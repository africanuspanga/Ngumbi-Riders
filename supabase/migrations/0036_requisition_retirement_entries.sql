-- =========================================================================
-- 0036_requisition_retirement_entries.sql
--
-- THE RETIREMENT FLOW (client request 2026-10-23).
--
-- 0033 made retirement a single click: the accountant typed what was spent and
-- the request was "retired". The owner wants the flow the reference system
-- has (retirement management + retirement performance monitoring):
--
--   * money released against an approved requisition is accounted for in one
--     OR MORE retirement entries — a purchase is often settled in pieces
--     (deposit receipt, then the balance receipt, then change returned);
--   * each entry states what was SPENT and what cash was RETURNED, with the
--     receipts attached;
--   * the Managing Director VERIFIES each entry (approve / reject with a
--     reason) — an accountant cannot clear their own advance;
--   * a request is UNRETIRED (nothing verified), PARTIALLY retired, or FULLY
--     retired (verified spent + returned covers everything paid out), and the
--     dashboard ages what is still outstanding by days since payment.
--
-- WHAT IS STORED AND WHAT IS DERIVED (D-034 rule 3)
-- Entries are stored — each is something a human chose to submit and the
-- Director chose to verify. The request's retired total, outstanding balance,
-- retired %, partial/full state and aging are DERIVED from the entries on read
-- (lib/requisitions/retirement.ts). purchase_requisitions.retirement_status is
-- still maintained (pending → completed) so every existing reader keeps
-- working, and it is set by the same server action that verifies the entry
-- that completes the retirement.
--
-- Not ledger money: an entry creates no payment, obligation or receipt. On
-- approval it MAY file the spent amount as a department expense (0030), which
-- is where a purchase becomes an operating cost in the reports.
-- =========================================================================

do $$ begin
  create type requisition_retirement_entry_status as enum ('submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.requisition_retirements (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  -- What was actually spent, and what unspent cash was handed back. Integer
  -- TZS. Together they are what this entry accounts for.
  spent_amount integer not null check (spent_amount >= 0),
  returned_amount integer not null default 0 check (returned_amount >= 0),
  spent_on date not null,
  description text not null check (length(description) between 3 and 2000),
  -- Where the spend is filed when the Director approves it.
  department_id uuid references public.departments(id) on delete restrict,
  status requisition_retirement_entry_status not null default 'submitted',
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  -- The department expense written on approval, if any.
  expense_id uuid references public.department_expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint requisition_retirements_accounts_for_something
    check (spent_amount + returned_amount > 0),
  constraint requisition_retirements_decision_shape
    check ((status = 'submitted') = (decided_at is null))
);

comment on table public.requisition_retirements is
  'Retirement entries: money released against an approved requisition, accounted for (spent + returned) and verified by the Director. Totals are derived on read.';

create index if not exists idx_requisition_retirements_requisition
  on public.requisition_retirements(requisition_id, submitted_at);
create index if not exists idx_requisition_retirements_status
  on public.requisition_retirements(status, submitted_at desc);

-- Receipts attach to the entry they support (nullable: documents filed before
-- this migration, and proof of payment, belong to the request as a whole).
alter table public.requisition_documents
  add column if not exists retirement_id uuid
    references public.requisition_retirements(id) on delete set null;
create index if not exists idx_requisition_documents_retirement
  on public.requisition_documents(retirement_id) where retirement_id is not null;

-- =========================================================================
-- GUARD: when an entry may be written, and that a decision is final
-- =========================================================================
create or replace function public.guard_requisition_retirement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'submitted' then
      raise exception 'a % retirement entry is a record and cannot be deleted', old.status;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select status, payment_status, retirement_status, requisition_number
      into parent
      from public.purchase_requisitions where id = new.requisition_id;
    if parent.status is distinct from 'approved' or parent.payment_status is distinct from 'paid' then
      raise exception 'requisition % must be approved and paid before it can be retired',
        coalesce(parent.requisition_number, new.requisition_id::text);
    end if;
    if parent.retirement_status = 'completed' then
      raise exception 'requisition % is already fully retired', parent.requisition_number;
    end if;
    if new.status <> 'submitted' then
      raise exception 'a retirement entry is created as submitted, never pre-decided';
    end if;
    return new;
  end if;

  -- UPDATE: a decided entry is frozen; a submitted one may only be decided.
  if old.status <> 'submitted' then
    if to_jsonb(old) - 'expense_id' is distinct from to_jsonb(new) - 'expense_id' then
      raise exception 'a % retirement entry cannot be changed', old.status;
    end if;
    return new;
  end if;
  if new.status <> 'submitted' and (
       new.requisition_id is distinct from old.requisition_id
    or new.spent_amount is distinct from old.spent_amount
    or new.returned_amount is distinct from old.returned_amount
    or new.submitted_by is distinct from old.submitted_by
  ) then
    raise exception 'deciding a retirement entry may not change what was submitted';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_requisition_retirement() from public, anon, authenticated;

drop trigger if exists trg_requisition_retirements_guard on public.requisition_retirements;
create trigger trg_requisition_retirements_guard
  before insert or update or delete on public.requisition_retirements
  for each row execute function public.guard_requisition_retirement();

-- =========================================================================
-- RLS + GRANTS — staff read, service role writes (the 0028 pattern)
-- =========================================================================
alter table public.requisition_retirements enable row level security;

drop policy if exists requisition_retirements_staff_read on public.requisition_retirements;
create policy requisition_retirements_staff_read on public.requisition_retirements
  for select to authenticated using (public.is_staff());

revoke insert, update, delete, truncate on public.requisition_retirements from anon, authenticated;
revoke all on public.requisition_retirements from anon;
grant select on public.requisition_retirements to authenticated;
