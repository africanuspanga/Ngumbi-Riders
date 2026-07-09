-- =========================================================================
-- 0017_fix_state_guards.sql — deep-dive bug fixes (2026-07-09 review)
--
-- 1. Receipt numbers move to a Postgres sequence allocated INSIDE
--    record_completed_payment. The old count(*)+1 computed in TypeScript was
--    racy: two concurrent settlements produced the same number, violated the
--    UNIQUE constraint and rolled back a legitimate settlement. The
--    p_receipt_number parameter is retained for signature stability but is
--    now ignored.
-- 2. apply_postponement gained status guards: it could previously flip a
--    PAID obligation to 'postponed' (double-billing the rider) and re-decide
--    an already-decided exemption. apply_exemption_waiver now also rejects
--    already-decided exemptions and no-op waivers.
-- 3. activate_contract_and_generate_obligations now only activates contracts
--    in a pre-active state ('draft','awaiting_signatures','scheduled') —
--    previously a terminated contract could be re-activated with a cancelled
--    calendar.
-- =========================================================================

-- ---- 1. Receipt number sequence -----------------------------------------
create schema if not exists private;
create sequence if not exists private.receipt_number_seq;
revoke all on sequence private.receipt_number_seq from public, anon, authenticated;

create or replace function public.record_completed_payment(
  p_payment_id uuid,
  p_obligation_ids uuid[],
  p_receipt_number text,   -- ignored (kept for signature stability); the
                           -- number is allocated from private.receipt_number_seq
  p_completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
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

  for v_ob in
    select * from public.payment_obligations
    where id = any(p_obligation_ids) for update
  loop
    -- Skip anything already settled so replays never double-allocate.
    if v_ob.status in ('paid', 'paid_in_advance') then
      continue;
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

-- Seed the sequence past any receipts that already exist.
select setval(
  'private.receipt_number_seq',
  greatest((select count(*) from public.receipts), 1)
);

-- ---- 2. Exemption decision guards ----------------------------------------
create or replace function public.apply_exemption_waiver(
  p_exemption_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.exemption_requests%rowtype;
  v_rows integer;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;

  select * into v_ex from public.exemption_requests where id = p_exemption_id for update;
  if not found then raise exception 'exemption_not_found'; end if;
  if v_ex.status not in ('submitted', 'under_review') then
    raise exception 'already_decided';
  end if;

  update public.payment_obligations
    set status = 'exempted', exemption_id = p_exemption_id
    where id = v_ex.obligation_id
      and status in ('scheduled', 'due', 'overdue');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- Already paid/cancelled/postponed — refuse rather than record a waiver
    -- that changed nothing.
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
set search_path = public
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

-- ---- 3. Contract activation state guard -----------------------------------
create or replace function public.activate_contract_and_generate_obligations(
  p_contract_id uuid,
  p_obligations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
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

  update public.contracts set status = 'active' where id = p_contract_id;

  return v_count;
end;
$$;
