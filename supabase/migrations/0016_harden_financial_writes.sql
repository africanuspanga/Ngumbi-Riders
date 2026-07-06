-- =========================================================================
-- 0016_harden_financial_writes.sql — lock down money tables (spec §22.3, §25.2)
--
-- Money must only be mutated by the controlled SECURITY DEFINER functions and
-- the service-role server code, never by a direct authenticated write. We
-- REVOKE INSERT/UPDATE/DELETE on the financial tables from anon + authenticated
-- (SELECT stays, still governed by RLS). The service role bypasses RLS and
-- retains full access; the definer functions run as the migration owner and are
-- unaffected.
-- =========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'payment_obligations',
    'payments',
    'payment_allocations',
    'payment_events',
    'payment_reservations',
    'receipts'
  ]
  loop
    execute format('revoke insert, update, delete on public.%I from anon, authenticated;', t);
  end loop;
end $$;

-- Signed contract documents and audit/login tables are also append-only from
-- the app's perspective; their writes already go through the service role.
revoke insert, update, delete on public.contract_documents from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.login_attempts from anon, authenticated;
revoke update, delete on public.contract_signatures from anon, authenticated;
