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

## Phase 2 — Applications and documents (IN PROGRESS)

| Task | Status | Notes |
|------|--------|-------|
| Public multi-step form (9 steps) | ✅ | `/apply` — RHF + zod, per-step validation, session draft autosave, mobile-first Swahili. |
| Applicant + contact + NIDA + emergency fields | ✅ | Full §8.2 field set with validation (18+, E.164 phone, 20-digit NIDA). |
| Two guarantors | ✅ | Both guarantor field sets (§8.4) required and validated. |
| Document uploads (client) | ✅ | 13 required docs; type/size validation shared with server (`lib/applications/documents`). |
| Drawn declaration + signature | ✅ | Canvas `SignaturePad` → transparent PNG; declaration acceptance required. |
| PII encryption (NIDA/licence) | ✅ | AES-256-GCM (`lib/security/crypto`), versioned payload, unit tested. |
| Application reference | ✅ | `NGR-APP-YYYY-000123` generator, unit tested. |
| `/apply/success` confirmation | ✅ | Shows reference. |
| Submission endpoint `/api/applications` | 🟡 | DB-ready: validates, encrypts, inserts application+guarantors, uploads docs, duplicate flag by phone. **Activates when Supabase creds land.** |
| Server file magic-byte scan | ✅ | `lib/applications/file-signature` — rejects spoofed MIME/extension; wired into submit; unit tested. |
| Submission rate limiting | ✅ | Generic durable limiter (`lib/security/rate-limit` + `rate_limit_events`, migration 0012); 5 submits/hr per IP; window math unit tested. |
| English i18n for the form | ✅ | Full `apply` namespace (sw + en), locale-aware validation messages, `LanguageSwitcher` (cookie-based) on apply/landing/login. Verified rendering in both languages. |
| Owner review pipeline (`/owner/applications` + `[id]`) | 🟡 | Built: status-filter list, applicant/guarantor detail, status state machine, deliberate NIDA/licence reveal (decrypt), signed doc URLs, duplicate warnings, **convert-to-rider** (creates auth user + temp PIN, copies PII). **Activates when Supabase creds land.** |
| Signed upload flow (`/api/uploads/sign`) | ⬜ | Optional; submit currently uploads inline via service role. |

**Exit criteria:** public applicant submits a complete application + owner reviews it — **code-complete on both sides**; live run pending Supabase creds.

## Phase 3 — Riders, motorcycles and imports (code-complete; DB pending)

| Task | Status | Notes |
|------|--------|-------|
| Motorcycle register | ✅ | `/owner/motorcycles` list, `/new` create (normalized registration), `/[id]` detail with assignment history + expense total. |
| Rider register | ✅ | `/owner/riders` list (status + risk), `/[id]` 360 profile with compliance warnings, reveal NIDA/licence, assignment history. |
| Manual rider creation | ✅ | `/owner/riders/new` — creates auth user + temp PIN, optional NIDA/licence (encrypted), optional immediate motorcycle assignment (§9.2). |
| Assignment history + transfer | ✅ | `lib/assignments/actions` — assign / release / exceptional transfer (reason required); DB partial-unique indexes enforce one-active invariants. |
| CSV/XLSX import wizard | 🟡 | `/owner/imports` — type select, template download, upload (CSV via papaparse / XLSX via exceljs), **dry-run** validation + in-batch & DB duplicate detection, batch + file persistence, **commit** with per-rider temp-PIN report. Riders + motorcycles types. **Activates when creds land.** |

**Exit criteria:** existing riders and motorcycles can be loaded safely — **code-complete**; live import run pending Supabase creds. Remaining import types (guarantors, contracts, assignments, historical obligations/payments, expenses) deferred to their phases.

## Phase 4 — Contracts and schedule engine (code-complete; DB pending)

| Task | Status | Notes |
|------|--------|-------|
| **Obligation schedule engine** | ✅ | `lib/obligations/schedule` — daily / selected-weekday, leap-year & month-boundary safe, UTC-from-EAT due timestamps. **15 unit tests** (incl. 18:00 EAT → 15:00Z). |
| Contract builder + live preview | ✅ | `/owner/contracts/new` — rider/moto, duration→end date, schedule, amount, deadline, ownership transfer; live obligation count + total value (§10.3 step 3). |
| Contract register + detail | ✅ | `/owner/contracts` + `/[id]` with terms, obligation stats, signatures. |
| On-screen signatures + physical fallback | ✅ | Owner + rider drawn signatures (stored PNGs) or an uploaded signed copy with SHA-256 hash (§10.3, §10.5). |
| Template + PDF generation | ✅ | `@react-pdf/renderer` A4 contract from versioned template; stored in private bucket with SHA-256 hash. |
| **Transactional activation** | ✅ | `activate_contract_and_generate_obligations` (migration 0013, SECURITY DEFINER, owner-guarded): TS computes the schedule, DB commits obligations + flips status to active in one transaction. Requires signatures. |
| Lifecycle actions | 🟡 | Pause / resume / complete-early / terminate (cancels future unpaid obligations, preserves paid history). Extend / renegotiate / schedule-change + `regenerate_future_obligations` + addendum PDF are follow-ups (§10.4, §3.4). |

**Exit criteria:** a signed contract can activate and produce an accurate obligation calendar — **code-complete**; live activation pending Supabase creds.

---

## Verification snapshot (local)

```
npm run typecheck   # ✅ tsc --noEmit clean
npm run lint        # ✅ eslint clean
npm run test        # ✅ 96 passed, 10 RLS skipped (no DB)
npm run build       # ✅ 25 routes compiled, proxy active
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
