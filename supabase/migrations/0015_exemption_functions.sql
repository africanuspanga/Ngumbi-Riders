-- =========================================================================
-- 0015_exemption_functions.sql — controlled exemption decisions (spec §16.2, §22.3)
--
-- Exemption decisions must update obligations through a controlled function and
-- PRESERVE the original due date in history. Both functions are SECURITY
-- DEFINER + owner-guarded and must be called with the owner's JWT.
--
--   waiver     -> the obligation becomes 'exempted' (its due_date is kept).
--   postpone   -> the original obligation becomes 'postponed' (kept for history)
--                 and a NEW scheduled obligation is created at the new date.
-- =========================================================================

create or replace function public.apply_exemption_waiver(
  p_exemption_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.exemption_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;

  select * into v_ex from public.exemption_requests where id = p_exemption_id for update;
  if not found then raise exception 'exemption_not_found'; end if;

  update public.payment_obligations
    set status = 'exempted', exemption_id = p_exemption_id
    where id = v_ex.obligation_id
      and status in ('scheduled', 'due', 'overdue');

  update public.exemption_requests
    set status = 'approved_waived', decided_by = auth.uid(), decided_at = now()
    where id = p_exemption_id;
end;
$$;

create or replace function public.apply_postponement(
  p_exemption_id uuid,
  p_new_date date,
  p_due_at timestamptz,
  p_local_due_time time
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex public.exemption_requests%rowtype;
  v_ob public.payment_obligations%rowtype;
  v_contract public.contracts%rowtype;
  v_new_id uuid;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;

  select * into v_ex from public.exemption_requests where id = p_exemption_id for update;
  if not found then raise exception 'exemption_not_found'; end if;

  select * into v_ob from public.payment_obligations where id = v_ex.obligation_id for update;
  if not found then raise exception 'obligation_not_found'; end if;

  select * into v_contract from public.contracts where id = v_ob.contract_id;

  -- A postponed date must not collide with an existing obligation (spec §11.3).
  if exists (select 1 from public.payment_obligations
             where contract_id = v_ob.contract_id and due_date = p_new_date) then
    raise exception 'date_conflict';
  end if;

  -- Preserve the original obligation for history.
  update public.payment_obligations
    set status = 'postponed', exemption_id = p_exemption_id
    where id = v_ob.id;

  -- Create the replacement obligation at the new date.
  insert into public.payment_obligations (
    contract_id, rider_id, motorcycle_id, due_date, due_at, local_due_time,
    amount_due, status, contract_version
  ) values (
    v_ob.contract_id, v_ob.rider_id, v_ob.motorcycle_id, p_new_date, p_due_at,
    p_local_due_time, v_ob.amount_due, 'scheduled', coalesce(v_contract.current_version, 1)
  ) returning id into v_new_id;

  update public.exemption_requests
    set status = 'approved_postponed', postponed_to_date = p_new_date,
        decided_by = auth.uid(), decided_at = now()
    where id = p_exemption_id;

  return v_new_id;
end;
$$;

revoke all on function public.apply_exemption_waiver(uuid) from public, anon;
revoke all on function public.apply_postponement(uuid, date, timestamptz, time) from public, anon;
grant execute on function public.apply_exemption_waiver(uuid) to authenticated;
grant execute on function public.apply_postponement(uuid, date, timestamptz, time) to authenticated;
