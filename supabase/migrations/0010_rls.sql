-- =========================================================================
-- 0010_rls.sql — Row-Level Security policy matrix (spec §23)
--
-- Principles:
--   * RLS is enabled on EVERY public table.
--   * The service role (admin client) bypasses RLS and performs privileged,
--     server-validated writes (rider creation, verified webhooks, jobs).
--   * Owner: full access to business records via public.is_owner().
--   * Rider: SELECT only rows matching public.current_rider_id() / auth.uid().
--     Rider INSERT is limited to incidents, exemption requests, push
--     subscriptions and their own notification read-state.
--   * Payment/financial mutation NEVER happens directly from a rider; it goes
--     through server routes + SECURITY DEFINER functions (later phases).
--   * Sensitive/system tables (private data, audit, login attempts, imports,
--     payment_events, job runs) are owner-read at most; riders get nothing.
--
-- A rider's own `riders` row contains no owner-only columns (owner notes live
-- in rider_private_data), so row-level policies fully protect confidentiality.
-- =========================================================================

-- Enable RLS everywhere. Tables with no matching policy deny all access to
-- anon/authenticated by default (service role still bypasses).
alter table public.app_settings            enable row level security;
alter table public.profiles                enable row level security;
alter table public.riders                  enable row level security;
alter table public.rider_private_data      enable row level security;
alter table public.rider_documents         enable row level security;
alter table public.guarantors              enable row level security;
alter table public.guarantor_documents     enable row level security;
alter table public.rider_applications      enable row level security;
alter table public.application_documents   enable row level security;
alter table public.motorcycles             enable row level security;
alter table public.motorcycle_assignments  enable row level security;
alter table public.motorcycle_expenses     enable row level security;
alter table public.contract_templates      enable row level security;
alter table public.contracts               enable row level security;
alter table public.contract_versions       enable row level security;
alter table public.contract_events         enable row level security;
alter table public.contract_signatures     enable row level security;
alter table public.contract_documents      enable row level security;
alter table public.payment_obligations     enable row level security;
alter table public.payments                enable row level security;
alter table public.payment_allocations     enable row level security;
alter table public.payment_events          enable row level security;
alter table public.payment_reservations    enable row level security;
alter table public.receipts                enable row level security;
alter table public.incident_reports        enable row level security;
alter table public.exemption_requests      enable row level security;
alter table public.notifications           enable row level security;
alter table public.push_subscriptions      enable row level security;
alter table public.announcements           enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.message_outbox          enable row level security;
alter table public.daily_summaries         enable row level security;
alter table public.risk_snapshots          enable row level security;
alter table public.import_batches          enable row level security;
alter table public.import_rows             enable row level security;
alter table public.login_attempts          enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.system_job_runs         enable row level security;

-- ---- app_settings --------------------------------------------------------
-- Non-secret business config; any signed-in user may read, only owner writes.
create policy settings_read on public.app_settings
  for select to authenticated using (true);
create policy settings_owner_write on public.app_settings
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- profiles ------------------------------------------------------------
create policy profiles_owner_all on public.profiles
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy profiles_self_read on public.profiles
  for select to authenticated using (id = auth.uid());

-- ---- riders --------------------------------------------------------------
create policy riders_owner_all on public.riders
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy riders_self_read on public.riders
  for select to authenticated using (id = public.current_rider_id());

-- ---- rider_private_data (owner only) ------------------------------------
create policy rider_private_owner_all on public.rider_private_data
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- rider_documents -----------------------------------------------------
create policy rider_docs_owner_all on public.rider_documents
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy rider_docs_self_read on public.rider_documents
  for select to authenticated
  using (rider_id = public.current_rider_id() and rider_viewable);

-- ---- guarantors / guarantor_documents (owner only) ----------------------
create policy guarantors_owner_all on public.guarantors
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy guarantor_docs_owner_all on public.guarantor_documents
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- rider_applications / documents (owner only; public submit via server) --
create policy applications_owner_all on public.rider_applications
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy application_docs_owner_all on public.application_documents
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- motorcycles ---------------------------------------------------------
create policy motorcycles_owner_all on public.motorcycles
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
-- Rider may read the safe fields of the motorcycle currently assigned to them.
create policy motorcycles_self_read on public.motorcycles
  for select to authenticated using (
    exists (
      select 1 from public.motorcycle_assignments a
      where a.motorcycle_id = motorcycles.id
        and a.rider_id = public.current_rider_id()
        and a.is_active
    )
  );

-- ---- motorcycle_assignments ---------------------------------------------
create policy assignments_owner_all on public.motorcycle_assignments
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy assignments_self_read on public.motorcycle_assignments
  for select to authenticated using (rider_id = public.current_rider_id());

-- ---- motorcycle_expenses (owner only) -----------------------------------
create policy expenses_owner_all on public.motorcycle_expenses
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- contract_templates --------------------------------------------------
create policy templates_owner_all on public.contract_templates
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy templates_read on public.contract_templates
  for select to authenticated using (true);

-- ---- contracts -----------------------------------------------------------
create policy contracts_owner_all on public.contracts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contracts_self_read on public.contracts
  for select to authenticated using (rider_id = public.current_rider_id());

-- ---- contract_versions / events / signatures / documents ----------------
create policy contract_versions_owner_all on public.contract_versions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contract_versions_self_read on public.contract_versions
  for select to authenticated using (
    exists (select 1 from public.contracts c
      where c.id = contract_versions.contract_id
        and c.rider_id = public.current_rider_id()));

create policy contract_events_owner_all on public.contract_events
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contract_events_self_read on public.contract_events
  for select to authenticated using (
    exists (select 1 from public.contracts c
      where c.id = contract_events.contract_id
        and c.rider_id = public.current_rider_id()));

create policy contract_signatures_owner_all on public.contract_signatures
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contract_signatures_self_read on public.contract_signatures
  for select to authenticated using (
    exists (select 1 from public.contracts c
      where c.id = contract_signatures.contract_id
        and c.rider_id = public.current_rider_id()));

create policy contract_documents_owner_all on public.contract_documents
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy contract_documents_self_read on public.contract_documents
  for select to authenticated using (
    exists (select 1 from public.contracts c
      where c.id = contract_documents.contract_id
        and c.rider_id = public.current_rider_id()));

-- ---- payment_obligations -------------------------------------------------
create policy obligations_owner_all on public.payment_obligations
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy obligations_self_read on public.payment_obligations
  for select to authenticated using (rider_id = public.current_rider_id());

-- ---- payments (rider reads own; creation goes through server routes) -----
create policy payments_owner_all on public.payments
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy payments_self_read on public.payments
  for select to authenticated using (rider_id = public.current_rider_id());

-- ---- payment_allocations -------------------------------------------------
create policy allocations_owner_all on public.payment_allocations
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy allocations_self_read on public.payment_allocations
  for select to authenticated using (
    exists (select 1 from public.payments p
      where p.id = payment_allocations.payment_id
        and p.rider_id = public.current_rider_id()));

-- ---- payment_events (owner read only; provider secrets/raw payloads) -----
create policy payment_events_owner_read on public.payment_events
  for select to authenticated using (public.is_owner());

-- ---- payment_reservations (owner only visibility) -----------------------
create policy reservations_owner_all on public.payment_reservations
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- receipts ------------------------------------------------------------
create policy receipts_owner_all on public.receipts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy receipts_self_read on public.receipts
  for select to authenticated using (
    exists (select 1 from public.payments p
      where p.id = receipts.payment_id
        and p.rider_id = public.current_rider_id()));

-- ---- incident_reports (rider inserts + reads own) -----------------------
create policy incidents_owner_all on public.incident_reports
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy incidents_self_read on public.incident_reports
  for select to authenticated using (rider_id = public.current_rider_id());
create policy incidents_self_insert on public.incident_reports
  for insert to authenticated with check (rider_id = public.current_rider_id());

-- ---- exemption_requests (rider inserts + reads own) ---------------------
create policy exemptions_owner_all on public.exemption_requests
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy exemptions_self_read on public.exemption_requests
  for select to authenticated using (rider_id = public.current_rider_id());
create policy exemptions_self_insert on public.exemption_requests
  for insert to authenticated with check (rider_id = public.current_rider_id());

-- ---- notifications (rider reads own; may mark own as read) --------------
create policy notifications_owner_all on public.notifications
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy notifications_self_read on public.notifications
  for select to authenticated using (recipient_profile_id = auth.uid());
create policy notifications_self_update on public.notifications
  for update to authenticated
  using (recipient_profile_id = auth.uid())
  with check (recipient_profile_id = auth.uid());

-- ---- push_subscriptions (rider manages own) -----------------------------
create policy push_owner_all on public.push_subscriptions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy push_self_all on public.push_subscriptions
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---- announcements / recipients -----------------------------------------
create policy announcements_owner_all on public.announcements
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy announcement_recipients_owner_all on public.announcement_recipients
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy announcement_recipients_self_read on public.announcement_recipients
  for select to authenticated using (rider_id = public.current_rider_id());

-- ---- owner/system-only tables (no rider access) -------------------------
create policy outbox_owner_all on public.message_outbox
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy summaries_owner_all on public.daily_summaries
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy risk_owner_all on public.risk_snapshots
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy imports_owner_all on public.import_batches
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy import_rows_owner_all on public.import_rows
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy job_runs_owner_read on public.system_job_runs
  for select to authenticated using (public.is_owner());

-- login_attempts + audit_logs: owner may READ for the system-health/audit
-- pages; writes happen only via the service role. No INSERT/UPDATE/DELETE
-- policies => append-only from the app's perspective, immutable to users.
create policy login_attempts_owner_read on public.login_attempts
  for select to authenticated using (public.is_owner());
create policy audit_owner_read on public.audit_logs
  for select to authenticated using (public.is_owner());
