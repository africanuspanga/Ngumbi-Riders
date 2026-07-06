# Route Map & Folder Structure

Full route inventory per spec §5. Routes implemented in Phase 0/1 are marked ✅;
the rest are scaffolded destinations for later phases (⬜).

## Public (`app/(public)`, `app/(auth)`)

| Route | Status | Phase |
|-------|--------|-------|
| `/` landing | ✅ | 0 |
| `/login` rider + owner entry | ✅ | 1 |
| `/apply` application form | ✅ | 2 |
| `/apply/success` | ✅ | 2 |
| `/privacy`, `/terms` | ⬜ | 2 |
| `/offline` PWA fallback | ✅ | 0 |

## Rider (`app/rider`) — gated by `proxy.ts` + `rider/layout.tsx`

| Route | Status | Phase |
|-------|--------|-------|
| `/rider` dashboard | ✅ | 6 |
| `/rider/settings/pin` change PIN | ✅ | 1 |
| `/rider/pay` + `/payments` + `/payments/[id]` | ✅ | 5 |
| `/rider/calendar` | ✅ | 6 |
| `/rider/contract`, `/contracts/[id]`, `/motorcycle`, `/documents` | ⬜ | 6 |
| `/rider/incidents` + `/incidents/new` + `/exemptions` | ✅ | 7 |
| `/rider/notifications` | ✅ | 8 |
| `/rider/settings` | ⬜ | 8 |

## Owner (`app/owner`) — gated by `proxy.ts` + `owner/layout.tsx`

| Route | Status | Phase |
|-------|--------|-------|
| `/owner` KPI dashboard | ✅ | 6 |
| `/owner/applications` pipeline list | ✅ | 2 |
| `/owner/applications/[id]` review + convert | ✅ | 2 |
| `/owner/riders` + `/new` + `/[id]` | ✅ | 3 |
| `/owner/motorcycles` + `/new` + `/[id]` | ✅ | 3 |
| `/owner/contracts` + `/new` + `/[id]` | ✅ | 4 |
| `/owner/payments` + `/cash` | ✅ | 5 |
| `/owner/reconciliation` | ✅ | 5 |
| `/owner/incidents` + `/exemptions` | ✅ | 7 |
| `/owner/imports` CSV/XLSX wizard | ✅ | 3 |
| `/owner/announcements` | ✅ | 8 |
| `/owner/reports`, `/expenses` | ⬜ | 9 |
| `/owner/settings`, `/audit`, `/system` | ⬜ | 9–10 |

## API route handlers (`app/api`)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/auth/rider-login` | ✅ | phone + PIN, server HMAC, rate limited |
| `POST /api/auth/change-pin` | ✅ | verify current, weak-PIN check, rotate |
| `POST /api/auth/owner-login` | ✅ | email/password, role-verified |
| `POST /api/auth/logout` | ✅ | clears session |
| `GET /api/health` | ✅ | liveness |
| `POST /api/applications` | 🟡 | Phase 2 — DB-ready, activates with creds |
| `/api/uploads/sign` | ⬜ | Phase 2 (optional; submit currently uploads inline) |
| `/api/payments/snippe/initiate` + `/api/payments/[id]/status` + `/api/webhooks/snippe` | ✅ | Phase 5 |
| `/api/push/subscribe` + `/api/cron/*` (6 jobs) | ✅ | Phase 8 |
| `/api/reports/[report]/export` | ⬜ | Phase 9 |

## Feature-based folder structure (spec §29)

```
app/            (public)/ (auth)/ rider/ owner/ api/     ← routes
components/     auth/ (ui/ forms/ dashboard/ … later)   ← shared UI
lib/            auth/ supabase/ security/ validation/
                money/ dates/ i18n/ audit/               ← domain logic
messages/       sw.json en.json                          ← i18n catalogs
supabase/       migrations/ config.toml seed.sql         ← database
scripts/        seed.ts                                  ← operational scripts
tests/          unit/ integration/rls/ stubs/            ← test suites
docs/           MIGRATION_PLAN ROUTE_MAP RLS_MATRIX      ← engineering docs
```

Organised by business feature, not only technical file type. `lib/snippe`,
`lib/resend`, `lib/pdf`, `lib/exports`, `lib/jobs` are added in their phases.
