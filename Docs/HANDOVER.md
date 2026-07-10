# HANDOVER — Orientation for Future Developers & Sessions

> Audience: a developer (human or AI session) touching this codebase for the
> first time. Read this, then `CLAUDE.md` (live execution state), then the
> relevant section of the build spec
> ([`NGUMBI_RIDERS_BUILD_SPEC.md`](NGUMBI_RIDERS_BUILD_SPEC.md) — the product
> source of truth). This document explains *how the system works and why*;
> CLAUDE.md tracks *where we are right now*.

---

## 1. What this is

Fleet contract & rider-payment management for **Ng'umbi Riders**, a single
motorcycle-leasing business in Tanzania. The owner (Mr. Ng'umbi) leases
motorcycles to riders under daily-installment contracts; riders pay whole daily
lease obligations via mobile money (**Snippe**) or cash; the owner sees who
paid, who owes, incidents, risk, and reports. Two roles only: **owner** and
**rider**. Single business — no multi-tenancy (see
[`SAAS_PLAN.md`](SAAS_PLAN.md) for the path to change that).

Design constraints that shape everything:
- **Mobile-first PWA for low-cost Android** on slow networks. Pages are small,
  server-rendered, Swahili-first.
- **Money is integer TZS** (no minor unit), **transactional and idempotent**,
  and financial history is **immutable** — corrections are new events.
- **Timezone is Africa/Dar_es_Salaam (EAT, UTC+3, no DST)**. Business dates are
  computed in EAT and stored as UTC (`lib/dates/tz.ts` is the only place the
  timezone lives).

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.2 App Router, React 19, TypeScript | `proxy.ts` (Next 16 rename of middleware) does session refresh + coarse role gating |
| Styling | Tailwind v4 | Design tokens in `app/globals.css` `@theme` |
| Backend | Supabase (Postgres, Auth, Storage) | Hosted project ref `rdofxxxdrqnhtewwzous` (Frankfurt) |
| i18n | next-intl | Swahili default, English secondary; catalogs `messages/sw.json` / `en.json` (kept at exact key parity) |
| Payments | Snippe (mobile money) | Signed webhook is the source of truth; see §5 |
| Email | Resend | Daily owner summary + outbox |
| Hosting | Vercel (Hobby) | ONE daily cron dispatcher (see §6) |
| Tests | Vitest | Unit for all business math; opt-in live RLS isolation suite |

## 3. Getting productive

```bash
npm install
cp .env.example .env.local     # fill in (see the table in .env.example)
npm run dev                    # http://localhost:3000
npm run verify                 # typecheck + lint + test — run before every commit
npm run build                  # must pass before calling anything done
npm run test:rls               # live RLS isolation suite (RLS_TEST_ENABLED=1, hits the real DB)
```

Machine constraints that surprise people:
- **No Docker on the dev machine** → `supabase start` / `db reset` don't work
  locally. Schema work is verified by reading SQL + applying to the hosted
  project.
- **No local DB password** → migrations are applied to the hosted project via
  the **Management API SQL endpoint**
  (`POST /v1/projects/{ref}/database/query`, `sbp_` token), *not* `db push`.
  Applied versions must also be inserted into
  `supabase_migrations.schema_migrations` so the CLI stays consistent
  (decision D-029).

## 4. Architecture tour

```
proxy.ts                     session refresh + coarse /rider /owner gating (convenience only)
app/(public)/                landing, /apply (public application form), offline
app/(auth)/login/            rider phone+PIN login; owner at /login/owner
app/rider/                   rider area — every page calls requireRider()
app/owner/                   owner area — every page calls requireOwner()
app/api/                     route handlers (auth, payments, webhook, cron, applications)
lib/<domain>/                domain logic; heavy business math is PURE + unit-tested
lib/supabase/                client (browser) · server (SSR) · admin (service role, server-only)
supabase/migrations/         0001..0018, append-only — NEVER edit an applied migration
tests/unit/                  business-rule tests        tests/integration/rls/  isolation suite
```

Authorization is layered, and only the bottom layer is trusted:
1. `proxy.ts` — coarse redirect (convenience).
2. Layouts + `requireOwner()`/`requireRider()` (`lib/auth/session.ts`) — page gating.
3. **Every server action / route handler re-checks the role itself** (search
   for `assertOwner`). Never rely on the page layer.
4. **RLS is the decisive boundary.** Assume any authenticated user can hit
   PostgREST directly with their JWT. Sensitive mutations happen through
   SECURITY DEFINER functions or the service-role client after explicit checks.

### Auth model (unusual — read this)
Riders log in with **phone + 4-digit PIN**. The PIN is never sent to Supabase:
the server derives `password = HMAC_SHA256(AUTH_PIN_PEPPER, phone:pin)`
(`lib/auth/pin-derive.ts`, server-only). Weak PINs are rejected
(`lib/auth/pin.ts`), temp PINs force a change on first login, and login is
throttled per phone AND per IP with a 30-min lockout backed by
`login_attempts`. Temp PINs come from `lib/auth/temp-pin.ts` (CSPRNG) — there
is exactly one generator; do not write another.

### Payment flow end-to-end (the heart of the system)
1. Rider picks N whole obligations → `POST /api/payments/snippe/initiate`.
   Server recomputes selection **oldest-first** (`lib/payments/selection.ts`)
   and amount — the client never supplies amounts or obligation ids.
2. A `payments` row (`created`) + `payment_reservations` rows are written. A
   partial-unique index guarantees one active reservation per obligation.
3. Snippe USSD push goes to the rider's phone; the payment becomes `pending`.
4. **The signed webhook** (`app/api/webhooks/snippe/route.ts`) is the ONLY
   thing that settles: raw-body HMAC (`{timestamp}.{body}`), ±300s freshness,
   event dedupe by unique provider event id, amount/currency check, then the
   SECURITY DEFINER function `record_completed_payment` (migrations 0014 →
   0017 → 0018) allocates obligations, flips them paid/paid_in_advance, writes
   the receipt (number from a Postgres sequence) and releases reservations —
   atomically and idempotently.
5. `record_completed_payment` is **self-defending** (0018): payment must be
   created/pending; every obligation must be outstanding, belong to the
   payment's rider, and not be actively reserved by another payment. Invariant
   violations make the webhook alert the owner (`payment_issue` notification +
   audit row) instead of retry-looping.
6. Fallbacks: a status-polling page (read-only), a reconciliation cron that
   queries Snippe for stale pending payments, and webhook matching by
   `metadata.payment_id` when the provider reference was never stored.
7. Cash: `recordCashPayment` (owner-only server action) recomputes everything
   server-side and settles through the SAME function.

If you change anything in this flow, re-read spec §12 and decisions D-031,
D-029, and run the money tests.

### The obligation calendar
`lib/obligations/schedule.ts` generates the whole calendar (daily/weekday,
leap-safe, EAT→UTC) at contract activation via a transactional DB function
(`activate_contract_and_generate_obligations`). Obligations transition
scheduled → due → overdue via the nightly cron (`lib/obligations/transitions.ts`
is pure and tested). Waivers/postponements go through guarded DB functions that
preserve the original obligation in history — nothing ever rewrites settled
rows.

## 5. Non-negotiable invariants

These are spec §36 rules; every review pass enforces them:

1. Secrets are server-only (service-role key, `AUTH_PIN_PEPPER`,
   `PII_ENCRYPTION_KEY`, Snippe/Resend keys). `import 'server-only'` guards the
   privileged modules. Nothing secret under `NEXT_PUBLIC_`.
2. Raw PINs never leave the server.
3. Never trust client-supplied amounts, roles, rider ids, statuses — recompute
   server-side.
4. Never weaken RLS to fix a frontend problem.
5. Money mutations are transactional + idempotent, in Postgres functions.
6. Financial/signed records are immutable; corrections are new events.
7. Webhooks verified from the raw body; browser callbacks never settle.
8. Every schema change is a new append-only migration.
9. Every business rule lands with tests; `npm run verify` before done.
10. Assumptions go in `DECISIONS.md` (D-001…D-031); status in
    `IMPLEMENTATION_STATUS.md` and `CLAUDE.md`.
11. Rider UI: Swahili-first, low-bandwidth, no raw enum strings.

## 6. Scheduled jobs (Vercel Hobby quirk)

Hobby allows only daily crons, so `vercel.json` has ONE cron:
`/api/cron/daily` at `0 21 * * *` UTC = **00:00 EAT**, which runs all seven
tasks serially (`lib/jobs/tasks.ts`, `maxDuration = 300`): obligation status →
reconcile pending → reservation cleanup → risk recalc → data quality → daily
summary (of the day that just ENDED) → outbox. Each task writes a
`system_job_runs` row; `/owner/system` shows health. All tasks are idempotent —
they may be re-run manually via the per-job routes (CRON_SECRET bearer,
timing-safe check in `lib/jobs/runner.ts`).

## 7. Common task recipes

- **Schema change** → new `supabase/migrations/00NN_*.sql` (append-only) →
  apply via Management API → insert version row in
  `supabase_migrations.schema_migrations` → regenerate
  `lib/supabase/types.gen.ts` if tables/columns changed → update
  `Docs/MIGRATION_PLAN.md` + `Docs/RLS_MATRIX.md`.
- **New owner mutation** → server action in `lib/<domain>/actions.ts` with
  `assertOwner()` first line, zod-parse input, explicit column lists (no
  spreads), `writeAudit(...)` for anything touching money/identity,
  `revalidatePath`.
- **New rider-facing page** → `requireRider()`, Swahili strings (add both
  `sw.json` and `en.json` keys), rely on RLS for data scoping.
- **New cron work** → add a `CronTask` in `lib/jobs/tasks.ts` (idempotent,
  dedupe-keyed notifications), append to `DAILY_TASKS`, keep queries bounded
  with explicit filters (a silent row-cap truncation caused a real bug — see
  D-031 context).
- **New report** → pure function in `lib/reports/compute.ts` + unit tests, wire
  a query in `lib/reports/queries.ts`, export drops out of the shared CSV/XLSX
  layer.

## 8. Production state & ops

Live state, pending credentials and the go-live checklist are tracked in
**CLAUDE.md §2** (always current) and `Docs/LAUNCH_CHECKLIST.md`. Operational
docs: `ADMIN_GUIDE.md` (owner-facing), `SECURITY_REVIEW.md`,
`BACKUP_RECOVERY.md`, `RLS_MATRIX.md`, `ROUTE_MAP.md`.

Known deliberate gaps (with reasons) live in CLAUDE.md §7 — check there before
"fixing" something that was consciously deferred (e.g. payment reversal
un-settlement, nonce-based CSP, count(*)+1 numbering).

## 9. Gotchas that have bitten before

- **EAT vs UTC**: never `new Date().toISOString().slice(0,10)` for a business
  date — use `localDateString()` from `lib/dates/tz`. The midnight-EAT cron
  runs at 21:00 UTC; "today" is ambiguous unless you say which one.
- **PostgREST row caps**: unfiltered `.select()` with `.limit(N)` and no
  `.order()` silently returns an arbitrary subset once data outgrows N. Always
  filter to what the computation needs.
- **Supabase error handling**: check `error.code === '23505'` for dupes, not
  the message text. Never ignore the `error` return of a mutation you depend on.
- **Vercel request bodies cap at ~4.5 MB** — that's why /apply uploads one
  document per request (D-030) and `serverActions.bodySizeLimit` is 15 MB.
- **`Docs/` vs `docs/`**: the repo folder is tracked as `Docs/` (macOS is
  case-insensitive, so both spellings work locally — they're the same folder;
  keep new files referenced as `Docs/` in git).
- **Two review passes have already hardened money paths** (commits 76731c7 and
  the 2026-07-10 pass, migrations 0017/0018). Read D-031 before touching
  settlement.
