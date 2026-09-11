-- =========================================================================
-- 0034_contract_completion_workflow.sql
--
-- END-OF-CONTRACT REQUEST, CERTIFICATE, OWNERSHIP TRANSFER AND RECORD LOCKING
-- (client feedback 2026-09-11 #6, #7, #8, #10).
--
-- "When a rider finishes a contract, the rider should not be marked complete
--  automatically without review."
--
-- Today `contractCompletionTask` (0025) flips an active contract to 'completed'
-- the moment its end date passes. That was right when completion meant only
-- "the term is over", but the client's contracts END IN A MOTORCYCLE CHANGING
-- HANDS, and that cannot be decided by a cron job at midnight. So completion
-- becomes a REQUEST that walks a fixed chain, and the automatic sweep is taught
-- to stand down (see section 7).
--
-- THE CHAIN, AND WHY IT IS A TABLE AND NOT A BOOLEAN
--
--   requested            rider asks
--   finance_review       finance is checking what is still owed
--   finance_cleared      finance confirms nothing is outstanding
--   director_review      with the Director
--   director_approved    Director approves completion
--   certificate_issued   certificate of accomplishment generated
--   transfer_in_progress back with finance for ownership transfer
--   transfer_uploaded    transfer document in the system
--   final_review         back with the Director
--   completed            Director has signed off; contract fully completed
--   rejected             refused at some stage
--   returned             sent back for correction
--
-- Each stage names WHO acts next, so the request is never "with everybody".
-- lib/completion/machine.ts owns the legal transitions and is pure and unit
-- tested; the trigger in section 6 enforces the two rules that must hold even
-- if that code is wrong, because they are the client's actual requirement:
-- finance clearance cannot be skipped, and the Director's approval cannot be
-- skipped.
--
-- OUTSTANDING MONEY IS NEVER STORED. "Finance confirms the rider has cleared
-- all obligations" records a HUMAN DECISION plus the balance at the moment they
-- made it. The live balance is always recomputed from the ledger
-- (lib/contracts/completion.ts), so a request that sat for a week and accrued a
-- new day cannot be approved on a stale zero — section 6 re-checks at sign-off.
-- =========================================================================

-- =========================================================================
-- 1. ENUMS
-- =========================================================================

do $$ begin
  create type contract_completion_status as enum (
    'requested',
    'finance_review',
    'finance_cleared',
    'director_review',
    'director_approved',
    'certificate_issued',
    'transfer_in_progress',
    'transfer_uploaded',
    'final_review',
    'completed',
    'rejected',
    'returned'
  );
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. THE REQUEST
-- =========================================================================

create table if not exists public.contract_completion_requests (
  id uuid primary key default gen_random_uuid(),
  -- NGR-CC-2026-0001, allocated max-based like receipts and requisitions.
  request_number text not null unique,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  rider_id uuid not null references public.riders(id) on delete restrict,
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  status contract_completion_status not null default 'requested',
  -- Who asked. Normally the rider; the owner may raise one on their behalf for
  -- a rider who cannot use the app, which is why this is a profile and not
  -- assumed to be the rider's own.
  requested_by uuid not null references public.profiles(id),
  rider_note text check (rider_note is null or length(rider_note) <= 1000),
  requested_at timestamptz not null default now(),

  -- ---- finance -----------------------------------------------------------
  finance_reviewed_by uuid references public.profiles(id),
  finance_reviewed_at timestamptz,
  finance_note text check (finance_note is null or length(finance_note) <= 2000),
  -- The outstanding balance finance SAW, in integer TZS. A snapshot of a
  -- derived figure, kept because it is evidence of what was decided and when —
  -- never read back as the current balance.
  finance_outstanding_snapshot integer
    check (finance_outstanding_snapshot is null or finance_outstanding_snapshot >= 0),
  finance_cleared boolean,

  -- ---- the Director's approval of completion ------------------------------
  director_decided_by uuid references public.profiles(id),
  director_decided_at timestamptz,
  director_note text check (director_note is null or length(director_note) <= 2000),

  -- ---- ownership transfer -------------------------------------------------
  transfer_started_at timestamptz,
  transfer_handled_by uuid references public.profiles(id),
  transfer_note text check (transfer_note is null or length(transfer_note) <= 2000),

  -- ---- final sign-off -----------------------------------------------------
  signed_off_by uuid references public.profiles(id),
  signed_off_at timestamptz,
  signoff_note text check (signoff_note is null or length(signoff_note) <= 2000),

  -- ---- refusal ------------------------------------------------------------
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(rejection_reason) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contract_completion_requests is
  'End-of-contract review chain. A contract is never completed by a cron job while one of these is open; finance clearance and Director approval cannot be skipped (see guard_completion_transition).';

create index if not exists idx_completion_requests_status
  on public.contract_completion_requests(status, requested_at desc);
create index if not exists idx_completion_requests_contract
  on public.contract_completion_requests(contract_id, requested_at desc);
create index if not exists idx_completion_requests_rider
  on public.contract_completion_requests(rider_id, requested_at desc);

-- One OPEN request per contract. Two riders cannot both be halfway through
-- handing back the same motorcycle, and two open requests would each think
-- they were the one that would complete the contract.
create unique index if not exists uq_open_completion_per_contract
  on public.contract_completion_requests(contract_id)
  where status not in ('completed', 'rejected');

drop trigger if exists trg_completion_requests_updated on public.contract_completion_requests;
create trigger trg_completion_requests_updated
  before update on public.contract_completion_requests
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3. STAGE HISTORY
-- =========================================================================
-- Append-only. Corrections are new rows, never edits (spec rule 6): the point
-- of this table is to answer "who moved this, when, and what did they say" a
-- year later, which an editable log cannot do.

create table if not exists public.contract_completion_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contract_completion_requests(id) on delete cascade,
  from_status contract_completion_status,
  to_status contract_completion_status not null,
  actor_id uuid references public.profiles(id),
  actor_role text,
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_completion_events_request
  on public.contract_completion_events(request_id, created_at);

-- =========================================================================
-- 4. CERTIFICATE OF ACCOMPLISHMENT
-- =========================================================================
-- Generated automatically once the Director approves completion. The stored
-- hash is what makes a downloaded PDF checkable against the record, exactly as
-- contract_documents has worked since Phase 4.
--
-- The certificate is IMMUTABLE once issued (section 6). Reissuing produces a
-- new row with the next version, so a certificate that was handed to a rider
-- can never be silently replaced by a different document with the same number.

create table if not exists public.contract_certificates (
  id uuid primary key default gen_random_uuid(),
  -- NGR-CERT-2026-0001
  certificate_number text not null unique,
  request_id uuid not null references public.contract_completion_requests(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  rider_id uuid not null references public.riders(id) on delete restrict,
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  storage_path text not null,
  sha256_hash text,
  -- The facts as they stood when it was printed. A certificate is a statement
  -- about a moment; re-deriving its text years later from rows that have since
  -- moved would make an old PDF and a new screen disagree.
  snapshot jsonb not null default '{}'::jsonb,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (request_id, version)
);

create index if not exists idx_certificates_contract
  on public.contract_certificates(contract_id, issued_at desc);
create index if not exists idx_certificates_rider
  on public.contract_certificates(rider_id, issued_at desc);

insert into storage.buckets (id, name, public)
values ('contract-certificates', 'contract-certificates', false)
on conflict (id) do nothing;

drop policy if exists storage_contract_certificates_owner on storage.objects;
create policy storage_contract_certificates_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'contract-certificates' and public.is_owner())
  with check (bucket_id = 'contract-certificates' and public.is_owner());

-- =========================================================================
-- 5. OWNERSHIP TRANSFER DOCUMENTS
-- =========================================================================
-- "Linked to the contract, linked to the rider, linked to the motorcycle."
-- All three, explicitly, rather than joined through the contract: a transfer
-- document is the evidence a specific machine went to a specific person, and
-- it has to stay findable from any of the three even if the contract is later
-- reorganised.

create table if not exists public.ownership_transfer_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contract_completion_requests(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  rider_id uuid not null references public.riders(id) on delete restrict,
  motorcycle_id uuid not null references public.motorcycles(id) on delete restrict,
  doc_type text not null default 'transfer_form'
    check (doc_type in ('transfer_form', 'registration_card', 'tra_receipt', 'other')),
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256_hash text not null,
  note text check (note is null or length(note) <= 1000),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_transfer_docs_request
  on public.ownership_transfer_documents(request_id, created_at);
create index if not exists idx_transfer_docs_contract
  on public.ownership_transfer_documents(contract_id);
create index if not exists idx_transfer_docs_motorcycle
  on public.ownership_transfer_documents(motorcycle_id);

insert into storage.buckets (id, name, public)
values ('ownership-transfers', 'ownership-transfers', false)
on conflict (id) do nothing;

drop policy if exists storage_ownership_transfers_owner on storage.objects;
create policy storage_ownership_transfers_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'ownership-transfers' and public.is_owner())
  with check (bucket_id = 'ownership-transfers' and public.is_owner());

-- =========================================================================
-- 6. THE TWO RULES THAT CANNOT BE SKIPPED
-- =========================================================================
-- lib/completion/machine.ts already refuses an illegal transition, and every
-- server action calls requirePermission() first. This trigger exists because
-- the client's requirement is a CONTROL, not a convenience: "Ensure
-- end-contract completion cannot skip finance and director approval." A
-- control that lives only in application code is an assumption.
--
-- It deliberately does NOT encode the whole state machine. Duplicating twelve
-- transitions in PL/pgSQL would give two copies to keep in step, and the second
-- copy would be the one nobody remembers. It encodes the invariants.

create or replace function public.guard_completion_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outstanding integer;
begin
  -- A finished request is history.
  if old.status in ('completed', 'rejected') and new.status is distinct from old.status then
    raise exception 'completion request % is closed (%) and cannot be reopened',
      old.request_number, old.status;
  end if;

  -- RULE 1 — the Director may not approve completion unless finance cleared it.
  if new.status = 'director_approved' and old.status <> 'director_approved' then
    if new.finance_cleared is not true then
      raise exception 'completion request % has not been cleared by finance',
        old.request_number;
    end if;
  end if;

  -- RULE 2 — a contract is only fully completed after the Director signed off,
  -- and a sign-off requires an approval that actually happened.
  if new.status = 'completed' and old.status <> 'completed' then
    if new.director_decided_at is null then
      raise exception 'completion request % was never approved by the Director',
        old.request_number;
    end if;
    if new.signed_off_by is null then
      raise exception 'completion request % has no final sign-off', old.request_number;
    end if;

    -- RULE 2b — and the rider must still owe nothing AT THIS MOMENT. Finance
    -- cleared a balance that was true when they looked; days accrue. Recomputed
    -- here from the ledger rather than trusting the snapshot, because this is
    -- the last point at which a mistake is still cheap.
    select coalesce(sum(amount_due), 0) into v_outstanding
      from public.payment_obligations
     where contract_id = new.contract_id
       and status in ('scheduled', 'due', 'overdue');
    if v_outstanding > 0 then
      raise exception 'contract still has % TZS outstanding — it cannot be signed off as completed',
        v_outstanding;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_completion_guard on public.contract_completion_requests;
create trigger trg_completion_guard
  before update on public.contract_completion_requests
  for each row execute function public.guard_completion_transition();

revoke all on function public.guard_completion_transition() from public, anon, authenticated;

-- A certificate, once issued, is the document the rider holds.
create or replace function public.guard_certificate_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'certificate % cannot be deleted — issue a new version instead',
      old.certificate_number;
  end if;
  -- The hash may be filled in once, immediately after the file is stored;
  -- nothing else ever moves.
  if to_jsonb(old) - 'sha256_hash' is distinct from to_jsonb(new) - 'sha256_hash'
     or (old.sha256_hash is not null and new.sha256_hash is distinct from old.sha256_hash) then
    raise exception 'certificate % is immutable — issue a new version instead',
      old.certificate_number;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_certificates_immutable on public.contract_certificates;
create trigger trg_certificates_immutable
  before update or delete on public.contract_certificates
  for each row execute function public.guard_certificate_immutable();

revoke all on function public.guard_certificate_immutable() from public, anon, authenticated;

-- =========================================================================
-- 7. RECORD LOCKING (client feedback #10)
-- =========================================================================
-- "Before completion the owner or authorised staff can edit allowed details.
--  After completion and final print, contract and registration details become
--  locked. Any change should require a special amendment process."
--
-- `locked_at` is that line. It is set by the sign-off, and the trigger below
-- refuses ordinary edits afterwards. The amendment process is deliberately NOT
-- "an owner override flag": unlocking is its own recorded act
-- (unlock_contract_for_amendment), so an amendment always leaves a trace,
-- which is the whole difference between amending a completed contract and
-- quietly editing one.

alter table public.contracts
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references public.profiles(id),
  add column if not exists lock_reason text,
  add column if not exists completion_request_id uuid
    references public.contract_completion_requests(id) on delete set null;

comment on column public.contracts.locked_at is
  'Set when a completion is signed off. While non-null the contract''s commercial terms are frozen; changing them requires unlock_contract_for_amendment, which is itself audited.';

alter table public.motorcycles
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references public.profiles(id),
  -- Set when ownership actually moves to a rider, so the register records that
  -- this machine is no longer the business's to lease out.
  add column if not exists transferred_to_rider_id uuid
    references public.riders(id) on delete set null,
  add column if not exists transferred_at timestamptz;

create or replace function public.guard_locked_contract()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  frozen_old jsonb;
  frozen_new jsonb;
begin
  if old.locked_at is null then
    return new;   -- not locked: normal editing rules apply
  end if;

  -- Unlocking is always allowed — that IS the amendment process, and the
  -- server action that does it writes an audit row first.
  if new.locked_at is null then
    return new;
  end if;

  -- Everything about the agreement is frozen. Only bookkeeping columns move:
  -- updated_at, and the lock columns themselves.
  frozen_old := to_jsonb(old) - 'updated_at' - 'locked_at' - 'locked_by' - 'lock_reason'
                              - 'last_edited_at' - 'last_edited_by';
  frozen_new := to_jsonb(new) - 'updated_at' - 'locked_at' - 'locked_by' - 'lock_reason'
                              - 'last_edited_at' - 'last_edited_by';
  if frozen_old is distinct from frozen_new then
    raise exception
      'contract % was completed and locked on % — changing it requires an amendment, not an edit',
      old.contract_number, old.locked_at::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contracts_locked on public.contracts;
create trigger trg_contracts_locked
  before update on public.contracts
  for each row execute function public.guard_locked_contract();

create or replace function public.guard_locked_motorcycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  frozen_old jsonb;
  frozen_new jsonb;
begin
  if old.locked_at is null or new.locked_at is null then
    return new;
  end if;
  -- The registration identity is what must not move after a transfer: plate,
  -- chassis, engine and the internal code. Status and notes may still change —
  -- a transferred machine can still be marked inactive in the register.
  frozen_old := jsonb_build_object(
    'registration_number', old.registration_number,
    'chassis_number', old.chassis_number,
    'engine_number', old.engine_number,
    'motorcycle_number', old.motorcycle_number
  );
  frozen_new := jsonb_build_object(
    'registration_number', new.registration_number,
    'chassis_number', new.chassis_number,
    'engine_number', new.engine_number,
    'motorcycle_number', new.motorcycle_number
  );
  if frozen_old is distinct from frozen_new then
    raise exception
      'motorcycle % was transferred and its registration details are locked — this needs an amendment, not an edit',
      coalesce(old.motorcycle_number, old.registration_number, old.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_motorcycles_locked on public.motorcycles;
create trigger trg_motorcycles_locked
  before update on public.motorcycles
  for each row execute function public.guard_locked_motorcycle();

revoke all on function public.guard_locked_contract() from public, anon, authenticated;
revoke all on function public.guard_locked_motorcycle() from public, anon, authenticated;

-- The amendment door. SECURITY DEFINER and owner-only: an accountant may not
-- reopen a signed-off contract, and the caller writes the audit row.
create or replace function public.unlock_contract_for_amendment(
  p_contract_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'an amendment needs a reason';
  end if;
  update public.contracts
     set locked_at = null, locked_by = null,
         lock_reason = 'amendment: ' || trim(p_reason)
   where id = p_contract_id;
end;
$$;

revoke all on function public.unlock_contract_for_amendment(uuid, text) from public, anon;
grant execute on function public.unlock_contract_for_amendment(uuid, text) to authenticated;

-- =========================================================================
-- 8. RLS
-- =========================================================================
-- Riders read their own request, its history and their own certificate — they
-- are the subject of all three and the certificate is theirs to download.
-- Transfer documents are STAFF ONLY: they carry counterparty and registration
-- detail that belongs to the business's records, and the rider receives the
-- physical document.

alter table public.contract_completion_requests enable row level security;
alter table public.contract_completion_events enable row level security;
alter table public.contract_certificates enable row level security;
alter table public.ownership_transfer_documents enable row level security;

drop policy if exists completion_requests_staff_read on public.contract_completion_requests;
create policy completion_requests_staff_read on public.contract_completion_requests
  for select to authenticated using (public.is_staff());

drop policy if exists completion_requests_self_read on public.contract_completion_requests;
create policy completion_requests_self_read on public.contract_completion_requests
  for select to authenticated using (
    exists (select 1 from public.riders r
             where r.id = contract_completion_requests.rider_id
               and r.profile_id = auth.uid())
  );

drop policy if exists completion_events_staff_read on public.contract_completion_events;
create policy completion_events_staff_read on public.contract_completion_events
  for select to authenticated using (public.is_staff());

drop policy if exists completion_events_self_read on public.contract_completion_events;
create policy completion_events_self_read on public.contract_completion_events
  for select to authenticated using (
    exists (select 1
              from public.contract_completion_requests cr
              join public.riders r on r.id = cr.rider_id
             where cr.id = contract_completion_events.request_id
               and r.profile_id = auth.uid())
  );

drop policy if exists certificates_staff_read on public.contract_certificates;
create policy certificates_staff_read on public.contract_certificates
  for select to authenticated using (public.is_staff());

drop policy if exists certificates_self_read on public.contract_certificates;
create policy certificates_self_read on public.contract_certificates
  for select to authenticated using (
    exists (select 1 from public.riders r
             where r.id = contract_certificates.rider_id
               and r.profile_id = auth.uid())
  );

drop policy if exists transfer_docs_staff_read on public.ownership_transfer_documents;
create policy transfer_docs_staff_read on public.ownership_transfer_documents
  for select to authenticated using (public.is_staff());

revoke insert, update, delete, truncate on public.contract_completion_requests from anon, authenticated;
revoke insert, update, delete, truncate on public.contract_completion_events from anon, authenticated;
revoke insert, update, delete, truncate on public.contract_certificates from anon, authenticated;
revoke insert, update, delete, truncate on public.ownership_transfer_documents from anon, authenticated;
