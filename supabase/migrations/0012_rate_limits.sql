-- =========================================================================
-- 0012_rate_limits.sql — generic durable rate limiting (spec §25.2)
-- Throttles public/expensive actions (application submission, file uploads).
-- Written and read only by the service role; RLS is enabled with NO policies so
-- anon/authenticated get nothing.
-- =========================================================================

create table public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,      -- e.g. 'application_submit'
  subject text not null,     -- rate-limit key, e.g. an IP address
  created_at timestamptz not null default now()
);
create index idx_rate_limit_lookup
  on public.rate_limit_events(action, subject, created_at);

alter table public.rate_limit_events enable row level security;

-- Periodic cleanup keeps the table small (old rows are irrelevant once outside
-- any window). A scheduled job prunes rows older than a day in Phase 8.
