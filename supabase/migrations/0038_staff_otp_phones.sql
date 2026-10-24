-- =========================================================================
-- 0038_staff_otp_phones.sql
--
-- WHERE A STAFF MEMBER'S SIGN-IN CODE GOES (D-053 amendment, 2026-10-24).
--
-- 0037 sent the code to the phone on the auth user. That broke on the first
-- real case: accountant DAUDI MWAKATIKA is also rider DAUD MWAKATIKA, and the
-- rider login already owns his number. Supabase allows a phone on ONE auth
-- user, so the accountant account could not carry it.
--
-- The code's destination is therefore its own fact, kept here. One person may
-- be a rider (phone = login identity) and staff (phone = where codes go) at
-- once. The auth phone stays what it was: an optional LOGIN identifier.
-- lib/auth/staff-otp.ts reads this table first and falls back to the auth
-- phone (the owner's number has always been there).
--
-- Service role only, like the 0037 tables.
-- =========================================================================

create table if not exists public.staff_otp_phones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.staff_otp_phones enable row level security;
revoke all on public.staff_otp_phones from anon, authenticated;
