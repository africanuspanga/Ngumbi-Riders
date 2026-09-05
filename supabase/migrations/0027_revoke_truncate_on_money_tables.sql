-- =========================================================================
-- 0027_revoke_truncate_on_money_tables.sql
--
-- Found while verifying 0026: every `authenticated` user — including every
-- RIDER — held TRUNCATE on the money and audit tables.
--
-- Migration 0016 revoked INSERT/UPDATE/DELETE so money could only move through
-- the controlled SECURITY DEFINER functions, but TRUNCATE was not in that list
-- and Supabase's default privileges grant it. TRUNCATE **ignores RLS entirely**
-- and fires no row triggers, so the one privilege that could erase the whole
-- ledger in a single statement was the one still granted.
--
-- No route in this application issues TRUNCATE, and PostgREST exposes no verb
-- that maps to it, so there is no known reachable exploit — but "not currently
-- reachable" is not a security boundary. The service role (which bypasses
-- grants) and the migration owner are unaffected, so nothing legitimate loses
-- an ability here.
-- =========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    -- money
    'payment_obligations',
    'payments',
    'payment_allocations',
    'payment_events',
    'payment_reservations',
    'receipts',
    'cash_payment_requests',
    'phone_loans',
    -- signed/immutable records and the audit trail
    'contract_documents',
    'contract_signatures',
    'audit_logs',
    'login_attempts'
  ]
  loop
    execute format('revoke truncate on public.%I from anon, authenticated;', t);
  end loop;
end $$;
