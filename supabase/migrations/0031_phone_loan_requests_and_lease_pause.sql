-- =========================================================================
-- 0031_phone_loan_requests_and_lease_pause.sql
--
-- RIDER-REQUESTED PHONE LOANS, AND WHAT THEY DO TO THE LEASE
-- (client feedback 2026-09-11 #11, #12, #13).
--
-- 0026 shipped phone loans that could only be agreed at the same moment as the
-- contract: the /apply wizard asked "motorcycle, or motorcycle + phone?", and
-- after that there was no way for anybody to get one. The client now wants a
-- rider who is already riding to be able to ASK, and the request to travel
-- through finance and the Director before a shilling is committed:
--
--   rider submits                 -> phone_loan_requests, 'submitted'
--   accountant reviews            -> 'under_review'   (obtains the invoice)
--   accountant raises requisition -> 'requisition_raised'
--   Director approves that        -> 'requisition_approved'
--   phone bought + retired        -> 'purchased'
--   accountant activates the loan -> 'active'  + obligations + LEASE PAUSES
--   final instalment settles      -> 'completed' + LEASE RESUMES
--
-- WHAT "THE LEASE PAUSES" MEANS HERE, PRECISELY
--
-- It does NOT mean the rider stops owing lease money, and it does NOT mean
-- lease obligations are deleted or forgiven. Nothing is written off: a lease
-- day that falls during the pause is POSTPONED — the existing obligation is
-- kept in history with status 'postponed' and an identical replacement is
-- created after the end of the calendar, exactly as an approved postponement
-- has worked since 0015. The rider owes the same number of days for the same
-- total; the days move.
--
-- Three consequences that make this the safe design:
--
--   * ARREARS ARE NOT PAUSED. Only obligations still 'scheduled' move. A day
--     the rider had already failed to pay stays overdue, because pausing it
--     would be forgiving a debt nobody agreed to forgive.
--   * THE CONTRACT TOTAL CANNOT DRIFT. One obligation out, one obligation in,
--     same amount. Every derived figure in this system (outstanding, remaining,
--     expected completion date) recomputes from the ledger, so they all follow
--     automatically and none of them has to be told about phone loans.
--   * DAYS MOVE ONE AT A TIME, AS THEY FALL DUE, from the nightly job. An
--     early repayment therefore needs no unwinding: the pause flag clears and
--     the next day is simply not postponed. There is no "projected resume
--     date" anywhere that could turn out to be wrong.
--
-- Phone instalments are ordinary obligations carrying kind='phone_loan' (0026),
-- so settlement, oldest-first allocation, receipts and statements all work on
-- them unchanged. THAT is what keeps a phone loan from corrupting a motorcycle
-- contract balance: there is only one ledger, and it was already whole.
-- =========================================================================

-- =========================================================================
-- 1. ENUM
-- =========================================================================

do $$ begin
  create type phone_loan_request_status as enum (
    'submitted',
    'under_review',
    'requisition_raised',
    'requisition_approved',
    'purchased',
    'active',
    'completed',
    'rejected',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. THE LIMITS THE RIDER IS SHOWN
-- =========================================================================
-- "Maximum phone-loan amount: TZS 350,000. Maximum repayment period: 3 months."
--
-- These live in app_settings rather than in a CHECK constraint because the
-- brief says "for now" — the Director will change them, and changing a
-- commercial limit must not require a deployment. The hard ceiling of 3 months
-- IS still a constraint on phone_loans.term_months (0026): the instalment
-- engine only knows how to split a loan across 1–3 months, so a longer term is
-- a code change, not a settings change.

alter table public.app_settings
  add column if not exists phone_loan_max_amount integer not null default 350000
    check (phone_loan_max_amount > 0),
  add column if not exists phone_loan_max_months integer not null default 3
    check (phone_loan_max_months between 1 and 3),
  add column if not exists phone_loan_interest_bps integer not null default 5000
    check (phone_loan_interest_bps >= 0 and phone_loan_interest_bps <= 20000);

comment on column public.app_settings.phone_loan_max_amount is
  'Largest phone loan a rider may request, integer TZS. Shown to the rider before they submit.';
comment on column public.app_settings.phone_loan_interest_bps is
  'Flat interest in basis points (5000 = 50%). Snapshotted onto each request and loan: changing it never restates an agreed loan.';

-- =========================================================================
-- 3. REQUESTS
-- =========================================================================
-- The agreed figures are SNAPSHOTTED onto the request at submission. The rider
-- is shown "you will repay X in N instalments of Y" before they submit, and
-- that promise must survive a later change to the interest setting — the same
-- reason phone_loans stores its computed totals instead of recomputing them.

create table if not exists public.phone_loan_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete restrict,
  -- The active motorcycle contract this rider holds when they ask. Kept even
  -- if the contract later ends, so the request's context is never lost.
  contract_id uuid references public.contracts(id) on delete set null,
  principal integer not null check (principal > 0),
  term_months integer not null check (term_months between 1 and 3),
  interest_bps integer not null check (interest_bps >= 0 and interest_bps <= 20000),
  interest_amount integer not null check (interest_amount >= 0),
  total_amount integer not null check (total_amount > 0),
  device_description text check (device_description is null or length(device_description) <= 300),
  reason text check (reason is null or length(reason) <= 1000),
  status phone_loan_request_status not null default 'submitted',
  -- Finance's step.
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 1000),
  -- The purchase requisition raised for the handset, if any.
  requisition_id uuid references public.purchase_requisitions(id) on delete set null,
  -- The Director's decision on the request itself.
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  -- Set when the loan is activated and the obligations exist.
  phone_loan_id uuid references public.phone_loans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_loan_requests_total_matches
    check (total_amount = principal + interest_amount)
);

comment on table public.phone_loan_requests is
  'A rider asking for a phone loan mid-contract. Not money until activation: creates no obligation, payment or allocation until status reaches active.';

create index if not exists idx_phone_loan_requests_status
  on public.phone_loan_requests(status, created_at desc);
create index if not exists idx_phone_loan_requests_rider
  on public.phone_loan_requests(rider_id, created_at desc);

-- A rider may have only ONE request in flight. Without this a rider could
-- submit five requests and finance would be reviewing five copies of the same
-- ask; worse, two could reach activation and generate two overlapping
-- instalment calendars.
create unique index if not exists uq_phone_loan_request_open_per_rider
  on public.phone_loan_requests(rider_id)
  where status in ('submitted', 'under_review', 'requisition_raised',
                   'requisition_approved', 'purchased', 'active');

drop trigger if exists trg_phone_loan_requests_updated on public.phone_loan_requests;
create trigger trg_phone_loan_requests_updated
  before update on public.phone_loan_requests
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 4. LOAN LIFECYCLE COLUMNS
-- =========================================================================

alter table public.phone_loans
  add column if not exists request_id uuid references public.phone_loan_requests(id) on delete set null,
  add column if not exists activated_at timestamptz,
  add column if not exists completed_at timestamptz,
  -- 'with_contract' = agreed at contract time (the 0026 path, lease had not
  -- started yet). 'mid_contract' = this migration's path, where a running
  -- lease has to be paused.
  add column if not exists source text not null default 'with_contract'
    check (source in ('with_contract', 'mid_contract'));

create index if not exists idx_phone_loans_status on public.phone_loans(status);

-- =========================================================================
-- 5. THE PAUSE FLAG
-- =========================================================================
-- One nullable pointer on the contract. Null means the lease is running. This
-- is deliberately NOT a contract_status value: `paused` there means the OWNER
-- suspended the whole contract, which is a different business fact with
-- different consequences, and overloading it would make every existing status
-- check ambiguous.

alter table public.contracts
  add column if not exists lease_paused_for_loan_id uuid references public.phone_loans(id) on delete set null,
  add column if not exists lease_paused_at timestamptz;

comment on column public.contracts.lease_paused_for_loan_id is
  'Non-null while an active phone loan is being repaid: lease days reaching their due date are postponed to the end of the calendar instead of falling due. Cleared automatically when the loan completes.';

create index if not exists idx_contracts_lease_paused
  on public.contracts(lease_paused_for_loan_id)
  where lease_paused_for_loan_id is not null;

-- Which loan (if any) caused an obligation to be postponed. Without this the
-- rider's calendar shows a postponed day with no explanation, and nobody can
-- audit how many days a loan actually moved.
alter table public.payment_obligations
  add column if not exists postponed_for_loan_id uuid references public.phone_loans(id) on delete set null;

create index if not exists idx_obligations_postponed_for_loan
  on public.payment_obligations(postponed_for_loan_id)
  where postponed_for_loan_id is not null;

-- =========================================================================
-- 6. ACTIVATION — one transaction, or nothing
-- =========================================================================
-- Creating the instalment calendar, flipping the loan to active and pausing
-- the lease must be atomic. Half of this applied means either a rider with
-- phone obligations whose lease never paused (they owe both at once), or a
-- paused lease with no phone obligations (they owe nothing and the lease has
-- stopped). Both are worse than failing.
--
-- The instalments arrive as jsonb built by lib/loans/phone.ts — the SAME pure
-- function that produced the figures the rider agreed to, so the calendar
-- cannot disagree with the quote. This mirrors how 0024 taught contract
-- activation to replay a payment plan verbatim.

create or replace function public.activate_phone_loan(
  p_loan_id uuid,
  p_instalments jsonb,   -- [{due_date, due_at, local_due_time, amount}, ...]
  p_pause_lease boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_loan public.phone_loans%rowtype;
  v_contract public.contracts%rowtype;
  v_row jsonb;
  v_count integer := 0;
  v_total integer := 0;
begin
  select * into v_loan from public.phone_loans where id = p_loan_id for update;
  if not found then raise exception 'phone_loan_not_found'; end if;
  if v_loan.status <> 'pending' then
    raise exception 'phone loan % is % and cannot be activated', p_loan_id, v_loan.status;
  end if;
  if v_loan.contract_id is null then
    raise exception 'phone loan % has no contract to attach instalments to', p_loan_id;
  end if;

  select * into v_contract from public.contracts where id = v_loan.contract_id for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.status <> 'active' then
    raise exception 'contract % is % — a phone loan attaches to an active contract only',
      v_contract.contract_number, v_contract.status;
  end if;
  if v_contract.lease_paused_for_loan_id is not null then
    raise exception 'contract % is already paused for another phone loan',
      v_contract.contract_number;
  end if;

  if jsonb_typeof(p_instalments) <> 'array' or jsonb_array_length(p_instalments) = 0 then
    raise exception 'no instalments supplied';
  end if;

  for v_row in select * from jsonb_array_elements(p_instalments) loop
    -- One obligation per contract per date (0007's unique constraint). A phone
    -- instalment landing on an existing lease day would be rejected there with
    -- an opaque 23505; say what actually happened instead.
    if exists (
      select 1 from public.payment_obligations
       where contract_id = v_loan.contract_id
         and due_date = (v_row->>'due_date')::date
    ) then
      raise exception 'a payment is already scheduled on % for contract %',
        v_row->>'due_date', v_contract.contract_number;
    end if;

    insert into public.payment_obligations (
      contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
      amount_due, status, contract_version, kind, phone_loan_id
    ) values (
      v_loan.contract_id,
      v_loan.rider_id,
      v_contract.motorcycle_id,
      (v_row->>'due_date')::date,
      (v_row->>'due_at')::timestamptz,
      (v_row->>'local_due_time')::time,
      (v_row->>'amount')::integer,
      'scheduled',
      coalesce(v_contract.current_version, 1),
      'phone_loan',
      p_loan_id
    );
    v_count := v_count + 1;
    v_total := v_total + (v_row->>'amount')::integer;
  end loop;

  -- The generated calendar must equal the agreed loan to the shilling. If it
  -- does not, the quote the rider accepted and the money the system will
  -- collect have diverged, and the only safe outcome is no loan at all.
  if v_total <> v_loan.total_amount then
    raise exception 'instalments total % but the loan is % — refusing to activate',
      v_total, v_loan.total_amount;
  end if;

  update public.phone_loans
     set status = 'active', activated_at = now()
   where id = p_loan_id;

  if p_pause_lease then
    update public.contracts
       set lease_paused_for_loan_id = p_loan_id, lease_paused_at = now()
     where id = v_loan.contract_id;
  end if;

  return v_count;
end;
$$;

-- =========================================================================
-- 7. POSTPONING ONE LEASE DAY
-- =========================================================================
-- Called by the nightly job for each lease day that comes due while the lease
-- is paused. The replacement DATE is computed in TypeScript by the existing,
-- unit-tested schedule engine (lib/obligations/payment-days.ts) and passed in,
-- because it must honour the contract's cadence and selected weekdays — that
-- logic already exists and reimplementing it in PL/pgSQL would be a second
-- copy of the rules to keep in step.
--
-- The function's job is the part that must be atomic: the original is retired
-- and its replacement created together, or neither happens.

create or replace function public.postpone_lease_day_for_loan(
  p_obligation_id uuid,
  p_loan_id uuid,
  p_new_date date,
  p_due_at timestamptz,
  p_local_due_time time
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ob public.payment_obligations%rowtype;
  v_contract public.contracts%rowtype;
  v_new_id uuid;
begin
  select * into v_ob from public.payment_obligations where id = p_obligation_id for update;
  if not found then raise exception 'obligation_not_found'; end if;

  -- ONLY a still-scheduled lease day may move. An overdue day is a debt the
  -- rider already owes and a paid one is history; either would be rewritten by
  -- a pause that reached it, so both are refused outright.
  if v_ob.status <> 'scheduled' then
    raise exception 'obligation % is % — only a scheduled day can be postponed for a phone loan',
      p_obligation_id, v_ob.status;
  end if;
  if v_ob.kind <> 'lease' then
    raise exception 'obligation % is a % obligation — a phone instalment is never postponed for its own loan',
      p_obligation_id, v_ob.kind;
  end if;

  -- An obligation reserved by an in-flight mobile payment must not move under
  -- the payer's feet (the guard 0018 added to settlement and exemptions).
  if exists (
    select 1 from public.payment_reservations
     where obligation_id = p_obligation_id and is_active
  ) then
    raise exception 'obligation % is reserved by a payment in progress', p_obligation_id;
  end if;

  select * into v_contract from public.contracts where id = v_ob.contract_id;

  if exists (
    select 1 from public.payment_obligations
     where contract_id = v_ob.contract_id and due_date = p_new_date
  ) then
    raise exception 'a payment is already scheduled on % for this contract', p_new_date;
  end if;

  update public.payment_obligations
     set status = 'postponed', postponed_for_loan_id = p_loan_id
   where id = p_obligation_id;

  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version, kind
  ) values (
    v_ob.contract_id, v_ob.rider_id, v_ob.motorcycle_id, p_new_date, p_due_at,
    p_local_due_time, v_ob.amount_due, 'scheduled',
    coalesce(v_contract.current_version, 1), 'lease'
  ) returning id into v_new_id;

  -- The lease now finishes a day later than it did. end_date is what the
  -- completion job and every "expected completion" figure read, so it has to
  -- follow or the contract would be declared complete with days outstanding.
  update public.contracts
     set end_date = greatest(coalesce(end_date, p_new_date), p_new_date)
   where id = v_ob.contract_id;

  return v_new_id;
end;
$$;

-- =========================================================================
-- 8. COMPLETION — the lease resumes
-- =========================================================================
-- Idempotent on purpose: it is called from the settlement path AND from the
-- nightly sweep, and both may reach it for the same loan.

create or replace function public.complete_phone_loan(p_loan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_loan public.phone_loans%rowtype;
  v_outstanding integer;
begin
  select * into v_loan from public.phone_loans where id = p_loan_id for update;
  if not found then raise exception 'phone_loan_not_found'; end if;
  if v_loan.status = 'completed' then
    return false;   -- already done; nothing to do and nothing to report
  end if;
  if v_loan.status <> 'active' then
    raise exception 'phone loan % is % and cannot be completed', p_loan_id, v_loan.status;
  end if;

  -- Never declare a loan repaid while it still has an unsettled instalment.
  select count(*) into v_outstanding
    from public.payment_obligations
   where phone_loan_id = p_loan_id
     and status in ('scheduled', 'due', 'overdue');
  if v_outstanding > 0 then
    raise exception 'phone loan % still has % unpaid instalment(s)', p_loan_id, v_outstanding;
  end if;

  update public.phone_loans
     set status = 'completed', completed_at = now()
   where id = p_loan_id;

  -- Resume the lease. Scoped to THIS loan so a contract paused by a different
  -- loan is never unpaused by accident.
  update public.contracts
     set lease_paused_for_loan_id = null, lease_paused_at = null
   where lease_paused_for_loan_id = p_loan_id;

  update public.phone_loan_requests
     set status = 'completed'
   where phone_loan_id = p_loan_id
     and status = 'active';

  return true;
end;
$$;

revoke all on function public.activate_phone_loan(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.postpone_lease_day_for_loan(uuid, uuid, date, timestamptz, time) from public, anon, authenticated;
revoke all on function public.complete_phone_loan(uuid) from public, anon, authenticated;

-- =========================================================================
-- 9. RLS
-- =========================================================================
-- A rider reads their OWN requests (they have to see where their ask got to).
-- Staff read all of them. Nobody writes from a browser session: every
-- transition is a server action behind requirePermission() using the service
-- role, which is what stops a rider from POSTing themselves an approval.

alter table public.phone_loan_requests enable row level security;

drop policy if exists phone_loan_requests_staff_read on public.phone_loan_requests;
create policy phone_loan_requests_staff_read on public.phone_loan_requests
  for select to authenticated using (public.is_staff());

drop policy if exists phone_loan_requests_self_read on public.phone_loan_requests;
create policy phone_loan_requests_self_read on public.phone_loan_requests
  for select to authenticated using (
    exists (
      select 1 from public.riders r
       where r.id = phone_loan_requests.rider_id
         and r.profile_id = auth.uid()
    )
  );

revoke insert, update, delete, truncate on public.phone_loan_requests from anon, authenticated;
