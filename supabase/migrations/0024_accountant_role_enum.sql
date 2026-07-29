-- =========================================================================
-- 0024_accountant_role_enum.sql — add the 'accountant' user role (spec #10)
--
-- SPLIT DELIBERATELY FROM 0025. Postgres refuses to USE a new enum label in
-- the same transaction that added it, and 0025's RLS policies compare
-- profiles.role against 'accountant'. Keeping the label on its own means 0025
-- can be applied as one transaction afterwards without erroring
-- ("unsafe use of new value of enum type"). Same reason 0022 added its
-- schedule_type labels ahead of use.
--
-- Additive and backfill-free: existing 'owner' / 'rider' profiles are untouched.
-- =========================================================================

alter type public.user_role add value if not exists 'accountant';
