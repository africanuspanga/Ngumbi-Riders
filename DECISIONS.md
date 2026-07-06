# Engineering Decisions & Assumptions

Records assumptions and resolved ambiguities instead of silently changing
business rules (spec §36.18). Newest first.

---

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
`lib/supabase/types.ts` exports precise **enum unions** (used across the app) but
a generic structural `Database` type. The typed-client generic was removed from
the client factories because the placeholder made supabase-js infer `never` for
inserts. Once a database exists, run
`supabase gen types typescript > lib/supabase/types.gen.ts` and reintroduce the
generic. Business-rule safety does not depend on these types — it is enforced by
DB constraints, RLS and server validation.

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
