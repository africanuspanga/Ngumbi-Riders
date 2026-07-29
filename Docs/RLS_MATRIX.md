# Row-Level Security Policy Matrix

Implements spec §23. RLS is enabled on **every** public table (`0010_rls.sql`).
The **service role** (admin client) bypasses RLS and performs server-validated
privileged writes; `anon` gets nothing. A table with no matching policy denies
all access to `anon`/`authenticated` by default.

Helpers: `is_owner()` (profile role = owner) · `current_rider_id()` (rider whose
`profile_id = auth.uid()`) · `is_accountant()` (role = accountant **AND**
`is_active`) · `is_staff()` (owner or active accountant). All SECURITY DEFINER
to avoid RLS recursion, all with `search_path = public, pg_temp`.

**Accountant** (migration `0025`, build spec #10) holds **SELECT-only** policies
on the financial tables and has NO policy at all on anything sensitive, so those
tables deny by default. Because `is_active` is tested inside `is_accountant()`,
deactivating an accountant revokes data access on the **next query**, not at
token expiry. The owner is deliberately not gated on `is_active` — locking the
sole owner out would be unrecoverable from inside the app.

Verified live on 2026-07-29 with a 31-assertion RBAC probe (readable finance
tables, blocked sensitive tables, no self-promotion to owner, no direct
`payments` INSERT, instant revocation on deactivate).

| Table | Owner | Accountant | Rider | Anon |
|-------|-------|------------|-------|------|
| `app_settings` | all | read | read (non-secret config) | — |
| `profiles` | all | read own | read own (`id = auth.uid()`) | — |
| `riders` | all | read | read own row | — |
| `rider_private_data` | all | — | — (owner-only PII) | — |
| `rider_documents` | all | — | read own where `rider_viewable` | — |
| `guarantors`, `guarantor_documents` | all | — | — | — |
| `rider_applications`, `application_documents` | all | — | — (public submit via server) | — |
| `motorcycles` | all | read | read the one actively assigned to them | — |
| `motorcycle_assignments` | all | read | read own | — |
| `motorcycle_expenses` | all | read | — | — |
| `contract_templates` | all | read | read | — |
| `contracts` | all | read | read own | — |
| `contract_versions/events/signatures/documents` | all | read | read where parent contract is theirs | — |
| `payment_obligations` | all | read | read own | — |
| `payments` | all | read | read own (creation via server) | — |
| `payment_allocations` | all | read | read where parent payment is theirs | — |
| `payment_events` | read | — | — (raw provider payloads) | — |
| `payment_reservations` | all | — | — | — |
| `receipts` | all | read | read where parent payment is theirs | — |
| `incident_reports` | all | — | read own + **insert own** | — |
| `exemption_requests` | all | read | read own + **insert own** | — |
| `notifications` | all | — | read own + **update own** (read-state) | — |
| `push_subscriptions` | all | — | **manage own** | — |
| `announcements` | all | — | — | — |
| `announcement_recipients` | all | — | read own | — |
| `daily_summaries` | all | read | — | — |
| `message_outbox`, `risk_snapshots` | all | — | — | — |
| `financial_notes` | all | read + **insert own** (no update/delete) | — | — |
| `import_batches`, `import_rows` | all | — | — | — |
| `system_job_runs` | read | — | — | — |
| `login_attempts` | read | — | — (writes: service role only) | — |
| `audit_logs` | read | — | — (writes: service role only) | — |

## Key guarantees (verified by `tests/integration/rls/isolation.test.ts`)

1. A rider reads **only** their own `riders`/`profiles` row.
2. A rider **cannot** read another rider by changing the id (returns empty).
3. A rider **cannot** read `rider_private_data`, `login_attempts` or `audit_logs`.
4. A rider **cannot** `INSERT` a payment directly (must go through server routes /
   SECURITY DEFINER functions).
5. `anon` reads nothing from `riders`.
6. The owner reads all riders and owner-only tables.

### Accountant guarantees (verified live 2026-07-29, 31/31 assertions)

7. An accountant reads the 12 financial tables above and **nothing** from
   `rider_private_data`, `guarantors`, `rider_applications`,
   `application_documents`, `payment_events`, `audit_logs`, `login_attempts`,
   `import_batches` or `system_job_runs`.
8. An accountant **cannot** change their own role (`profiles` UPDATE affects
   0 rows; the role stays `accountant`).
9. An accountant **cannot** `INSERT` into `payments` — direct money writes are
   revoked from `authenticated` (0016), so recording a payment goes through the
   same `record_completed_payment` path the owner uses.
10. Deactivating an accountant (`profiles.is_active = false`) makes
    `is_accountant()` return false and their reads return 0 rows **immediately**,
    without waiting for their JWT to expire.

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
