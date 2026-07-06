-- =========================================================================
-- 0002_helpers.sql — schemas, auth helpers, shared triggers (spec §22.3, §23)
-- =========================================================================

-- Private schema for future SECURITY DEFINER transaction functions
-- (activate_contract, complete_snippe_payment, record_cash_payment, ...).
-- Not exposed through the API. Direct table writes are revoked where a
-- controlled function is required (added alongside those functions in later
-- phases).
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- ---- updated_at trigger --------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---- Authorization helpers ----------------------------------------------
-- SECURITY DEFINER + owned by the migration role so they bypass RLS on
-- `profiles`/`riders`, preventing infinite recursion inside RLS policies.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.current_rider_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.riders where profile_id = auth.uid();
$$;

-- Callable by signed-in users inside policies, but not by anon.
revoke all on function public.is_owner() from public;
revoke all on function public.current_rider_id() from public;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.current_rider_id() to authenticated;
