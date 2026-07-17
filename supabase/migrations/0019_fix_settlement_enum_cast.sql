-- =========================================================================
-- 0019_fix_settlement_enum_cast.sql — CRITICAL settlement bug fix (2026-07-17)
--
-- record_completed_payment (0014 → 0017 → 0018) marks each obligation with:
--
--     set status = case when due_date > v_local_today
--                       then 'paid_in_advance' else 'paid' end
--
-- A CASE over two untyped string literals resolves to `text`, and PostgreSQL
-- has NO implicit cast from text to the `obligation_status` enum, so the
-- UPDATE raises:
--
--     42804: column "status" is of type obligation_status but expression is
--            of type text
--
-- This bug has been present since 0014, i.e. settlement has NEVER succeeded on
-- a real Postgres. The unit tests are node-only (no DB), no local `supabase
-- start` (no Docker) and the RLS suite never calls settlement, so it shipped.
--
-- Live symptom (verified 2026-07-17 on ref rdofxxxdrqnhtewwzous):
--   * 2 `payment.completed` webhooks arrived, 0 payments reached 'completed',
--     0 receipts — the webhook's rpc('record_completed_payment') threw a
--     non-invariant error → HTTP 500 → Snippe retried until the rider gave up
--     and the record was cancelled (Bug #1: "money on Snippe, not on owner
--     dashboard").
--   * 3 cash payments are stuck 'failed' (900,000 TZS) because recordCashPayment
--     hit the same throw and flagged 'settlement_failed' (Bug #12).
--
-- SECOND latent bug (surfaced once the enum bug was fixed): the receipt insert
-- calls encode(gen_random_bytes(6), 'hex'). pgcrypto is installed in the
-- `extensions` schema on Supabase, which is NOT on the function's hardened
-- search_path (public, pg_temp), so it raised
-- `function gen_random_bytes(integer) does not exist` — meaning settlement
-- could never have completed even without the enum bug.
--
-- Fix: (a) cast each CASE branch explicitly to obligation_status, and
-- (b) fully-qualify extensions.gen_random_bytes. Everything else in the 0018
-- function body is reproduced verbatim (all guards preserved). CREATE OR
-- REPLACE keeps the existing grants (0014/0016 service_role execute).
-- =========================================================================

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

    -- FIX (0019): cast each branch to obligation_status. A bare CASE over
    -- string literals is `text`, which has no implicit cast to the enum.
    update public.payment_obligations
      set status = case when due_date > v_local_today
                        then 'paid_in_advance'::public.obligation_status
                        else 'paid'::public.obligation_status end,
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

  -- FIX (0019): fully-qualify gen_random_bytes. pgcrypto lives in the
  -- `extensions` schema on Supabase, which is NOT on this definer function's
  -- hardened search_path (public, pg_temp) — the bare name raised
  -- `function gen_random_bytes(integer) does not exist`, the second reason
  -- settlement never completed. gen_random_uuid() is fine (also in pg_catalog).
  insert into public.receipts (payment_id, receipt_number, verification_code)
    values (p_payment_id, v_receipt_number, encode(extensions.gen_random_bytes(6), 'hex'))
    on conflict (payment_id) do nothing;

  update public.payment_reservations
    set is_active = false where payment_id = p_payment_id;
end;
$$;
