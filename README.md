# Ng'umbi Riders

Fleet contract & rider-payment management for Ng'umbi Riders (Tanzania).
Mobile-first PWA. **Source of truth: [`Docs/CLAUDE.md`](Docs/CLAUDE.md).**

Stack: Next.js 16.2 (App Router, React 19) · TypeScript · Tailwind v4 ·
Supabase (Auth/Postgres/Storage) · `next-intl` (Swahili-first) · Snippe (Phase 5)
· Resend (Phase 8).

## Status

Phases **0 (foundations)** and **1 (database, auth, RLS)** are implemented.
See [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md),
[`DECISIONS.md`](DECISIONS.md) and [`docs/`](docs/).

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in Supabase creds when available
npm run dev                    # http://localhost:3000
```

### Database (needs Docker for local, or a linked project)

```bash
supabase start                 # local Postgres (Docker) …
# …or, against a hosted project:
supabase link --project-ref <ref>
supabase db push               # apply migrations in supabase/migrations
npm run seed                   # owner + demo riders via Admin API
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run test` | Vitest (unit + RLS; RLS skips without a DB) |
| `npm run test:rls` | RLS isolation suite (`RLS_TEST_ENABLED=1` + live DB) |
| `npm run verify` | typecheck + lint + test |
| `npm run db:push` / `db:reset` / `db:diff` | Supabase migrations |
| `npm run seed` | Seed owner + demo rider accounts |

## Security invariants (never violate)

- Service-role key, `AUTH_PIN_PEPPER`, `PII_ENCRYPTION_KEY`, Snippe & Resend
  secrets are **server-only** — never `NEXT_PUBLIC_`, never in client bundles.
- The raw 4-digit PIN never leaves the server; the Supabase password is a keyed
  HMAC derived server-side.
- Never trust client-supplied amounts, roles, rider IDs, payment statuses or
  contract totals.
- Never weaken RLS to fix a frontend problem; RLS is the decisive boundary.
- Financial history is immutable — corrections are reversal/correction events.

## Layout

`app/` routes · `lib/` domain logic (auth, supabase, security, money, dates,
i18n, audit) · `supabase/migrations/` schema · `tests/` unit + RLS · `docs/`
engineering references.
