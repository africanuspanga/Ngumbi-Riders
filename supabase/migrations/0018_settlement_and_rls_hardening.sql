-- =========================================================================
-- 0018_settlement_and_rls_hardening.sql — deep-dive review fixes (2026-07-10)
--
-- 1. record_completed_payment becomes self-defending: it refuses to settle a
--    payment outside 'created'/'pending' (a late payment.completed after a
--    failure/reversal must be reconciled by a human, never auto-settled), and
--    for every obligation it verifies (a) the obligation belongs to the
--    payment's rider, (b) the obligation is still outstanding — an
--    exempted/postponed/cancelled obligation raises instead of being silently
--    flipped back to 'paid' (which reversed owner waivers / double-billed
--    postponements), and (c) no OTHER payment holds an active reservation on
--    it (a cash payment could previously settle obligations reserved by an
--    in-flight mobile payment, stranding the rider's mobile money).
-- 2. apply_exemption_waiver / apply_postponement verify the obligation belongs
--    to the exemption's rider (a spoofed exemption row could otherwise make
--    the owner waive a DIFFERENT rider's obligation) and refuse obligations
--    with an active payment reservation (racing an in-flight payment).
-- 3. Contract activation refuses an empty obligation calendar.
-- 4. exemptions_self_insert / incidents_self_insert RLS policies pin the
--    inserted status and (for exemptions) require the obligation to belong to
--    the inserting rider and forbid pre-filled decision columns.
-- 5. Riders may only update notifications.read_at (column-level grant), not
--    rewrite notification content.
-- 6. Housekeeping: one open exemption per obligation, app_settings updated_at
--    trigger, missing FK/hot-path indexes, receipt sequence starts at 1.
--
-- All functions are CREATE OR REPLACE — existing grants (0013/0014/0015) are
-- preserved. search_path now includes pg_temp last (definer hygiene).
-- =========================================================================

-- ---- 1. record_completed_payment ------------------------------------------
create or replace function public.record_completed_payment(
  p_payment_id uuid,
  p_obligation_ids uuid[],
  p_receipt_number text,   -- ignored (kept for signature stability)
  p_completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_ob record;
  v_local_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_alloc_total integer;
  v_receipt_number text;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;

  -- Idempotent: a replayed webhook for an already-completed payment is a no-op.
  if v_payment.status = 'completed' then return; end if;

  -- A payment that already failed/expired/was cancelled or reversed must never
  -- be auto-settled by a late out-of-order event — by then its obligations may
  -- be re-reserved or re-settled by another payment. Surface for manual
  -- reconciliation instead.
  if v_payment.status not in ('created', 'pending') then
    raise exception 'invalid_payment_status: %', v_payment.status;
  end if;

  for v_ob in
    select * from public.payment_obligations
    where id = any(p_obligation_ids) for update
  loop
    -- Skip anything already settled so replays never double-allocate.
    if v_ob.status in ('paid', 'paid_in_advance') then
      continue;
    end if;

    -- Never settle over an exempted/postponed/cancelled obligation: that would
    -- silently reverse an owner waiver or double-bill a postponed day.
    if v_ob.status not in ('scheduled', 'due', 'overdue') then
      raise exception 'obligation_not_outstanding: % is %', v_ob.id, v_ob.status;
    end if;

    -- Money must land on the payment's own rider.
    if v_ob.rider_id <> v_payment.rider_id then
      raise exception 'obligation_rider_mismatch: %', v_ob.id;
    end if;

    -- An obligation actively reserved by a DIFFERENT in-flight payment belongs
    -- to that payment's settlement; settling it here would strand the other
    -- payment's money on allocation_mismatch.
    if exists (
      select 1 from public.payment_reservations r
      where r.obligation_id = v_ob.id and r.is_active and r.payment_id <> p_payment_id
    ) then
      raise exception 'obligation_reserved_by_other_payment: %', v_ob.id;
    end if;

    insert into public.payment_allocations (payment_id, obligation_id, amount)
      values (p_payment_id, v_ob.id, v_ob.amount_due)
      on conflict (payment_id, obligation_id) do nothing;

    update public.payment_obligations
      set status = case when due_date > v_local_today then 'paid_in_advance' else 'paid' end,
          settled_at = p_completed_at
      where id = v_ob.id;
  end loop;

  -- Money integrity: allocations must sum to exactly the payment amount.
  select coalesce(sum(amount), 0) into v_alloc_total
    from public.payment_allocations where payment_id = p_payment_id;
  if v_alloc_total <> v_payment.amount then
    raise exception 'allocation_mismatch: % <> %', v_alloc_total, v_payment.amount;
  end if;

  update public.payments
    set status = 'completed', completed_at = p_completed_at
    where id = p_payment_id;

  v_receipt_number := 'NGR-RCPT-'
    || to_char(p_completed_at at time zone 'Africa/Dar_es_Salaam', 'YYYY')
    || '-' || lpad(nextval('private.receipt_number_seq')::text, 6, '0');

  insert into public.receipts (payment_id, receipt_number, verification_code)
    values (p_payment_id, v_receipt_number, encode(gen_random_bytes(6), 'hex'))
    on conflict (payment_id) do nothing;

  update public.payment_reservations
    set is_active = false where payment_id = p_payment_id;
end;
$$;

-- Receipt numbering should start at 000001 on a fresh ledger (0017 seeded the
-- sequence so the first nextval returned 2). Safe re-seed: next value =
-- receipts so far + 1.
select setval(
  'private.receipt_number_seq',
  (select count(*) from public.receipts) + 1,
  false
);

-- ---- 2. Exemption decision functions ---------------------------------------
create or replace function public.apply_exemption_waiver(
  p_exemption_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ex public.exemption_requests%rowtype;
  v_ob public.payment_obligations%rowtype;
  v_rows integer;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;

  select * into v_ex from public.exemption_requests where id = p_exemption_id for update;
  if not found then raise exception 'exemption_not_found'; end if;
  if v_ex.status not in ('submitted', 'under_review') then
    raise exception 'already_decided';
  end if;

  select * into v_ob from public.payment_obligations where id = v_ex.obligation_id for update;
  if not found then raise exception 'obligation_not_found'; end if;
  -- The exemption must target its own rider's obligation — a forged request
  -- row must never let the owner waive a DIFFERENT rider's obligation.
  if v_ob.rider_id <> v_ex.rider_id then raise exception 'rider_mismatch'; end if;
  -- An obligation reserved by an in-flight payment is about to be settled;
  -- deciding it now races the settlement. Decide after the payment resolves.
  if exists (
    select 1 from public.payment_reservations r
    where r.obligation_id = v_ob.id and r.is_active
  ) then
    raise exception 'obligation_reserved';
  end if;

  update public.payment_obligations
    set status = 'exempted', exemption_id = p_exemption_id
    where id = v_ex.obligation_id
      and status in ('scheduled', 'due', 'overdue');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'obligation_not_actionable';
  end if;

  update public.exemption_requests
    set status = 'approved_waived', decided_by = auth.uid(), decided_at = now()
    where id = p_exemption_id;
end;
$$;

create or replace function public.apply_postponement(
  p_exemption_id uuid,
  p_new_date date,
  p_due_at timestamptz,
  p_local_due_time time
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ex public.exemption_requests%rowtype;
  v_ob public.payment_obligations%rowtype;
  v_contract public.contracts%rowtype;
  v_new_id uuid;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;

  select * into v_ex from public.exemption_requests where id = p_exemption_id for update;
  if not found then raise exception 'exemption_not_found'; end if;
  if v_ex.status not in ('submitted', 'under_review') then
    raise exception 'already_decided';
  end if;

  select * into v_ob from public.payment_obligations where id = v_ex.obligation_id for update;
  if not found then raise exception 'obligation_not_found'; end if;
  -- Same integrity guards as the waiver path (see comments there).
  if v_ob.rider_id <> v_ex.rider_id then raise exception 'rider_mismatch'; end if;
  if exists (
    select 1 from public.payment_reservations r
    where r.obligation_id = v_ob.id and r.is_active
  ) then
    raise exception 'obligation_reserved';
  end if;
  -- Never rewrite settled/cancelled history (spec rule 6): only an obligation
  -- that is still owed can be postponed.
  if v_ob.status not in ('scheduled', 'due', 'overdue') then
    raise exception 'obligation_not_actionable';
  end if;

  select * into v_contract from public.contracts where id = v_ob.contract_id;

  -- A postponed date must not collide with an existing obligation (spec §11.3).
  if exists (select 1 from public.payment_obligations
             where contract_id = v_ob.contract_id and due_date = p_new_date) then
    raise exception 'date_conflict';
  end if;

  -- Preserve the original obligation for history.
  update public.payment_obligations
    set status = 'postponed', exemption_id = p_exemption_id
    where id = v_ob.id;

  -- Create the replacement obligation at the new date.
  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version
  ) values (
    v_ob.contract_id, v_ob.rider_id, v_ob.motorcycle_id, p_new_date, p_due_at,
    p_local_due_time, v_ob.amount_due, 'scheduled', coalesce(v_contract.current_version, 1)
  ) returning id into v_new_id;

  update public.exemption_requests
    set status = 'approved_postponed', postponed_to_date = p_new_date,
        decided_by = auth.uid(), decided_at = now()
    where id = p_exemption_id;

  return v_new_id;
end;
$$;

-- ---- 3. Contract activation: refuse an empty calendar ----------------------
create or replace function public.activate_contract_and_generate_obligations(
  p_contract_id uuid,
  p_obligations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_count integer;
  v_has_owner_sig boolean;
  v_has_rider_sig boolean;
  v_has_signed_doc boolean;
begin
  if not public.is_owner() then
    raise exception 'forbidden';
  end if;

  select * into v_contract from public.contracts
    where id = p_contract_id for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.status = 'active' then raise exception 'already_active'; end if;
  -- Only pre-active contracts may be activated; a paused/terminated/completed
  -- contract must never come back through this path.
  if v_contract.status not in ('draft', 'awaiting_signatures', 'scheduled') then
    raise exception 'invalid_status: %', v_contract.status;
  end if;
  if coalesce(v_contract.installment_amount, 0) <= 0 then
    raise exception 'invalid_amount';
  end if;

  select exists (select 1 from public.contract_signatures
      where contract_id = p_contract_id and signer_role = 'owner')
    into v_has_owner_sig;
  select exists (select 1 from public.contract_signatures
      where contract_id = p_contract_id and signer_role = 'rider')
    into v_has_rider_sig;
  select exists (select 1 from public.contract_documents
      where contract_id = p_contract_id and is_signed)
    into v_has_signed_doc;

  if not ((v_has_owner_sig and v_has_rider_sig) or v_has_signed_doc) then
    raise exception 'signatures_required';
  end if;

  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version
  )
  select
    p_contract_id, v_contract.rider_id, v_contract.motorcycle_id,
    (o->>'dueDate')::date,
    (o->>'dueAtUtc')::timestamptz,
    (o->>'localDueTime')::time,
    v_contract.installment_amount,
    'scheduled',
    v_contract.current_version
  from jsonb_array_elements(p_obligations) as o
  on conflict (contract_id, due_date) do nothing;

  get diagnostics v_count = row_count;

  -- "A contract can never be active without its calendar" — an empty (or
  -- fully-conflicting) obligation list must not produce an active contract
  -- with nothing to collect.
  if not exists (
    select 1 from public.payment_obligations
    where contract_id = p_contract_id
      and status in ('scheduled', 'due', 'overdue')
  ) then
    raise exception 'empty_calendar';
  end if;

  update public.contracts set status = 'active' where id = p_contract_id;

  return v_count;
end;
$$;

-- ---- 4. Rider-insert RLS policies pin the inserted shape --------------------
-- A rider inserting via PostgREST directly (RLS is the decisive boundary) must
-- not be able to file an exemption against another rider's obligation, pre-set
-- decision columns, or open an incident born 'resolved'.
drop policy exemptions_self_insert on public.exemption_requests;
create policy exemptions_self_insert on public.exemption_requests
  for insert to authenticated
  with check (
    rider_id = public.current_rider_id()
    and status = 'submitted'
    and decided_by is null
    and decided_at is null
    and decision_note is null
    and postponed_to_date is null
    and exists (
      select 1 from public.payment_obligations o
      where o.id = obligation_id
        and o.rider_id = public.current_rider_id()
    )
  );

drop policy incidents_self_insert on public.incident_reports;
create policy incidents_self_insert on public.incident_reports
  for insert to authenticated
  with check (
    rider_id = public.current_rider_id()
    and status = 'open'
  );

-- One open exemption request per obligation (queue-spam guard).
create unique index if not exists uq_open_exemption_per_obligation
  on public.exemption_requests(obligation_id)
  where status in ('submitted', 'under_review');

-- ---- 5. Riders may only mark their notifications read ----------------------
-- Row-level policy already scopes to own rows; the column-level grant stops a
-- rider rewriting title/body/deep_link of a payment reminder. Owner-side
-- notification writes go through the service role and are unaffected.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---- 6. Housekeeping --------------------------------------------------------
-- app_settings was the one updated_at table without the shared trigger.
create trigger trg_app_settings_updated
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Missing FK / hot-path indexes.
create index if not exists idx_payments_contract on public.payments(contract_id);
create index if not exists idx_obligations_exemption
  on public.payment_obligations(exemption_id) where exemption_id is not null;
create index if not exists idx_reservations_payment
  on public.payment_reservations(payment_id);
create index if not exists idx_contracts_motorcycle on public.contracts(motorcycle_id);
