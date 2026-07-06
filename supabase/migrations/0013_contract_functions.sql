-- =========================================================================
-- 0013_contract_functions.sql — transactional contract activation (spec §11, §22.3)
--
-- The schedule itself is computed in TypeScript (lib/obligations/schedule.ts,
-- the single tested source of truth) and passed in as JSON. This function
-- commits the obligations AND flips the contract to active in ONE transaction,
-- so a contract can never be active without its calendar (or vice-versa).
--
-- SECURITY DEFINER + an internal is_owner() guard: it must be called with the
-- OWNER's JWT (request-scoped server client), not the service role. Placed in
-- `public` because PostgREST/rpc only exposes public; execute is revoked from
-- anon and the owner check is enforced inside (see DECISIONS D-021).
-- =========================================================================

create or replace function public.activate_contract_and_generate_obligations(
  p_contract_id uuid,
  p_obligations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
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
  if coalesce(v_contract.installment_amount, 0) <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Mandatory owner + rider signatures, OR an uploaded signed physical copy
  -- (spec §10.3 step 8-9).
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
    amount_due, status, contract_version
  )
  select
    p_contract_id, v_contract.rider_id, v_contract.motorcycle_id,
    (o->>'dueDate')::date,
    (o->>'dueAtUtc')::timestamptz,
    (o->>'localDueTime')::time,
    v_contract.installment_amount,
    'scheduled',
    v_contract.current_version
  from jsonb_array_elements(p_obligations) as o
  on conflict (contract_id, due_date) do nothing;

  get diagnostics v_count = row_count;

  update public.contracts set status = 'active' where id = p_contract_id;

  return v_count;
end;
$$;

revoke all on function public.activate_contract_and_generate_obligations(uuid, jsonb) from public, anon;
grant execute on function public.activate_contract_and_generate_obligations(uuid, jsonb) to authenticated;
