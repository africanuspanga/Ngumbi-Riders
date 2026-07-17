# SESSION HANDOVER — pick up here

> **Read this first, then `CLAUDE.md`.** This is the "where we are / what to do
> next" note written at the end of the **2026-07-17** session so a fresh session
> (with no chat memory) can continue safely. The product source of truth is
> still `Docs/NGUMBI_RIDERS_BUILD_SPEC.md`; the deep orientation guide is
> `Docs/HANDOVER.md`. This file tracks the live execution state.

Everything below is **committed on `main`** and the working tree is clean.
DB migrations `0019`, `0020`, `0021` are **applied to the live database** and
recorded in `supabase_migrations.schema_migrations`.

---

## 0. The one thing you must know

The user (Africanus, africanuspanga@gmail.com) is fixing/extending a **LIVE**
single-business fleet-payment app (Ng'umbi Riders, www.ngumbi.co.tz). Treat all
money paths as production. **Commit convention: author is Africanus ONLY — never
add a `Co-Authored-By: Claude` trailer** (see memory `no-claude-commit-coauthor`).
Commit each finished, tested chunk. Live money mutations are gated by a safety
classifier and require explicit user go-ahead — do not hand-edit payments.

---

## 1. What was fixed/built on 2026-07-17 (7 commits)

1. **CRITICAL: settlement had never worked.** `record_completed_payment` (behind
   every Snippe webhook, status-poll, reconcile cron AND cash payment) threw on
   every call → **0 payments ever settled, 0 receipts ever generated** since
   go-live. Two DB bugs: a `CASE`→enum cast (no implicit text→`obligation_status`
   cast) and `gen_random_bytes` unreachable (pgcrypto lives in the `extensions`
   schema, off the function's `search_path`). Fixed in **migration `0019`**
   (cast branches to `::public.obligation_status`, qualify
   `extensions.gen_random_bytes`). This was the root cause of BOTH "Snippe paid
   but owner dashboard didn't update" (#1) AND the broken cash page (#12).
   Verified by a rollback dry-run. **The fix is DB-only, so it is already live.**
2. **Rider card colours (#2)** — logic was already correct (`overdue`→red,
   `due`→orange, else green); the "always orange" was a *symptom* of settlement
   never completing. Green label clarified to "up to date".
3. **Applicant onboarding (#3/#4/#5), migration `0020`:** identity type
   (NIDA / Driving Licence / Voter ID), **driving licence never mandatory**,
   docs conditional per type; **exactly ONE guarantor** (was two) + guarantor
   confirmation SMS; region/district **dependent dropdowns** from
   `lib/geo/tanzania.ts` (server rejects a district not in the chosen region).
4. **Owner notification on new application (#6)** — in-app + optional SMS.
5. **SMS provider = Mobishastra** (`lib/mobishastra/client.ts`) wired into the
   delivery outbox (`lib/messaging/outbox.ts`). Disabled-safe until creds land.
6. **Motorcycle fields + auto code (#16/#7), migration `0021`:** registration
   number **optional** (add/correct later on the detail page);
   chassis/engine/colour/make/model mandatory (chassis+engine unique); code
   auto-generated `NGR-{REGION}-{DIST}-M-{SEQ4}` (e.g. `NGR-DSM-KIN-M-0001`),
   `XXX` fallback, per-region-district sequence. Code is now the primary id.

Verification at handover: `npm run verify` → **189 unit tests pass**, typecheck
✅, lint ✅ (1 benign React-Compiler `watch()` warning), `npm run build` ✅.

---

## 2. TWO things the OWNER must do (not code)

1. **Deploy to Vercel.** The DB fixes (`0019`–`0021`) are already live, but the
   committed *code* (onboarding form, colours, SMS, notifications, motorcycle
   form) needs a deploy to reach the site. Add these env vars in Vercel for SMS:
   `MOBISHASTRA_USER`, `MOBISHASTRA_PASSWORD`, `MOBISHASTRA_SENDER_ID`,
   `OWNER_NOTIFY_PHONE` (see `.env.example`).
2. **Reconcile pilot money in-app** (owner chose to do this themselves): the
   pending mobile payment `16c05398` self-heals via the reconcile-pending cron;
   re-record JACOB's **300,000** cash on the now-fixed `/owner/payments/cash`;
   credit LEANHARD's **10,000** overpayment. Details in memory
   `settlement-never-worked-fixed-0019`.

---

## 3. Where to continue (priority order)

The user is working through the 21-item spec in their **priority order**
(spec §21). Do ONE tested chunk per pass; commit each.

- **NEXT: #8/#13 monthly + weekly instalments + monthly cash recording.**
  HIGHEST money-risk — it changes the obligation/settlement engine
  (`lib/obligations/schedule`). **Decision already made** (memory
  `monthly-instalment-due-day-decision`): *the platform owner sets a fixed due
  date per monthly contract; the obligation is NOT overdue until that day
  passes; owner records one cash payment per month (select rider → month →
  amount).* Build with DB-level tests (the settlement bug shipped precisely
  because the PL/pgSQL money functions were never executed by any test — unit
  tests are node-only, no local Postgres).
- **#10 accountant role + RBAC/RLS** → unblocks **#11** motorcycle procurement
  workflow (owner approve → accountant invoice → owner pays + proof → accountant
  receipt → contract-ready). #11 needs a `motorcycle_requests`-style concept and
  the accountant role first.
- **#9/#18** contract PDF storage/download + template (a sample contract PDF is
  at `/Users/admin/Downloads/09. MKATABA-JACKSON FESTO MAGOHA.pdf`).
- **#14** phone financing (repayment phases), **#15** duration units
  (months/weeks/days), **#17** PWA install polish, **#19** data import.

---

## 4. How to work on this repo (mechanics)

- **Verify before committing:** `npm run verify` (typecheck + lint + test).
  `npm run build` for UI changes.
- **No local Postgres / Docker.** DB work goes through the **Supabase Management
  API SQL endpoint** using `SUPABASE_ACCESS_TOKEN` from `.env.local` (D-029):
  `POST https://api.supabase.com/v1/projects/rdofxxxdrqnhtewwzous/database/query`
  with body `{"query":"..."}`. A throwaway helper pattern that worked well:
  a small node script reading the token from `.env.local` and POSTing the SQL
  (used this session for diagnosis, applying migrations, and SAFE rollback
  dry-runs of money functions — wrap a `PERFORM fn(...)` in a `DO $$ ... RAISE
  EXCEPTION 'dryrun' $$;` block so nothing commits).
- **Migrations:** append-only, never edit an applied one. After applying live,
  regenerate types:
  `SUPABASE_ACCESS_TOKEN=... npx supabase gen types typescript --project-id
  rdofxxxdrqnhtewwzous > lib/supabase/types.gen.ts` (0019 was DB-only; 0020/0021
  needed a type regen).
- **Secrets** are in `.env.local` (gitignored): Supabase service-role key,
  `SUPABASE_ACCESS_TOKEN` (Management API), Snippe key + webhook secret, VAPID,
  PII key, PIN pepper. Snippe status API works read-only for reconciliation.
- **RLS is the boundary; money mutates only via SECURITY DEFINER functions +
  the service-role admin client.** Migration 0016 revokes direct money writes;
  `record_completed_payment` is the settlement entry point.

---

## 5. File map for what was touched this session

```
supabase/migrations/0019_fix_settlement_enum_cast.sql        # settlement fix
supabase/migrations/0020_identity_type_and_single_guarantor.sql
supabase/migrations/0021_motorcycle_fields_and_codes.sql
lib/geo/tanzania.ts                # 26 regions/districts + stable codes (#5/#7)
lib/mobishastra/client.ts          # SMS adapter (GET sendurlcomma.aspx)
lib/messaging/outbox.ts            # SMS branch + enqueueSms
lib/validation/application.ts      # identity type, 1 guarantor, region/district
app/(public)/apply/ApplicationForm.tsx   # reworked wizard (8 steps)
app/api/applications/route.ts      # identity storage, guarantor SMS, owner notify
lib/motorcycles/{code,validation,actions,queries}.ts     # #16/#7
app/owner/motorcycles/**           # form, list, detail, RegistrationForm
messages/sw.json · messages/en.json      # apply namespace (sw/en at parity)
tests/unit/{tanzania-geo,mobishastra,application-onboarding,motorcycle-code}.test.ts
```

Persistent context lives in the memory files (loaded each session via
`MEMORY.md`): `settlement-never-worked-fixed-0019`,
`monthly-instalment-due-day-decision`, `ngumbi-production-site-live`,
`no-claude-commit-coauthor`, `permission-policy-dependency-upgrades`.
