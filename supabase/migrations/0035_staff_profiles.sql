-- =========================================================================
-- 0035_staff_profiles.sql
--
-- STAFF / ADMINISTRATION PROFILES (client feedback 2026-09-11 #9).
--
-- "Full name, phone, email, role, education profile, work experience,
--  employment status, attached certificates, start date, notes. When these
--  details are entered, the staff profile should go to the director for review
--  or approval."
--
-- WHY A SEPARATE TABLE AND NOT MORE COLUMNS ON `profiles`
--
-- `profiles` is the AUTHENTICATION record. Every RLS helper in this database —
-- is_owner(), is_accountant(), is_staff() — reads it on virtually every query,
-- and 0026 opened a staff-wide SELECT policy on it so colleagues can see each
-- other's display names. Hanging an employee's education history, salary-
-- adjacent notes and employment status off that row would publish all of it
-- through a policy that exists for a completely different reason, and would
-- widen the hottest table in the schema. So: one row per staff member in its
-- own table, with its own policies.
--
-- WHO MAY SEE WHAT
--
--   an employee   their OWN profile and certificates, and may edit them while
--                 the record is a draft or has been returned to them
--   the Director  everything, and is the only role that approves a profile or
--                 sets an employment status
--   an accountant NOT their colleagues' records. A second accountant's
--                 education history and employment status is not finance data,
--                 and is_staff() would have handed it over.
--
-- That last line is the reason the policies below name `is_owner()` explicitly
-- instead of reusing `is_staff()` the way every other table added in this build
-- does.
-- =========================================================================

-- =========================================================================
-- 1. ENUMS
-- =========================================================================

do $$ begin
  create type employment_status as enum ('probation', 'permanent', 'inactive', 'terminated');
exception when duplicate_object then null; end $$;

-- The review chain the client asked for: an employee fills the record in and
-- submits it; the Director approves it or returns it with a note.
do $$ begin
  create type staff_profile_review_status as enum ('draft', 'submitted', 'approved', 'returned');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. THE PROFILE
-- =========================================================================
-- full_name, email and role are NOT duplicated here: they live on `profiles`
-- and duplicating them guarantees two answers to one question the first time
-- somebody is renamed. This table holds only what `profiles` does not.

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  -- Personal phone. Deliberately NOT validated against the rider phone regex:
  -- staff may carry a foreign or landline number, and a constraint that
  -- rejects a real number is worse than a free-text field.
  phone text check (phone is null or length(phone) between 5 and 32),
  -- What they do, in words, as distinct from their SYSTEM role on `profiles`.
  job_title text check (job_title is null or length(job_title) <= 120),
  employment_status employment_status not null default 'probation',
  start_date date,
  end_date date,
  education text check (education is null or length(education) <= 4000),
  work_experience text check (work_experience is null or length(work_experience) <= 4000),
  notes text check (notes is null or length(notes) <= 4000),
  review_status staff_profile_review_status not null default 'draft',
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_profiles_dates_ordered
    check (end_date is null or start_date is null or end_date >= start_date)
);

comment on table public.staff_profiles is
  'HR record for an owner/accountant account. Separate from public.profiles, which is the authentication record read by every RLS helper.';

create index if not exists idx_staff_profiles_review
  on public.staff_profiles(review_status, submitted_at desc);
create index if not exists idx_staff_profiles_employment
  on public.staff_profiles(employment_status);

drop trigger if exists trg_staff_profiles_updated on public.staff_profiles;
create trigger trg_staff_profiles_updated
  before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3. CERTIFICATES
-- =========================================================================
-- Education certificates, professional certificates, training certificates,
-- experience letters and anything else. Private bucket + signed URLs, and a
-- sha256 so a downloaded file can be checked against the record — the same
-- treatment every other document in this system gets (spec §24).

create table if not exists public.staff_certificates (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('education', 'professional', 'training', 'experience_letter', 'other')),
  title text not null check (length(title) between 2 and 200),
  issuer text check (issuer is null or length(issuer) <= 200),
  issued_on date,
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256_hash text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_certificates_profile
  on public.staff_certificates(staff_profile_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('staff-documents', 'staff-documents', false)
on conflict (id) do nothing;

drop policy if exists storage_staff_documents_owner on storage.objects;
create policy storage_staff_documents_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'staff-documents' and public.is_owner())
  with check (bucket_id = 'staff-documents' and public.is_owner());

-- =========================================================================
-- 4. GUARD — an approved record is the Director's, not the employee's
-- =========================================================================
-- Without this, an employee could submit a modest record, have it approved,
-- and then edit their employment status to 'permanent'. Approval has to mean
-- something, so an approved record reverts to 'submitted' the moment its
-- substance changes, and the Director sees it again.

create or replace function public.guard_staff_profile_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  substance_old jsonb;
  substance_new jsonb;
begin
  substance_old := jsonb_build_object(
    'phone', old.phone, 'job_title', old.job_title, 'start_date', old.start_date,
    'end_date', old.end_date, 'education', old.education,
    'work_experience', old.work_experience, 'notes', old.notes
  );
  substance_new := jsonb_build_object(
    'phone', new.phone, 'job_title', new.job_title, 'start_date', new.start_date,
    'end_date', new.end_date, 'education', new.education,
    'work_experience', new.work_experience, 'notes', new.notes
  );

  if old.review_status = 'approved'
     and new.review_status = 'approved'
     and substance_old is distinct from substance_new then
    new.review_status := 'submitted';
    new.submitted_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := 'Re-submitted automatically: the record changed after approval.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_profiles_review_guard on public.staff_profiles;
create trigger trg_staff_profiles_review_guard
  before update on public.staff_profiles
  for each row execute function public.guard_staff_profile_review();

revoke all on function public.guard_staff_profile_review() from public, anon, authenticated;

-- =========================================================================
-- 5. RLS
-- =========================================================================
-- Owner: everything. Employee: their own row only. Accountants do NOT read
-- each other — see the header. No client-side writes at all: every change is a
-- server action behind requirePermission() using the service role, which is
-- what stops an employee setting their own employment_status.

alter table public.staff_profiles enable row level security;
alter table public.staff_certificates enable row level security;

drop policy if exists staff_profiles_owner_read on public.staff_profiles;
create policy staff_profiles_owner_read on public.staff_profiles
  for select to authenticated using (public.is_owner());

drop policy if exists staff_profiles_self_read on public.staff_profiles;
create policy staff_profiles_self_read on public.staff_profiles
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists staff_certificates_owner_read on public.staff_certificates;
create policy staff_certificates_owner_read on public.staff_certificates
  for select to authenticated using (public.is_owner());

drop policy if exists staff_certificates_self_read on public.staff_certificates;
create policy staff_certificates_self_read on public.staff_certificates
  for select to authenticated using (
    exists (select 1 from public.staff_profiles sp
             where sp.id = staff_certificates.staff_profile_id
               and sp.profile_id = auth.uid())
  );

revoke insert, update, delete, truncate on public.staff_profiles from anon, authenticated;
revoke insert, update, delete, truncate on public.staff_certificates from anon, authenticated;
