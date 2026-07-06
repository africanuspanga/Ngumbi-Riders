# Implementation Status

Source of truth: `Docs/NGUMBI_RIDERS_BUILD_SPEC.md`. This file tracks phase progress. Update it as
each task lands (spec §36.2).

Legend: ✅ done · 🟡 partial · ⬜ not started · ⏭️ deferred to later phase

---

## Phase 0 — Repository and foundations

| Task | Status | Notes |
|------|--------|-------|
| Next.js 16.2 TypeScript App Router project | ✅ | `next@16.2.0`, React 19.2, App Router. `npm run build` passes. |
| Tailwind CSS | ✅ | Tailwind v4 via `@tailwindcss/postcss`; design tokens in `app/globals.css` (`@theme`). |
| Supabase local dev + migrations | 🟡 | `supabase/config.toml` + 11 migrations authored. `supabase start` needs Docker (absent here); apply via `supabase db push` once a project is linked. |
| Linting / formatting / tests / CI | ✅ | ESLint 9 flat config (native Next 16 config), Prettier, Vitest, GitHub Actions CI. |
| Design tokens, responsive shell, i18n | ✅ | Green Bolt-inspired palette; `next-intl` Swahili-default (+English); mobile-first shells. |
| Environment validation | ✅ | `lib/env.ts` — zod-validated public vs server split, fail-loud on missing secrets. |

**Exit criteria:** App builds ✅ · CI configured ✅ · local Supabase 🟡 (blocked on Docker/creds — migrations ready to apply).

## Phase 1 — Database, auth and RLS

| Task | Status | Notes |
|------|--------|-------|
| Schema, enums, constraints, audit infra | ✅ | 13 enums, 38 tables, money/assignment/obligation constraints, `audit_logs`, `login_attempts`, `system_job_runs`. |
| Owner auth (email/password) | ✅ | `POST /api/auth/owner-login`; role-verified; rate limited. |
| Rider phone + 4-digit PIN auth | ✅ | `POST /api/auth/rider-login`; server-only HMAC PIN→password derivation; never sends raw PIN to Supabase. |
| PIN security controls | ✅ | Weak-PIN rejection (repeat/sequence/phone-tail/blocklist); temp-PIN forced change; `POST /api/auth/change-pin`. |
| Login rate limiting + lockout | ✅ | 5 fails/15 min → 30-min lock, per phone AND IP (`lib/auth/lockout.ts`, `rate-limit.ts`). Unit tested. |
| RLS policy matrix | ✅ | `0010_rls.sql` — RLS on every table; owner-all + rider-own-row; sensitive/system tables owner-only. See `docs/RLS_MATRIX.md`. |
| Automated RLS isolation tests | 🟡 | `tests/integration/rls/isolation.test.ts` written (10 cases). Skipped until `RLS_TEST_ENABLED=1` + live Supabase. |
| `IMPLEMENTATION_STATUS.md` / `DECISIONS.md` | ✅ | This file + `DECISIONS.md`. |
| Lint / typecheck / tests before completion | ✅ | `npm run verify` → typecheck ✅, lint ✅, 28 unit tests ✅. |

**Exit criteria:** Owner + test riders can sign in — code complete, ✅ pending live DB. Cross-rider access impossible — enforced by RLS; proof pending RLS test run against a live DB.

---

## Verification snapshot (local)

```
npm run typecheck   # ✅ tsc --noEmit clean
npm run lint        # ✅ eslint clean
npm run test        # ✅ 28 passed, 10 RLS skipped (no DB)
npm run build       # ✅ 14 routes compiled, proxy active
```

## Blocked / awaiting input

- **Supabase credentials** (URL, publishable key, service-role key, `DATABASE_URL`) — needed to `supabase db push` the migrations, seed accounts, and run the RLS suite. Provided later per the brief.
- **Docker** — absent on this build machine, so `supabase start` (local Postgres) cannot run here. Migrations + tests are authored to run as soon as a database is reachable.
- **Snippe / Resend credentials** — not needed until Phases 5/8.

## Not started (later phases)

Phases 2–10 (applications, riders/imports, contracts, payments, dashboards,
incidents, notifications/PWA, reports, hardening) — ⬜. Foundational tables for
all of them already exist so later phases mostly add functions, policies refine,
and UI.
