-- =========================================================================
-- 0009_platform.sql — imports, login attempts, audit, job runs (§21, §25, §27)
-- =========================================================================

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null,     -- riders | motorcycles | contracts | ...
  status text not null default 'draft',   -- draft | validated | committed | rolled_back
  file_path text,                -- original file in restricted bucket
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  status text not null default 'pending',  -- valid | warning | error | inserted
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_import_rows_batch on public.import_rows(batch_id);

-- Login attempts (spec §7.3). Never stores the PIN. Written by the service role;
-- unauthenticated users must not read it (RLS: no policies -> deny all).
create table public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  phone text,                    -- canonical phone OR owner email key; nullable
  ip text not null,
  outcome login_outcome not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index idx_login_attempts_phone on public.login_attempts(phone, created_at);
create index idx_login_attempts_ip on public.login_attempts(ip, created_at);

-- Append-only audit trail (spec §25.2). No update/delete policies are granted.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_role text not null default 'system',
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index idx_audit_action on public.audit_logs(action, created_at);
create index idx_audit_entity on public.audit_logs(entity_type, entity_id);

-- Scheduled job run history (spec §27). Every job writes a record.
create table public.system_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',  -- running | success | failed
  counts jsonb not null default '{}'::jsonb,
  error_summary text
);
create index idx_job_runs_name on public.system_job_runs(job_name, started_at);
