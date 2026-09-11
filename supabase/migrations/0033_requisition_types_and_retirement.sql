-- =========================================================================
-- 0033_requisition_types_and_retirement.sql
--
-- REQUISITION TYPES, SUPPORTING DOCUMENT KINDS AND RETIREMENT
-- (client feedback 2026-09-11 #14).
--
-- "Staff creates a requisition. Invoice attached. Director approves. Purchase
--  or payment is made. Proof of payment or receipt uploaded. Accountant
--  performs retirement. Status becomes completed."
--
-- 0028 built the request and the decision; 0029 added whether the money was
-- released. What was missing is everything AFTER the money leaves: the receipt,
-- and the accountant accounting for what was actually spent against what was
-- approved. That last step is retirement, and it is the only thing that closes
-- the loop between an authorisation and a real cost.
--
-- WHY THE STATUS ENUM IS NOT SIMPLY EXTENDED
--
-- The brief lists nine "statuses" — draft, submitted, under review, approved,
-- rejected, payment made, receipt uploaded, retirement pending, retired. They
-- are not nine values of one thing; they are three independent facts:
--
--     status            what the Director decided      (0028)
--     payment_status    whether the money moved        (0029)
--     retirement_status whether it has been accounted  (here)
--
-- Folding them into one enum makes 'approved' ambiguous (approved and unpaid?
-- approved and retired?) and silently breaks every existing `status = 'approved'`
-- check in the codebase. Keeping them orthogonal means each question has
-- exactly one answer, and lib/requisitions/compute.ts derives the single
-- sentence a human reads from the three. Only 'under_review' is genuinely a
-- new DECISION state, so only it is added to the enum.
--
-- Retirement is an accounting act, not a payment: it creates no money row. What
-- it CAN create is a department expense (0030), which is where an approved
-- purchase finally becomes a recorded cost.
-- =========================================================================

-- =========================================================================
-- 1. ENUM
-- =========================================================================
-- 'under_review' — the new DECISION state, meaning the request has been picked
-- up but not ruled on — is added by 0032, on its own, because Postgres refuses
-- to use a new enum label in the transaction that created it (the 0024/0025
-- split). Only the retirement type is created here.

do $$ begin
  create type requisition_retirement_status as enum ('not_started', 'pending', 'completed');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. WHAT KIND OF REQUEST THIS IS
-- =========================================================================
-- Text, not an enum, for the same reason `department` is text in 0028: this is
-- a business classification the owner will extend, and it is validated in the
-- app layer against lib/requisitions/constants.ts.

alter table public.purchase_requisitions
  add column if not exists requisition_type text not null default 'general',
  -- Set when this requisition exists to buy a handset for a rider's phone-loan
  -- request (0031), so the two workflows can find each other in one query.
  add column if not exists phone_loan_request_id uuid
    references public.phone_loan_requests(id) on delete set null,
  add column if not exists retirement_status requisition_retirement_status
    not null default 'not_started',
  add column if not exists retired_by uuid references public.profiles(id),
  add column if not exists retired_at timestamptz,
  add column if not exists retirement_note text
    check (retirement_note is null or length(retirement_note) <= 2000),
  -- What was ACTUALLY spent, which is the whole point of retirement: it is
  -- allowed to differ from the approved total, and the difference is what the
  -- Director wants to see. Nullable until retired.
  add column if not exists retired_amount integer
    check (retired_amount is null or retired_amount >= 0);

comment on column public.purchase_requisitions.retired_amount is
  'Actual spend accounted for at retirement. May differ from the approved total; the variance is reported, never hidden by overwriting the approval.';
comment on column public.purchase_requisitions.requisition_type is
  'general | phone | motorcycle | department_expense — app-layer validated (lib/requisitions/constants.ts).';

create index if not exists idx_requisitions_retirement
  on public.purchase_requisitions(retirement_status, decided_at desc)
  where status = 'approved';
create index if not exists idx_requisitions_phone_loan_request
  on public.purchase_requisitions(phone_loan_request_id)
  where phone_loan_request_id is not null;

-- =========================================================================
-- 3. DOCUMENT KINDS
-- =========================================================================
-- One table, one bucket, one kind column. A separate table per document kind
-- would multiply the RLS surface and the signed-URL plumbing for no gain —
-- they are all "a file attached to this requisition", differing only in when
-- it may be attached (section 5).

alter table public.requisition_documents
  add column if not exists doc_type text not null default 'supporting'
    check (doc_type in ('supporting', 'invoice', 'proof_of_payment', 'receipt', 'retirement'));

comment on column public.requisition_documents.doc_type is
  'supporting/invoice attach while the request is a draft; proof_of_payment, receipt and retirement attach only after approval.';

create index if not exists idx_requisition_documents_type
  on public.requisition_documents(requisition_id, doc_type);

-- =========================================================================
-- 4. NARROWED IMMUTABILITY GUARD (replaces 0029's)
-- =========================================================================
-- Same shape and the same reasoning as 0029: strip the columns that are
-- ALLOWED to move after approval and require everything else to be byte-identical.
-- Writing the test this way round means a column added by a future migration is
-- frozen automatically, which is the behaviour you want by default for a record
-- the Director signed.
--
-- The mutable-after-approval set grows by exactly the retirement columns. The
-- lines, the total, the department and the decision remain untouchable.

create or replace function public.guard_requisition_decided()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mutable_stripped_old jsonb;
  mutable_stripped_new jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'requisition % cannot be deleted once submitted (status %)',
        old.requisition_number, old.status;
    end if;
    return old;
  end if;

  -- Payment progress belongs to an APPROVED purchase and nothing else.
  if new.payment_status is distinct from old.payment_status
     and new.status <> 'approved' then
    raise exception 'requisition % is % — only an approved request can be marked %',
      old.requisition_number, new.status, new.payment_status;
  end if;

  -- So does retirement. You cannot account for money that was never authorised.
  if new.retirement_status is distinct from old.retirement_status
     and new.status <> 'approved' then
    raise exception 'requisition % is % — only an approved request can be retired',
      old.requisition_number, new.status;
  end if;

  -- And retirement follows payment: retiring an unpaid purchase would be
  -- accounting for money that never left.
  if new.retirement_status = 'completed'
     and old.retirement_status is distinct from 'completed'
     and new.payment_status <> 'paid' then
    raise exception 'requisition % has not been paid (%) and cannot be retired',
      old.requisition_number, new.payment_status;
  end if;

  if old.status = 'approved' then
    mutable_stripped_old := to_jsonb(old)
      - 'payment_status' - 'payment_marked_by' - 'payment_marked_at' - 'payment_note'
      - 'retirement_status' - 'retired_by' - 'retired_at' - 'retirement_note'
      - 'retired_amount' - 'updated_at';
    mutable_stripped_new := to_jsonb(new)
      - 'payment_status' - 'payment_marked_by' - 'payment_marked_at' - 'payment_note'
      - 'retirement_status' - 'retired_by' - 'retired_at' - 'retirement_note'
      - 'retired_amount' - 'updated_at';

    if mutable_stripped_old is distinct from mutable_stripped_new then
      raise exception
        'requisition % is approved: only its payment and retirement stages may change, not the request itself',
        old.requisition_number;
    end if;
    return new;
  end if;

  if old.status in ('rejected', 'cancelled') then
    raise exception 'requisition % is closed (status %) and cannot be changed',
      old.requisition_number, old.status;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_requisition_decided() from public, anon, authenticated;

drop trigger if exists trg_requisitions_guard on public.purchase_requisitions;
create trigger trg_requisitions_guard
  before update or delete on public.purchase_requisitions
  for each row execute function public.guard_requisition_decided();

-- =========================================================================
-- 5. CHILD-ROW GUARD — which documents may attach, and when
-- =========================================================================
-- 0028 froze lines AND documents together the moment a request left draft,
-- which was right when the only documents were quotations. A receipt exists by
-- definition after approval, so the rule is split:
--
--   line items                    draft only, always. An extra line on an
--                                 approved request would be money the Director
--                                 never saw.
--   supporting / invoice          draft only. These are what the decision was
--                                 made on and must be exactly what was seen.
--   proof_of_payment / receipt /  approved only, and never on a rejected or
--   retirement                    cancelled request — there is nothing to pay.
--
-- The ten-document cap now counts per kind, so a long retirement file list
-- cannot crowd out the quotations the request was approved on.

create or replace function public.guard_requisition_child_rows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_id uuid := coalesce(new.requisition_id, old.requisition_id);
  parent_status requisition_status;
  v_doc_type text;
  doc_count integer;
begin
  select status into parent_status
    from public.purchase_requisitions where id = parent_id;

  -- Parent already gone: this is the cascade deleting us, and that cascade
  -- passed the parent guard.
  if parent_status is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'requisition_items' then
    if parent_status <> 'draft' then
      raise exception 'requisition lines can only change while the request is a draft (status %)',
        parent_status;
    end if;
    return coalesce(new, old);
  end if;

  -- Documents.
  v_doc_type := coalesce(new.doc_type, old.doc_type, 'supporting');

  if v_doc_type in ('supporting', 'invoice') then
    if parent_status <> 'draft' then
      raise exception 'a % document can only be attached while the request is a draft (status %)',
        v_doc_type, parent_status;
    end if;
  else
    if parent_status <> 'approved' then
      raise exception 'a % document can only be attached to an approved request (status %)',
        v_doc_type, parent_status;
    end if;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into doc_count
      from public.requisition_documents
     where requisition_id = parent_id and doc_type = v_doc_type;
    if doc_count >= 10 then
      raise exception 'a requisition may carry at most 10 % documents', v_doc_type;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_requisition_child_rows() from public, anon, authenticated;

drop trigger if exists trg_requisition_items_guard on public.requisition_items;
create trigger trg_requisition_items_guard
  before insert or update or delete on public.requisition_items
  for each row execute function public.guard_requisition_child_rows();

drop trigger if exists trg_requisition_documents_guard on public.requisition_documents;
create trigger trg_requisition_documents_guard
  before insert or update or delete on public.requisition_documents
  for each row execute function public.guard_requisition_child_rows();

-- =========================================================================
-- 6. GRANTS — unchanged, restated
-- =========================================================================

revoke insert, update, delete, truncate on public.purchase_requisitions from anon, authenticated;
revoke insert, update, delete, truncate on public.requisition_items from anon, authenticated;
revoke insert, update, delete, truncate on public.requisition_documents from anon, authenticated;
