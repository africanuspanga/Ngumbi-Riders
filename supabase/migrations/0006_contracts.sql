-- =========================================================================
-- 0006_contracts.sql — contract engine (spec §10, §22)
-- Financial state transitions (activate, regenerate, renegotiate) run through
-- SECURITY DEFINER functions added in later phases; these are the tables.
-- =========================================================================

create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null unique,
  rider_id uuid not null references public.riders(id) on delete restrict,
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  assignment_id uuid references public.motorcycle_assignments(id) on delete restrict,
  contract_type text not null default 'fixed_term_lease',
  ownership_transfers boolean not null default false,
  ownership_transfer_notes text,
  start_date date,
  end_date date,
  duration_months integer check (duration_months is null or duration_months > 0),
  schedule_type schedule_type not null default 'daily',
  selected_weekdays smallint[] not null default '{}',  -- 0=Sun .. 6=Sat
  installment_amount integer not null default 0 check (installment_amount >= 0),
  payment_deadline_time time not null default '18:00',
  currency text not null default 'TZS',
  template_version integer,
  special_terms text,
  status contract_status not null default 'draft',
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One ACTIVE contract per rider (spec §22.2). Owner must close the previous
-- contract before another can activate.
create unique index uq_active_contract_per_rider
  on public.contracts(rider_id) where status = 'active';
create index idx_contracts_rider on public.contracts(rider_id);
create index idx_contracts_status on public.contracts(status);
create trigger trg_contracts_updated
  before update on public.contracts
  for each row execute function public.set_updated_at();

create table public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (contract_id, version)
);

create table public.contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  event_type text not null,   -- pause | resume | extend | renegotiate | terminate | ...
  effective_date date not null,
  reason text,
  financial_impact jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_contract_events_contract on public.contract_events(contract_id);

create table public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  signer_role text not null,   -- owner | rider | guarantor | witness
  signer_name text,
  signature_image_path text,
  method text,                 -- drawn | physical_upload
  ip text,
  user_agent text,
  signed_at timestamptz not null default now()
);
create index idx_contract_signatures_contract on public.contract_signatures(contract_id);

-- Signed documents are immutable (spec §10.5, §22.2). Enforced by a trigger in
-- the phase that generates them; addenda are separate rows, never overwrites.
create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  doc_type text not null default 'contract',  -- contract | addendum
  storage_path text not null,
  sha256_hash text,
  version integer not null default 1,
  is_signed boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_contract_documents_contract on public.contract_documents(contract_id);
