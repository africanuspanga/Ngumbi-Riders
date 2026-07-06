-- =========================================================================
-- 0004_applications.sql — public rider applications (spec §8, §22)
-- Submitted through validated server endpoints only; anon has no table access.
-- =========================================================================

create table public.rider_applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,            -- e.g. NGR-APP-2026-000123
  status application_status not null default 'draft',
  first_name text not null,
  middle_name text,
  last_name text not null,
  date_of_birth date,
  gender text,
  primary_phone text not null,
  alternative_phone text,
  email citext,
  region text,
  district text,
  ward text,
  street text,
  full_address text,
  -- Sensitive identifiers stored as app-level ciphertext (spec §25.1).
  nida_number_encrypted text,
  driving_licence_encrypted text,
  previous_experience text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  duplicate_flags jsonb not null default '[]'::jsonb,
  converted_rider_id uuid references public.riders(id) on delete set null,
  resume_token_hash text,                    -- for secure draft resume (§8.6)
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_applications_status on public.rider_applications(status);
create index idx_applications_phone on public.rider_applications(primary_phone);
create trigger trg_applications_updated
  before update on public.rider_applications
  for each row execute function public.set_updated_at();

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.rider_applications(id) on delete cascade,
  doc_type text not null,      -- nida_front | nida_back | licence | photo | declaration
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index idx_application_documents_app
  on public.application_documents(application_id);

-- Now that applications exist, complete the guarantor back-reference.
alter table public.guarantors
  add constraint guarantors_application_fk
  foreign key (application_id)
  references public.rider_applications(id) on delete cascade;
