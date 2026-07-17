-- =========================================================================
-- 0023_production_hardening.sql — findings from the 2026-07-18 production
-- readiness review (see DECISIONS D-033). Four independent hardenings:
--
-- 1. Contracts must not be deletable through PostgREST. `contracts` kept the
--    default table grants (0016's write-lock list covered the money tables but
--    not contracts), and payment_obligations.contract_id was ON DELETE CASCADE
--    — so one owner-session DELETE /contracts could erase a contract AND its
--    entire obligation calendar (cascading on through exemption_requests),
--    bypassing the 0016 write-locks entirely (referential actions run as the
--    table owner). Revoke DELETE/TRUNCATE and make the FK RESTRICT: financial
--    records are immutable (spec rule 6); nothing in the app deletes contracts.
--
-- 2. Signed contract documents immutability (spec §10.5/§22.2): promised as a
--    trigger in 0006's comments, never shipped. The admin client bypasses
--    grants AND RLS, so this trigger is the only layer that actually protects
--    a signed PDF row from a buggy server code path.
--
-- 3. Schedule-shape consistency (0022 follow-up): the schedule-agnostic
--    activation function will generate whatever the contract row implies, so
--    the row itself must be coherent — monthly requires a due day and a
--    duration; weekly requires exactly ONE weekday; weekday elements are 0..6.
--    (Existing rows verified compliant before applying.)
--
-- 4. Hygiene: pg_temp on the two policy helper functions (0018 standard), and
--    plain b-tree indexes on FK columns whose only index was partial (unusable
--    for RI checks) or missing.
-- =========================================================================

-- 1. Contract deletion -----------------------------------------------------
revoke delete, truncate on public.contracts from anon, authenticated;

alter table public.payment_obligations
  drop constraint payment_obligations_contract_id_fkey,
  add constraint payment_obligations_contract_id_fkey
    foreign key (contract_id) references public.contracts(id) on delete restrict;

-- 2. Signed-document immutability ------------------------------------------
create or replace function public.forbid_signed_document_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_signed then
      raise exception 'signed_document_immutable';
    end if;
    return old;
  end if;
  -- UPDATE: a signed row is frozen entirely; an unsigned row may be updated
  -- (including flipping is_signed to true exactly once).
  if old.is_signed then
    raise exception 'signed_document_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contract_documents_immutable on public.contract_documents;
create trigger trg_contract_documents_immutable
  before update or delete on public.contract_documents
  for each row execute function public.forbid_signed_document_mutation();

-- 3. Schedule-shape consistency (0022 follow-up) ----------------------------
alter table public.contracts
  add constraint contracts_monthly_shape check (
    schedule_type <> 'monthly'
    or (due_day_of_month is not null and duration_months is not null)
  ),
  add constraint contracts_weekly_shape check (
    schedule_type <> 'weekly'
    or coalesce(array_length(selected_weekdays, 1), 0) = 1
  ),
  add constraint contracts_weekday_range check (
    selected_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  );

-- 4. Hygiene ----------------------------------------------------------------
alter function public.is_owner() set search_path = public, pg_temp;
alter function public.current_rider_id() set search_path = public, pg_temp;

create index if not exists idx_payment_events_payment on public.payment_events(payment_id);
create index if not exists idx_payment_obligations_moto on public.payment_obligations(motorcycle_id);
create index if not exists idx_contracts_assignment on public.contracts(assignment_id);
create index if not exists idx_guarantors_application on public.guarantors(application_id);
create index if not exists idx_rider_applications_converted on public.rider_applications(converted_rider_id);
create index if not exists idx_payment_reservations_obligation on public.payment_reservations(obligation_id);
create index if not exists idx_exemption_requests_obligation on public.exemption_requests(obligation_id);
create index if not exists idx_motorcycle_assignments_moto on public.motorcycle_assignments(motorcycle_id);
