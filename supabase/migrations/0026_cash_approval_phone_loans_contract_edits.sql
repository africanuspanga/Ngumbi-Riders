-- =========================================================================
-- 0026_cash_approval_phone_loans_contract_edits.sql
--
-- Client-feedback build #2 (2026-09-05). Four independent concerns, one
-- migration:
--
--   1. CASH APPROVAL (payments #4/#5/#6/#7) — an accountant who receives cash
--      no longer settles it directly. They raise a REQUEST the Director
--      confirms, edits or rejects; only on confirmation does the money settle
--      through the same record_completed_payment path. Every payment now also
--      records WHO received it, because there may be several accountants.
--
--   2. PHONE LOANS (new feature) — a rider may take the motorcycle together
--      with a phone. The loan is principal + 50% interest repaid over at most
--      3 monthly instalments, collected BEFORE the motorcycle lease starts.
--      Obligations gain a `kind` so a phone instalment is distinguishable from
--      a lease day everywhere it is displayed or reported.
--
--   3. CONTRACT EDITING — contracts gain the columns the editor needs
--      (`daily_rate`, `payment_days_target`, `lease_start_date`) and the
--      activation function learns to carry an obligation's kind.
--
--   4. APPLICATION QUESTION — "motorcycle only, or motorcycle + phone?".
--
-- Money invariants are unchanged: obligations are still whole, settlement is
-- still record_completed_payment, and direct writes to money tables stay
-- revoked from authenticated (0016) — the new tables follow the same rule.
-- =========================================================================

-- =========================================================================
-- 1. ENUMS
-- =========================================================================

do $$ begin
  create type cash_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type phone_loan_status as enum ('pending', 'active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

-- What an obligation is FOR. 'lease' is every obligation that exists today, so
-- the default keeps the whole live calendar meaning exactly what it meant.
do $$ begin
  create type obligation_kind as enum ('lease', 'phone_loan');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. WHO RECEIVED THE MONEY (payments #2)
-- =========================================================================
-- `created_by` records who typed the record into the system. With two
-- accountants the Director also needs to know who physically took the cash —
-- they are usually the same person but must not be assumed to be.

alter table public.payments
  add column if not exists received_by uuid references public.profiles(id),
  add column if not exists note text;

comment on column public.payments.received_by is
  'Staff member who physically received a cash payment (may differ from created_by, who typed it in). NULL for mobile money.';

create index if not exists idx_payments_received_by on public.payments(received_by);
create index if not exists idx_payments_completed_at on public.payments(completed_at);

-- =========================================================================
-- 3. CASH PAYMENT REQUESTS (payments #4)
-- =========================================================================
-- An accountant's cash entry is a REQUEST until the Director confirms it.
-- Nothing is settled and no `payments` row exists while it is pending, so a
-- rejected or edited request can never leave money half-recorded. The
-- obligation ids are stored as an array rather than a child table because the
-- set is replaced wholesale on every edit and is only meaningful together.

create table if not exists public.cash_payment_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  obligation_ids uuid[] not null check (array_length(obligation_ids, 1) > 0),
  amount integer not null check (amount > 0),
  payment_date date not null,
  note text,
  status cash_request_status not null default 'pending',
  -- Who received the physical cash, and who typed the request in.
  received_by uuid not null references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  -- Set when approval settles the money, so the request links to its payment.
  payment_id uuid references public.payments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cash_requests_status
  on public.cash_payment_requests(status, created_at desc);
create index if not exists idx_cash_requests_rider
  on public.cash_payment_requests(rider_id, created_at desc);

drop trigger if exists trg_cash_requests_updated on public.cash_payment_requests;
create trigger trg_cash_requests_updated
  before update on public.cash_payment_requests
  for each row execute function public.set_updated_at();

alter table public.cash_payment_requests enable row level security;

-- Owner sees and decides everything; the accountant sees the queue they work
-- from. WRITES go through the service role only (see the revoke below), so a
-- forged client insert cannot manufacture a payment request.
drop policy if exists cash_requests_owner_read on public.cash_payment_requests;
create policy cash_requests_owner_read on public.cash_payment_requests
  for select to authenticated using (public.is_owner());

drop policy if exists cash_requests_accountant_read on public.cash_payment_requests;
create policy cash_requests_accountant_read on public.cash_payment_requests
  for select to authenticated using (public.is_accountant());

revoke insert, update, delete on public.cash_payment_requests from anon, authenticated;

-- Staff must be able to read each other's DISPLAY NAME, or "received by
-- <name>" renders as "—" for an accountant looking at a payment their
-- colleague took. Scoped to staff rows only: rider profiles stay invisible to
-- an accountant, exactly as 0025 left them.
drop policy if exists profiles_staff_read on public.profiles;
create policy profiles_staff_read on public.profiles
  for select to authenticated
  using (public.is_staff() and role in ('owner', 'accountant'));

-- =========================================================================
-- 4. PHONE LOANS (new feature)
-- =========================================================================
-- Fixed commercial terms set by the Director: 50% flat interest, repaid in at
-- most 3 monthly instalments. The computed figures are STORED (not recomputed
-- at read time) because they are the agreed contract terms — a later change to
-- the default rate must never silently restate an existing loan.

create table if not exists public.phone_loans (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete set null,
  principal integer not null check (principal > 0),
  -- Stored as basis points so the rate is exact integer arithmetic: 5000 = 50%.
  interest_bps integer not null default 5000 check (interest_bps >= 0 and interest_bps <= 20000),
  interest_amount integer not null check (interest_amount >= 0),
  total_amount integer not null check (total_amount > 0),
  term_months integer not null check (term_months between 1 and 3),
  device_description text,
  status phone_loan_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_loans_total_matches check (total_amount = principal + interest_amount)
);

create index if not exists idx_phone_loans_rider on public.phone_loans(rider_id);
create index if not exists idx_phone_loans_contract on public.phone_loans(contract_id);

drop trigger if exists trg_phone_loans_updated on public.phone_loans;
create trigger trg_phone_loans_updated
  before update on public.phone_loans
  for each row execute function public.set_updated_at();

alter table public.phone_loans enable row level security;

drop policy if exists phone_loans_owner_all on public.phone_loans;
create policy phone_loans_owner_all on public.phone_loans
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists phone_loans_accountant_read on public.phone_loans;
create policy phone_loans_accountant_read on public.phone_loans
  for select to authenticated using (public.is_accountant());

drop policy if exists phone_loans_self_read on public.phone_loans;
create policy phone_loans_self_read on public.phone_loans
  for select to authenticated using (
    exists (select 1 from public.riders r
             where r.id = phone_loans.rider_id and r.profile_id = auth.uid())
  );

-- A loan balance is money: it mutates through server code holding the service
-- role, exactly like payments and obligations (0016).
revoke insert, update, delete on public.phone_loans from anon, authenticated;

-- =========================================================================
-- 5. OBLIGATION KIND (phone instalments live in the same ledger)
-- =========================================================================
-- A phone instalment is an obligation like any other — same settlement
-- function, same oldest-first allocation, same receipts. Only its LABEL and
-- reporting differ, so one nullable-free enum column carries the distinction
-- instead of a parallel table that would need its own money guarantees.

alter table public.payment_obligations
  add column if not exists kind obligation_kind not null default 'lease',
  add column if not exists phone_loan_id uuid references public.phone_loans(id) on delete restrict;

comment on column public.payment_obligations.kind is
  'lease = motorcycle lease day/instalment (the default and everything before 0026); phone_loan = a phone-loan instalment collected before the lease starts.';

create index if not exists idx_obligations_kind on public.payment_obligations(kind);

-- =========================================================================
-- 6. CONTRACT COLUMNS FOR EDITING + PRICING + PHONE LOANS
-- =========================================================================

alter table public.contracts
  -- The agreed DAILY rate. Weekly/monthly instalments are derived from it
  -- (10,000/day -> 70,000/week) instead of being typed twice.
  add column if not exists daily_rate integer check (daily_rate is null or daily_rate > 0),
  -- Custom-weekday contracts are sold as "N payment days", not "N calendar
  -- days": the term is extended until N payment days have actually fallen.
  add column if not exists payment_days_target integer
    check (payment_days_target is null or payment_days_target > 0),
  -- When a phone loan is attached the lease instalments start only after it is
  -- repaid; start_date stays the contract/possession start.
  add column if not exists lease_start_date date,
  add column if not exists phone_loan_id uuid references public.phone_loans(id) on delete set null,
  -- Bumped by the contract editor so an edited term is traceable.
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by uuid references public.profiles(id);

-- 'payment_days' joins 'duration' and 'exact': the owner sells the lease as a
-- number of PAYMENT DAYS and the end date is counted forward from them.
alter table public.contracts drop constraint if exists contracts_end_date_source_check;
alter table public.contracts
  add constraint contracts_end_date_source_check
  check (end_date_source in ('duration', 'exact', 'payment_days'));

comment on column public.contracts.daily_rate is
  'Agreed daily lease rate in TZS. installment_amount is derived from it for weekly/monthly cadences (daily x 7, daily x 30) and equals it for daily/custom-weekday cadences.';
comment on column public.contracts.payment_days_target is
  'Number of PAYMENT DAYS the term must collect (custom-weekday contracts). The end date is extended until this many selected weekdays have fallen.';
comment on column public.contracts.lease_start_date is
  'First lease obligation date. Equals start_date unless a phone loan defers the lease until the loan is repaid.';

create index if not exists idx_contracts_phone_loan on public.contracts(phone_loan_id);

-- =========================================================================
-- 7. APPLICATION: MOTORCYCLE ONLY, OR MOTORCYCLE + PHONE?
-- =========================================================================

alter table public.rider_applications
  add column if not exists wants_phone_loan boolean not null default false,
  add column if not exists phone_loan_amount integer
    check (phone_loan_amount is null or phone_loan_amount > 0);

comment on column public.rider_applications.wants_phone_loan is
  'Applicant answered "motorcycle + phone" (build feedback 2026-09-05). Carried to the contract builder, which attaches a phone loan.';

-- =========================================================================
-- 8. ACTIVATION WITH OBLIGATION KIND
-- =========================================================================
-- Replaces the 0025 version. ONE line of behaviour changes: each obligation
-- row may declare a `kind` and `phoneLoanId`, defaulting to 'lease'/NULL so
-- every existing caller is byte-for-byte unaffected. Every guard from 0018 and
-- 0025 is preserved verbatim — the owner check, the pre-active status check,
-- the positive-amount check, the signature requirement, the empty-CALENDAR
-- refusal that tests STORED obligations rather than row_count, and the
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
    amount_due, status, contract_version, kind, phone_loan_id
  )
  select
    p_contract_id, v_contract.rider_id, v_contract.motorcycle_id,
    (o->>'dueDate')::date,
    (o->>'dueAtUtc')::timestamptz,
    (o->>'localDueTime')::time,
    coalesce(nullif(o->>'amount', '')::integer, v_contract.installment_amount),
    'scheduled',
    v_contract.current_version,
    coalesce(nullif(o->>'kind', ''), 'lease')::public.obligation_kind,
    nullif(o->>'phoneLoanId', '')::uuid
  from jsonb_array_elements(p_obligations) as o
  on conflict (contract_id, due_date) do nothing;

  get diagnostics v_count = row_count;

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

-- =========================================================================
-- 9. BACKFILL
-- =========================================================================
-- Existing contracts: the daily rate equals the instalment for daily and
-- custom-weekday cadences (one payment = one day). Weekly/monthly rows are
-- LEFT NULL rather than back-derived: dividing an agreed weekly instalment by
-- 7 could invent a rate the owner never agreed, and the editor prompts for it.
update public.contracts
   set daily_rate = installment_amount
 where daily_rate is null
   and installment_amount > 0
   and schedule_type in ('daily', 'selected_weekdays');

-- Every existing lease starts its instalments on its start date.
update public.contracts
   set lease_start_date = start_date
 where lease_start_date is null
   and start_date is not null;
