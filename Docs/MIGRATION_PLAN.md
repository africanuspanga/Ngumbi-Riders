# Database Migration Plan

Every schema, function, trigger, policy and seed change ships as a Supabase
migration (spec §36.4–5). Migrations are append-only and never edited after they
are applied. Apply with `supabase db push` (linked project) or `supabase db
reset` (local, needs Docker).

## Applied — Phase 1 foundation (`supabase/migrations/`)

| File | Contents |
|------|----------|
| `0001_enums.sql` | Extensions (`pgcrypto`, `citext`) + 13 enum types (roles, statuses, methods, outcomes). |
| `0002_helpers.sql` | `private` schema; `set_updated_at()` trigger fn; `is_owner()` / `current_rider_id()` SECURITY DEFINER authz helpers. |
| `0003_identity.sql` | `app_settings` (singleton), `profiles`, `riders`, `rider_private_data` (owner-only, encrypted PII), `rider_documents`, `guarantors`, `guarantor_documents`. |
| `0004_applications.sql` | `rider_applications`, `application_documents`; guarantor→application FK. |
| `0005_motorcycles.sql` | `motorcycles`, `motorcycle_assignments` (one-active partial-unique indexes), `motorcycle_expenses`. |
| `0006_contracts.sql` | `contract_templates`, `contracts` (one active per rider), `contract_versions`, `contract_events`, `contract_signatures`, `contract_documents`. |
| `0007_payments.sql` | `payment_obligations` (unique contract+due_date), `payments` (unique idempotency key & Snippe ref), `payment_allocations`, `payment_events` (unique event id/hash), `payment_reservations` (one-active), `receipts`. |
| `0008_operations.sql` | `incident_reports`, `exemption_requests`, obligation→exemption FK, `notifications` (dedupe), `push_subscriptions`, `announcements`, `announcement_recipients`, `message_outbox`, `daily_summaries`, `risk_snapshots`. |
| `0009_platform.sql` | `import_batches`, `import_rows`, `login_attempts`, `audit_logs`, `system_job_runs`. |
| `0010_rls.sql` | RLS enabled on every table + the full owner/rider policy matrix. |
| `0011_storage.sql` | 7 private storage buckets + owner-only object policy (rider access is server-mediated signed URLs). |
| `0012_rate_limits.sql` | Generic `rate_limit_events` table (RLS-enabled, service-role only) for durable throttling of public actions (application submission, uploads). |
| `seed.sql` | Non-auth reference data (settings defaults, template v1, demo motorcycles). Auth users via `scripts/seed.ts`. |

### Constraints already enforced (spec §22.2)
Unique normalized rider phone · unique motorcycle registration · one active
contract per rider · one active assignment per rider and per motorcycle · unique
obligation per contract+due_date · `amount_due > 0` · `payments.amount > 0` ·
unique Snippe reference · unique webhook event identity/payload hash.

## Planned — later phases (new migration files, not yet written)

These are intentionally deferred; the tables exist so they slot in cleanly.

- **Phase 2** `00xx_application_flow` — application reference sequence, resume-token
  handling, duplicate-detection helper functions.
- **Phase 3** `00xx_import_functions` — batch validation/commit/rollback functions;
  rider-number sequence generator.
- **Phase 4** `00xx_contract_functions` — `private.activate_contract_and_generate_obligations`,
  `private.regenerate_future_obligations`, signed-document immutability trigger,
  obligation generator (daily + selected-weekday, leap-year safe, UTC from EAT).
- **Phase 5** `00xx_payment_functions` — `private.create_payment_reservation`,
  `private.complete_snippe_payment`, `private.record_cash_payment`,
  `private.reverse_provider_payment`; allocation-sum + whole-obligation invariant
  triggers; receipt-number sequence; **revoke direct writes** on payments/
  allocations/obligations so only the controlled functions mutate money.
- **Phase 6** `00xx_reporting_views` — KPI/materialized views for the owner
  dashboard; rider balance function.
- **Phase 7** `00xx_exemption_risk` — `private.apply_exemption_waiver`,
  `private.apply_postponement`, `private.calculate_rider_risk`.
- **Phase 8** `00xx_notifications_cron` — Supabase Cron schedules (obligation
  processor, reminders, reconciliation, daily summary), notification dedupe fns.
- **Phase 9** `00xx_reports_export` — expense/margin aggregation, reconciliation
  views.
- **Phase 10** `00xx_hardening` — retention jobs, data-quality check functions,
  `FORCE ROW LEVEL SECURITY` review.

## Apply / verify commands

```bash
supabase link --project-ref <ref>   # once
supabase db push                    # apply all migrations
supabase db lint                    # static checks
supabase gen types typescript > lib/supabase/types.gen.ts
RLS_TEST_ENABLED=1 npm run test:rls # prove rider isolation
npm run seed                        # owner + demo riders (Admin API)
```
