-- =========================================================================
-- 0029_requisition_payment_stage.sql
--
-- REQUISITION PAYMENT PROGRESS (client feedback 2026-09-06).
--
-- "here we see approved but also whether paid or not — whether the owner has
--  paid for that requisition or not. Approve, processing, paid."
--
-- 0028 stopped at the Director's decision: a requisition was approved and then
-- nothing more was ever recorded about it. The accountant had no way to learn
-- that the money for an approved purchase had actually been released, so they
-- asked in person. This adds the step after approval.
--
--   approved + unpaid      the Director said yes; no money has moved
--   approved + processing  payment has been initiated (bank, cash, transfer)
--   approved + paid        the supplier has been paid
--
-- IMPORTANT — this is still NOT ledger money. It records what the owner says
-- happened with a purchase; it creates no payment, obligation, allocation or
-- receipt, and touches none of the rider money tables. `payments` remains the
-- record of rider collections only, and no report may add a requisition to it.
--
-- WHY THE GUARD HAD TO CHANGE
--
-- 0028's guard_requisition_decided() refuses EVERY update once a requisition
-- is approved, which is exactly right for the request itself: the lines, the
-- total and the decision are what the Director authorised and must never move
-- afterwards. But payment progress happens BY DEFINITION after approval, so
-- the guard is narrowed rather than removed: on an approved row the payment
-- columns may change and NOTHING ELSE may. That is enforced by comparing the
-- two row images with those columns stripped out, so a future column is
-- protected automatically instead of having to be remembered here.
-- =========================================================================

-- =========================================================================
-- 1. ENUM
-- =========================================================================

do $$ begin
  create type requisition_payment_status as enum ('unpaid', 'processing', 'paid');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. COLUMNS
-- =========================================================================
-- Every existing approved requisition starts at 'unpaid', which is the honest
-- default: nothing in the system has ever claimed they were paid.

alter table public.purchase_requisitions
  add column if not exists payment_status requisition_payment_status not null default 'unpaid',
  add column if not exists payment_marked_by uuid references public.profiles(id),
  add column if not exists payment_marked_at timestamptz,
  add column if not exists payment_note text
    check (payment_note is null or length(payment_note) <= 1000);

comment on column public.purchase_requisitions.payment_status is
  'Whether the owner has released money for this APPROVED purchase. Operational marker, not ledger money — creates no payment or allocation.';
comment on column public.purchase_requisitions.payment_marked_by is
  'Who last changed the payment stage. Kept separately from decided_by: approving and paying are different acts.';

-- The accountant's home question is "which of my approved requests are still
-- unpaid?", so that is the index.
create index if not exists idx_requisitions_payment_status
  on public.purchase_requisitions(payment_status, decided_at desc)
  where status = 'approved';

-- =========================================================================
-- 3. NARROWED IMMUTABILITY GUARD
-- =========================================================================
-- Replaces the 0028 version. Two rules, both still refusing by default:
--
--   * a rejected or cancelled requisition remains completely frozen;
--   * an approved one may change its payment columns and nothing else.
--
-- The "nothing else" test strips the mutable columns from both row images and
-- compares what is left. Written this way round on purpose: a column added by
-- a later migration is protected the moment it exists, whereas an explicit
-- list of frozen columns would silently fail to cover it.

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

  -- Payment progress belongs to an APPROVED purchase and nothing else. A
  -- rejected request was never authorised, so it can never be "paid".
  if new.payment_status is distinct from old.payment_status
     and new.status <> 'approved' then
    raise exception 'requisition % is % — only an approved request can be marked % ',
      old.requisition_number, new.status, new.payment_status;
  end if;

  if old.status = 'approved' then
    mutable_stripped_old := to_jsonb(old)
      - 'payment_status' - 'payment_marked_by' - 'payment_marked_at'
      - 'payment_note' - 'updated_at';
    mutable_stripped_new := to_jsonb(new)
      - 'payment_status' - 'payment_marked_by' - 'payment_marked_at'
      - 'payment_note' - 'updated_at';

    if mutable_stripped_old is distinct from mutable_stripped_new then
      raise exception
        'requisition % is approved: only its payment stage may change, not the request itself',
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

-- The trigger definition is unchanged; recreated so this migration is
-- self-contained if replayed against a database that somehow lost it.
drop trigger if exists trg_requisitions_guard on public.purchase_requisitions;
create trigger trg_requisitions_guard
  before update or delete on public.purchase_requisitions
  for each row execute function public.guard_requisition_decided();

-- =========================================================================
-- 4. GRANTS
-- =========================================================================
-- Unchanged from 0028 and restated as the invariant this migration must not
-- break: staff READ requisitions through RLS; every write goes through the
-- service role after a server-side permission check. Marking a purchase paid
-- is the Director's act, so no client-side grant is added for it.

revoke insert, update, delete on public.purchase_requisitions from anon, authenticated;
