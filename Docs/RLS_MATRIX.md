# Row-Level Security Policy Matrix

Implements spec §23. RLS is enabled on **every** public table (`0010_rls.sql`).
The **service role** (admin client) bypasses RLS and performs server-validated
privileged writes; `anon` gets nothing. A table with no matching policy denies
all access to `anon`/`authenticated` by default.

Helpers: `is_owner()` (profile role = owner) · `current_rider_id()` (rider whose
`profile_id = auth.uid()`). Both are SECURITY DEFINER to avoid RLS recursion.

| Table | Owner | Rider | Anon |
|-------|-------|-------|------|
| `app_settings` | all | read (non-secret config) | — |
| `profiles` | all | read own (`id = auth.uid()`) | — |
| `riders` | all | read own row | — |
| `rider_private_data` | all | — (owner-only PII) | — |
| `rider_documents` | all | read own where `rider_viewable` | — |
| `guarantors`, `guarantor_documents` | all | — | — |
| `rider_applications`, `application_documents` | all | — (public submit via server) | — |
| `motorcycles` | all | read the one actively assigned to them | — |
| `motorcycle_assignments` | all | read own | — |
| `motorcycle_expenses` | all | — | — |
| `contract_templates` | all | read | — |
| `contracts` | all | read own | — |
| `contract_versions/events/signatures/documents` | all | read where parent contract is theirs | — |
| `payment_obligations` | all | read own | — |
| `payments` | all | read own (creation via server) | — |
| `payment_allocations` | all | read where parent payment is theirs | — |
| `payment_events` | read | — (raw provider payloads) | — |
| `payment_reservations` | all | — | — |
| `receipts` | all | read where parent payment is theirs | — |
| `incident_reports` | all | read own + **insert own** | — |
| `exemption_requests` | all | read own + **insert own** | — |
| `notifications` | all | read own + **update own** (read-state) | — |
| `push_subscriptions` | all | **manage own** | — |
| `announcements` | all | — | — |
| `announcement_recipients` | all | read own | — |
| `message_outbox`, `daily_summaries`, `risk_snapshots` | all | — | — |
| `import_batches`, `import_rows` | all | — | — |
| `system_job_runs` | read | — | — |
| `login_attempts` | read | — (writes: service role only) | — |
| `audit_logs` | read | — (writes: service role only) | — |

## Key guarantees (verified by `tests/integration/rls/isolation.test.ts`)

1. A rider reads **only** their own `riders`/`profiles` row.
2. A rider **cannot** read another rider by changing the id (returns empty).
3. A rider **cannot** read `rider_private_data`, `login_attempts` or `audit_logs`.
4. A rider **cannot** `INSERT` a payment directly (must go through server routes /
   SECURITY DEFINER functions).
5. `anon` reads nothing from `riders`.
6. The owner reads all riders and owner-only tables.

## Notes

- **Financial mutation** never happens directly from a rider. Rider-facing
  payment creation is a server route; money state transitions move to
  SECURITY DEFINER functions in Phase 5, after which direct writes to
  `payments`/`payment_allocations`/`payment_obligations` are revoked.
- **Column confidentiality**: owner-only free-text notes live in
  `rider_private_data`, so a rider reading their own `riders` row never sees
  owner-only columns (see DECISIONS D-009).
- **Storage**: all buckets private; riders receive files only through short-lived
  server-issued signed URLs (spec §24), so no rider `storage.objects` policy is
  granted.
