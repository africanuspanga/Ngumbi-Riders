-- =========================================================================
-- 0007_payments.sql — obligations, payments, allocations, receipts (§11, §12, §13)
-- Whole-obligation accounting only: NO partially-paid status, allocation sums
-- and whole-obligation settlement are enforced by SECURITY DEFINER functions in
-- Phase 5. Uniqueness constraints here make webhook replay non-duplicating.
-- =========================================================================

create table public.payment_obligations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  rider_id uuid not null references public.riders(id) on delete restrict,
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  due_date date not null,
  due_at timestamptz not null,               -- UTC, computed in Africa/Dar_es_Salaam
  local_due_time time not null,              -- snapshot of deadline at generation
  amount_due integer not null check (amount_due > 0),
  status obligation_status not null default 'scheduled',
  settled_at timestamptz,
  paid_in_advance_at timestamptz,
  exemption_id uuid,                         -- FK added in 0008
  contract_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, due_date)             -- spec §11.3, §22.2
);
create index idx_obligations_rider_status
  on public.payment_obligations(rider_id, status);
create index idx_obligations_due_date on public.payment_obligations(due_date);
create trigger trg_obligations_updated
  before update on public.payment_obligations
  for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  method payment_method not null,
  amount integer not null check (amount > 0),
  status payment_status not null default 'created',
  payer_phone text,                          -- may belong to another person (§12.2)
  idempotency_key text not null unique,      -- local initiation key (§12.4)
  snippe_reference text unique,              -- provider reference (§22.2)
  provider_payment_id text,
  created_by uuid references public.profiles(id),  -- owner for cash payments
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_payments_rider on public.payments(rider_id);
create index idx_payments_status on public.payments(status);
create trigger trg_payments_updated
  before update on public.payments
  for each row execute function public.set_updated_at();

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  obligation_id uuid not null references public.payment_obligations(id) on delete restrict,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, obligation_id)
);
create index idx_allocations_obligation on public.payment_allocations(obligation_id);

-- Raw provider events in a restricted audit table (spec §12.1). Replay-safe via
-- unique provider event id and payload hash (spec §12.4, §22.2).
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  event_type text not null,
  provider_event_id text unique,
  payload_hash text unique,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

-- Reservations lock selected obligations during an in-flight payment (§12.4).
create table public.payment_reservations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  obligation_id uuid not null references public.payment_obligations(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- Only one active reservation per obligation.
create unique index uq_active_reservation_per_obligation
  on public.payment_reservations(obligation_id) where is_active;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  receipt_number text not null unique,       -- NGR-RCPT-2026-000001
  storage_path text,
  verification_code text not null,
  created_at timestamptz not null default now()
);
