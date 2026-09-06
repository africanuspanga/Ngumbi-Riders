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
> [`DECISIONS.md`](DECISIONS.md) (D-001…D-039) · [`Docs/MIGRATION_PLAN.md`](Docs/MIGRATION_PLAN.md) ·
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

**🆕 CLIENT-FEEDBACK BUILD #3 (2026-09-06, migration `0029`, APPLIED LIVE).**
Six requests, plus two production outages fixed the same day and two permanent
guards added so that class of outage cannot ship again. ⚠ **Deploy to Vercel is
the remaining step.**

**Two outages, both fixed and deployed (`65f695e`, `162076f`).**
- `/owner` threw on every request: `app/owner/page.tsx` called
  `formatClockDate()`, a plain function exported from the `'use client'`
  module `components/owner/live-clock.tsx`. On the server such an export is a
  client REFERENCE, not the function. Formatters moved to `lib/dates/clock.ts`.
- `/owner/payments/approvals` and `/accountant/payments/approvals` threw on
  every request: both passed `editHref={(r) => …}` — a FUNCTION — as a prop to
  the Client Component `CashApprovalQueue`. Functions are not serializable
  across the boundary. Now `editBasePath`, a plain string.
- Found alongside: `RIDER_VIEW_COOKIE` was exported from a client module and
  read server-side on `/owner/riders`, so the card/table preference had never
  actually applied since it shipped.

**Two permanent guards (this is the answer to "why does it keep coming back").**
- `lib/dev/rsc-boundary.ts` + `tests/unit/rsc-boundary.test.ts` — a source
  scanner in `npm run verify`, so it runs in CI. Two rules: a non-`'use client'`
  module may not (1) import a non-component binding from a `'use client'`
  module, nor (2) pass a function literal as a prop to a client component. It
  caught five fresh violations of rule 1 during this very build.
  **A "component" is PascalCase WITHOUT underscores** — `RIDER_VIEW_COOKIE`
  starts with a capital and a laxer test would have missed it.
- `tests/integration/smoke/` + `npm run test:smoke` — opt-in
  (`SMOKE_TEST_ENABLED=1 SMOKE_BASE_URL=…`), READ-ONLY, requests every page as
  every role and fails on 5xx, on the `error.tsx` marker, or on landing at
  `/login` (a rejected session would otherwise let every route "pass").
  Routes are DISCOVERED from `app/**/page.tsx`, never listed, so a new page is
  covered the day it is created. Sessions are minted without passwords: an
  admin-generated OTP for the email roles (`generateLink` does NOT send mail),
  and the app's own `/api/auth/rider-login` for riders.
  **RIDER PAGES ARE NOT COVERED** unless `SMOKE_RIDER_PHONE` +
  `SMOKE_RIDER_PIN` are set — a PIN is unrecoverable by design, so there is no
  way to mint a rider session without one. 52 owner+accountant pages pass.

**The six requests.**
1. **Owner notifications, at last.** `notifyOwner()` had been writing since
   Phase 8 from 8 call sites and **nothing ever displayed them — the backlog
   was 884 unread**. New `/owner/notifications` and `/accountant/notifications`
   (the rider page now shares one component with a `labels` prop), an unread
   bell in the back-office header on every page, and an unread panel at the top
   of the owner dashboard. `unreadCount()` was also counting a `.limit(100)`
   page and returning its length, so it could never report more than 100.
2. **Requisition PDF** (`lib/requisitions/pdf.tsx`,
   `/api/requisitions/[id]/pdf`), modelled on the client's reference document —
   grey section bars, one ruled item table, an approvals table — in Ng'umbi
   green rather than the reference's blue. Downloadable **at any stage** by
   owner and accountant, and the stage is printed on its face, with an explicit
   "NOT an authorisation to purchase" line on anything unapproved. Amounts are
   recomputed from the lines by the same pure functions the screen uses, so a
   printed total can never disagree with the approved one.
   ⚠ **Known limitation:** `@react-pdf/renderer` 4.5.1 renders NOTHING for an
   absolutely-positioned footer (three variants tried) and produces no output
   for `<Text render={…} />`, so the footer is in normal flow and there is no
   "Page X of Y".
3. **Transactions grouped by outcome** (`lib/payments/grouping.ts`, pure +
   tested) on both `/owner/payments/transactions` and the accountant's.
   Successful money first, then the reasons money did not arrive. Empty groups
   are omitted; no payment is ever dropped.
4. **Requisition payment stage** (migration `0029`): approved → **unpaid /
   processing / paid**, shown as a column in the list, a badge on the detail
   page and a line in the PDF. The accountant is notified in-app and by SMS
   (queued; Mobishastra delivers once the credentials are paid for).
   `requisitions.pay` is a NEW permission the accountant does not hold —
   approving a purchase and paying for it are different acts.
   **This is not ledger money**: it creates no payment, obligation, allocation
   or receipt, and no report may treat it as collections.
5. **Add to home screen** (`components/pwa/InstallPrompt.tsx`) in both shells.
   The manifest was already installable; nobody was ever told. Captures
   `beforeinstallprompt` on Android/Chrome and replays it from a real button;
   iOS gets the Share → Add to Home Screen instruction instead, because it has
   no programmatic install and a button that cannot work is worse. Written with
   `useSyncExternalStore` — the React Compiler rejects setState-in-effect.
6. **Daily reconciliation was ALREADY DONE.** `vercel.json` has one cron at
   `0 21 * * *` (midnight EAT) hitting `/api/cron/daily`, which runs all 8
   tasks serially including `reconcile-pending`. Verified live: every task
   succeeded on 2026-09-05 and 09-04; 438 runs recorded. Nothing was built.

Verified: **454 unit tests** (+40), typecheck ✅, lint ✅, `npm run build` ✅,
52-page smoke run ✅. 0029 applied live after a rollback-only dry run with a
negative control; types regenerated and diffed against the live schema.

**🆕 RIDER EDIT + DELETE, AND TWO LIVE DATA FIXES (2026-09-05, no migration).**
The owner can now correct a rider's details (`/owner/riders/[id]/edit`, linked
from the rider page and the riders table) and delete a rider outright.

- **Changing a rider's phone RESETS THEIR PIN, by necessity.** The Supabase
  password is `HMAC(pepper, canonical_phone + ':' + pin)`, so the number is
  part of the credential — a new number makes the old PIN derive a different
  password. The raw PIN is unrecoverable by design, so `updateRider` issues a
  fresh temp PIN, forces a change at next login and shows it once. The form
  warns BEFORE saving. If the auth update fails, the rider row's phone is
  rolled back so record and login never disagree.
- **Delete is two-step and refuses settled money.** The first click reports
  what would be destroyed (contracts, payment days, payments, assignments);
  only the second deletes. A rider with any completed payment or receipt
  CANNOT be deleted (rule 6) — the UI explains this and points at
  deactivation. Deletion order mirrors `scripts/demo-cleanup.ts`.
- Identity numbers are written only when actually typed, so a blank licence
  box cannot erase one on file.

**Live data fixed the same day (owner-approved):**
- **ALFREDY MSANGI (NGR-R-0020)** could not pay because his only contract
  `NGR-C-0012` was activated on 18/08 at 13:25 and **terminated 3 minutes
  later at 13:28** — `getRiderPayView` requires an `active` contract, so the
  rider app showed him no Lipa Sasa at all while he still owed 20,000.
  Reactivated (the 0026 reactivation path, replicated in SQL + audited):
  status `active`, 20 cancelled weeks restored, due/overdue re-swept →
  **4 overdue (40,000) + 18 scheduled (180,000)**. He can pay again.
- **All 4 demo riders DELETED** via `npm run demo:cleanup` (Juma, Neema,
  Baraka, Rehema "Mtihani" + their 4 DEMOCHS motorcycles, contract, 31
  obligations, demo payment + receipt). Verified: 0 demo rows, **0 orphans**,
  12 real riders remain. The live register is now real riders only.

**🆕 PURCHASE REQUISITIONS (2026-09-05, migration `0028`, APPLIED LIVE; D-036).**
The accountant can now ask the Managing Director to approve a purchase —
new motorcycles, spare parts, fuel, phones, anything. Modelled on the client's
reference form and on the 0026 cash-approval workflow: the accountant PREPARES,
the Director DECIDES.

- **Flow.** `/accountant/requisitions` → **New request** (`…/new`): request
  number (auto `REQ/2026/09/0030`), date, title, description, department,
  fiscal year, currency (TZS), payment information, then **request items**
  (description · category · qty · UOM · unit price · amount · budget cover)
  with a live total, **supporting documents** (≤10, PDF/JPG/PNG/WebP, 4 MiB
  each), and the **Managing Director** to approve. **Save as draft** or
  **Submit request**. The Director's queue is `/owner/requisitions`, where they
  Approve (with an optional note) or Reject (reason required); the accountant
  is notified either way and can withdraw a request while it is undecided.
- **Separation of duties is in the permission matrix.** The accountant holds
  `requisitions.write` and NOT `requisitions.decide`, so they can never approve
  their own request. `requisitions.read` is staff-only; riders hold neither.
- **Not ledger money.** A requisition authorises a purchase — it never creates
  a payment, obligation or allocation, and touches none of the money tables.
- **Nothing derived is stored.** Line amount = qty × unit price, total = sum of
  lines, both computed on read (`lib/requisitions/compute.ts`). No total column
  exists, so an approved figure cannot drift from its lines (D-034 rule 3).
- **A decided request is frozen in the DB.** 0028 triggers refuse to update an
  approved/rejected/cancelled requisition, to delete anything past draft, or to
  add/change lines and documents unless the parent is still a draft.
- Verified live: 3 tables + enum + private `requisition-documents` bucket, RLS
  on all three, staff-read policies, **zero write grants to anon/authenticated**
  (service role only), and a **rollback-only dry run** that priced a 2-line
  request at 16,450,000 TZS and had **all 3 immutability guards fire**, with a
  negative control proving the assertions actually ran. Types regenerated and
  diffed against the live schema.

Verified: **398 unit tests** (+22), typecheck ✅, lint ✅, `npm run build` ✅.
See `Docs/SAAS_PLAN.md` §19 for the transferable lessons and D-036 — chiefly
that approval is now a **reusable primitive** (this is the second instance
after 0026's cash confirmation) and that shared surfaces such as dashboards
must degrade when a feature's schema is not provisioned yet, while the
feature's own pages still fail loudly.

**🆕 CLIENT-FEEDBACK BUILD #2 (2026-09-05, migrations `0026`+`0027`, APPLIED
LIVE; D-035).** Nine more client-requested changes. Types regenerated from the
live schema. Verified live: 2 new tables, 12 new columns, 5 new policies, the
activation function carries the obligation `kind` with all 0018/0025 guards
intact, and a **rollback-only dry run settled a phone-loan obligation**
end-to-end (paid + receipt + one allocation, with a negative control proving
the assertions ran). ⚠ **Deploy to Vercel is the remaining step.** Headlines:

- **Cash needs the Director's decision.** An accountant recording cash now
  raises a `cash_payment_requests` row; NOTHING touches `payments` until the
  owner confirms it at `/owner/payments/approvals`, where they can also edit
  (which days it covers → which recomputes the amount) or reject with a reason.
  Confirmation creates the payment, settles through the same
  `record_completed_payment`, and notifies the rider in-app + by SMS (queued;
  delivers when Mobishastra creds land). `payments.received_by` records WHO
  took the money, separately from who typed it in.
- **Payments is a rider directory, not a list** (`/owner/payments`,
  `/accountant/payments`) reusing the tested `lib/riders/directory.ts` helpers.
  Per-rider drill-down at `…/payments/rider/[id]`: full payment history (date,
  method, cash receiver, receipt, days covered) plus a **bank-style statement**
  with a running balance and a date range. Riders get their own at
  `/rider/statement`. Flat ledger moved to `…/payments/transactions`.
- **Green / red everywhere.** `lib/contracts/completion.ts` derives
  outstanding-now (GREEN) and remaining-to-finish-the-contract (RED) from the
  ledger — never stored (D-034 rule 3). The dashboard shows them as one
  **stacked bar per rider**, and the date/time now ticks live top-right.
- **Expected completion date** from the payments actually made, rendered
  "Monday, 25 June 2030" (`formatLongDate`). Refuses to print a date rather
  than extrapolating an absurd one.
- **Stuck pending payments fixed.** A `pending` the provider never resolved
  used to block EVERY later attempt forever (one rider was locked out for a
  month after mistyping their number). The initiate route now reconciles with
  the provider and expires a stale attempt; the reconcile cron abandons
  pendings older than 6h.
- **Phone loans** (`lib/loans/phone.ts`, `phone_loans`): principal + 50% flat
  interest over ≤3 months, collected BEFORE the lease starts. Implemented as
  ordinary obligations with `kind='phone_loan'`, so settlement, receipts and
  oldest-first allocation all work unchanged. `/apply` now asks "motorcycle
  only, or motorcycle + phone?" and the builder surfaces the answer.
- **Contracts are editable** (`/owner/contracts/[id]/edit`) — motorcycle,
  ownership, special terms and deadline always; term/schedule/price only before
  activation (after it the obligations ARE the money record). A terminated or
  completed contract can be **reactivated**, which also restores the obligations
  termination cancelled and optionally extends the term.
- **Weekly = daily × 7, monthly = daily × 30** (`lib/contracts/pricing.ts`):
  the owner enters ONE daily rate. Custom weekdays extend the term until every
  payment day has fallen (`lib/obligations/payment-days.ts`); a term can also be
  denominated directly in payment days.
- **`lib/contracts/term.ts` is the single term resolver** the builder preview
  and the server both call, so the preview can never disagree with what is saved.
- **General financial report** (bank-statement style) on both report pages:
  total collected for a month/range, every transaction, and what each rider
  contributed — with CSV/XLSX export.

Verified: **376 unit tests** (+68), typecheck ✅, lint ✅, `npm run build` ✅.

**🆕 CLIENT-FEEDBACK BUILD (2026-07-29, migrations `0024`+`0025`, applied live;
D-034).** Nine client-requested changes shipped together. Headlines:

- **Accountant role (#10 / spec #4)** — a real permission model at last.
  `lib/auth/roles.ts` (pure, tested) + `requirePermission()`/`checkPermission()`
  in every action + **RLS** (`is_accountant()`, `is_staff()`, SELECT-only
  policies on 14 financial tables, nothing on private data/guarantors/
  applications/payment_events/audit/imports). Owner manages accounts at
  `/owner/staff`; accountant area at `/accountant/*`. `profiles.is_active` is
  checked *inside* `is_accountant()`, so deactivation bites on the next QUERY,
  not the next login. **Verified live: 31/31 RBAC probe checks** (can read the
  12 finance tables, blocked on the 9 sensitive ones, cannot self-promote,
  cannot INSERT into `payments`, deactivation revokes instantly).
- **Bulk payment plans (#1)** — `lib/obligations/plan.ts` generates a whole
  schedule from start+end+amount+frequency (daily/weekly/monthly/custom);
  rows are individually excludable/re-datable/re-priceable; stored as
  `contracts.payment_plan` jsonb and replayed verbatim at activation.
  `activate_contract_and_generate_obligations` gained per-row amounts
  (`coalesce(nullif(o->>'amount','')::int, installment_amount)`) — **every 0018
  guard preserved verbatim**; proved by a rollback-only dry run (5-day plan,
  1 day excluded, 1 amount edited → 4 obligations, 55,000 total, then rolled
  back).
- **Flexible durations (#9)** — `lib/contracts/duration.ts`: years/months/
  weeks/days in any combination, or an exact end date that wins. Calendar
  months (never 30-day blocks), leap-safe. `duration_months` is now the MONTHS
  COMPONENT, not the whole term.
- **Automatic contract completion (#8)** — nightly `contractCompletionTask`
  (in `DAILY_TASKS`, right after the status sweep) moves `active → completed`
  once the end date passes; **"Contract Ended — Outstanding Balance" is
  DERIVED** from the ledger (`lib/contracts/status.ts`), never stored, so it
  can't go stale. Backfill in 0025 completed Daud's `NGR-C-0011` (ended
  30/06/2026, 0 outstanding) — exactly the case the client reported.
- **Rider directory (#2)** — search (name/phone/rider code/motorcycle reg/
  contract number; phone matched on the national significant number so
  `0712…`, `+255712…` and `712…` all hit), 8 sorts, 7 quick filters + region/
  district/motorcycle/date-range, card+table views with the preference in a
  COOKIE (read server-side — no effect, no hydration flash), 25/page.
- **Rider profile + pictures (#3)** — one `getRiderProfile()` shape rendered
  for owner/accountant/rider; photos in the PRIVATE `rider-documents` bucket
  behind signed URLs, magic-byte validated (WebP added to the sniffer),
  owner-only writes, rider sees only their own (`/rider/profile`).
- **Dates (#5)** — `lib/dates/format.ts` is the single utility; **DD/MM/YYYY**
  everywhere. Calendar dates are split textually (never tz-converted, which
  would shift them a day); instants render in EAT.
- **Geo (#6)** — all **31 regions** (26 mainland + **5 Zanzibar**, previously
  absent entirely) + 11 missing mainland districts. Existing spellings frozen
  (`Nyang'wale`, `Arumeru`, `Hanang'`, `Kibiti`) — rows store names as text, so
  a rename orphans them.
- **Location inheritance (#7)** — the real bug was that `ManualRiderForm` never
  had dropdowns (free text). New shared `RegionDistrictFields` + server-side
  `isDistrictOfRegion` validation; picking a motorcycle fills the rider's
  region/district, and `riders.location_source` records provenance so a hand
  edit is never overwritten.

Verified: **308 unit tests** (+93), typecheck ✅, lint ✅, `npm run build` ✅.
See `Docs/SAAS_PLAN.md` §18 for the transferable lessons and D-034.

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

app/accountant/      gated accountant area (spec #10) — dashboard, reports,
                     payments (+record), outstanding, riders, motorcycles,
                     contracts, notes
app/owner/staff/     owner-only accountant account management
app/accountant/requisitions/  purchase requests (raise, edit draft, submit)
app/owner/requisitions/       Managing Director's approve / reject / mark-paid queue
app/owner/notifications/ app/accountant/notifications/  staff inboxes (2026-09-06)
app/api/requisitions/[id]/pdf  printable requisition, any stage

lib/env.ts           validated env (public vs server-only)
lib/supabase/        client (browser) · server (SSR) · admin (service role, server-only) · proxy · types
lib/auth/            phone (E.164) · pin (validation) · pin-derive (HMAC, server-only) ·
                     lockout (pure) · rate-limit (server-only) · session ·
                     provision (Admin API) · roles (permission matrix, pure)
lib/staff/           accountant account create/activate/deactivate/reset (owner-only)
lib/notes/           internal financial notes (append-only)
lib/requisitions/    constants · compute (pure totals + status/payment machine) ·
                     numbering (REQ/YYYY/MM/NNNN) · validation · actions · queries ·
                     pdf (printable request, any stage)
lib/dev/             rsc-boundary (client/server boundary scanner) · routes
                     (smoke-test route discovery) — build-quality tooling, not app code
lib/notifications/   service · queries · actions · labels (sw/en, plain module)
lib/payments/        …· grouping (transaction outcome groups, pure)
lib/pwa/             install-labels (sw/en, plain module)
lib/contracts/       actions · queries · validation · pdf · duration (#9) · status (#8)
lib/obligations/     schedule (cadence engine) · plan (bulk generator, #1) · transitions
lib/riders/          actions · queries · validation · numbering · directory (#2, pure) ·
                     profile (#3) · photo + photo-constants
lib/dates/           tz (timezone primitives) · format (DD/MM/YYYY, the shared utility)
lib/security/        request (client IP)     lib/audit/  audit writer
lib/money/ dates/ i18n/ validation/          domain utilities

supabase/migrations/ 0001..0028 + seed.sql    supabase/config.toml
scripts/seed.ts      owner + demo rider seeding
tests/unit/          phone, pin, lockout, money, rsc-boundary, dev-routes,
                     payment-grouping, requisition-payment-stage
tests/integration/rls/   isolation suite (opt-in via RLS_TEST_ENABLED)
tests/integration/smoke/ every page as every role (opt-in via SMOKE_TEST_ENABLED)
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
12. **Every privileged action calls `requirePermission()`/`checkPermission()`**
    (`lib/auth/roles.ts`) — hiding a button is not access control. RLS stays
    decisive; a new role ships with a live RBAC probe or it is an assumption.
13. **If a status can be computed from the ledger, compute it** (D-034). Only
    persist state a human chose. Derived money state cannot go stale.
14. **`npm run build` is part of the done-gate, not just `npm run verify`** —
    `'use server'` files may export only async functions, and that (like the
    `proxyConfig` matcher before it) is caught at build time alone.
15. Reference data encoded into identifiers (geo codes) is **append-only**;
    never rename a region/district that live rows store as text.
16. **Only COMPONENTS cross the client/server boundary.** A `'use client'`
    module's exports are client references on the server, so a server module
    may never import a helper, hook or constant from one, and never pass a
    FUNCTION as a prop to a client component. Shared values live in `lib/`;
    pass strings and ids, not callbacks. Enforced by
    `tests/unit/rsc-boundary.test.ts` in `npm run verify` — three production
    outages came from breaking this (2026-09-06).
17. **A page that renders in `npm run build` has not been tested.** Build never
    executes a dynamic page and vitest is node-only, so before a release run
    `npm run test:smoke` against a live server. That is the only gate that
    actually requests the pages.

---

## 6. Commands

```bash
npm run dev            # local dev (http://localhost:3000)
npm run verify         # typecheck + lint + test  (run before committing)
npm run build          # production build
npm run test:rls       # RLS isolation (needs RLS_TEST_ENABLED=1 + live DB)
npm run test:smoke     # every page as every role; needs a RUNNING server:
                       #   SMOKE_TEST_ENABLED=1 SMOKE_BASE_URL=http://localhost:3000
                       #   (+ SMOKE_RIDER_PHONE / SMOKE_RIDER_PIN for rider pages)
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
- **Application/contract numbers use count(*)+1** with unique-constraint
  retries — replace with DB sequences if concurrent creation ever matters.
  (Rider numbers are **max-based** since 2026-07-20 — `lib/riders/numbering.ts`;
  count(*)+1 collided forever after the demo-rider deletion left the count 4
  behind the issued sequence, surfacing as a bogus "phone already exists" on
  every rider creation. Applications/contracts are never deleted, so their
  count-based numbering doesn't have that failure mode.)
- **`incident_reports`/`rider_applications` free-text fields** have no length
  caps; announcements likewise.
- Owner file uploads (physical contract copy, drawn signature) skip magic-byte
  sniffing — owner-only surface, but inconsistent with the public endpoint.
