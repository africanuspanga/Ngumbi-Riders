-- =========================================================================
-- 0005_motorcycles.sql — register, assignments, expense ledger (spec §9, §3.6)
-- =========================================================================

create table public.motorcycles (
  id uuid primary key default gen_random_uuid(),
  motorcycle_number text not null unique,          -- internal number
  registration_number text not null unique,        -- unique plate (spec §22.2)
  make text,
  model text,
  status motorcycle_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_motorcycles_updated
  before update on public.motorcycles
  for each row execute function public.set_updated_at();

-- Assignment history is immutable in practice; transfers close the current row
-- and open a new one (spec §9.4). Enforced by partial unique indexes below.
create table public.motorcycle_assignments (
  id uuid primary key default gen_random_uuid(),
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  rider_id uuid not null references public.riders(id) on delete restrict,
  is_active boolean not null default true,
  start_date date not null,
  end_date date,
  transfer_reason text,
  created_at timestamptz not null default now()
);
-- One active assignment per motorcycle and per rider (spec §22.2).
create unique index uq_active_assignment_per_motorcycle
  on public.motorcycle_assignments(motorcycle_id) where is_active;
create unique index uq_active_assignment_per_rider
  on public.motorcycle_assignments(rider_id) where is_active;
create index idx_assignments_rider on public.motorcycle_assignments(rider_id);

-- Lightweight expense ledger feeding the cash-operating-margin report (§3.6).
create table public.motorcycle_expenses (
  id uuid primary key default gen_random_uuid(),
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  expense_date date not null,
  category text not null,
  amount integer not null check (amount > 0),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_expenses_motorcycle on public.motorcycle_expenses(motorcycle_id);
