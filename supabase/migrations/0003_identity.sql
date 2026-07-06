-- =========================================================================
-- 0003_identity.sql — settings, profiles, riders, guarantors (spec §9, §22)
-- Business numbers (NGR-R-0001) are human-readable; UUIDs are internal.
-- Sensitive values (NIDA, licence) are stored as app-level AES-256-GCM
-- ciphertext in *_private_data and are owner-only (spec §25.1).
-- =========================================================================

-- Singleton business/config row (spec §3.3, §10, §17.3).
create table public.app_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'Ng''umbi Riders',
  brand_primary_color text not null default '#2F8F46',
  timezone text not null default 'Africa/Dar_es_Salaam',
  currency text not null default 'TZS',
  default_installment_amount integer not null default 0
    check (default_installment_amount >= 0),
  payment_deadline_time time not null default '18:00',
  daily_summary_time time not null default '22:00',
  reminder_config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One profile per auth user. Owner has role='owner'; every rider has a profile.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text,
  must_change_pin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Rider operational record. Phone is the canonical E.164 string and is unique.
create table public.riders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  rider_number text not null unique,
  phone text not null unique
    check (phone ~ '^\+255[67][0-9]{8}$'),
  email citext,
  first_name text not null,
  middle_name text,
  last_name text not null,
  date_of_birth date,
  gender text,
  region text,
  district text,
  ward text,
  street text,
  full_address text,
  status rider_status not null default 'onboarding',
  risk_level risk_level not null default 'low',
  risk_reasons jsonb not null default '[]'::jsonb,
  -- NOTE: owner-only freeform notes live in rider_private_data.owner_notes, NOT
  -- here, so simple row-level RLS never leaks them to the rider's own-row read.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_riders_status on public.riders(status);
create trigger trg_riders_updated
  before update on public.riders
  for each row execute function public.set_updated_at();

-- Sensitive rider identifiers — owner-only, encrypted at the application layer.
create table public.rider_private_data (
  rider_id uuid primary key references public.riders(id) on delete cascade,
  nida_number_encrypted text,
  driving_licence_encrypted text,
  owner_notes text,                 -- owner-only; never exposed to riders
  encryption_key_version integer not null default 1,
  updated_at timestamptz not null default now()
);
create trigger trg_rider_private_updated
  before update on public.rider_private_data
  for each row execute function public.set_updated_at();

-- Documents a rider is allowed to view (private storage paths only).
create table public.rider_documents (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  rider_viewable boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_rider_documents_rider on public.rider_documents(rider_id);

-- Guarantors (two required for public applications; §8.4). Linked to the
-- application at submission and/or the rider after conversion.
create table public.guarantors (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references public.riders(id) on delete cascade,
  application_id uuid, -- FK added in 0004 after rider_applications exists
  full_name text not null,
  phone text not null,
  nida_number_encrypted text,
  residential_address text,
  relationship text,
  occupation text,
  employer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_guarantors_rider on public.guarantors(rider_id);
create trigger trg_guarantors_updated
  before update on public.guarantors
  for each row execute function public.set_updated_at();

create table public.guarantor_documents (
  id uuid primary key default gen_random_uuid(),
  guarantor_id uuid not null references public.guarantors(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- Seed the singleton settings row.
insert into public.app_settings (id) values (true) on conflict do nothing;
