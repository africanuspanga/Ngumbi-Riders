# SAAS_PLAN — Turning Ng'umbi Riders into a Multi-Tenant SaaS

> **Status: PLAN ONLY — nothing here is built.** The product today is
> deliberately single-business (spec §1, CLAUDE.md §1). This document is the
> detailed blueprint for converting it into a subscription SaaS ("fleet
> lease-management for African motorcycle/bajaji fleets") if and when more
> businesses want it. It is written so a future team can execute it phase by
> phase without re-deriving the architecture.

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

**Estimated effort to first paying external tenant: ~8–12 engineer-weeks**
across 7 phases (S0–S6), each shippable and reversible. Ng'umbi Riders itself
becomes tenant #1 with zero downtime via a backfill migration.

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

This list was compiled by auditing the actual code; it is the checklist for S1.

| # | Assumption today | Where | Change |
|---|---|---|---|
| 1 | `app_settings` is a singleton row | `0003_identity.sql`, `lib/system` | becomes per-org `organization_settings` |
| 2 | `is_owner()` = "profile.role = 'owner'" globally | `0002_helpers.sql`, every policy | `is_org_admin(org_id)` via `organization_members` |
| 3 | One owner account, seeded | `scripts/seed.ts` | signup flow creates org + first admin |
| 4 | Rider phone is globally unique | `riders`, Supabase auth users | phone unique **per org**; auth identity strategy in §5 |
| 5 | Receipt numbers global sequence `NGR-RCPT-YYYY-NNNNNN` | 0017/0018 | per-org sequence + org prefix (e.g. `ACME-RCPT-…`) |
| 6 | Contract/rider/application numbers `NGR-*` count(*)+1 | `lib/*/actions.ts` | per-org DB sequences (fixes a known race too) |
| 7 | ONE Snippe key + ONE webhook secret in env | `lib/env.ts`, `lib/snippe` | per-org encrypted credentials + per-org webhook routing (§6) |
| 8 | Resend + OWNER_SUMMARY_EMAIL single recipient | `lib/resend`, tasks | per-org notification settings |
| 9 | Crons iterate ALL riders/payments | `lib/jobs/tasks.ts` | fan out per org (and move off Hobby — §8) |
| 10 | Storage paths `applicationId/...` with owner-only policy | `0011_storage.sql` | prefix every path with `org_id/`, policies check membership |
| 11 | Branding hardcoded (logo, "Ng'umbi Riders", colors) | layout/login/PDF/emails | per-org branding table + theme tokens |
| 12 | `/apply` is THE application form | `app/(public)/apply` | per-org form at `/{orgSlug}/apply` (or subdomain) |
| 13 | Owner dashboards/KPIs query whole tables | `lib/dashboard`, `lib/reports` | all queries gain org scope (RLS enforces; queries add explicit filter for perf) |
| 14 | Audit log actor roles owner/rider/system | `lib/audit` | + org_id, + `platform_admin` actor |
| 15 | RLS test suite: 2 riders, 1 owner | `tests/integration/rls` | matrix grows: cross-ORG isolation is the new critical axis |
| 16 | PDF contracts embed the business identity | `lib/contracts/pdf` | render from org branding + org legal fields |
| 17 | Rate limits keyed by IP/phone globally | `lib/security/rate-limit` | + per-org quotas (abuse and plan enforcement) |

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
plans (id text pk, name, monthly_price_tzs int, max_riders int,
       max_motorcycles int, features jsonb)
subscriptions (org_id fk, plan_id fk, status, current_period_end, provider refs…)
platform_admins (profile_id pk)                                        -- us
usage_counters (org_id, metric, period, value)                         -- plan enforcement
```

Changed: **every business table** gains `org_id uuid not null references
organizations(id)`; `profiles.role` gains `platform_admin`; riders keep
`role='rider'` but gain org scoping through `riders.org_id`.

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

## 6. Payments & webhooks per tenant

- Each org connects its **own Snippe account** (API key + webhook secret,
  encrypted at rest with `PII_ENCRYPTION_KEY`-style AES-256-GCM, decrypted
  server-side only). The platform never pools client money — money flows
  directly fleet↔rider through the fleet's own provider account. This keeps us
  out of money-transmitter territory (verify with counsel, §11).
- Webhook routing: one endpoint `/api/webhooks/snippe/[orgId]` (or the org id
  embedded in the metadata we already send). Signature is verified with THAT
  org's secret; the settlement function additionally asserts
  `payment.org_id = obligation.org_id = reservation.org_id`.
- Receipts: per-org sequence + prefix from org settings.
- Platform fees (optional, later): bill via subscription, not by skimming
  payment flows — far simpler legally and technically.

## 7. Product surface changes

- **Signup & onboarding wizard**: create org → choose plan/trial → business
  profile (name, logo, colors) → connect Snippe (or "cash-only mode" — works
  out of the box, mobile money can be connected later) → import
  motorcycles/riders (existing import wizard, now org-scoped) → invite staff.
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
- **i18n**: already sw/en; per-org default locale setting.

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

## 10. Security & compliance deltas

- **Tenant isolation is the new crown jewel.** Extend the RLS suite to a
  cross-org matrix (org-A staff vs org-B data, org-A rider vs org-B rider,
  storage paths, DB functions, exports) and make it a CI gate against a
  staging project. The existing suite pattern (10 checks, live) scales to this.
- SECURITY DEFINER functions assert org consistency on every row (extend
  D-031's guards).
- Storage: every object key gains an `org_id/` prefix; policies check
  membership; signed URLs stay server-issued and short-lived.
- Support impersonation writes `audit_logs` rows with `actor_role =
  'platform_admin'` and is visible to the tenant.
- Legal (get local counsel): data-processing terms with each fleet (they are
  the data controller for rider PII), Tanzania Personal Data Protection Act
  (No. 11 of 2022) registration/compliance, KYC/AML posture — direct
  fleet↔rider flows via the fleet's own Snippe account keep the platform out
  of the money chain, confirm this holds.
- Backups/DR: current BACKUP_RECOVERY.md is single-tenant; add per-tenant
  export (JSON/CSV dump of an org) both as a feature and as churn-offboarding
  obligation.

## 11. Migration path (no big bang)

The trick: **Ng'umbi Riders becomes org #1 by backfill**, and every step keeps
the current product working.

- **S0 — Groundwork (≈1 wk).** Create `organizations` +
  `organization_members` + backfill migration: insert the Ng'umbi org, add
  `org_id` columns **nullable**, backfill every row, then set `not null` +
  FKs + composite uniques/indexes. Convert `app_settings` →
  `organization_settings`. No behavior change; owner is the sole admin member.
- **S1 — AuthZ rewrite (≈2 wk).** New helper functions; rewrite the full RLS
  matrix + policies; extend money functions with org assertions; rewrite the
  RLS test suite with a second (synthetic) org; all app queries gain explicit
  org filters. Exit: cross-org isolation suite passes live.
- **S2 — Identity (≈1 wk).** Rider auth Option A (synthetic identities,
  org-scoped phone). Migrate existing rider auth users in place. Staff org
  switcher.
- **S3 — Payments per tenant (≈1–2 wk).** `organization_payment_providers`,
  per-org webhook secret verification + routed endpoint, per-org receipt
  sequences, reconciliation per org. Ng'umbi's env-based creds move into its
  org row. Exit: a second sandbox org completes a Snippe payment end-to-end.
- **S4 — Onboarding + branding + plans (≈2 wk).** Signup wizard, org slugs on
  public routes, branding application, `plans`/`subscriptions` with manual
  activation, limit enforcement. Exit: a stranger can self-serve to a working
  cash-only fleet.
- **S5 — Platform ops (≈1–2 wk).** Admin console, Sentry + per-org alerting,
  per-org job fan-out on Vercel Pro, per-tenant export. Exit: we can operate
  10 tenants without SSHing into anything.
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
