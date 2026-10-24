-- =========================================================================
-- 0037_staff_sms_otp.sql
--
-- SMS ONE-TIME CODE AT STAFF SIGN-IN (client request 2026-10-24, D-053).
--
-- The owner and accountants sign in with email/phone + password. A password
-- alone is one factor: whoever learns it reads the whole ledger. From now on a
-- correct password only earns a 6-digit code sent by SMS to the phone on the
-- account; the session is created after the code is entered.
--
-- WHY THE DATABASE HAS TO KNOW
-- Gating only the app's login route would be decoration. The Supabase anon key
-- is public (it ships in every browser bundle), so anybody holding the
-- password can call Supabase Auth directly, receive a perfectly valid JWT and
-- query PostgREST with it — never touching our login route at all. So the
-- staff RLS helpers now also ask: was THIS session (the JWT's `session_id`
-- claim) produced by a completed SMS challenge? A session that skipped the
-- code is signed in but is neither owner nor accountant in any policy.
--
--   staff_login_challenges  one row per code sent. Only an HMAC of the code is
--                           stored; attempts are counted on the row.
--   staff_verified_sessions the Supabase sessions that passed a challenge.
--   staff_session_ok()      true when the kill switch is off, or the caller's
--                           session is in staff_verified_sessions.
--   is_owner()/is_accountant()  now AND staff_session_ok(). is_staff() is
--                           built from the two, so it inherits the rule.
--
-- THE KILL SWITCH — app_settings.staff_otp_required — ships OFF.
-- Turning it on before the OTP-aware app is deployed would make every staff
-- session (including the one being used right now) unverified, i.e. lock the
-- business out of its own data. Order of operations:
--   1. apply this migration (switch off: behaviour unchanged);
--   2. deploy the app;
--   3. owner adds each accountant's phone at /owner/staff;
--   4. flip the switch on (UPDATE app_settings SET staff_otp_required = true).
-- If SMS ever fails completely, flipping it off is the break-glass — done via
-- the Management API, deliberately not from the app (a session that has not
-- passed the code is not the owner, so it cannot switch the code off).
--
-- Service role only: no grants to anon/authenticated on either table.
-- =========================================================================

alter table public.app_settings
  add column if not exists staff_otp_required boolean not null default false;

comment on column public.app_settings.staff_otp_required is
  'D-053. When true, owner/accountant sessions count as staff in RLS only after an SMS code was verified for that session. Break-glass: set false via the Management API.';

create table if not exists public.staff_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- HMAC_SHA256(pepper, id || ':' || code). The code itself is never stored.
  code_hash text not null,
  -- Where the code went, E.164. Kept so a resend goes to the same number.
  phone text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  sent_count smallint not null default 1,
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists staff_login_challenges_user_recent_idx
  on public.staff_login_challenges (user_id, created_at desc);

create table if not exists public.staff_verified_sessions (
  -- The `session_id` claim of the Supabase JWT. Stable across token refresh,
  -- so one verification lasts as long as the session does.
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid references public.staff_login_challenges(id) on delete set null,
  verified_at timestamptz not null default now()
);

create index if not exists staff_verified_sessions_user_idx
  on public.staff_verified_sessions (user_id);

alter table public.staff_login_challenges enable row level security;
alter table public.staff_verified_sessions enable row level security;
revoke all on public.staff_login_challenges from anon, authenticated;
revoke all on public.staff_verified_sessions from anon, authenticated;

-- ---- the rule --------------------------------------------------------------

create or replace function public.staff_session_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    not coalesce((select staff_otp_required from public.app_settings limit 1), false)
    or exists (
      select 1 from public.staff_verified_sessions s
      where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
    );
$$;

revoke all on function public.staff_session_ok() from public, anon;
grant execute on function public.staff_session_ok() to authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  ) and public.staff_session_ok();
$$;

create or replace function public.is_accountant()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'accountant' and is_active
  ) and public.staff_session_ok();
$$;

revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_accountant() from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_accountant() to authenticated;
