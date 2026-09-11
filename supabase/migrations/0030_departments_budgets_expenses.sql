-- =========================================================================
-- 0030_departments_budgets_expenses.sql
--
-- DEPARTMENT BUDGETS AND EXPENSES (client feedback 2026-09-11 #2).
--
-- "Create departments, assign a budget to each department, record expenses
--  under each department, track remaining budget, view total spending per
--  department, generate reports."
--
-- Until now the only expense ledger in this system was motorcycle_expenses:
-- every shilling spent had to be attached to a motorcycle, so rent, salaries,
-- airtime and office costs had nowhere to go and simply were not recorded.
-- This adds the general ledger side of the business.
--
-- THREE DESIGN DECISIONS WORTH THE READING TIME
--
-- 1. TWO EXPENSE TABLES, NOT ONE, AND NO DOUBLE COUNTING.
--    motorcycle_expenses is not migrated or absorbed. It has a live history,
--    a unique-per-motorcycle meaning and it feeds the cash-operating-margin
--    report, and rewriting money history to fit a new shape is exactly what
--    spec rule 6 forbids. Instead it gains a NULLABLE department_id, and a
--    department's spend is defined as
--        sum(department_expenses for D) + sum(motorcycle_expenses tagged D)
--    Every row belongs to exactly one of the two tables, so no expense can be
--    counted twice however it is tagged.
--
-- 2. NOTHING DERIVED IS STORED (D-034 rule 3). There is no `spent` column and
--    no `remaining` column on a budget. Remaining = budget - spend, computed
--    on read by lib/departments/compute.ts. A stored remaining balance drifts
--    the first time an expense is edited, and then the Director is reading a
--    number no row supports.
--
-- 3. A BUDGET IS A PERIOD, NOT A YEAR FIELD. Each allocation carries explicit
--    period_start/period_end dates, so "Q1 fuel" and "annual administration"
--    coexist and an expense is matched to a budget by its DATE rather than by
--    a label someone has to keep consistent.
--
-- This is operating-cost accounting. It is NOT rider money: nothing here
-- creates a payment, obligation, allocation or receipt, and no collections
-- figure may ever include it. The cashflow report shows the two side by side
-- precisely so they are never added together by accident.
-- =========================================================================

-- =========================================================================
-- 1. DEPARTMENTS
-- =========================================================================
-- `code` is a stable, uppercase, machine-readable handle used in exports and
-- report filters. Like the geo codes (spec rule 15) it is APPEND-ONLY: renaming
-- a code orphans every export and saved filter that quotes it. The display
-- `name` is what changes when the client renames a department.

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name text not null check (length(name) between 2 and 100),
  description text check (description is null or length(description) <= 1000),
  -- Deactivated rather than deleted: a department with history must keep it.
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.departments is
  'Cost centres for budgeting and expense reporting. Operating costs only — never rider collections.';

create index if not exists idx_departments_active on public.departments(is_active, name);

drop trigger if exists trg_departments_updated on public.departments;
create trigger trg_departments_updated
  before update on public.departments
  for each row execute function public.set_updated_at();

-- The six the client named. Inserted as data, not as an enum, because the
-- brief explicitly says "other custom departments" — adding one must not
-- require a migration.
insert into public.departments (code, name, description)
values
  ('OPERATIONS',   'Operations',           'Day-to-day running of the fleet: field staff, airtime, transport.'),
  ('FINANCE',      'Finance',              'Accounting, banking charges, audit and financial administration.'),
  ('FLEET',        'Motorcycle purchasing','Buying motorcycles and the costs of bringing them into service.'),
  ('ADMIN',        'Administration',       'Office, rent, utilities, stationery and general administration.'),
  ('MAINTENANCE',  'Maintenance',          'Servicing, spare parts and repairs across the fleet.'),
  ('OTHER',        'Other',                'Anything that does not belong to another department.')
on conflict (code) do nothing;

-- =========================================================================
-- 2. BUDGETS
-- =========================================================================
-- A department may hold several allocations (an annual budget plus a top-up,
-- or one per quarter). They are summed for any period that overlaps the one
-- being reported on.

create table if not exists public.department_budgets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  label text not null check (length(label) between 2 and 120),
  fiscal_year integer not null check (fiscal_year between 2020 and 2100),
  period_start date not null,
  period_end date not null,
  -- Integer TZS, like every amount in this system (spec rule 11).
  amount integer not null check (amount > 0),
  note text check (note is null or length(note) <= 1000),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_budgets_period_ordered check (period_end >= period_start)
);

create index if not exists idx_department_budgets_dept
  on public.department_budgets(department_id, period_start desc);
create index if not exists idx_department_budgets_period
  on public.department_budgets(period_start, period_end);

drop trigger if exists trg_department_budgets_updated on public.department_budgets;
create trigger trg_department_budgets_updated
  before update on public.department_budgets
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3. DEPARTMENT EXPENSES
-- =========================================================================
-- General operating spend. `requisition_id` links a spend back to the purchase
-- the Director approved, which is what makes retirement (0032) checkable: the
-- accountant must account for approved money with actual expenses.

create table if not exists public.department_expenses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  expense_date date not null,
  -- Shares the requisition item vocabulary so an approved line and the expense
  -- it becomes are filed under the same word (lib/requisitions/constants.ts).
  category text not null,
  amount integer not null check (amount > 0),
  description text not null check (length(description) between 1 and 300),
  supplier text check (supplier is null or length(supplier) <= 200),
  -- Invoice / receipt number as written on the paper.
  reference text check (reference is null or length(reference) <= 120),
  requisition_id uuid references public.purchase_requisitions(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_department_expenses_dept
  on public.department_expenses(department_id, expense_date desc);
create index if not exists idx_department_expenses_date
  on public.department_expenses(expense_date desc);
create index if not exists idx_department_expenses_requisition
  on public.department_expenses(requisition_id);

drop trigger if exists trg_department_expenses_updated on public.department_expenses;
create trigger trg_department_expenses_updated
  before update on public.department_expenses
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 4. TAGGING THE EXISTING LEDGERS
-- =========================================================================
-- Motorcycle expenses can now roll up into a department without moving a
-- single row. Left NULL for every existing row: nobody has said which
-- department those belong to, and inventing an answer would put figures into
-- the Director's report that no human chose.

alter table public.motorcycle_expenses
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_motorcycle_expenses_dept
  on public.motorcycle_expenses(department_id, expense_date desc);

drop trigger if exists trg_motorcycle_expenses_updated on public.motorcycle_expenses;
create trigger trg_motorcycle_expenses_updated
  before update on public.motorcycle_expenses
  for each row execute function public.set_updated_at();

-- A requisition belongs to a department too, so approved purchases and the
-- spend they become appear under the same heading in the reports. The legacy
-- free-text `department` column from 0028 is KEPT and still populated: it is
-- on printed requisitions that already exist, and rewriting those would be
-- rewriting a record the Director signed.
alter table public.purchase_requisitions
  add column if not exists department_id uuid references public.departments(id) on delete set null;

create index if not exists idx_requisitions_department
  on public.purchase_requisitions(department_id, request_date desc);

-- Backfill the link for existing requisitions from the text they already
-- carry. Only exact, unambiguous matches — anything else stays NULL rather
-- than being guessed into the wrong cost centre.
--
-- THE TRIGGER IS DISABLED FOR THIS ONE STATEMENT, and it is worth saying
-- exactly why, because bypassing an immutability guard is not something to do
-- casually. `guard_requisition_decided()` (0029) refuses ANY change to an
-- approved requisition except its payment columns — correctly, since the
-- lines, the total and the decision are what the Director authorised. It
-- refused this backfill on the first attempt, which is the guard working.
--
-- But `department_id` did not exist when those requests were approved, and
-- this statement does not change anything the Director saw: it reads the
-- `department` TEXT that is already on the row — the same word printed on the
-- requisition they signed — and stores the matching id beside it. The
-- authorisation is untouched; only its machine-readability changes. Without
-- this, every historical approved request would be invisible to the
-- department filter on the new reports.
--
-- Scoped to a single UPDATE inside this migration's transaction: if anything
-- below fails, the whole migration rolls back and the trigger is restored with
-- it. Nothing else in this file writes to purchase_requisitions.
alter table public.purchase_requisitions disable trigger trg_requisitions_guard;

update public.purchase_requisitions r
   set department_id = d.id
  from public.departments d
 where r.department_id is null
   and d.code = case r.department
                  when 'fleet'          then 'FLEET'
                  when 'operations'     then 'OPERATIONS'
                  when 'finance'        then 'FINANCE'
                  when 'administration' then 'ADMIN'
                  else null
                end;

alter table public.purchase_requisitions enable trigger trg_requisitions_guard;

-- Prove the guard is back on before this migration is allowed to commit. A
-- migration that silently left an immutability guard disabled would be far
-- worse than the one it replaced.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_requisitions_guard'
       and tgrelid = 'public.purchase_requisitions'::regclass
       and tgenabled <> 'D'
  ) then
    raise exception 'trg_requisitions_guard is still disabled — refusing to commit';
  end if;
end $$;

-- =========================================================================
-- 5. RLS
-- =========================================================================
-- Both back-office roles READ; nobody writes directly. Every mutation goes
-- through a server action that has already called requirePermission(), then
-- the service role — the rule the money tables have followed since 0016 and
-- the requisition tables since 0028. Riders hold no policy here at all: what
-- the business spends is none of a rider's business.

alter table public.departments enable row level security;
alter table public.department_budgets enable row level security;
alter table public.department_expenses enable row level security;

drop policy if exists departments_staff_read on public.departments;
create policy departments_staff_read on public.departments
  for select to authenticated using (public.is_staff());

drop policy if exists department_budgets_staff_read on public.department_budgets;
create policy department_budgets_staff_read on public.department_budgets
  for select to authenticated using (public.is_staff());

drop policy if exists department_expenses_staff_read on public.department_expenses;
create policy department_expenses_staff_read on public.department_expenses
  for select to authenticated using (public.is_staff());

revoke insert, update, delete, truncate on public.departments from anon, authenticated;
revoke insert, update, delete, truncate on public.department_budgets from anon, authenticated;
revoke insert, update, delete, truncate on public.department_expenses from anon, authenticated;

-- motorcycle_expenses was owner-only under 0010 and gained an accountant
-- SELECT policy in 0025; the new column changes neither. Restated so a replay
-- of this migration cannot leave it writable by a browser session.
revoke insert, update, delete, truncate on public.motorcycle_expenses from anon, authenticated;

-- =========================================================================
-- 6. GUARD — a department with history is never deleted
-- =========================================================================
-- `on delete restrict` on the two child FKs already refuses the delete, but it
-- reports it as a foreign-key violation. This says what actually happened, in
-- the words the owner will read on screen.

create or replace function public.guard_department_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  select count(*) into n from public.department_expenses where department_id = old.id;
  if n > 0 then
    raise exception 'department % has % expense(s) and cannot be deleted — deactivate it instead',
      old.name, n;
  end if;
  select count(*) into n from public.department_budgets where department_id = old.id;
  if n > 0 then
    raise exception 'department % has % budget(s) and cannot be deleted — deactivate it instead',
      old.name, n;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_departments_guard_delete on public.departments;
create trigger trg_departments_guard_delete
  before delete on public.departments
  for each row execute function public.guard_department_delete();

revoke all on function public.guard_department_delete() from public, anon, authenticated;
