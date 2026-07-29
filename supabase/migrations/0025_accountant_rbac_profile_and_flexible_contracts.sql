-- =========================================================================
-- 0025_accountant_rbac_profile_and_flexible_contracts.sql   (2026-07-29)
--
-- One migration covering the schema half of the 2026-07-29 client feedback:
--
--   1. Accountant role RBAC (#4)      — activation flag, helper functions,
--                                       read-only RLS across the financial
--                                       tables, internal financial notes.
--   2. Rider profile (#3)             — profile photo path.
--   3. Rider location provenance (#7) — records whether a rider's region/
--                                       district was copied from their bike.
--   4. Flexible contract duration (#9)— years/weeks/days alongside months,
--                                       plus how the end date was decided.
--   5. Payment-plan metadata (#1)     — the owner-edited (date, amount) plan
--                                       and the frequency it was generated at.
--   6. Contract completion (#8)       — supporting index + a one-off backfill
--                                       of contracts whose term already ended.
--   7. Search/filter indexes (#2).
--
-- SAFETY: additive only. No column is dropped or retyped, no row is deleted.
-- Every new column is nullable or has a default that reproduces today's
-- behaviour, so existing riders, motorcycles and contracts keep working
-- untouched. The single data change is the #8 backfill, which moves finished
-- ACTIVE contracts to `completed` — the state the owner would otherwise set by
-- hand — and never touches obligations, payments or allocations.
-- =========================================================================

-- =========================================================================
-- 1. ACCOUNTANT ROLE (#4)
-- =========================================================================

-- Access can be withdrawn without deleting the account (and without orphaning
-- the audit trail that references the profile). Owner accounts default active.
alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists email citext,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists deactivated_at timestamptz;

comment on column public.profiles.is_active is
  'Owner-controlled access switch. A deactivated staff profile keeps its history but is refused at login and by is_accountant()/is_staff().';

-- ---- authorization helpers ---------------------------------------------
-- SECURITY DEFINER (like is_owner) so policies can read `profiles` without
-- recursing through its own RLS. search_path pinned per D-031/0018.

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
  );
$$;

-- "Staff" = owner or an ACTIVE accountant. Used by the read-side policies that
-- both roles share. The owner is never gated on is_active: locking the sole
-- owner out of their own system would be unrecoverable from inside the app.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_owner() or public.is_accountant();
$$;

revoke all on function public.is_accountant() from public, anon;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_accountant() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ---- internal financial notes (accountant + owner) ----------------------
create table if not exists public.financial_notes (
  id uuid primary key default gen_random_uuid(),
  -- Free-form scope so a note can hang off a rider, contract or payment
  -- without four nullable FKs. Validated in the app layer.
  entity_type text not null check (entity_type in ('rider', 'contract', 'payment', 'motorcycle', 'general')),
  entity_id uuid,
  body text not null check (length(body) between 1 and 4000),
  author_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_financial_notes_entity
  on public.financial_notes(entity_type, entity_id, created_at desc);

alter table public.financial_notes enable row level security;

-- Owner: full control. Accountant: may read all notes and add their own, but
-- may NOT edit or delete (notes are an append-only internal record).
drop policy if exists financial_notes_owner_all on public.financial_notes;
create policy financial_notes_owner_all on public.financial_notes
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists financial_notes_accountant_read on public.financial_notes;
create policy financial_notes_accountant_read on public.financial_notes
  for select to authenticated using (public.is_accountant());

drop policy if exists financial_notes_accountant_insert on public.financial_notes;
create policy financial_notes_accountant_insert on public.financial_notes
  for insert to authenticated
  with check (public.is_accountant() and author_id = auth.uid());

-- ---- accountant READ policies -------------------------------------------
-- Deliberately SELECT-only, and deliberately NOT applied to:
--   rider_private_data      (NIDA/licence ciphertext + owner notes)
--   guarantors / *_documents, rider_applications  (identity documents)
--   payment_events          (raw provider payloads)
--   audit_logs / login_attempts / system_job_runs / import_*  (system internals)
--   app_settings write, profiles write            (no role or config changes)
-- Money mutation is impossible from any of these: migration 0016 revokes
-- direct writes on the money tables, so an accountant recording a payment goes
-- through the same server-validated controlled function the owner uses.

do $$
declare
  t text;
begin
  foreach t in array array[
    'riders', 'motorcycles', 'motorcycle_assignments', 'motorcycle_expenses',
    'contracts', 'contract_versions', 'contract_events', 'contract_documents',
    'payment_obligations', 'payments', 'payment_allocations', 'receipts',
    'exemption_requests', 'daily_summaries'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_accountant_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_accountant())',
      t || '_accountant_read', t
    );
  end loop;
end $$;

-- Non-secret business config (currency, deadline, default instalment): the
-- accountant needs to read it to interpret money. settings_read already allows
-- any authenticated user; no extra policy required.

-- Accountants must be able to see their own profile row (settings_read covers
-- app_settings; profiles_self_read covers this) and their own notifications
-- (notifications_self_read keys on recipient_profile_id = auth.uid()).

-- =========================================================================
-- 2. RIDER PROFILE PHOTO (#3)
-- =========================================================================

alter table public.riders
  add column if not exists photo_path text;

comment on column public.riders.photo_path is
  'Storage path of the rider profile picture inside the private rider-documents bucket. Populated from the application photo on convert-to-rider and replaceable by the owner. NULL renders a placeholder.';

-- =========================================================================
-- 3. RIDER LOCATION PROVENANCE (#7)
-- =========================================================================
-- riders.region/district are the rider's PERSONAL (home) location.
-- motorcycles.region/district are the bike's OPERATIONAL location.
-- They are usually the same, so the rider form copies the bike's values — this
-- column records that it did, so the UI can show "same as motorcycle" and
-- re-sync on transfer, while still allowing a genuinely different home address.

alter table public.riders
  add column if not exists location_source text not null default 'manual'
    check (location_source in ('manual', 'motorcycle'));

comment on column public.riders.region is
  'Rider PERSONAL/home region. The motorcycle''s operational region lives on motorcycles.region — see location_source.';
comment on column public.riders.location_source is
  'manual = typed for this rider; motorcycle = copied from the assigned motorcycle''s operational location (#7).';

-- =========================================================================
-- 4. FLEXIBLE CONTRACT DURATION (#9)
-- =========================================================================

alter table public.contracts
  add column if not exists duration_years integer not null default 0
    check (duration_years >= 0),
  add column if not exists duration_weeks integer not null default 0
    check (duration_weeks >= 0),
  add column if not exists duration_days integer not null default 0
    check (duration_days >= 0),
  add column if not exists end_date_source text not null default 'duration'
    check (end_date_source in ('duration', 'exact'));

-- duration_months was "> 0 or null"; a term expressed purely in weeks or days
-- has a ZERO month component, so the old constraint would reject it. The
-- replacement allows 0 and keeps negatives out. Existing rows (all >= 1) pass
-- both, so this cannot invalidate live data.
alter table public.contracts drop constraint if exists contracts_duration_months_check;
alter table public.contracts
  add constraint contracts_duration_months_check
  check (duration_months is null or duration_months >= 0);

comment on column public.contracts.duration_years is 'Years component of the lease term (#9). Combined with duration_months/weeks/days.';
comment on column public.contracts.end_date_source is
  'duration = end_date derived from the duration components; exact = the owner typed an explicit end date (which then wins).';

-- =========================================================================
-- 5. PAYMENT-PLAN METADATA (#1)
-- =========================================================================
-- The bulk generator produces an EDITABLE list of (dueDate, amount) rows. When
-- the owner has adjusted it (excluded days, changed an amount or a date) it no
-- longer matches any pure cadence, so the plan itself is stored and
-- activate_contract_and_generate_obligations replays it verbatim. NULL keeps
-- the old behaviour: generate from schedule_type.

alter table public.contracts
  add column if not exists payment_plan jsonb,
  add column if not exists payment_frequency text
    check (payment_frequency is null or payment_frequency in ('daily', 'weekly', 'monthly', 'custom')),
  add column if not exists payment_plan_generated_at timestamptz;

comment on column public.contracts.payment_plan is
  'Owner-approved payment plan: jsonb array of {dueDate, amount} (integer TZS). Authoritative for obligation generation when present; NULL = derive from schedule_type. Never edited after activation — obligations are the record from then on.';

-- A stored plan must be an array (a bare object or string here would make
-- activation silently generate nothing).
alter table public.contracts drop constraint if exists contracts_payment_plan_is_array;
alter table public.contracts
  add constraint contracts_payment_plan_is_array
  check (payment_plan is null or jsonb_typeof(payment_plan) = 'array');

-- =========================================================================
-- 6. CONTRACT COMPLETION (#8)
-- =========================================================================

-- The nightly completion job scans active contracts by end date.
create index if not exists idx_contracts_status_end_date
  on public.contracts(status, end_date);

-- One-off backfill: contracts whose term finished before today but which are
-- still `active` because nothing ever completed them (the client's "Daud has
-- completed his contract" report). Only the lifecycle column changes —
-- obligations, payments and allocations are untouched, so a contract that ends
-- with arrears still shows its unpaid days and is rendered as
-- "Contract Ended — Outstanding Balance" by lib/contracts/status.ts.
-- Paused contracts are excluded: the owner suspended them deliberately.
update public.contracts
   set status = 'completed'
 where status = 'active'
   and end_date is not null
   and end_date < (now() at time zone 'Africa/Dar_es_Salaam')::date;

-- =========================================================================
-- 7. SEARCH + FILTER INDEXES (#2)
-- =========================================================================
-- The riders page searches name / phone / rider code / motorcycle registration
-- / contract number and filters by region, district and registration date.
-- Trigram indexes make the ILIKE '%term%' searches usable as the fleet grows.

create extension if not exists pg_trgm;

create index if not exists idx_riders_first_name_trgm
  on public.riders using gin (first_name gin_trgm_ops);
create index if not exists idx_riders_last_name_trgm
  on public.riders using gin (last_name gin_trgm_ops);
create index if not exists idx_riders_phone_trgm
  on public.riders using gin (phone gin_trgm_ops);
create index if not exists idx_riders_rider_number_trgm
  on public.riders using gin (rider_number gin_trgm_ops);
create index if not exists idx_riders_created_at on public.riders(created_at);
create index if not exists idx_riders_region_district on public.riders(region, district);

create index if not exists idx_motorcycles_registration_trgm
  on public.motorcycles using gin (registration_number gin_trgm_ops);
create index if not exists idx_motorcycles_number_trgm
  on public.motorcycles using gin (motorcycle_number gin_trgm_ops);
create index if not exists idx_contracts_number_trgm
  on public.contracts using gin (contract_number gin_trgm_ops);

-- =========================================================================
-- 8. ACTIVATION WITH PER-OBLIGATION AMOUNTS (#1)
-- =========================================================================
-- Replaces the 0018 version. Only ONE line of behaviour changes: the amount
-- comes from the plan row when the caller supplied one, falling back to the
-- contract's instalment amount exactly as before. Every guard 0018 added is
-- preserved verbatim — the owner check, the pre-active status check, the
-- positive-amount check, the signature requirement, the empty-CALENDAR refusal
-- (which must test the stored obligations, not the insert's row_count: a retry
-- after a partial failure legitimately inserts 0 new rows) and the
-- single-transaction commit.

create or replace function public.activate_contract_and_generate_obligations(
  p_contract_id uuid,
  p_obligations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_count integer;
  v_has_owner_sig boolean;
  v_has_rider_sig boolean;
  v_has_signed_doc boolean;
begin
  if not public.is_owner() then
    raise exception 'forbidden';
  end if;

  select * into v_contract from public.contracts
    where id = p_contract_id for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.status = 'active' then raise exception 'already_active'; end if;
  -- Only pre-active contracts may be activated; a paused/terminated/completed
  -- contract must never come back through this path (0018).
  if v_contract.status not in ('draft', 'awaiting_signatures', 'scheduled') then
    raise exception 'invalid_status: %', v_contract.status;
  end if;
  if coalesce(v_contract.installment_amount, 0) <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_obligations is null
     or jsonb_typeof(p_obligations) <> 'array'
     or jsonb_array_length(p_obligations) = 0 then
    raise exception 'empty_calendar';
  end if;

  select exists (select 1 from public.contract_signatures
      where contract_id = p_contract_id and signer_role = 'owner')
    into v_has_owner_sig;
  select exists (select 1 from public.contract_signatures
      where contract_id = p_contract_id and signer_role = 'rider')
    into v_has_rider_sig;
  select exists (select 1 from public.contract_documents
      where contract_id = p_contract_id and is_signed)
    into v_has_signed_doc;

  if not ((v_has_owner_sig and v_has_rider_sig) or v_has_signed_doc) then
    raise exception 'signatures_required';
  end if;

  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version
  )
  select
    p_contract_id, v_contract.rider_id, v_contract.motorcycle_id,
    (o->>'dueDate')::date,
    (o->>'dueAtUtc')::timestamptz,
    (o->>'localDueTime')::time,
    -- Per-row amount from an owner-edited plan (#1); the contract instalment
    -- remains the default for every plain cadence.
    coalesce(nullif(o->>'amount', '')::integer, v_contract.installment_amount),
    'scheduled',
    v_contract.current_version
  from jsonb_array_elements(p_obligations) as o
  on conflict (contract_id, due_date) do nothing;

  get diagnostics v_count = row_count;

  -- "A contract can never be active without its calendar" (0018). Tests the
  -- STORED obligations rather than v_count, so a retry that inserts nothing new
  -- because the calendar already exists still activates correctly.
  if not exists (
    select 1 from public.payment_obligations
    where contract_id = p_contract_id
      and status in ('scheduled', 'due', 'overdue')
  ) then
    raise exception 'empty_calendar';
  end if;

  update public.contracts set status = 'active' where id = p_contract_id;

  return v_count;
end;
$$;

revoke all on function public.activate_contract_and_generate_obligations(uuid, jsonb) from public, anon;
grant execute on function public.activate_contract_and_generate_obligations(uuid, jsonb) to authenticated;
