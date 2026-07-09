# CLAUDE.md — Working Handoff & Orientation

> **This file = where we are and what to do next.** Read it first every session.
> **Product source of truth = [`Docs/NGUMBI_RIDERS_BUILD_SPEC.md`](Docs/NGUMBI_RIDERS_BUILD_SPEC.md)** (the full build
> spec). This file never overrides the spec; it tracks execution against it.
>
> Companion docs: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) ·
> [`DECISIONS.md`](DECISIONS.md) (D-001…D-028) · [`docs/MIGRATION_PLAN.md`](docs/MIGRATION_PLAN.md) ·
> [`docs/ROUTE_MAP.md`](docs/ROUTE_MAP.md) · [`docs/RLS_MATRIX.md`](docs/RLS_MATRIX.md) ·
> [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) ·
> [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) ·
> [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md)

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
`npm run test` ✅ (155 unit pass, 10 RLS skip) · `npm run build` ✅ (55 routes).

**GO-LIVE PROGRESS (2026-07-09).** Hosted Supabase project **Ng'umbi Riders**
(ref `rdofxxxdrqnhtewwzous`, Frankfurt, org Driftmark Africa) is provisioned:
- **All 16 migrations applied** via the Management API SQL endpoint (no DB
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
- ⚠ **BLOCKED — rider login / RLS suite**: hosted auth has
  `external_phone_enabled=false`; rider `signInWithPassword({phone})` fails
  with "Phone logins are disabled". Fix: dashboard → Auth → Providers →
  enable **Phone** (no SMS provider needed, D-008) and disable public
  signups; then `RLS_TEST_ENABLED=1 npm run test:rls`.
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
signature pad, 13 doc uploads), AES-256-GCM PII encryption, `/apply/success`,
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
1. **Hosted auth config**: enable the **Phone** provider + disable public
   signups on project `rdofxxxdrqnhtewwzous` (dashboard → Auth → Providers;
   or Management API `PATCH /v1/projects/{ref}/config/auth`
   `{"external_phone_enabled":true,"disable_signup":true}`). Without it rider
   login fails and the RLS suite cannot run.
2. **Snippe**: key in `.env.local` lacks `collection:read` (regenerate with
   read+create scopes) and `SNIPPE_WEBHOOK_SECRET` is unset.
3. **Resend** key + domain DNS; Vercel deployment (sets webhook/cron URLs).
4. **No Docker here** → local `supabase start` can't boot on this machine;
   the DB password is also unknown locally, so DB work goes through the
   Management API SQL endpoint (`POST /v1/projects/{ref}/database/query`)
   instead of `db push`.

### ▶ Immediate next actions
Migrations, env, seed and types are DONE (see §2). Remaining critical path:
```bash
# 1. after enabling phone auth (see Blocked #1):
RLS_TEST_ENABLED=1 npm run test:rls # PROVE rider isolation -> closes Phase 1 exit
# 2. deploy to Vercel (env vars from .env.local) -> gives HTTPS URL
# 3. point Snippe webhook at <url>/api/webhooks/snippe; set SNIPPE_WEBHOOK_SECRET
# 4. Vercel Cron picks up vercel.json; set CRON_SECRET in Vercel env
```
Then: verify Resend DNS, import real riders/motorcycles via `/owner/imports`,
reconcile sample totals, change the owner temp password, and run the pilot. If a feature
session is wanted instead, the highest-value **follow-ups** are: contract
extend/renegotiate + `regenerate_future_obligations` + addendum PDF (§10.4);
receipt PDF + payment-reversal handling (§13, §12.3); remaining report views +
PDF export (§19.1); nonce-based CSP; blind-index NIDA dedupe (D-014).

---

## 3. Phase roadmap (spec §34) — checklist

- [x] **Phase 0** Foundations
- [x] **Phase 1** Database, auth, RLS *(code done; live-DB RLS proof pending)*
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

supabase/migrations/ 0001..0011 + seed.sql    supabase/config.toml
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

- `lib/supabase/types.ts` is a structural placeholder — regenerate real types
  from the live DB and re-add the `<Database>` generic to the clients (DECISIONS
  D-010).
- Rate limiting is app-level per-phone/IP (small race acceptable at <100 riders);
  consider a SECURITY DEFINER atomic version if abuse appears (D-005).
- Phase 5 must **revoke direct writes** on payments/allocations/obligations once
  the controlled money functions exist (see MIGRATION_PLAN Phase 5).
- Sentry/observability wired in Phase 10 (route handlers currently log via
  `login_attempts` + `audit_logs`).
