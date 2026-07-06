# Launch Checklist (Phase 10)

Operational steps to take the code-complete build (Phases 0–9) to production.
Items marked **[creds]** need the live Supabase / Snippe / Resend / VAPID
credentials; the rest are done or doable now.

## 1. Provision & apply the database
- [ ] Create the Supabase project; copy URL, publishable key, service-role key, `DATABASE_URL`.
- [ ] `supabase link --project-ref <ref>`
- [ ] `supabase db push` (applies migrations 0001–0016)
- [ ] `supabase gen types typescript > lib/supabase/types.gen.ts`; re-add the `<Database>` generic (DECISIONS D-010)
- [ ] Create the 7 private storage buckets are created by 0011 — verify in dashboard.

## 2. Environment
- [ ] Set every var from `.env.example` in Vercel (server-only vars unprefixed).
- [ ] Generate strong `AUTH_PIN_PEPPER` (32+), `PII_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CRON_SECRET`.
- [ ] Generate VAPID keys (`npx web-push generate-vapid-keys`) → `VAPID_*`.
- [ ] Set `SNIPPE_API_KEY`, `SNIPPE_WEBHOOK_SECRET`, `SNIPPE_BASE_URL`.
- [ ] Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_SUMMARY_EMAIL`.

## 3. Accounts & seed
- [ ] `npm run seed` (creates owner + demo riders) — then change the owner password.
- [ ] Enable MFA on the owner Supabase account if available (spec §7.1).

## 4. Prove security **[creds]**
- [ ] `RLS_TEST_ENABLED=1 npm run test:rls` — rider isolation passes (Phase 1 exit).
- [ ] Confirm service-role key / pepper absent from the client bundle (`grep -r` the `.next` output).
- [ ] Verify a signed URL expires; verify webhook replay is a no-op.

## 5. Integrations
- [ ] Point the Snippe webhook at `https://<domain>/api/webhooks/snippe`.
- [ ] Send a test mobile-money payment end-to-end; confirm the receipt appears exactly once.
- [ ] Verify Resend domain DNS (SPF/DKIM); trigger `/api/cron/daily-summary` once.
- [ ] Configure Vercel Cron (from `vercel.json`) and confirm `CRON_SECRET` is set.

## 6. Data migration
- [ ] Import existing riders + motorcycles via `/owner/imports`; reconcile counts.
- [ ] Reconcile a sample of historical collection totals against the reports.

## 7. Domain, PWA, monitoring
- [ ] Point `ngumbi.co.tz` at Vercel; verify HTTPS + HSTS.
- [ ] Install the PWA on a low-cost Android device; test offline fallback + slow 3G.
- [ ] Wire Sentry (`SENTRY_DSN`) for frontend + backend errors (§32).

## 8. Backups (see `BACKUP_RECOVERY.md`)
- [ ] Confirm Supabase automated DB backups (PITR if available).
- [ ] Stand up the **separate storage backup** — DB backups do NOT cover storage objects (§24).
- [ ] Do one restore drill.

## 9. Pilot
- [ ] Pilot with 5 riders before full rollout (§34 Phase 10).
- [ ] Sign off the Definition of Done (spec §35).
