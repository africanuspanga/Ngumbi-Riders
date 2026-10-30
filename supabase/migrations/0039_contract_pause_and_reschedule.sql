-- =========================================================================
-- 0039_contract_pause_and_reschedule.sql   (client feedback 2026-10-29, D-055)
--
-- Two owner reports, one migration.
--
-- 1. "I paused the contract but his debt keeps going up."
--    A pause only flipped contracts.status. Nothing stopped the nightly sweep
--    turning the paused rider's days due → overdue, so the debt kept growing.
--    A pause now behaves like the phone-loan lease pause (0031, D-043): a lease
--    day that falls INSIDE the pause is POSTPONED to the end of the calendar —
--    nothing forgiven, nothing invented; the lease simply runs longer.
--    `paused_from` records where the pause starts, and the function below
--    refuses to move any day before it: arrears the rider ran up before the
--    pause are a real debt and stay exactly where they are.
--
-- 2. "The owner cannot change a payment plan from daily to weekly or monthly."
--    After activation the term/schedule editor is closed (the obligations ARE
--    the money record). `reschedule_contract_obligations` changes the cadence
--    of the FUTURE, still-scheduled lease days only — today, arrears and every
--    settled day are untouched — and refuses unless the money is conserved to
--    the shilling: what the rider still owed for the rest of the lease before
--    the change is exactly what they owe after it.
--
-- Both functions are service-role only (the app calls them through the admin
-- client after requirePermission), like every money function since 0016.
-- =========================================================================

alter table public.contracts
  add column if not exists paused_from date;

comment on column public.contracts.paused_from is
  'Set while the owner has paused the contract: the first local date the pause covers. Lease days on or after it are postponed to the end of the calendar as they arrive. Cleared on resume.';

-- -------------------------------------------------------------------------
-- 1. Postpone one lease day that falls inside an owner pause.
-- -------------------------------------------------------------------------
create or replace function public.postpone_day_for_contract_pause(
  p_obligation_id uuid,
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

  select * into v_contract from public.contracts where id = v_ob.contract_id for update;
  if v_contract.status <> 'paused' or v_contract.paused_from is null then
    raise exception 'contract % is not paused', v_ob.contract_id;
  end if;

  -- Only a day INSIDE the pause may move. A day before it is a debt the rider
  -- ran up while they had the motorcycle.
  if v_ob.due_date < v_contract.paused_from then
    raise exception 'obligation % (%) is before the pause started (%)',
      p_obligation_id, v_ob.due_date, v_contract.paused_from;
  end if;
  -- 'due'/'overdue' are allowed because a pause can be recorded after its
  -- start date (the owner pauses today for a rider who stopped on Monday).
  if v_ob.status not in ('scheduled', 'due', 'overdue') then
    raise exception 'obligation % is % — only an unpaid day can be postponed', p_obligation_id, v_ob.status;
  end if;
  if v_ob.kind <> 'lease' then
    raise exception 'obligation % is a % obligation — only lease days are paused', p_obligation_id, v_ob.kind;
  end if;
  if exists (
    select 1 from public.payment_reservations
     where obligation_id = p_obligation_id and is_active
  ) then
    raise exception 'obligation % is reserved by a payment in progress', p_obligation_id;
  end if;
  if p_new_date <= v_ob.due_date then
    raise exception 'a postponed day must move later, not to %', p_new_date;
  end if;
  if exists (
    select 1 from public.payment_obligations
     where contract_id = v_ob.contract_id and due_date = p_new_date
  ) then
    raise exception 'a payment is already scheduled on % for this contract', p_new_date;
  end if;

  update public.payment_obligations set status = 'postponed' where id = p_obligation_id;

  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version, kind
  ) values (
    v_ob.contract_id, v_ob.rider_id, v_ob.motorcycle_id, p_new_date, p_due_at,
    p_local_due_time, v_ob.amount_due, 'scheduled',
    coalesce(v_contract.current_version, 1), 'lease'
  ) returning id into v_new_id;

  update public.contracts
     set end_date = greatest(coalesce(end_date, p_new_date), p_new_date)
   where id = v_ob.contract_id;

  return v_new_id;
end;
$$;

-- -------------------------------------------------------------------------
-- 2. Change the payment frequency of a live contract.
--
-- p_updates: [{ "id": uuid, "amount": int }]   existing future days KEPT as
--            instalments of the new cadence (re-priced in place, date kept)
-- p_inserts: [{ "due_date", "due_at", "local_due_time", "amount" }] new days
-- p_cancel_ids: every other future scheduled lease day (its money has moved
--            into the instalments above)
--
-- The planner (lib/contracts/reschedule.ts, pure + tested) decides all of this;
-- the function re-checks every rule it can, because the planner ran on a read
-- that may already be stale.
-- -------------------------------------------------------------------------
create or replace function public.reschedule_contract_obligations(
  p_contract_id uuid,
  p_schedule_type public.schedule_type,
  p_selected_weekdays smallint[],
  p_due_day_of_month smallint,
  p_installment_amount int,
  p_daily_rate int,
  p_cancel_ids uuid[],
  p_updates jsonb,
  p_inserts jsonb,
  p_end_date date,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_scope_ids uuid[];
  v_touched_ids uuid[];
  v_before bigint;
  v_after bigint;
  v_count int;
begin
  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.locked_at is not null then raise exception 'contract % is locked', p_contract_id; end if;
  if v_contract.status not in ('active', 'paused') then
    raise exception 'contract % is %, only a live contract can be rescheduled', p_contract_id, v_contract.status;
  end if;
  if p_installment_amount is null or p_installment_amount <= 0 then
    raise exception 'invalid instalment';
  end if;

  -- The scope: EVERY future, still-scheduled lease day, locked for the rest of
  -- the transaction. The caller must account for all of them — a day left out
  -- would keep billing at the old cadence alongside the new one.
  select coalesce(array_agg(id order by id), '{}')
    into v_scope_ids
    from (
      select id from public.payment_obligations
       where contract_id = p_contract_id
         and kind = 'lease'
         and status = 'scheduled'
         and due_date > v_today
       for update
    ) s;

  select coalesce(array_agg(x order by x), '{}')
    into v_touched_ids
    from (
      select unnest(coalesce(p_cancel_ids, '{}')) as x
      union all
      select (u->>'id')::uuid from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) u
    ) t;

  if v_touched_ids <> v_scope_ids then
    raise exception 'the plan does not cover exactly the future scheduled days (a payment may have landed) — reload and try again';
  end if;
  if cardinality(v_scope_ids) = 0 then
    raise exception 'no future scheduled days to reschedule';
  end if;

  if exists (
    select 1 from public.payment_reservations
     where obligation_id = any(v_scope_ids) and is_active
  ) then
    raise exception 'a payment is in progress against one of these days';
  end if;

  -- MONEY CONSERVATION. Nothing is forgiven, nothing invented.
  select coalesce(sum(amount_due), 0) into v_before
    from public.payment_obligations where id = any(v_scope_ids);
  select coalesce((select sum((u->>'amount')::int) from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) u), 0)
       + coalesce((select sum((i->>'amount')::int) from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb)) i), 0)
    into v_after;
  if v_before <> v_after then
    raise exception 'money not conserved: % before, % after', v_before, v_after;
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) u where (u->>'amount')::int <= 0)
     or exists (select 1 from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb)) i where (i->>'amount')::int <= 0
                   or (i->>'due_date')::date <= v_today) then
    raise exception 'every new instalment must be positive and in the future';
  end if;

  update public.payment_obligations
     set status = 'cancelled'
   where id = any(coalesce(p_cancel_ids, '{}'));

  update public.payment_obligations o
     set amount_due = (u->>'amount')::int
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) u
   where o.id = (u->>'id')::uuid;

  -- The (contract_id, due_date) unique constraint refuses a date that is
  -- already used, so a plan that collides fails loudly here.
  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version, kind
  )
  select p_contract_id, v_contract.rider_id, v_contract.motorcycle_id,
         (i->>'due_date')::date, (i->>'due_at')::timestamptz, (i->>'local_due_time')::time,
         (i->>'amount')::int, 'scheduled', coalesce(v_contract.current_version, 1), 'lease'
    from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb)) i;
  get diagnostics v_count = row_count;

  update public.contracts
     set schedule_type = p_schedule_type,
         selected_weekdays = coalesce(p_selected_weekdays, '{}'),
         due_day_of_month = p_due_day_of_month,
         installment_amount = p_installment_amount,
         daily_rate = coalesce(p_daily_rate, daily_rate),
         -- The planner passes the last date any live obligation now falls on;
         -- the completion job reads end_date, so it must never sit before one.
         end_date = greatest(
           coalesce(p_end_date, end_date),
           coalesce((select max(due_date) from public.payment_obligations
                      where contract_id = p_contract_id
                        and status not in ('cancelled', 'postponed')), p_end_date)
         ),
         last_edited_at = now(),
         last_edited_by = p_actor
   where id = p_contract_id;

  return jsonb_build_object(
    'cancelled', cardinality(coalesce(p_cancel_ids, '{}')),
    'kept', jsonb_array_length(coalesce(p_updates, '[]'::jsonb)),
    'inserted', v_count,
    'total', v_after
  );
end;
$$;

revoke all on function public.postpone_day_for_contract_pause(uuid, date, timestamptz, time) from public, anon, authenticated;
revoke all on function public.reschedule_contract_obligations(uuid, public.schedule_type, smallint[], smallint, int, int, uuid[], jsonb, jsonb, date, uuid) from public, anon, authenticated;
