-- =========================================================================
-- 0028_purchase_requisitions.sql
--
-- PURCHASE REQUISITIONS (client feedback 2026-09-05).
--
-- "The accountant needs to ask the Managing Director for approval to buy new
--  motorcycles and other things."
--
-- The shape mirrors the cash-approval workflow shipped in 0026, for the same
-- reason: the accountant PREPARES, the Director DECIDES, and nothing is
-- treated as authorised until they have decided it.
--
--   accountant fills in  -> purchase_requisitions row, status 'draft'
--   accountant submits   -> status 'submitted'; the Director is notified
--   Director approves    -> status 'approved', decided_at = the approval date
--   Director rejects     -> status 'rejected' with a reason
--   accountant withdraws -> status 'cancelled' (only while still submitted)
--
-- IMPORTANT — a requisition is NOT ledger money. It authorises a purchase; it
-- never creates a payment, an obligation or an allocation, and it is entirely
-- separate from the rider payment tables. What it shares with them is the
-- discipline: amounts are integer TZS, writes go through the service role
-- after a server-side permission check, and a decided record is immutable.
--
-- Nothing here is derived-and-stored: an item's amount is quantity x unit
-- price and a requisition's total is the sum of its items, both computed on
-- read (D-034 rule 3) so an approved figure can never silently drift from the
-- lines that produced it.
-- =========================================================================

-- =========================================================================
-- 1. ENUM
-- =========================================================================

do $$ begin
  create type requisition_status as enum ('draft', 'submitted', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. REQUISITIONS
-- =========================================================================

create table if not exists public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  -- REQ/YYYY/MM/NNNN, allocated from the highest number issued that month.
  requisition_number text not null unique,
  title text not null check (length(title) between 3 and 200),
  description text check (description is null or length(description) <= 4000),
  -- What the spend is for: fleet | operations | finance | administration.
  -- Text rather than an enum because this is a business classification the
  -- owner may want to extend without a migration; validated in the app layer.
  department text not null,
  fiscal_year integer not null check (fiscal_year between 2020 and 2100),
  request_date date not null,
  -- Every amount in this system is integer TZS (spec rule 11). The column
  -- exists because the form asks for it and the client may trade in other
  -- currencies one day; today only TZS is accepted.
  currency text not null default 'TZS' check (currency = 'TZS'),
  -- Free text: "GESHON ENTERPRISES / CRDB 0152421911200", or a mobile number.
  payment_information text check (payment_information is null or length(payment_information) <= 1000),
  status requisition_status not null default 'draft',
  -- The Managing Director this request is addressed to.
  approver_id uuid references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  submitted_at timestamptz,
  -- "Approval Date" on the form: filled when the Director decides.
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.purchase_requisitions is
  'Accountant-raised purchase requests awaiting the Managing Director''s approval. Not ledger money: never creates a payment or obligation.';

create index if not exists idx_requisitions_status
  on public.purchase_requisitions(status, created_at desc);
create index if not exists idx_requisitions_requested_by
  on public.purchase_requisitions(requested_by, created_at desc);
create index if not exists idx_requisitions_number
  on public.purchase_requisitions(requisition_number desc);

drop trigger if exists trg_requisitions_updated on public.purchase_requisitions;
create trigger trg_requisitions_updated
  before update on public.purchase_requisitions
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3. LINE ITEMS
-- =========================================================================
-- `position` preserves the order the accountant typed the rows in, which is
-- how they will read the printed request back. Neither the line amount nor the
-- requisition total is stored: both are computed from quantity x unit_price so
-- an approved total is always exactly the lines that were approved.

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete cascade,
  position integer not null check (position >= 0),
  description text not null check (length(description) between 1 and 300),
  -- motorcycle | spare_parts | maintenance | repair | service | fuel |
  -- insurance | registration | phone | office | other (app-layer validated).
  category text not null,
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  -- Unit of measure: unit | piece | set | litre | box | service | month | kilogram.
  unit text not null,
  unit_price integer not null check (unit_price >= 0),
  -- Where the money comes from: collections | owner_capital | financing | other.
  budget_cover text not null,
  created_at timestamptz not null default now(),
  unique (requisition_id, position)
);

create index if not exists idx_requisition_items_parent
  on public.requisition_items(requisition_id, position);

-- =========================================================================
-- 4. SUPPORTING DOCUMENTS
-- =========================================================================
-- Quotations, proformas and photos. Stored in the PRIVATE requisition-documents
-- bucket and served only through short-lived signed URLs, like every other
-- document in this system (spec §24).

create table if not exists public.requisition_documents (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256_hash text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_requisition_documents_parent
  on public.requisition_documents(requisition_id, created_at);

insert into storage.buckets (id, name, public)
values ('requisition-documents', 'requisition-documents', false)
on conflict (id) do nothing;

-- Consistent with 0011: the owner may reach the bucket through an
-- authenticated request; everyone else (including the accountant who uploaded
-- the file) receives it as a server-issued signed URL.
drop policy if exists storage_requisition_documents_owner on storage.objects;
create policy storage_requisition_documents_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'requisition-documents' and public.is_owner())
  with check (bucket_id = 'requisition-documents' and public.is_owner());

-- =========================================================================
-- 5. IMMUTABILITY GUARDS
-- =========================================================================
-- A decided requisition is a record of what the Director authorised, so it is
-- frozen the same way a signed contract document is (spec rule 6). Items and
-- documents may only change while the request is still a draft — otherwise an
-- accountant could add a line to an already-approved request and the approval
-- would silently cover money the Director never saw.

create or replace function public.guard_requisition_decided()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'requisition % cannot be deleted once submitted (status %)',
        old.requisition_number, old.status;
    end if;
    return old;
  end if;

  if old.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'requisition % is closed (status %) and cannot be changed',
      old.requisition_number, old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_requisitions_guard on public.purchase_requisitions;
create trigger trg_requisitions_guard
  before update or delete on public.purchase_requisitions
  for each row execute function public.guard_requisition_decided();

create or replace function public.guard_requisition_child_rows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_id uuid := coalesce(new.requisition_id, old.requisition_id);
  parent_status requisition_status;
  doc_count integer;
begin
  select status into parent_status
    from public.purchase_requisitions where id = parent_id;

  -- The parent row being gone means the cascade is deleting us with it, and
  -- that cascade already passed the guard above.
  if parent_status is null then
    return coalesce(new, old);
  end if;

  if parent_status <> 'draft' then
    raise exception 'requisition lines and documents can only change while the request is a draft (status %)',
      parent_status;
  end if;

  -- Ten supporting documents, as the form promises.
  if tg_op = 'INSERT' and tg_table_name = 'requisition_documents' then
    select count(*) into doc_count
      from public.requisition_documents where requisition_id = parent_id;
    if doc_count >= 10 then
      raise exception 'a requisition may carry at most 10 supporting documents';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_requisition_items_guard on public.requisition_items;
create trigger trg_requisition_items_guard
  before insert or update or delete on public.requisition_items
  for each row execute function public.guard_requisition_child_rows();

drop trigger if exists trg_requisition_documents_guard on public.requisition_documents;
create trigger trg_requisition_documents_guard
  before insert or update or delete on public.requisition_documents
  for each row execute function public.guard_requisition_child_rows();

revoke all on function public.guard_requisition_decided() from public, anon, authenticated;
revoke all on function public.guard_requisition_child_rows() from public, anon, authenticated;

-- =========================================================================
-- 6. RLS
-- =========================================================================
-- Both back-office roles READ everything (the accountant must see the queue
-- they raised and the Director's decision on it). NOBODY writes directly:
-- every mutation goes through a server action that has already called
-- requirePermission(), then the service role — the same rule the money tables
-- have followed since 0016, so a forged client insert cannot manufacture an
-- approved purchase request.

alter table public.purchase_requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.requisition_documents enable row level security;

drop policy if exists requisitions_staff_read on public.purchase_requisitions;
create policy requisitions_staff_read on public.purchase_requisitions
  for select to authenticated using (public.is_staff());

drop policy if exists requisition_items_staff_read on public.requisition_items;
create policy requisition_items_staff_read on public.requisition_items
  for select to authenticated using (public.is_staff());

drop policy if exists requisition_documents_staff_read on public.requisition_documents;
create policy requisition_documents_staff_read on public.requisition_documents
  for select to authenticated using (public.is_staff());

revoke insert, update, delete on public.purchase_requisitions from anon, authenticated;
revoke insert, update, delete on public.requisition_items from anon, authenticated;
revoke insert, update, delete on public.requisition_documents from anon, authenticated;

-- Truncate is revoked on the money tables by 0027 for the same reason it is
-- revoked here: a table-wide wipe is never a legitimate application action.
revoke truncate on public.purchase_requisitions from anon, authenticated;
revoke truncate on public.requisition_items from anon, authenticated;
revoke truncate on public.requisition_documents from anon, authenticated;
