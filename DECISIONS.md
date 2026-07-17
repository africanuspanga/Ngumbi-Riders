# Engineering Decisions & Assumptions

Records assumptions and resolved ambiguities instead of silently changing
business rules (spec §36.18). Newest first.

---

## D-033 · PostgREST's row cap and swallowed errors are treated as a bug CLASS (review 2026-07-18)
A full production-readiness audit found the obligation-status cron had
transitioned NOTHING for days while reporting success nightly: PostgREST caps
every select at `db-max-rows` (1000) regardless of the client's `.limit()` — so
`.limit(10000)` silently returned the 1000 oldest rows and today's obligations
were never selected — while the `toOverdue` update's ~1000-id `.in()` filter
built a querystring larger than upstream proxies accept (the request FAILS, and
the code read `{ data }` without `error`, so a failed update counted as "0 rows
updated"). Three systemic rules now apply: (1) any query whose result set grows
with fleet × days goes through `lib/supabase/fetch-all.ts` (stable-order
`.range()` pagination that THROWS on error) or aggregates in SQL; (2) bulk
`.in(id, …)` mutations are chunked (~150 ids); (3) destructuring `{ data }`
without checking `error` in a job/money path is a review-blocking defect — a
failed request must never be indistinguishable from an empty result. The same
audit fixed two more silent-severity classes: an export misname (`proxyConfig`
vs `config`) that Next ignored without warning, and RHF's kept-after-unmount
values turning conditional fields into invisible validation errors (now
`z.preprocess('' → undefined)` + an onInvalid form-level message). Full findings
in `Docs/SAAS_PLAN.md` §17; migration `0023` carries the DB-side hardenings
(contracts DELETE revoked + FK RESTRICT, signed-document immutability trigger,
schedule-shape checks).

## D-032 · Monthly + weekly instalments reuse the schedule-agnostic money path (migration 0022)
Spec #8/#13. The obligation calendar is still computed in the tested TS engine
(`lib/obligations/schedule.ts`) and committed by the schedule-type-agnostic
`activate_contract_and_generate_obligations`; `record_completed_payment` settles
per-obligation regardless of cadence, so **no money function changed** — a
monthly obligation is just an obligation whose amount is the month's instalment,
and one obligation = one month, so the existing cash flow already gives "select
rider → month → record". Migration 0022 is additive only: two new
`schedule_type` labels (`weekly`, `monthly`) and a nullable
`contracts.due_day_of_month`. **Weekly** = one obligation per week on an
owner-chosen weekday (default = the start weekday), stored as a one-element
`selected_weekdays` array. **Monthly** = exactly `duration_months` obligations on
the owner-set `due_day_of_month`; the first falls on the *first occurrence of the
due day within the lease* (this month if the due day hasn't passed on the start
date, else next month), and `31` means "last day of month" (clamped per month).
Owner decisions captured 2026-07-17 (memory `monthly-instalment-due-day-decision`
+ this session's two confirmations). The monthly money path was proven live with
a rollback-only settlement dry-run (obligation → `paid_in_advance`, payment →
`completed`, receipt issued) — the DB-level test the settlement bug
([D-031]/0019) lacked.

## D-031 · Settlement is self-defending at the DB chokepoint (migration 0018)
The 2026-07-10 deep-dive found that nothing enforced "an obligation being
settled must still be outstanding and owned by this payment": a cash payment
could settle obligations reserved by an in-flight mobile payment (stranding the
rider's mobile money on `allocation_mismatch` forever), and a late
`payment.completed` could flip an owner-waived (`exempted`) or `postponed`
obligation back to `paid`. Migration 0018 makes `record_completed_payment`
verify payment status ∈ (created,pending), obligation status ∈
(scheduled,due,overdue), rider match, and no active reservation by another
payment; the exemption functions gained rider-match + reservation guards and
`exemptions_self_insert` now pins the inserted shape (a rider could previously
file an exemption against ANOTHER rider's obligation and the owner's approval
would corrupt the victim's ledger). The webhook maps invariant violations to a
200 + audit row + owner notification (`payment_issue`) instead of a retry loop,
and matches payments by `metadata.payment_id` as a fallback when the reference
was never stored. Reversal events are flagged to the owner (un-settlement flow
is still a follow-up).

## D-030 · /apply uploads one document per request (Vercel body cap)
Vercel caps request bodies at ~4.5 MB, so the original single multipart POST of
payload + 13 documents could never succeed in production with real phone
photos. The submit endpoint now accepts the text payload + drawn signature
only and returns a stateless 2-hour HMAC upload token
(`lib/applications/upload-token`, signed with `AUTH_PIN_PEPPER`); the client
then posts each document individually to `/api/applications/documents`
(rate-limited by the pre-existing `upload_sign` policy, scope/doc-type
allowlisted, magic-byte-scanned, idempotent for retries). `MAX_FILE_BYTES`
dropped 10 MiB → 4 MiB to fit the per-request cap. A submission abandoned
mid-upload leaves an application with partial documents — visible to the owner
in review, strictly better than the old all-or-nothing failure.

## D-029 · Go-live DB ops run through the Management API, not `db push`
The hosted project's Postgres password is unknown locally (a reset was not
authorized during the 2026-07-09 go-live session), so migrations were applied
via the Management API SQL endpoint (`POST /v1/projects/{ref}/database/query`,
authenticated with the `sbp_` access token, `check_function_bodies = off` like
the CLI). Applied versions were recorded in
`supabase_migrations.schema_migrations`, so a future `supabase db push` (once a
DB password exists) sees 0001–0016 as already applied. `DATABASE_URL` stays
unset in `.env.local`; nothing in seed/tests needs it.

## D-028 · Hardening: money tables are write-locked; CSP added
Migration 0016 revokes direct INSERT/UPDATE/DELETE on the financial tables (and
audit/login/signed-doc tables) from anon/authenticated, so money mutates only
through the controlled SECURITY DEFINER functions + the service role (§22.3).
This required routing contract-terminate's obligation-cancel through the admin
client. A Content-Security-Policy (plus HSTS/frame-deny/nosniff) is now set on
every response; it uses `unsafe-inline`/`unsafe-eval` for Next's hydration
bootstrap — nonce-based CSP is a tracked follow-up (see SECURITY_REVIEW.md).
`FORCE ROW LEVEL SECURITY` was reviewed and deferred (definer/service roles
bypass RLS regardless; the write-revoke is the higher-value control). Data-quality
checks run as a daily cron alerting the owner; `/owner/system` + `/owner/audit`
surface health and the audit trail.

## D-027 · Reports: pure aggregation + thin export layer
Every report number is produced by a pure function in `lib/reports/compute`
(collections, arrears, performance, contract progress, cash-operating-margin),
unit-tested to the §19.2 definitions, and fed by server queries. Exports are a
thin serialization layer: CSV (`lib/reports/csv`, RFC-4180 escaping) and XLSX
(exceljs) share the same table shape, so adding a report or format is small. The
report centre page is the print-friendly view. Cash operating margin is labelled
"collected revenue − recorded expenses" (not full accounting profit) per §3.6.
Remaining §19.1 report views (rider/motorcycle statements, reconciliation) and
PDF export reuse these functions — tracked follow-ups.

## D-026 · Jobs are cron endpoints; integrations no-op until configured
Scheduled work (spec §27) runs as CRON_SECRET-guarded route handlers scheduled by
`vercel.json` (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`), each
wrapped by `runJob` which records a `system_job_runs` row and is idempotent. The
obligation status processor's transition logic is pure and unit-tested. Every
external integration degrades gracefully: Resend, web-push and SMS/WhatsApp all
return `not_configured` / `skipped` until their keys/providers are set, so the
app runs end-to-end before any of them exist (SMS/WhatsApp stay off per §36.16).
In-app notifications are the source of truth; push is supplementary. The service
worker is network-first and never caches sensitive data (§26.2). Also fixed a
latent bug: the owner-dashboard KPI query cast snake_case rows to the camelCase
KPI shape — now mapped, so live KPIs aren't silently zero.

## D-025 · Exemptions preserve history; risk is explainable and pure
Exemption decisions never mutate obligations directly. `apply_exemption_waiver`
marks the obligation `exempted` (keeping its due_date); `apply_postponement`
marks the original `postponed` (kept for history) and inserts a NEW scheduled
obligation at the new date, with a unique-per-date conflict guard — so paid and
past obligations are never rewritten (§3.4, §16.2). Both are SECURITY DEFINER +
owner-guarded, called with the owner JWT. Risk scoring (`lib/risk/scoring`) is a
transparent rule engine returning a level PLUS the reasons, unit-tested;
thresholds are parameterised for owner tuning, and a manual override always wins.
Manual override currently isn't "sticky" against a later recompute (owner runs
whichever they intend) — a `risk_manual` flag is a small follow-up.

## D-024 · Dashboards: KPI math is pure and unit-tested to the spec definitions
All dashboard numbers are computed by pure functions (`lib/dashboard/kpis`,
`lib/dashboard/rider`) so §14.1's exact definitions are pinned by tests — in
particular "collected today" (completed payment transactions received today) is
kept distinct from "settled for today" (today's obligations already paid), which
the spec explicitly forbids merging. Rider payment state (paid/due/overdue) is
derived only from obligation status, never optimistic. Owner KPI queries bound
the obligation scan to `due_date <= today`; a materialized rollup can replace it
if the dataset ever grows (not a concern at <100 riders).

## D-023 · Payments: webhook is truth, settlement is atomic + idempotent
The Snippe webhook (`/api/webhooks/snippe`) is the ONLY thing that completes a
payment — browser callbacks never do (§12.1). It verifies HMAC-SHA256 over the
RAW body (`{timestamp}.{body}`), rejects timestamps >5 min old, and dedupes on
the unique `provider_event_id`/`payload_hash` so a replayed event is a no-op.
Settlement runs through `record_completed_payment` (migration 0014, SECURITY
DEFINER, service-role only): it allocates whole obligations, enforces
`sum(allocations) = payment.amount`, writes the receipt, and releases
reservations — all atomically and idempotently. The rider NEVER supplies the
amount: the initiate route recomputes it from the oldest-N outstanding
obligations (`selectOldest`) and reserves them (partial-unique index → one active
pending attempt per obligation, §12.5). Cash payments (owner-only) reuse the same
settlement function. Snippe idempotency keys are ≤30 chars (guide constraint).

## D-022 · Contract engine: TS computes the schedule, DB commits atomically
The obligation schedule is generated by the pure, unit-tested TS engine
(`lib/obligations/schedule`) — single source of truth — and passed as JSON to
`activate_contract_and_generate_obligations`, which inserts the obligations and
flips the contract to `active` in ONE transaction. This avoids reimplementing
date/timezone logic in plpgsql while keeping activation atomic (a contract can
never be active without its calendar). Tanzania is EAT (UTC+3, no DST), so due
timestamps are built with an explicit `+03:00` offset — exact and host-tz
independent. Lifecycle terminate/complete-early cancel only FUTURE unpaid
obligations; paid history is preserved (§3.4). PDF via `@react-pdf/renderer`
(server-external), stored with a SHA-256 hash; signed docs are never overwritten.

## D-021 · SECURITY DEFINER functions live in `public`, guarded by is_owner()
Spec §22.3 prefers a non-exposed schema, but PostgREST/`supabase.rpc` only
exposes `public`. So the activation function is in `public` with execute revoked
from `anon`, granted to `authenticated`, and an internal `is_owner()` guard. It
MUST be called with the owner's JWT (the request-scoped server client), not the
service role (which has no `auth.uid()` and would fail the guard); SECURITY
DEFINER lets it bypass RLS for the inserts.

## D-020 · Phase 3: assignment writes, import framework, bulk temp PINs
Assignment invariants (one active per rider/motorcycle) are enforced by DB
partial-unique indexes; the assign/release/transfer actions do ordered close→open
writes so those indexes are never violated (a SECURITY DEFINER
`private.transfer_motorcycle` for full atomicity is a tracked follow-up, §22.3).
The import wizard is a small registry (`lib/imports/definitions`): each type owns
template columns, a normalizing zod row schema, and a duplicate field. Validation
+ in-batch dedupe are pure/tested; DB dedupe + persistence live in the actions.
Dry-run persists an `import_batches` row + the original file + `import_rows`
without touching live tables; commit re-validates from stored raw and inserts.
Bulk-imported and manually-created riders each get a per-row **temporary PIN**
(mustChangePin); the owner gets a one-time downloadable PIN list. Phase 3 needed
no new migrations — all tables already exist from Phase 1. Owner UI is English;
rider screens stay Swahili-first.

## D-019 · Owner review pipeline: status machine, deliberate reveal, convert
Application review transitions are governed by a pure, unit-tested state machine
(`lib/applications/status`) so illegal jumps (e.g. submitted→approved) are
impossible. NIDA/licence stay ciphertext in list/detail and are only decrypted by
an explicit **Reveal** action that is audited (`application.secrets_revealed`,
§25.1). Documents open via 60-second signed URLs (§24). **Convert-to-rider**
(§8.6) creates the auth user with a server-generated one-time temp PIN
(mustChangePin), copies address + encrypted PII to `rider_private_data`, links
`converted_rider_id`, and audits — the temp PIN is shown to the owner exactly
once. Rider number `NGR-R-0001` is allocated by count (race-tolerant; unique
constraint guards). Owner UI is English (owner is a single known user); rider
screens remain Swahili-first.

## D-018 · Bilingual form: validation messages are i18n keys, not strings
The application form is fully translated (`apply` namespace, sw + en). To keep
validation localized too, the shared zod schema now emits stable message KEYS
(`phone`, `nida`, `age`, …) instead of hardcoded Swahili; the form maps them via
`apply.errors.*` with a generic fallback for un-keyed built-ins. Language is
chosen with a cookie-based `LanguageSwitcher` (no locale in the URL — keeps rider
links clean), present on apply/landing/login. Supersedes D-015's "Swahili-inline"
note. Verified both languages render server-side.

## D-017 · Submission hardening: magic-byte scan + generic durable rate limiter
Uploaded files are re-checked server-side against their real leading bytes
(`lib/applications/file-signature`) so a spoofed MIME type/extension cannot get a
file stored (§8.6, §24). Public submission is throttled by a generic durable
limiter (`lib/security/rate-limit` + `rate_limit_events`, migration 0012) with
named policies (5 application submits/hour per IP); the window math is pure and
unit tested. The limiter fails open on DB read errors so a transient issue never
blocks a legitimate applicant.

## D-016 · Application submission endpoint is DB-ready, not yet live
`/api/applications` fully validates, encrypts PII, inserts the application +
guarantors, and uploads documents via the service-role client — but it only runs
once Supabase creds are configured. The per-year reference sequence is computed
by counting applications in the year (race-tolerant; the unique `reference`
constraint + a 3-try retry protect against collisions). Submission **rate
limiting** and a deep file **magic-byte scan** are tracked follow-ups (the
endpoint is the wire-up point when creds land).

## D-015 · Application form: Swahili-inline strings + react-hook-form
The 9-step wizard uses `react-hook-form` + `@hookform/resolvers/zod` (the
spec-recommended stack for complex forms, §1.3) with per-step `trigger()`
validation and sessionStorage draft autosave (§8.6). Strings are inline Swahili
(the form is Swahili-first, §6.2); an English i18n pass is a follow-up. zod v4
works with resolvers v3.10 for our schemas.

## D-014 · NIDA/licence encrypted with AES-256-GCM; duplicate detection by phone
Sensitive identifiers are stored as versioned AES-256-GCM ciphertext
(`v1.<iv>.<tag>.<ct>`, `lib/security/crypto`, key = `PII_ENCRYPTION_KEY`).
Because a random IV makes ciphertext non-searchable, duplicate detection
currently keys on the **plaintext phone** (never silently blocks — flags for the
owner, §8.6). A deterministic **blind index** (HMAC) column for NIDA/licence
equality search is a tracked follow-up before Phase 3 conversion.

## D-013 · `.env.local` placeholders committed? No
`.env.local` holds dummy values so `npm run build`/tests run without real
secrets. It is gitignored and never committed. Only `.env.example` (no secrets)
is committed.

## D-012 · RLS tests are opt-in and skip without a database
`tests/integration/rls/isolation.test.ts` requires a live Supabase. It runs only
when `RLS_TEST_ENABLED=1` and real (non-localhost-dummy) env is present;
otherwise it skips so `npm run test` stays green in CI without a database. This
build machine has no Docker, so `supabase start` cannot run locally — the suite
is authored and ready to execute the moment credentials/DB are supplied.

## D-011 · `server-only` guard vs. Node test/seed execution
Privileged modules (`admin.ts`, `pin-derive.ts`, `provision.ts`, `rate-limit.ts`,
`session.ts`, `audit.ts`) import `server-only` to fail the build if pulled into a
client bundle. Because that package throws under plain Node, Vitest aliases it to
an empty stub, and `npm run seed` runs with `--conditions=react-server`. The
production guarantee is unchanged; only test/script execution is unblocked.

## D-010 · Supabase typing is a structural placeholder for now
**RESOLVED 2026-07-09 (go-live):** `lib/supabase/types.gen.ts` is now generated
from the live database (`supabase gen types typescript --linked`) and re-exported
as `Database`/`Json` from `lib/supabase/types.ts`; the `<Database>` generic is
back on all three client factories. Regenerate after every migration. The
hand-maintained enum unions remain the app-layer source of truth.

Original decision: `lib/supabase/types.ts` exported precise **enum unions** but
a generic structural `Database` type, because the placeholder made supabase-js
infer `never` for inserts when used as the client generic. Business-rule safety
does not depend on these types — it is enforced by DB constraints, RLS and
server validation.

## D-009 · Owner-only notes moved off the `riders` table
RLS is row-level, not column-level, and a rider may read their own `riders` row.
To honour "owner notes visible only to owner" (§9.1) without views or column
grants (which cannot distinguish owner from rider — both are the `authenticated`
role), `owner_notes` lives in the owner-only `rider_private_data` table. A
rider's own row therefore contains no owner-only fields.

## D-008 · Rider phone sign-in uses phone + server-derived password
Per §7.2 we call `signInWithPassword({ phone, password })`. Rider auth users are
created via the Admin API with `phone_confirm: true`, so **no SMS/OTP** is
required and the SMS provider stays disabled. The password is the keyed HMAC
`HMAC_SHA256(AUTH_PIN_PEPPER, canonicalPhone + ':' + pin)`; the raw PIN never
leaves the server and is never stored.

## D-007 · Canonical phone stored with leading `+` on `riders.phone`
Both login and change-PIN derive the password from `riders.phone` (or the
normalized input), guaranteeing the exact same canonical string feeds Supabase
and the HMAC. Constraint: `^\+255[67][0-9]{8}$`.

## D-006 · Lockout persists the full 30 minutes
The lockout detector finds any run of 5 failures spanning ≤15 min and locks for
30 min from the most recent failure in that run (not merely "5 failures in the
last 15 min", which would unlock after ~15 min). The DB lookback is 45 min
(30 + 15) so an active lock is always observable. See `lib/auth/lockout.ts`.

## D-005 · Rate limiting is DB-backed, keyed by phone AND IP
Attempts are recorded in `login_attempts` (never the PIN) and evaluated per
phone and per IP so one IP cannot brute-force across many phones. At <100 riders
the small read/insert race is acceptable; a SECURITY DEFINER atomic variant can
replace it later if needed.

## D-004 · Owner login is a server route too
Although the owner uses Supabase email/password, login goes through
`/api/auth/owner-login` for a uniform rate-limit + audit path and to verify
`role = 'owner'` before granting the owner area.

## D-003 · Money stored as integer TZS
TZS has no routinely used minor unit; amounts are integer shillings. No floats
for money anywhere (`lib/money`, `amount > 0` CHECKs).

## D-002 · Next.js 16 `proxy.ts` replaces `middleware.ts`
Session refresh + coarse `/rider` `/owner` gating live in the root `proxy.ts`
(`proxy()` / `proxyConfig`). RLS remains the decisive authorization boundary; the
proxy is convenience only.

## D-001 · Foundational tables created for all phases now
Phase 1 creates every table in spec §22.1 (38 tables) with full RLS, even for
later-phase features, so the RLS matrix is complete and later phases add
functions/columns via new migrations rather than reworking the schema.
