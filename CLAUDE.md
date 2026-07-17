# CLAUDE.md — Working Handoff & Orientation

> **This file = where we are and what to do next.** Read it first every session.
> **Product source of truth = [`Docs/NGUMBI_RIDERS_BUILD_SPEC.md`](Docs/NGUMBI_RIDERS_BUILD_SPEC.md)** (the full build
> spec). This file never overrides the spec; it tracks execution against it.
>
> **▶ CONTINUING WORK? Read [`Docs/SESSION_HANDOVER.md`](Docs/SESSION_HANDOVER.md)
> FIRST** — the "pick up here" note (state as of 2026-07-17: what's done, what's
> live, what's next, and how to work on this repo).
>
> **New here? Read [`Docs/HANDOVER.md`](Docs/HANDOVER.md)** — the
> orientation guide for future sessions and developers (how the system works
> and why); this file tracks where execution stands right now.
>
> Companion docs: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) ·
> [`DECISIONS.md`](DECISIONS.md) (D-001…D-031) · [`Docs/MIGRATION_PLAN.md`](Docs/MIGRATION_PLAN.md) ·
> [`Docs/ROUTE_MAP.md`](Docs/ROUTE_MAP.md) · [`Docs/RLS_MATRIX.md`](Docs/RLS_MATRIX.md) ·
> [`Docs/LAUNCH_CHECKLIST.md`](Docs/LAUNCH_CHECKLIST.md) ·
> [`Docs/SECURITY_REVIEW.md`](Docs/SECURITY_REVIEW.md) ·
> [`Docs/BACKUP_RECOVERY.md`](Docs/BACKUP_RECOVERY.md) ·
> [`Docs/SAAS_PLAN.md`](Docs/SAAS_PLAN.md) (future multi-tenant SaaS blueprint — plan only, not built)

---

## 1. What this project is

Single-business fleet contract & rider-payment management for **Ng'umbi Riders**
(Tanzania). Mobile-first PWA for low-cost Android. Two roles only: **owner**
(Mr. Ng'umbi) and **riders**. No multi-tenancy, no SaaS. Riders pay whole daily
lease obligations via mobile money (Snippe); owner sees who paid / who owes.

Stack: **Next.js 16.2** (App Router, React 19) · TypeScript · **Tailwind v4** ·
**Supabase** (Auth/Postgres/Storage/Realtime) · `next-intl` (Swahili-first) ·
**Snippe** (payments, Phase 5) · **Resend** (email, Phase 8).

---

## 2. Current status — LIVE DB provisioned (2026-07-09); go-live in progress

Verified locally: `npm run typecheck` ✅ · `npm run lint` ✅ ·
`npm run test` ✅ (215 unit pass, 10 RLS skip) · `npm run build` ✅.

**🔎 PRODUCTION-READINESS REVIEW (2026-07-18, commit `cd9341b`, D-033,
`SAAS_PLAN.md` §17): 9-lens full-codebase audit; 30+ bugs fixed; migration
`0023` applied live.** Headlines: the obligation-status cron transitioned
NOTHING while reporting success (PostgREST 1000-row cap + oversized `.in()`
updates + swallowed errors; statuses backfilled live — 1,160 overdue / 9 due);
disabled riders could still log in (now gated at login/layout/money-path +
auth-level ban; the 4 seeded demo/test riders were DELETED from the live DB);
owner KPIs/summary/reports were computed from capped subsets (all queries now
paginated via `lib/supabase/fetch-all.ts`); `proxy.ts` matcher silently ignored
(`proxyConfig`→`config`); a PostgREST DELETE could cascade-erase a contract's
obligation calendar (0023 revoke + FK RESTRICT + signed-doc immutability
trigger); monthly pay presets were day-denominated; the motorcycle import
wizard predated 0021 (rewritten). Systemic rules now in force (D-033): paginate
fleet-scaling queries, chunk bulk `.in()` mutations, never destructure `{data}`
without checking `error` in job/money paths. **Deploy to Vercel is the top
remaining action — the live site still runs the pre-review build.**

**🔴 CRITICAL SETTLEMENT FIX (2026-07-17) — migration 0019, applied live.**
`record_completed_payment` (behind EVERY mobile webhook, status-poll, reconcile
cron AND cash payment) threw on every call since go-live, so **no payment ever
settled and no receipt was ever generated** — the true root cause of both the
"Snippe shows paid but owner dashboard doesn't" report and the broken
`/owner/payments/cash` page. Two DB bugs: (1) `case … 'paid_in_advance' …
'paid' …` is `text`, no implicit cast to the `obligation_status` enum; (2) the
receipt insert's `gen_random_bytes` (pgcrypto) lives in the `extensions` schema,
off the function's `public, pg_temp` search_path. **`0019_fix_settlement_enum_cast.sql`
casts the CASE branches and fully-qualifies `extensions.gen_random_bytes`;
applied live + recorded in schema_migrations; verified by a rollback dry-run that
now runs settlement end-to-end.** It slipped through because tests are node-only
(no local Postgres), so the PL/pgSQL money functions were never executed — see
`SAAS_PLAN.md §16` and add DB-level integration tests. ⚠ **0019 is applied to
the live DB but must still be COMMITTED to git** so the repo matches live.
Stranded pilot money needs owner reconciliation (LEANHARD double-paid 10k;
JACOB 300k cash to re-record) — see the memory note `settlement-never-worked-fixed-0019`.

Other 2026-07-17 work (COMMITTED on main; needs a Vercel deploy to reach the
live site):
- rider hero card green label clarified to "up to date" (`app/rider/page.tsx`).
- `lib/geo/tanzania.ts` (26 regions/districts + stable codes, spec #5/#7) + tests.
- Mobishastra SMS adapter `lib/mobishastra/client.ts` wired into the outbox
  (spec #4/#6), disabled-safe until `MOBISHASTRA_*` creds land (owner-chosen
  provider; API = GET https://mshastra.com/sendurlcomma.aspx).
- **Onboarding rework (migration 0020, applied live; spec #3/#4/#5):** applicant
  picks an identity type (NIDA / Driving Licence / Voter ID); driving licence is
  never mandatory; required docs follow the type. Exactly ONE guarantor (was
  two) + guarantor confirmation SMS. Region/district are dependent dropdowns from
  the geo dataset (server rejects a district not in the chosen region). Owner
  reveal shows Voter ID; convert-to-rider copies identity_type + voter_id.
- Owner notified (in-app + optional SMS to `OWNER_NOTIFY_PHONE`) on every new
  application (spec #6).
- **Motorcycle fields + auto code (migration 0021, applied live; spec #16/#7):**
  registration number is optional (add/correct later on the detail page);
  chassis/engine/colour/make/model mandatory (chassis+engine unique); the
  internal code is auto-generated `NGR-{REGION}-{DIST}-M-{SEQ4}` from the geo
  codes (XXX fallback). Code is now the primary identifier in the UI.

**Monthly + weekly instalments (migration 0022, applied live; spec #8/#13,
D-032):** `schedule_type` gained `weekly` + `monthly`; `contracts` gained a
nullable `due_day_of_month`. The obligation/settlement engine was NOT changed —
it's schedule-agnostic, so a monthly obligation is just an obligation whose
amount is the month's instalment and one obligation = one month (the existing
cash page already does "select rider → month → record"). Weekly = one
obligation/week on an owner-chosen weekday (default = start weekday). Monthly =
exactly `duration_months` obligations on the owner-set due day; first payment on
the first occurrence of that day within the lease; `31` = last day of month.
Proven live with a rollback-only settlement dry-run (monthly obligation →
`paid_in_advance` + receipt — the DB-level money test 0019 lacked).

Remaining build-spec items (priority order, not yet started): accountant role +
RLS (#10), motorcycle procurement workflow
(#11, needs the accountant role), contract storage/download + template (#9/#18),
phone financing (#14), duration units (#15), PWA polish (#17), data import
(#19). Pilot money reconciliation is owner-driven in-app (see memory
`settlement-never-worked-fixed-0019`).

**LIVE-SITE BLOCKER FIX (2026-07-11) — needs deploy.** The production `/apply`
wizard could never pass step 1 (reported by the owner testing
www.ngumbi.co.tz): `@hookform/resolvers` v3 does not recognise zod v4's error
shape (`.issues` replaced `.errors`) and RETHREW the ZodError instead of
returning a field-error map, so every react-hook-form `trigger()` /
`handleSubmit()` rejected silently — the Continue button did nothing, in all
6 RHF forms (apply wizard, contract builder, expense/motorcycle/rider/incident
forms). Fixed: `@hookform/resolvers` upgraded 3.10.0 → ^5.4.0 (zod-v4-aware);
the two `z.coerce` forms (`ContractBuilder`, `ExpenseForm`) now use
`useForm<FormInput, unknown, Output>` input/output generics; regression test
`tests/unit/application-resolver.test.ts` exercises the resolver the way the
wizard does. Also fixed while verifying: an EMPTY optional env value
(`OWNER_SUMMARY_EMAIL=` added to `.env.local` 2026-07-11) failed
`.email()`/`.url()` validation and made `serverEnv()` throw on first use —
`lib/env.ts` now treats `''` as "not configured" for optional vars.

**SILENT-FAILURE HARDENING SWEEP (2026-07-11).** Three parallel review passes
(silent client-side failures, dynamic i18n keys/enum-label leaks, dependency
runtime seams) after the resolver incident. Fixed: root `app/error.tsx` +
`app/global-error.tsx` (a rejected server action inside `startTransition`
previously showed Next's bare production error screen); try/catch + visible
error state on ChangePinForm, AnnouncementForm, ExemptionRequestForm,
CashPaymentForm, ImportWizard (both phases), contract LifecycleButtons (result
was ignored entirely), and all five RHF `onSubmit`s; PayClient's resend-USSD
button now reports success/failure, knows `obligation_reserved`, and treats
`reversed` as terminal; rider receipt + incident pages no longer leak raw
English enums (`lib/payments/labels.ts`, `INCIDENT_STATUS_LABELS_SW`);
FileInput size message said 10MB but the cap is 4 MiB; login no longer reports
a server/network failure as "wrong credentials" (new `login.network`,
`pin.network` keys). Remaining from the sweep (deferred): logout buttons no-op
when offline; RiderStatusActions/IncidentStatus/RiskControls ignore action
results; `setManualRisk` swallows its DB error server-side (reads as success);
notification mark-read never checks errors; push-subscribe replay (known);
no component-level test renders any client form — vitest is node-only, which
is structurally why the resolver bug shipped (consider jsdom + RTL smoke
tests for the wizard/login).

**DEEP-DIVE REVIEW #2 (2026-07-10) — all findings fixed in code; two ops
actions remain.** Six parallel review passes (payments/money, auth/security,
cron/jobs, DB/RLS, API surface, domain/date math) over the whole codebase.
What was found and fixed:
- **Money integrity (migration 0018 + code, D-031):** `record_completed_payment`
  now refuses payments outside created/pending, non-outstanding obligations
  (exempted/postponed/cancelled were silently flipped back to `paid` —
  reversing owner waivers / double-billing postponements), rider mismatches,
  and obligations actively reserved by ANOTHER payment (cash could previously
  settle days reserved by an in-flight mobile payment, permanently stranding
  the rider's mobile money). Exemption waive/postpone gained the same
  rider-match + reservation guards; contract activation refuses an empty
  calendar; `recordCashPayment` also pre-checks reservations and rejects
  future dates.
- **Loud failures instead of silent ones:** webhook amount/currency mismatches,
  settlement invariant violations and reversal/chargeback events now write an
  audit row + owner `payment_issue` notification (previously: silent 200 or an
  infinite 500 retry loop). The initiate route's reference-store step is
  error-checked, and the webhook falls back to matching by
  `metadata.payment_id` so a payment whose reference was never stored is no
  longer unmatchable forever. Webhook dedupe keys on error code 23505, not the
  message text. Daily-summary email failure now fails the job run (was
  recorded as "success"); outbox retries failed sends (≤5 attempts) and no
  longer permanently strands messages enqueued before the Resend key exists.
- **RLS tightening (0018):** `exemptions_self_insert` pins status/decision
  columns and requires the obligation to belong to the inserting rider (a
  forged row could previously make the owner waive a DIFFERENT rider's
  obligation); `incidents_self_insert` pins `status='open'`; riders can update
  only `notifications.read_at`; one open exemption per obligation; definer
  functions get `search_path = public, pg_temp`; missing FK indexes added.
- **Cron correctness:** daily summary now reports the day that just ENDED (it
  ran at 00:00 EAT and always summarized the minute-old empty new day);
  obligation-status query gained the missing `due_date <= today` filter (it
  fetched the entire future calendar and silently truncated at 10k rows);
  dispatcher `maxDuration` 60→300s (Hobby max); transition notifications are
  best-effort per rider (one failure no longer permanently skips the rest).
- **/apply could never work in production (D-030):** 13 documents in one
  multipart POST exceeds Vercel's ~4.5 MB body cap. Now: submit payload first
  → signed 2h upload token → one document per request to
  `/api/applications/documents` (allowlisted scope/docType, magic-byte scan,
  idempotent retries, `upload_sign` rate limit). Per-file cap 10→4 MiB.
  `serverActions.bodySizeLimit` raised to 15 MB for owner uploads (scanned
  contracts, XLSX imports).
- **Credentials:** convert-to-rider used `Math.random()` for the temp PIN —
  now the shared CSPRNG `lib/auth/temp-pin`; CSV-imported PINs must pass the
  weak-PIN rules; convert-to-rider PII copy errors are surfaced (were silently
  swallowed); owner-login counts malformed probes toward the throttle;
  `getClientIp` prefers platform-set `x-real-ip` over spoofable first-hop XFF.
- **Dashboards/dates:** owner-KPI obligation query scoped to unpaid + due-today
  (was ALL history: silent 5k-row truncation with no ORDER BY ⇒ arbitrarily
  wrong KPIs at scale — same fix in the daily summary); payment dates render
  the EAT day via `localDateString` (were UTC slices, off by one 21:00–24:00
  UTC); rider payment statuses show Swahili labels, not raw enums; rider
  calendar is now weekday-aligned with a Swahili month header; exemption
  reject/under-review are conditional updates (couldn't overwrite a decided
  request's history any more); application reference year computed in EAT;
  arrears label "31+ days"; `paymentPerformance` buckets are exclusive.

✅ **Migration 0018 APPLIED LIVE (2026-07-11)** via the Management API (D-029)
and recorded in `supabase_migrations.schema_migrations` — 0017 turned out to be
already applied at go-live, so the live DB now has **all 18 migrations**.
Verified live: settlement/waiver/postponement/activation guards present, 4
definer functions carry `search_path = public, pg_temp`, both rider-insert
policies pinned, 5 new indexes, `app_settings` trigger, notifications
column-grant = `read_at` only, receipt sequence next value = 1. The
`SUPABASE_ACCESS_TOKEN` (sbp_, Driftmark Africa) used for this is now stored in
`.env.local` for future DB ops.

⚠ **REQUIRED OPS (do before pilot):**
1. **Delete/disable the 3 demo riders** seeded on 2026-07-09 — their phones AND
   PINs are published in `scripts/seed.ts` in a public repo, i.e. anyone can
   log in as them. (Verified 2026-07-11: all three are `active` with 0
   contracts / 0 payments, so deletion is clean.) Change the owner temp
   password at the same time.

**GO-LIVE PROGRESS (2026-07-09).** Hosted Supabase project **Ng'umbi Riders**
(ref `rdofxxxdrqnhtewwzous`, Frankfurt, org Driftmark Africa) is provisioned:
- **All 18 migrations applied** (0018 on 2026-07-11) via the Management API
  SQL endpoint (no DB
  password available locally — password reset was not authorized; the CLI's
  `supabase_migrations.schema_migrations` table is populated so `db push`
  stays consistent). Live DB verified: 39 public tables, RLS enabled on all,
  62 policies, 7 private storage buckets.
- **`.env.local` is fully populated** (Supabase URL/keys, fresh
  AUTH_PIN_PEPPER / PII_ENCRYPTION_KEY / CRON_SECRET / VAPID keypair, Snippe
  API key). `DATABASE_URL` is unset — not needed by seed or RLS tests.
- **Seeded**: owner `owner@ngumbi.co.tz` (temp password = the seed default in
  `scripts/seed.ts` — MUST be changed before pilot) + 3 demo riders. Owner
  email login verified live.
- **Generated DB types wired in** (D-010 resolved): `lib/supabase/types.gen.ts`
  + `<Database>` generic on all three client factories.
- **Hosted auth configured** (user-approved): phone provider enabled (no SMS
  provider, D-008), public signups disabled. **RLS isolation suite PASSES
  live (10/10)** — Phase 1's exit criterion is CLOSED. Rider phone+PIN login
  is verified working end-to-end.
- ⚠ **Snippe key lacks `collection:read` scope** (balance check returned 403
  AUTHZ_002). Regenerate the key with `collection:read` + `collection:create`.
  Webhook secret still needed (dashboard → Settings → Webhook Secret).
- Still pending: Resend key + DNS, Vercel deploy (cron + webhook URL), real
  rider/motorcycle import, pilot.

Integrations degrade gracefully (return `not_configured`) until their keys exist.

**Phase 10 (buildable parts done):** money tables **write-locked** (migration
0016 revokes direct writes; money mutates only via controlled functions +
service role), **data-quality** cron, `/owner/system` health + `/owner/audit`
pages, **CSP** + security headers on every response, and the ops docs
(`SECURITY_REVIEW`, `LAUNCH_CHECKLIST`, `BACKUP_RECOVERY`). Remaining Phase 10 is
credential-gated ops.

**Phase 9 (code-complete):** report aggregation math (`lib/reports/compute` —
collections, arrears, performance, contract progress, cash-operating-margin; 11
tests), motorcycle **expense ledger** (`/owner/expenses`) + margin on the
motorcycle detail, **report centre** (`/owner/reports`, date range) with
**CSV/XLSX exports** (`/api/reports/[report]/export`). Remaining report views +
PDF export are follow-ups.

**Phase 8 (code-complete):** obligation status processor (pure, tested) + 6
CRON_SECRET-guarded cron jobs (`vercel.json`) writing `system_job_runs`; in-app
notifications (`/rider/notifications`) + owner announcements; PWA service worker
(`public/sw.js`) + registration + web-push (`/api/push/subscribe`, disabled until
VAPID); Resend daily summary (idempotent) + message outbox (email on; SMS/WhatsApp
flagged off). Integrations no-op cleanly until their keys are set.

**Phase 7 (code-complete):** rider incident reporting + owner queue, exemption
requests with owner **waive/postpone/reject** through controlled DB functions
(migration 0015 — postpone preserves the original obligation as `postponed` and
creates a new one, never corrupting history), and explainable rule-based **risk
scoring** (`lib/risk/scoring`) with owner recompute + manual override.

**Phase 6 (code-complete):** owner **KPI dashboard** (`/owner` — expected/settled/
collected/outstanding, collection rate, arrears aging, who-hasn't-paid, ending
contracts, high-risk, warnings) and rider dashboard (`/rider` — state, Lipa Sasa,
progress, motorcycle, recent payments) + colour-coded payment **calendar**
(`/rider/calendar`). KPI + rider-state math is pure and unit-tested
(`lib/dashboard/*`).

**Phase 5 (code-complete; activates when creds + Snippe keys land):** whole-
obligation selection with **oldest-first allocation** and partial-payment
rejection (`lib/payments/selection`), Snippe client, `/rider/pay` flow with
conservative status polling, **signed webhook** (`/api/webhooks/snippe`: raw-body
HMAC, 5-min freshness, replay-safe dedupe), atomic settlement (migration 0014
`record_completed_payment`), receipts, owner **cash payments** + payments list +
reconciliation.

**Phase 3 (code-complete):** motorcycle register, rider register + manual
creation, assignment history + exceptional transfer, CSV/XLSX import wizard
(riders + motorcycles).

**Phase 4 (code-complete; activates when creds land):** the **obligation
schedule engine** (`lib/obligations/schedule` — daily/weekday, leap-year & month
safe, UTC-from-EAT, 15 tests), contract builder with live preview, register +
detail, **on-screen signatures + physical-copy fallback**, **PDF generation**
(`@react-pdf/renderer`, SHA-256 hash), and **transactional activation** (migration
0013 SECURITY DEFINER function generates the obligation calendar + activates in
one transaction). Lifecycle: pause/resume/complete-early/terminate.

**Phase 2 (all code-complete; activates when Supabase creds land):** public
multi-step application form (`/apply`, 9 steps, RHF + zod, session draft,
signature pad, 13 doc uploads — **one request per document** via a signed
upload token + `/api/applications/documents`, D-030, since Vercel caps request
bodies at ~4.5 MB), AES-256-GCM PII encryption, `/apply/success`,
submission endpoint (`/api/applications`) with **magic-byte file scan** +
**durable per-IP rate limiting** (migration 0012), **bilingual (sw/en)** with a
cookie `LanguageSwitcher`, and the **owner review pipeline**
(`/owner/applications` + `[id]`): status state machine, deliberate NIDA/licence
reveal, signed doc URLs, duplicate warnings, and **convert-to-rider** (creates
the auth user + one-time temp PIN, copies encrypted PII).

**Done**
- Foundations: Next 16.2 App Router, Tailwind v4 tokens, i18n (sw/en), env
  validation, ESLint/Prettier/Vitest, GitHub Actions CI, `.env.example`.
- Database: 13 enums + **38 tables** (all of spec §22.1) across 11 migrations,
  with the §22.2 constraints; audit/login/job infrastructure.
- Auth: owner email/password + **rider phone + 4-digit PIN** with **server-only
  HMAC** PIN→password derivation. Weak-PIN rules, forced temp-PIN change,
  DB-backed rate limiting + **30-min lockout** (5 fails/15 min, per phone & IP).
- **Full RLS matrix** (owner-all + rider-own-row; sensitive/system tables
  owner-only) + private storage buckets.
- Tests: unit (phone/PIN/lockout/money) + RLS isolation suite (opt-in).

**Blocked on input (not code):**
1. **Snippe**: key in `.env.local` lacks `collection:read` (regenerate with
   read+create scopes in the Snippe dashboard) and `SNIPPE_WEBHOOK_SECRET` is
   unset (dashboard → Settings → Webhook Secret).
2. **Resend** key + domain DNS; Vercel deployment (sets webhook/cron URLs).
3. **No Docker here** → local `supabase start` can't boot on this machine;
   the DB password is also unknown locally, so DB work goes through the
   Management API SQL endpoint (`POST /v1/projects/{ref}/database/query`)
   instead of `db push` (see D-029).

### ▶ Immediate next actions
All 18 migrations, env, seed, types, auth config and the live RLS proof are
DONE (see §2). Remaining critical path:
```bash
# 0. delete/disable the 3 demo riders (PINs are public in scripts/seed.ts)
#    and change the owner temp password
# 1. deploy to Vercel (env vars from .env.local) -> gives HTTPS URL
# 2. point Snippe webhook at <url>/api/webhooks/snippe; set SNIPPE_WEBHOOK_SECRET
# 3. Vercel Cron picks up vercel.json; set CRON_SECRET in Vercel env
```
Then: verify Resend DNS, import real riders/motorcycles via `/owner/imports`,
reconcile sample totals, and run the pilot. If a feature
session is wanted instead, the highest-value **follow-ups** are: contract
extend/renegotiate + `regenerate_future_obligations` + addendum PDF (§10.4);
receipt PDF + payment-reversal **un-settlement flow** (§13, §12.3 — reversal
events are now flagged to the owner but nothing un-settles automatically);
remaining report views + PDF export (§19.1); nonce-based CSP; blind-index NIDA
dedupe (D-014).

---

## 3. Phase roadmap (spec §34) — checklist

- [x] **Phase 0** Foundations
- [x] **Phase 1** Database, auth, RLS *(DONE — live-DB RLS suite passed 10/10
      on 2026-07-09; exit criterion closed)*
- [x] **Phase 2** Application form + validation + PII encryption + submit
      endpoint + magic-byte scan + rate limiting + bilingual i18n + **owner
      review pipeline & convert-to-rider** — *code-complete; live run pending DB*
- [x] **Phase 3** Rider + motorcycle registers, manual rider creation,
      assignment history + transfer, CSV/XLSX import wizard (riders +
      motorcycles) — *code-complete; live run pending DB*
- [x] **Phase 4** Contract engine: builder + preview, template + PDF, signatures
      + physical fallback, **obligation generation** (daily/weekday, leap-safe,
      UTC-from-EAT), transactional activation, lifecycle — *code-complete; live
      run pending DB. Follow-ups: extend/renegotiate + regenerate-future +
      addendum PDF (§10.4)*
- [x] **Phase 5** Payments: whole-obligation selection (oldest-first), **Snippe**
      integration, signed webhook + idempotency, atomic allocations, receipts,
      reconciliation, owner cash payments — *code-complete; live run pending DB +
      Snippe keys. Follow-ups: receipt PDF, reversal handling, recon cron*
- [x] **Phase 6** Owner KPI dashboard + rider dashboard/calendar/progress — *code
      complete; live data pending DB*
- [x] **Phase 7** Incidents, exemption waiver/postponement (controlled fns),
      explainable risk — *code-complete; live run pending DB*
- [x] **Phase 8** In-app notifications, PWA (SW/push), Resend daily summary,
      SMS/WhatsApp outbox (flagged off), 6 cron jobs — *code-complete; live cron
      + push/email pending DB + keys*
- [x] **Phase 9** Report math (collections/arrears/performance/progress/margin),
      expense ledger, report centre, CSV/XLSX exports — *code-complete; remaining
      report views + PDF export are follow-ups*
- [x] **Phase 10** Hardening: money-table write-locks (0016), data-quality cron,
      `/owner/system` + `/owner/audit`, CSP + headers, security/launch/backup docs
      — *buildable parts done; live RLS proof + real-data staging + pilot are
      credential-gated ops (see LAUNCH_CHECKLIST)*

All ten phases are code-complete. Keep financial state transactional & idempotent;
never weaken RLS; keep secrets server-only; add tests with each business rule.

---

## 4. Architecture map (where things live)

```
app/(public)/        landing, offline            app/(auth)/login/   rider+owner login
app/rider/           gated rider area (proxy + layout)
app/owner/           gated owner area
app/api/auth/*       rider-login, owner-login, change-pin, logout
app/api/health       liveness
proxy.ts             Next 16 proxy (was middleware) — session refresh + gate

lib/env.ts           validated env (public vs server-only)
lib/supabase/        client (browser) · server (SSR) · admin (service role, server-only) · proxy · types
lib/auth/            phone (E.164) · pin (validation) · pin-derive (HMAC, server-only) ·
                     lockout (pure) · rate-limit (server-only) · session · provision (Admin API)
lib/security/        request (client IP)     lib/audit/  audit writer
lib/money/ dates/ i18n/ validation/          domain utilities

supabase/migrations/ 0001..0018 + seed.sql    supabase/config.toml
scripts/seed.ts      owner + demo rider seeding
tests/unit/          phone, pin, lockout, money
tests/integration/rls/ isolation suite (opt-in via RLS_TEST_ENABLED)
messages/sw.json en.json                      i18n catalogs
```

Full route + folder inventory: `docs/ROUTE_MAP.md`.
Migration-by-migration contents + planned future migrations: `docs/MIGRATION_PLAN.md`.

---

## 5. Non-negotiable rules (from spec §36 — enforce every session)

1. **Secrets stay server-only**: service-role key, `AUTH_PIN_PEPPER`,
   `PII_ENCRYPTION_KEY`, Snippe & Resend creds. Never `NEXT_PUBLIC_`, never in a
   client bundle. The `server-only` import guards the privileged modules.
2. **Raw PIN never leaves the server**; password = `HMAC_SHA256(pepper, phone:pin)`.
3. **Never trust client-supplied** amounts, roles, rider IDs, payment statuses or
   contract totals — recompute/verify server-side.
4. **RLS is the decisive boundary** — never weaken it to fix a frontend problem.
5. **Money is transactional & idempotent**; keep invariants in Postgres
   functions / transactional server code, not client components.
6. **Financial & signed records are immutable** — corrections are reversal/
   correction events, never deletes/overwrites.
7. **Snippe webhooks** verified from the raw body; never mark a payment complete
   from a browser callback.
8. **Every schema change = a Supabase migration** (append-only; never edit an
   applied migration). No undocumented manual DB changes.
9. Add tests with every critical business rule; run typecheck+lint+tests before
   marking a task done.
10. Record assumptions in `DECISIONS.md`; keep `IMPLEMENTATION_STATUS.md` current.
11. Rider UI: simple, **Swahili-first**, low-bandwidth. SMS/WhatsApp behind flags
    until providers configured. Money is stored as **integer TZS**.

---

## 6. Commands

```bash
npm run dev            # local dev (http://localhost:3000)
npm run verify         # typecheck + lint + test  (run before committing)
npm run build          # production build
npm run test:rls       # RLS isolation (needs RLS_TEST_ENABLED=1 + live DB)
npm run db:push        # apply migrations to linked project
npm run db:reset       # local reset (needs Docker)
npm run seed           # seed owner + demo riders
```

Repo: https://github.com/africanuspanga/Ngumbi-Riders (branch `main`).

---

## 7. Known follow-ups / tech debt to revisit

- Rate limiting is app-level per-phone/IP (small race acceptable at <100 riders);
  consider a SECURITY DEFINER atomic version if abuse appears (D-005).
- Sentry/observability wired in Phase 10 (route handlers currently log via
  `login_attempts` + `audit_logs`).

From deep-dive #2 (2026-07-10) — real but deliberately deferred:
- **Payment reversal un-settlement**: `reversed` exists in the enum and
  reversal webhooks now alert the owner, but there is no controlled function
  that un-settles allocations/obligations (corrections must be reversal events,
  never overwrites — spec rule 6).
- **Contract end-date convention (needs an owner decision)**: a "1-month"
  contract starting Jan 31 currently ends Feb 27 (clamped `addMonths` then −1
  day double-shortens month-end starts; codified in `tests/unit/schedule.test.ts`).
  The natural lease convention would be last-day-of-month (Feb 28). Decide
  before generating real contracts — obligations are money.
- **Risk recompute is ~3 queries/rider serially** (`lib/jobs/tasks.ts`
  riskRecalcTask). Fine under the 300s dispatcher budget at pilot scale;
  batch it before the fleet grows past a few hundred riders.
- **Stale `running` job rows**: a dispatcher crash/timeout leaves
  `system_job_runs` rows at `running` forever; `/owner/system` should treat
  running > ~15 min as failed.
- **Reconcile settles with `now()`** as completed_at (Snippe status API doesn't
  return the completion time) — receipt year/paid-in-advance classification can
  drift for payments reconciled after midnight.
- **`mustChangePin` is enforced on pages only** — rider API routes/actions
  check the role but not the forced-PIN-change flag (not an escalation; a
  policy gap).
- **LanguageSwitcher isn't mounted in the rider area** (rider pages are
  hardcoded Swahili; catalogs sw/en are at parity, 131 keys each).
- **Export default range** (`/api/reports/[report]/export` defaults from=to)
  differs from the report page default (1st of month) — only bites hand-typed
  URLs.
- **Push subscribe upserts by endpoint** — an authenticated user replaying
  another's (unguessable) endpoint URL could reassign it (delivery DoS at
  worst).
- **Application/rider/contract numbers use count(*)+1** with unique-constraint
  retries — replace with DB sequences if concurrent creation ever matters.
- **`incident_reports`/`rider_applications` free-text fields** have no length
  caps; announcements likewise.
- Owner file uploads (physical contract copy, drawn signature) skip magic-byte
  sniffing — owner-only surface, but inconsistent with the public endpoint.
