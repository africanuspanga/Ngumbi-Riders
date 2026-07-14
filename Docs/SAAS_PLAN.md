# SAAS_PLAN — Turning Ng'umbi Riders into a Multi-Tenant SaaS

> **Status: PLAN ONLY — nothing here is built.** The product today is
> deliberately single-business (spec §1, CLAUDE.md §1). This document is the
> detailed blueprint for converting it into a subscription SaaS ("fleet
> lease-management for African motorcycle/bajaji fleets") if and when more
> businesses want it. It is written so a future team can execute it phase by
> phase without re-deriving the architecture.
>
> **Reviewed & extended 2026-07-12:** the §2 inventory was re-verified against
> the codebase (all original claims accurate; item 6 corrected — application
> numbers already use a per-year DB sequence). Items 18–25 (missed
> assumptions), per-org encryption, PDPA data residency, tax, staff
> invitations, billing tables and §15 were added.

---

## 0. Executive summary

The codebase is unusually well positioned for SaaS conversion because the
things that are hardest to retrofit are already right: RLS is the decisive
authorization boundary, money is transactional/idempotent behind SECURITY
DEFINER functions, business math is pure and tested, and secrets are
server-only. The conversion is therefore mostly *mechanical but broad*:
introduce an `organizations` (tenant) table, stamp `org_id` on every business
row, rewrite the RLS matrix from "owner vs rider" to "member-of-org vs
rider-of-org", scope payments/webhooks/crons/storage per tenant, and add
signup, billing and a platform-admin console around it.

**Recommended architecture: single shared Postgres database, shared schema,
`org_id` column + RLS tenant isolation** (the standard Supabase multi-tenant
pattern). Schema-per-tenant and database-per-tenant are rejected below (§3).

**Estimated effort to first paying external tenant: ~10–14 engineer-weeks**
across 7 phases (S0–S6), each shippable and reversible. Ng'umbi Riders itself
becomes tenant #1 with zero downtime via a backfill migration. (Raised from
the original 8–12 after the 2026-07-12 re-audit: per-org PWA/branding surface,
per-org envelope encryption, and the PDPA/tax workstreams were underscoped.)

---

## 1. What "SaaS" means for this product

- A fleet owner (a *business*, e.g. a boda-boda leasing company) signs up,
  pays a subscription, and gets an isolated workspace: their motorcycles,
  riders, contracts, payments, reports.
- Riders belong to exactly one fleet workspace and see only their own data
  (same as today).
- The platform operator (us) has a super-admin console: tenants, plans,
  usage, health, support impersonation (audited).
- Per-tenant: branding (name/logo/colors), payment provider credentials,
  locale defaults, business settings (grace days, due time, currencies later).

Non-goals (v1 of the SaaS): white-label custom domains, multi-currency,
cross-tenant analytics products, marketplace features, offline-first sync.

## 2. Inventory — every single-tenant assumption that must change

This list was compiled by auditing the actual code and **re-verified against
the codebase on 2026-07-12** (items 18–25 were found in that second audit); it
is the checklist for S1.

| # | Assumption today | Where | Change |
|---|---|---|---|
| 1 | `app_settings` is a singleton row | `0003_identity.sql`, `lib/system` | becomes per-org `organization_settings` |
| 2 | `is_owner()` = "profile.role = 'owner'" globally | `0002_helpers.sql`, every policy | `is_org_admin(org_id)` via `organization_members` |
| 3 | One owner account, seeded | `scripts/seed.ts` | signup flow creates org + first admin |
| 4 | Rider phone is globally unique | `riders`, Supabase auth users | phone unique **per org**; auth identity strategy in §5 |
| 5 | Receipt numbers global sequence `NGR-RCPT-YYYY-NNNNNN` | 0017/0018 | per-org sequence + org prefix (e.g. `ACME-RCPT-…`) |
| 6 | Contract (`NGR-C-`) and rider (`NGR-R-`) numbers are count(*)+1; application numbers (`NGR-APP-YYYY-`) already use a per-year DB sequence | `lib/contracts/actions.ts`, `lib/riders/actions.ts`, `lib/applications/reference.ts` | per-org DB sequences everywhere (fixes the count(*)+1 race too); the application-sequence pattern is the template |
| 7 | ONE Snippe key + ONE webhook secret in env | `lib/env.ts`, `lib/snippe` | per-org encrypted credentials + per-org webhook routing (§6) |
| 8 | Resend + OWNER_SUMMARY_EMAIL single recipient | `lib/resend`, tasks | per-org notification settings |
| 9 | Crons iterate ALL riders/payments | `lib/jobs/tasks.ts` | fan out per org (and move off Hobby — §8) |
| 10 | Storage paths `applicationId/...` with owner-only policy | `0011_storage.sql` | prefix every path with `org_id/`, policies check membership |
| 11 | Branding hardcoded (logo, "Ng'umbi Riders", colors) | layout/login/PDF/emails | per-org branding table + theme tokens |
| 12 | `/apply` is THE application form | `app/(public)/apply` | per-org form at `/{orgSlug}/apply` (or subdomain) — **preserve the signature carry-over fix below** |
| 13 | Owner dashboards/KPIs query whole tables | `lib/dashboard`, `lib/reports` | all queries gain org scope (RLS enforces; queries add explicit filter for perf) |
| 14 | Audit log actor roles owner/rider/system | `lib/audit` | + org_id, + `platform_admin` actor |
| 15 | RLS test suite: 2 riders, 1 owner | `tests/integration/rls` | matrix grows: cross-ORG isolation is the new critical axis |
| 16 | PDF contracts embed the business identity | `lib/contracts/pdf` | render from org branding + org legal fields |
| 17 | Rate limits keyed by IP/phone globally | `lib/security/rate-limit`, `lib/auth/rate-limit` | + per-org quotas (abuse and plan enforcement) |
| 18 | PWA identity hardcoded: manifest `name`/`short_name`, SW cache key `ngr-shell-v1`, push notification title, `/icons/logo.png` | `app/manifest.ts`, `public/sw.js` | dynamic per-org manifest route; org-branded push payloads; SW stays platform-generic (§7) |
| 19 | `notifyOwner()` notifies EVERY profile with `role='owner'` — assumes exactly one owner in the system | `lib/notifications/service.ts` | notify org staff via `organization_members` (admin/manager roles) |
| 20 | `daily_summaries.summary_date` is globally unique; summary email subject/template hardcode the brand + colors | `0008_operations.sql`, `lib/resend/summary.ts`, `lib/jobs/tasks.ts` | `unique(org_id, summary_date)`; per-org recipient list + branding |
| 21 | `push_subscriptions` has `unique(endpoint)` and no org column | `0008_operations.sql` | + org_id, composite unique; fixing this also closes the endpoint-replay follow-up (CLAUDE.md §7) |
| 22 | `audit_logs`, `system_job_runs`, `login_attempts`, `rate_limit_events` have no org column | `0009_platform.sql` | + `org_id` (nullable — platform-level events keep it null) |
| 23 | /apply upload token is HMAC'd with `AUTH_PIN_PEPPER` and scoped to applicationId only (not org-bound) | `lib/applications/upload-token.ts` | dedicated signing secret; org_id joins the token scope |
| 24 | One global `PII_ENCRYPTION_KEY` encrypts every tenant's PII directly | `lib/security/crypto.ts` | per-org data keys under envelope encryption — enables per-tenant crypto-shredding at offboarding (§10) |
| 25 | ~17 more hardcoded brand sites: root metadata title/template, i18n `appName` in both catalogs, login placeholder (`owner@ngumbi.co.tz` + a real phone), Snippe payer fallbacks (`'Ngumbi'`, `noreply@ngumbi.co.tz`), contract PDF title, VAPID subject fallback (`mailto:owner@ngumbi.co.tz`) | `app/layout.tsx`, `messages/*.json`, `app/(auth)/login/LoginForm.tsx`, `lib/snippe/client.ts`, `lib/contracts/pdf.tsx`, `lib/push/webpush.ts` | all read from org branding/settings; add a CI grep gate at S0 so new hardcoded brand strings can't creep in |

> **Carry-over fix — do NOT regress when rebuilding `/apply` (item 12).** The
> application form's signature step had a validation-order bug (fixed 2026-07-14,
> commit `da33d0b`; the owner hit it live on step 8/9 — "value not correct" /
> "Thamani si sahihi"). The drawn signature lives in React state and the pad is a
> **`<canvas>`, not a registered react-hook-form field**, so three things must
> hold or the step becomes impossible to pass:
> 1. **Default the field to `''`** (`defaultValues.signature = ''`). If it is
>    validated while `undefined`, zod v4 emits `"Invalid input: expected string,
>    received undefined"` — a message that is NOT one of the `apply.errors.*` i18n
>    keys, so the UI silently falls back to the generic "invalid value" instead of
>    "signature required".
> 2. **Mirror the drawing into the form on draw** (`setValue('signature', …)` in
>    the pad's `onChange`), so validation and the final submit see the real value.
> 3. **Never `trigger()` the field before its value is set.** The original bug:
>    `STEP_FIELDS[7]` listed `signature`, so `next()` validated it *before* the
>    deferred `setValue` ran, then early-returned — the `setValue` was never
>    reached.
>
> Any per-org rewrite of the form, or reuse of `components/forms/SignaturePad`,
> must carry these three properties. Guarded by
> `tests/unit/application-resolver.test.ts` ("step 8 regression"). The same
> canvas-input pattern applies to the contract on-screen signature
> (`lib/contracts` / builder) — check it there too when porting.

> **Carry-over fix — rider payment flow (pilot-hardened 2026-07-14).** The
> `/rider/pay` flow accreted several must-not-regress rules while shaking out the
> live pilot with the owner. A per-org rewrite (`/{orgSlug}/…` routing, per-org
> Snippe) must preserve all of them:
> 1. **Pay from ANY number.** The payer-phone box defaults to the rider's number
>    but is fully editable — a rider may pay from a friend's/relative's line. The
>    initiate route accepts any valid phone; it never forces the rider's
>    registered number. (commits `f8abb8e`, `9e83ac2`)
> 2. **Always land on amount + number selection, never the push screen.** A
>    leftover `pending`/`created` attempt must NOT auto-open the "Inasubiri
>    uthibitisho…" waiting screen — to the owner it looked like Lipa Sasa fired a
>    payment on a locked number. If a stale pending blocks a fresh payment, clear
>    it automatically (`cancelCurrentPendingPayment`) and retry once — no manual
>    cancel step. (commit `a81e4e4`)
> 3. **Confirm the number before the USSD request goes out.** Tapping pay opens a
>    "Je, hii ndiyo namba unayotaka kulipia?" step; the request is sent only after
>    the rider confirms. (commit `9e83ac2`)
> 4. **Completion must not hang on the webhook** — the status poll reconciles
>    with the provider directly (see §6). (commit `d018399`)
> 5. Nice-to-have kept intentionally dependency-free for low-cost Android: a
>    payment-received celebration (`components/rider/Confetti.tsx`) on completion.
>    (commit `d3b07d4`)

> **Carry-over fix — contract builder must offer an already-assigned bike (2026-07-14,
> commit `4893ec4`).** Assigning a motorcycle to a rider (standalone "Assign
> motorcycle") flips it to `status='assigned'`, and the builder listed only
> `available` bikes — so assigning first made that rider's contract impossible to
> create (empty select → zod's raw "Invalid UUID"). The builder must offer bikes
> that are `available` OR assigned to the rider being contracted (and not under a
> live contract); `createContract` re-checks this server-side. In the SaaS this
> is org-scoped: only offer bikes of the caller's org. See §2 item 12.

## 3. Tenancy model decision

**Chosen: shared database, shared schema, `org_id uuid not null` on every
business table, enforced by RLS.**

Why not the alternatives:
- **Schema-per-tenant**: Supabase tooling (PostgREST, generated types,
  migrations, dashboard) is built around one schema; N-schema migration fanout
  becomes the whole job. Poor fit.
- **Database/project-per-tenant**: perfect isolation but linear cost per
  tenant (each Supabase project is billed), no cross-tenant admin queries,
  N× migration/ops overhead. Only justified for a future "enterprise dedicated"
  tier.
- Shared-schema RLS is the pattern this codebase already lives by; the RLS
  isolation suite gives us regression-tested proof of isolation.

Hard rules for the shared model:
- `org_id` is `not null`, has an FK to `organizations`, and appears in a
  **composite index with every hot filter** (e.g. `(org_id, due_date)`).
- Every RLS policy starts from org membership; there are no "global" policies
  on business tables.
- Uniques become composite: `unique(org_id, phone)`, `unique(org_id,
  registration_number)`, `unique(org_id, contract_id, due_date)` etc.
- SECURITY DEFINER money functions re-verify that *every row they touch shares
  the caller's org* (extend the D-031 self-defense to org identity).
- **RLS performance is a hard rule, not an optimization**: policy helper calls
  are wrapped as `(select public.is_org_staff(org_id, …))` so Postgres caches
  them once per statement (initplan), helpers are `stable`, and
  `organization_members` carries a covering index on
  `(profile_id, org_id, role)` — the policy layer sits on every query's hot
  path once there are N tenants.

## 4. Target data model (delta)

New tables:

```sql
organizations (
  id uuid pk, slug citext unique, name text, status org_status,       -- active|suspended|churned
  plan_id text, billing_customer_id text, trial_ends_at timestamptz,
  branding jsonb, locale_default text, timezone text default 'Africa/Dar_es_Salaam',
  created_at, updated_at
)
organization_members (
  org_id fk, profile_id fk, role org_role,                            -- admin|manager|viewer
  unique(org_id, profile_id)
)
organization_settings (org_id pk/fk, …everything from app_settings…)
organization_payment_providers (
  org_id fk, provider text ('snippe'…), api_key_encrypted text,
  webhook_secret_encrypted text, status, unique(org_id, provider)
)
organization_invitations (
  id uuid pk, org_id fk, email citext, role org_role, token_hash text,
  invited_by fk, expires_at timestamptz, accepted_at timestamptz,
  unique(org_id, email)                                                -- staff onboarding (§7)
)
plans (id text pk, name, monthly_price_tzs int, max_riders int,
       max_motorcycles int, features jsonb)
subscriptions (org_id fk, plan_id fk, status, current_period_end, provider refs…)
billing_invoices (
  id uuid pk, org_id fk, period_start, period_end, amount_tzs int,
  vat_tzs int, status, issued_at, paid_at, external_ref text           -- manual invoicing v1 (§9); numbering TRA-compatible
)
platform_admins (profile_id pk)                                        -- us; MFA required (§10)
usage_counters (org_id, metric, period, value)                         -- plan enforcement
org_encryption_keys (org_id pk/fk, wrapped_dek bytea, created_at,
                     destroyed_at timestamptz)                         -- envelope encryption (§10)
```

Changed: **every business table** gains `org_id uuid not null references
organizations(id)`; `profiles.role` gains `platform_admin`; riders keep
`role='rider'` but gain org scoping through `riders.org_id`. The **infra
tables gain org_id too** (`audit_logs`, `system_job_runs`, `login_attempts`,
`rate_limit_events`, `push_subscriptions`, `daily_summaries` — nullable where
platform-level rows exist, e.g. a platform-admin audit event or a global job
run).

Helper functions replacing today's:

```sql
current_org_ids()      -- orgs the JWT's profile belongs to (staff) — SECURITY DEFINER
is_org_staff(org uuid, min_role org_role)   -- admin ≥ manager ≥ viewer
current_rider_org()    -- the org of the rider bound to auth.uid()
```

Policy shape (replaces owner-all/rider-own):

```sql
create policy t_staff_all on public.<table>
  for all to authenticated
  using (public.is_org_staff(org_id, 'viewer'))
  with check (public.is_org_staff(org_id, 'manager'));
create policy t_rider_own on public.<table>
  for select to authenticated
  using (org_id = public.current_rider_org() and rider_id = public.current_rider_id());
```

Write-locks from 0016/0018 (money tables, column grants) carry over unchanged —
they are orthogonal to tenancy.

## 5. Identity & auth strategy

**Staff** (fleet admins/managers): email+password (existing owner flow),
membership rows decide org access; a staff user MAY belong to several orgs
(consultants) — the UI gets an org switcher; the active org travels in a
server-verified cookie, *never* trusted from the client for authorization
(RLS uses membership, not the cookie).

**Riders**: keep phone+PIN with the HMAC derivation — it's the product's
superpower for low-literacy users. Two options for the global-uniqueness
problem (Supabase auth phone identities are global):

- **Option A (recommended): synthetic auth identities.** Stop using Supabase's
  phone provider for riders; create auth users with a synthetic email
  `r-{riderId}@riders.internal` and password = existing HMAC derivation keyed
  by `(org_id, phone, pin)`. Rider login route resolves `(org, phone) → riderId`
  first (org comes from the login URL's slug / rider's saved org), then signs
  in. Same UX, no global phone collision, no SMS dependency (we already run
  with SMS off, D-008).
- Option B: keep global phone identities and forbid the same phone in two
  orgs. Simpler, but blocks a real scenario (rider switches fleets, or two
  fleets in one family share a phone) and couples tenants. Rejected.

PIN pepper, lockout, weak-PIN rules, temp-PIN flows are unchanged (add org_id
to `login_attempts` keys).

**Migration window (S2):** rider auth users are migrated in place, batched;
during the cutover the rider-login route accepts BOTH the legacy phone
identity and the new synthetic identity behind a feature flag, so a failed or
partial batch never locks riders out. The dual-acceptance flag is removed only
after the RLS/auth suite passes against the fully migrated identities.

**Staff account flows** (new — today the one owner is seeded): invitation
acceptance (from `organization_invitations`, token-hashed, expiring), email
verification, and password reset all ride Supabase's standard email auth.
Riders deliberately do NOT get self-service reset — the owner-mediated
temp-PIN flow is the right trust model for this user base and stays.

## 6. Payments & webhooks per tenant

- Each org connects its **own Snippe account** (API key + webhook secret,
  AES-256-GCM encrypted at rest under the org's DEK — the §10 envelope
  scheme — decrypted server-side only). The platform never pools client money — money flows
  directly fleet↔rider through the fleet's own provider account. This keeps us
  out of money-transmitter territory (verify with counsel, §11).
- Webhook routing: one endpoint `/api/webhooks/snippe/[orgId]` (or the org id
  embedded in the metadata we already send). Signature is verified with THAT
  org's secret; the settlement function additionally asserts
  `payment.org_id = obligation.org_id = reservation.org_id`.
- **Verify credentials at connect time**: the onboarding step makes a live
  test call and asserts the key's scopes (`collection:read` +
  `collection:create`) before saving. This exact failure happened at Ng'umbi's
  go-live (403 AUTHZ_002, key missing `collection:read`) — it must surface in
  the connect wizard, not at a rider's first payment. Store the verified
  scopes + `last_verified_at`; the org settings page and `/admin` show a
  per-org credential/webhook health indicator, and a cron re-verifies weekly.
- **Completion must not depend solely on the webhook (pilot lesson,
  2026-07-14, commit `d018399`).** At Ng'umbi's go-live the Snippe completion
  webhook wasn't reaching production (public-URL / `SNIPPE_WEBHOOK_SECRET`
  misconfig on Vercel), so riders sat on "Inasubiri uthibitisho…" forever after
  entering their PIN — the money moved but the app never learned. The fix makes
  the rider's status poll ask the provider directly
  (`reconcilePaymentWithProvider` → the same atomic `record_completed_payment`),
  so a payment settles within one poll even if the webhook never lands; the
  reconcile cron is the slower backstop. **Per-org this matters MORE, not less**:
  per-org webhook routing + per-org secrets are more failure-prone than a single
  global endpoint, so keep the provider-poll (and the reconcile job) as the
  authoritative completion fallback for every tenant. The completion decision
  always comes from the provider, never the browser (spec rule 7). Also make the
  connect wizard's live test (above) verify the webhook URL is a public HTTPS
  origin — a `localhost`/empty `NEXT_PUBLIC_APP_URL` fallback silently poisons
  the callback (the initiate route now guards this with a `config_error`).
- Receipts: per-org sequence + prefix from org settings.
- Platform fees (optional, later): bill via subscription, not by skimming
  payment flows — far simpler legally and technically.

## 7. Product surface changes

- **Signup & onboarding wizard**: create org → choose plan/trial → business
  profile (name, logo, colors) → connect Snippe (or "cash-only mode" — works
  out of the box, mobile money can be connected later) → import
  motorcycles/riders (existing import wizard, now org-scoped) → invite staff.
- **Guided first-run onboarding & empty states (real pilot learning: a fresh
  account is confusing — users land in empty tables and don't know where to
  start or where things live).** The signup wizard sets the org up; this is the
  *day-2* problem of teaching a new fleet how to actually use the product. The
  SaaS needs, as a first-class surface (not an afterthought):
  - A **persistent step-by-step "getting started" checklist** on the dashboard
    that stays until complete and deep-links each step to the exact screen:
    e.g. **1.** add your first motorcycle → **2.** add or import riders → **3.**
    create & activate a contract → **4.** connect mobile money (or stay
    cash-only) → **5.** record/collect the first payment → **6.** invite your
    staff. Each item **self-checks from real data** (e.g. "≥1 activated
    contract"), never a manual flag, so it can't lie. Show a progress bar and a
    "what this means / why it matters" line per step.
  - **Designed empty states on every list** (motorcycles, riders, contracts,
    payments, expenses, reports, applications): a one-line plain-language
    explanation + a single primary CTA to the create/import action, instead of a
    blank table. This is where most of the confusion is today.
  - An optional, dismissible **first-run tour** that points out where the main
    areas live (dashboard, riders, contracts, payments, reports, settings) — a
    lightweight highlight/coach-mark pass, not a modal wall.
  - Keep all of it **Swahili-first and low-literacy friendly** (short sentences,
    icons, examples with real TZS amounts) — the same bar as the rider UI.
  - The rider side gets the same treatment (a first-login "here's how you pay"
    explainer + empty-calendar guidance), since riders are even less likely to
    tolerate a confusing blank screen.
- **Routing**: path-based tenancy `/{orgSlug}/…` for the public application
  form and rider login; the authenticated apps stay at `/owner` (org from
  session) and `/rider`. Subdomains (`acme.fleetapp.tz`) are a later polish —
  the app already runs behind Vercel so wildcard domains are easy when wanted.
- **Platform admin console** (`/admin`, platform_admins only): tenant list,
  plan/subscription state, usage vs limits, job health per org, suspend org,
  impersonate-with-audit for support.
- **Branding**: org logo/name/colors applied to layouts, login pages, PDF
  contracts, receipts, emails. Keep it token-based (CSS variables already
  exist).
- **PWA per org**: `app/manifest.ts` becomes a dynamic per-org manifest
  (name/short_name/icons/theme from org branding; `start_url` carries the org
  slug) so a rider's installed app is *their fleet's* app. The service worker
  stays platform-generic — cache keys versioned per deploy, never per org —
  and push payloads carry org branding server-side.
- **Platform marketing site**: the current `(public)` landing page is
  Ng'umbi's; the SaaS needs its own marketing/pricing/signup surface at the
  root domain, with each tenant's public pages (apply, rider login) under
  `/{orgSlug}`. Ng'umbi's existing landing content becomes tenant #1's page.
- **i18n**: already sw/en; per-org default locale setting. The `appName`
  string moves out of the message catalogs into org branding — catalogs keep
  only product copy.

## 8. Jobs, scale & infrastructure

- Vercel **Hobby's one-daily-cron does not survive multi-tenancy**. Move to
  Pro: per-minute crons allowed; split the dispatcher into per-task crons
  again (the per-job routes still exist) and make every task iterate
  **per org** with bounded, org-scoped queries.
- At ~50+ orgs, move heavy fan-out (risk recompute, reconciliation) to a queue
  (Vercel Queues or Upstash QStash): cron enqueues `(task, org_id)` messages;
  a worker route processes them. `system_job_runs` gains `org_id`.
- Postgres: the shared-schema model with proper composite indexes comfortably
  handles hundreds of fleets × thousands of riders on a mid-tier Supabase
  instance; partitioning `payment_obligations` by org becomes worth evaluating
  around ~10M rows.
- **Supabase**: move to Pro with PITR before the first external tenant, and
  keep a permanent dedicated **staging project** — it is the target for the
  cross-org RLS CI gate (§10) and for rehearsing every S-phase migration
  before it touches production. (Region choice interacts with PDPA — §10.)
- Observability becomes mandatory before external tenants: Sentry (already a
  tracked follow-up), per-org error tagging, uptime checks on the webhook
  endpoint, alerting when an org's job run fails.

## 9. Billing & plans

- **Subscription billing, not payment-volume fees**, for v1. Tanzania reality:
  card penetration is low — support (a) Snippe/mobile-money collection of the
  subscription itself, (b) manual invoicing with platform-admin activation.
  Stripe/Paddle only if targeting fleets outside East Africa.
- Suggested plans (validate with real prospects):
  - **Starter** — ≤15 riders, cash-only mode, 1 staff seat.
  - **Standard** — ≤75 riders, mobile money, 3 seats, reports/exports.
  - **Fleet** — unlimited riders, seats, priority support.
  - 14-day trial, read-only grace period on non-payment (never lock an owner
    away from their financial records — export always works).
- Enforcement points: rider/motorcycle creation & import (hard limit), staff
  invites, feature flags in `plans.features` checked server-side.
- **Tax (get the accountant's ruling with the S4 pricing work)**: subscription
  invoices to Tanzanian businesses attract 18% VAT once the platform entity is
  VAT-registered, and TRA fiscal-receipt (EFD / e-invoicing) obligations apply
  to invoicing — design `billing_invoices` numbering and fields to be
  TRA-compatible from day one rather than retrofitting.
- **Lifecycle states** (drive both access and billing):
  `trialing → active → past_due (full access, dunning) → grace (read-only +
  export) → suspended (staff read-only, riders can still VIEW obligations but
  payments pause) → churned (export window, then §10 offboarding)`. Never
  strand rider money mid-flight: suspension blocks NEW payment initiation but
  in-flight payments settle normally.

## 10. Security & compliance deltas

- **Tenant isolation is the new crown jewel.** Extend the RLS suite to a
  cross-org matrix (org-A staff vs org-B data, org-A rider vs org-B rider,
  storage paths, DB functions, exports) and make it a CI gate against a
  staging project. The existing suite pattern (10 checks, live) scales to this.
- SECURITY DEFINER functions assert org consistency on every row (extend
  D-031's guards).
- Storage: every object key gains an `org_id/` prefix; policies check
  membership; signed URLs stay server-issued and short-lived. The /apply
  upload token gains org_id in its HMAC scope and its own signing secret
  (today it reuses `AUTH_PIN_PEPPER` — §2 item 23).
- **Data residency (PDPA cross-border — flagged as a blocker, not a nicety)**:
  the live Supabase project is in **Frankfurt (EU)**. Tanzania's PDPA (No. 11
  of 2022) and its 2023 regulations restrict cross-border transfer of personal
  data — hosting Tanzanian riders' NIDA numbers, licences and phone numbers in
  the EU for *other businesses' data* needs an explicit lawful basis (PDPC
  registration as processor, transfer conditions, and per-tenant DPA language
  naming the region). Counsel resolves this at the S3 gate; the fallback is
  migrating the project to a compliant region (Supabase project migration is a
  known, rehearsable procedure — do it before external tenants, not after).
- **Per-org envelope encryption**: a platform KEK (env/KMS) wraps one data key
  per org (`org_encryption_keys`); all PII ciphertext is under the org's DEK.
  This buys (a) blast-radius containment, (b) **crypto-shredding at
  offboarding** — destroying the wrapped DEK renders residual ciphertext in
  backups unreadable, which is otherwise nearly impossible to guarantee — and
  (c) a per-tenant rotation story. Existing Ng'umbi ciphertext is re-encrypted
  under org #1's DEK during S0.
- **Platform-admin accounts require MFA** (Supabase auth supports TOTP) — a
  phished platform admin is a breach of every tenant at once.
- Support impersonation writes `audit_logs` rows with `actor_role =
  'platform_admin'` and is visible to the tenant.
- **Offboarding is a defined procedure, not an idea**: at churn — (1) full
  per-tenant export delivered (JSON/CSV of every org-scoped table + storage
  objects), (2) 60-day read-only retention window, (3) hard delete of rows and
  storage prefixes + DEK destruction (crypto-shredding covers backups), (4) an
  audit trail of the deletion itself, retained. This is both a product feature
  ("your data is yours") and a PDPA obligation.
- Legal (get local counsel): data-processing terms with each fleet (they are
  the data controller for rider PII), Tanzania Personal Data Protection Act
  (No. 11 of 2022) registration/compliance, KYC/AML posture — direct
  fleet↔rider flows via the fleet's own Snippe account keep the platform out
  of the money chain, confirm this holds.
- Backups/DR: current BACKUP_RECOVERY.md is single-tenant; rewrite for
  multi-tenant restore drills (restoring ONE tenant from a full backup is a
  different exercise than restoring the database).

## 11. Migration path (no big bang)

The trick: **Ng'umbi Riders becomes org #1 by backfill**, and every step keeps
the current product working.

- **S0 — Groundwork (≈1–1.5 wk).** Create `organizations` +
  `organization_members` + backfill migration: insert the Ng'umbi org, add
  `org_id` columns **nullable** (business AND infra tables — §2 item 22),
  backfill every row, then set `not null` + FKs + composite uniques/indexes.
  Convert `app_settings` → `organization_settings`. Introduce
  `org_encryption_keys` and re-encrypt existing PII under org #1's DEK (§10).
  Add the brand-string CI grep gate (§2 item 25). No behavior change; owner is
  the sole admin member.
- **S1 — AuthZ rewrite (≈2 wk).** New helper functions (with the §3 initplan
  perf pattern); rewrite the full RLS matrix + policies; extend money
  functions with org assertions; rewrite the RLS test suite with a second
  (synthetic) org; all app queries gain explicit org filters. Exit: cross-org
  isolation suite passes live (against the permanent staging project, §8).
- **S2 — Identity (≈1–1.5 wk).** Rider auth Option A (synthetic identities,
  org-scoped phone). Migrate existing rider auth users in place behind the
  dual-acceptance flag (§5). Staff org switcher + invitation/password-reset
  flows (`organization_invitations`).
- **S3 — Payments per tenant (≈1–2 wk).** `organization_payment_providers`
  with connect-time scope verification (§6), per-org webhook secret
  verification + routed endpoint, per-org receipt sequences, reconciliation
  per org. Ng'umbi's env-based creds move into its org row. **Counsel
  checkpoint: money-transmitter posture + PDPA data residency (§10) — both
  must clear before S4 opens signup.** Exit: a second sandbox org completes a
  Snippe payment end-to-end.
- **S4 — Onboarding + branding + plans (≈2–2.5 wk).** Signup wizard, org slugs
  on public routes, branding application (incl. per-org PWA manifest, §7),
  platform marketing/pricing site, `plans`/`subscriptions`/`billing_invoices`
  with manual activation (VAT/TRA-ready numbering, §9), limit enforcement,
  lifecycle states (§9). Exit: a stranger can self-serve to a working
  cash-only fleet.
- **S5 — Platform ops (≈1–2 wk).** Admin console (with MFA, §10), Sentry +
  per-org alerting, per-org job fan-out on Vercel Pro, per-tenant export +
  the offboarding procedure (§10), multi-tenant backup/restore drill. Exit:
  we can operate 10 tenants without SSHing into anything.
- **S6 — Billing automation + polish (≈1–2 wk).** Automated subscription
  collection, dunning/grace, subdomains if wanted, docs (tenant-facing
  ADMIN_GUIDE fork).

Each phase = migrations + code + tests + a DECISIONS.md entry, same discipline
as today.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| RLS rewrite introduces an isolation hole | cross-org test matrix in CI as a release gate; policies reviewed table-by-table against RLS_MATRIX.md |
| Money functions touch rows across orgs due to a caller bug | org assertions inside the SECURITY DEFINER functions (defense in depth, like D-031) |
| Webhook secret mix-up settles org A's payment with org B's event | per-org secret verification + org equality asserted at settlement; provider event ids stored with org_id |
| One noisy tenant exhausts crons/DB | per-org bounded queries, queue-based fan-out, per-org rate limits & usage counters |
| Seeded/demo credentials leak (happened pre-SaaS!) | no shared demo accounts; per-org sandbox data; secrets scanning in CI |
| Product drift: Ng'umbi needs vs SaaS needs conflict | Ng'umbi is tenant #1 with no special-case code — anything special becomes an org setting |
| Regulatory surprise (payments/PII) | counsel review at S3 gate; direct fleet↔rider money flows; DPA + PDPA compliance checklist before first external tenant |
| PDPA cross-border: rider PII hosted in Frankfurt for TZ tenants | counsel + region decision at S3 gate; per-tenant DPA names the hosting region; project region migration rehearsed on staging as the fallback |
| New hardcoded brand strings creep in between now and S0 | CI grep gate on `Ng'umbi`/`ngumbi.co.tz` outside the org-branding modules (17 sites exist today — §2 item 25) |
| Offboarded tenant's PII survives in backups | per-org envelope encryption + DEK destruction at offboarding (crypto-shredding, §10) |

## 13. Explicitly out of scope / do NOT do

- Do not fork the codebase per client ("just copy it for the next fleet") —
  that's N codebases to patch for every money bug found.
- Do not introduce microservices/queues/k8s before S5's measured need.
- Do not pool client money through a platform account.
- Do not weaken the invariants in HANDOVER.md §5 for any tenant feature.
- Do not start S1 before there are ≥2 concrete prospect fleets — the single-
  tenant product must first prove itself in the Ng'umbi pilot.

## 14. Decision triggers

Start executing this plan when ANY of:
- 2+ serious inbound requests from other fleet owners, or
- Ng'umbi pilot stable for 60+ days and expansion is desired, or
- a strategic partner (e.g. a lender financing motorcycles) wants portfolio
  visibility across fleets.

First step when triggered: S0 groundwork + pricing validation interviews with
3–5 fleet owners (Dar es Salaam boda/bajaji associations are the obvious
channel).

## 15. Support & success metrics (deliberately thin)

Enough to not be caught flat-footed at tenant #2; flesh out with real usage.

- **Support channel reality in Tanzania**: a WhatsApp business line + phone
  number, staffed by whoever operates the platform. In-app support is a later
  polish. Each plan states a response expectation (Starter: next business day;
  Fleet: same day). The `/admin` impersonation flow (§7, audited) is the
  support tool.
- **Track from day one** (mostly derivable from `usage_counters` + existing
  tables): activation (signup → first *activated contract*, the moment the
  product is real for a fleet) — the getting-started checklist (§7) is exactly
  this funnel made visible, so instrument per-step completion and drop-off to
  see *where* new fleets stall; weekly active fleets, per-org collection rate
  (already computed for the owner KPI — doubles as a product-health signal:
  a fleet whose riders stop paying through the app is a fleet about to churn),
  churn + stated reason, MRR.
- **Operational bar before tenant #2**: a named answer to "who gets paged when
  webhooks fail at 02:00", an incident runbook (extend BACKUP_RECOVERY.md),
  and a status-communication habit — even a manually updated status page.
