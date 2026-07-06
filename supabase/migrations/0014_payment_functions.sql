-- =========================================================================
-- 0014_payment_functions.sql — transactional payment settlement (spec §12, §22.2)
--
-- Marks a payment complete, allocates it to WHOLE obligations, settles them,
-- writes the receipt, and releases reservations — all in ONE transaction and
-- IDEMPOTENTLY (safe to call twice for the same webhook / retry). Used by both
-- the Snippe webhook and owner cash payments.
--
-- Invariant enforced: completed allocations for the payment MUST equal the
-- payment amount, and every allocation settles a whole obligation. Called only
-- with the service role (webhook has no user JWT); execute is revoked from
-- anon/authenticated.
-- =========================================================================

create or replace function public.record_completed_payment(
  p_payment_id uuid,
  p_obligation_ids uuid[],
  p_receipt_number text,
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

  insert into public.receipts (payment_id, receipt_number, verification_code)
    values (p_payment_id, p_receipt_number, encode(gen_random_bytes(6), 'hex'))
    on conflict (payment_id) do nothing;

  update public.payment_reservations
    set is_active = false where payment_id = p_payment_id;
end;
$$;

revoke all on function public.record_completed_payment(uuid, uuid[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_completed_payment(uuid, uuid[], text, timestamptz) to service_role;
