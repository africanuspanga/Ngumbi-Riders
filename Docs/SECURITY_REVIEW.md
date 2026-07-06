# Security Review (self-review, Phase 10)

Reviews the security posture against spec §25 and the §31.4 security tests.

## Secrets & keys
- Service-role key, `AUTH_PIN_PEPPER`, `PII_ENCRYPTION_KEY`, Snippe & Resend
  secrets, VAPID private key are **server-only**. `lib/env.ts` splits public vs
  server; the admin client, PIN derivation, crypto and provisioning import
  `server-only` so a client bundle that reaches them fails the build.
- Rider PIN never leaves the server; the Supabase password is a keyed HMAC
  (`HMAC_SHA256(pepper, phone:pin)`), so the 4-digit space isn't brute-forceable
  offline without the pepper.

## AuthN / AuthZ
- Rider phone+PIN and owner email/password both go through server routes with
  rate limiting + 30-min lockout (5 fails/15 min, per phone AND IP).
- RLS is enabled on every table; owner-all + rider-own-row; sensitive/system
  tables owner-only (see `RLS_MATRIX.md`). Server helpers re-check role as
  defense in depth. RLS is the decisive boundary and is proven by
  `tests/integration/rls/isolation.test.ts` once run against a live DB.

## Money integrity
- Settlement is atomic + idempotent (`record_completed_payment`); allocations
  must equal the payment amount; whole-obligation only; oldest-first.
- Webhook verifies HMAC over the raw body + 5-min freshness + dedupe by event id.
- **Migration 0016 revokes direct INSERT/UPDATE/DELETE** on `payments`,
  `payment_obligations`, `payment_allocations`, `payment_events`,
  `payment_reservations`, `receipts`, `contract_documents`, `audit_logs`,
  `login_attempts` from anon/authenticated — money mutates only via the
  controlled functions + service role.

## PII
- NIDA / licence stored as versioned AES-256-GCM ciphertext; revealed only by a
  deliberate, audited owner action; never logged.
- All storage buckets private; riders receive files via short-lived signed URLs.
- Service worker never caches NIDA/receipts/contracts/reports (§26.2).

## Transport / headers
- CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy
  on every response (`next.config.ts`).

## Reviewed decisions / follow-ups
- **CSP uses `unsafe-inline`/`unsafe-eval`** for Next's hydration bootstrap.
  Tighten to nonce-based CSP via the proxy — tracked follow-up.
- **`FORCE ROW LEVEL SECURITY`** considered and deferred: our SECURITY DEFINER
  functions run as a BYPASSRLS role and the service role bypasses RLS, so FORCE
  adds little for the `authenticated`/`anon` roles that are already policy-bound;
  revoking direct writes (0016) is the higher-value control. Revisit if any
  non-bypass role is granted table access.
- **Sentry** wiring is pending `SENTRY_DSN` (§32).
- **NIDA/licence duplicate detection** uses phone today; a deterministic blind
  index for equality search is a follow-up (D-014).
