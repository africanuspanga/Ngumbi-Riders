/*
 * Authenticated route smoke test — "does every page still render?"
 *
 * WHY
 *
 * The static RSC boundary check (tests/unit/rsc-boundary.test.ts) makes one
 * class of crash impossible to ship. It cannot see the others: a failing query,
 * a null deref, a column that does not exist yet, a page that renders fine with
 * empty data and throws with real data. Those only appear when a real signed-in
 * user actually requests the page, which is how the owner found /owner and
 * /owner/payments/approvals — in production.
 *
 * This suite is that request, for every page, for every role.
 *
 * OPT-IN, because it needs a running server and a real database:
 *
 *   SMOKE_TEST_ENABLED=1 SMOKE_BASE_URL=http://localhost:3000 npm run test:smoke
 *
 * It is READ-ONLY: every request is a GET of a page. It writes nothing through
 * the app. Running it against production is therefore safe, with two honest
 * side effects — the auth sessions it mints, and (if rider credentials are
 * supplied) one login_attempts row per run.
 *
 * ROLE COVERAGE
 *
 *   owner, accountant   automatic. They are email users, so a session is minted
 *                       with an admin-generated OTP. No mail is sent.
 *   rider               only when SMOKE_RIDER_PHONE and SMOKE_RIDER_PIN are set.
 *                       Riders authenticate by phone and PIN, and a PIN is
 *                       unrecoverable by design — the password is
 *                       HMAC(pepper, phone:pin) and nothing stores the digits.
 *                       There is no way to mint a rider session without either
 *                       a real PIN or creating a throwaway rider in the live
 *                       register, which is exactly the demo data that was
 *                       deliberately purged. Supply a PIN or accept the gap;
 *                       the suite states which it did rather than implying
 *                       rider pages were covered when they were not.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { discoverPageRoutes, fillRoute, type RouteRole } from '@/lib/dev/routes';
import { adminClient, cookieHeader, sessionForEmail, sessionForRider } from './session';

const ENABLED = process.env.SMOKE_TEST_ENABLED === '1';
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const RIDER_PHONE = process.env.SMOKE_RIDER_PHONE ?? '';
const RIDER_PIN = process.env.SMOKE_RIDER_PIN ?? '';

const APP_DIR = join(fileURLToPath(new URL('../../../', import.meta.url)), 'app');

/** Text rendered by app/error.tsx when a server render throws. */
const ERROR_BOUNDARY_MARKER = 'Something went wrong. Check your connection';

type RoleSession = { role: RouteRole; cookies: string; ids: Record<string, string | undefined> };

const suite = ENABLED ? describe : describe.skip;

suite('smoke: every page renders for its role', () => {
  const sessions = new Map<RouteRole, RoleSession>();
  let riderCovered = false;

  beforeAll(async () => {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (!process.env[key]) throw new Error(`${key} is required for the smoke test`);
    }

    const admin = adminClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    /** One real id per table, so dynamic routes are requested with real data. */
    async function firstId(table: string, filter?: [string, string]): Promise<string | undefined> {
      let query = admin.from(table).select('id').limit(1);
      if (filter) query = query.eq(filter[0], filter[1]);
      const { data, error } = await query;
      if (error) {
        // A table that does not exist yet is a gap in coverage, not a failure
        // of the pages that do exist. Say so; do not fail the run.
        console.warn(`  [smoke] no id from ${table}: ${error.message}`);
        return undefined;
      }
      return (data?.[0] as { id?: string } | undefined)?.id;
    }

    const staffIds: Record<string, string | undefined> = {};
    for (const table of [
      'riders',
      'contracts',
      'motorcycles',
      'rider_applications',
      'cash_payment_requests',
      'purchase_requisitions',
      'payments',
    ]) {
      staffIds[table] = await firstId(table);
    }

    // --- owner + accountant -------------------------------------------------
    const { data: staff, error: staffError } = await admin
      .from('profiles')
      .select('id, role')
      .in('role', ['owner', 'accountant'])
      .eq('is_active', true);
    if (staffError) throw new Error(`could not read profiles: ${staffError.message}`);

    const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (authError) throw new Error(`could not list auth users: ${authError.message}`);
    const emailOf = new Map(authUsers.users.map((u) => [u.id, u.email ?? null]));

    for (const role of ['owner', 'accountant'] as const) {
      const profile = (staff ?? []).find((p) => p.role === role);
      const email = profile ? emailOf.get(profile.id) : null;
      if (!profile || !email) {
        console.warn(`  [smoke] no active ${role} with an email — ${role} pages not covered`);
        continue;
      }
      const jar = await sessionForEmail({
        url: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        publishableKey: PUBLISHABLE_KEY,
        email,
      });
      sessions.set(role, { role, cookies: cookieHeader(jar), ids: staffIds });
    }

    // --- rider --------------------------------------------------------------
    if (RIDER_PHONE && RIDER_PIN) {
      const jar = await sessionForRider({ baseUrl: BASE_URL, phone: RIDER_PHONE, pin: RIDER_PIN });
      // A rider may only open their OWN payment, so the id must be theirs.
      const { data: riderRow } = await admin
        .from('riders')
        .select('id, phone')
        .eq('phone', RIDER_PHONE)
        .maybeSingle();
      const riderId = (riderRow as { id?: string } | null)?.id;
      const ownPayment = riderId ? await firstId('payments', ['rider_id', riderId]) : undefined;
      sessions.set('rider', {
        role: 'rider',
        cookies: cookieHeader(jar),
        ids: { ...staffIds, payments: ownPayment, riders: riderId },
      });
      riderCovered = true;
    } else {
      console.warn(
        '  [smoke] SMOKE_RIDER_PHONE / SMOKE_RIDER_PIN not set — RIDER PAGES ARE NOT COVERED',
      );
    }
  }, 120_000);

  it('mints a session for at least the owner', () => {
    expect(sessions.has('owner')).toBe(true);
  });

  it('renders every page without a server error', async () => {
    const routes = discoverPageRoutes(APP_DIR);
    expect(routes.length).toBeGreaterThan(20); // discovery itself must not silently return nothing

    const failures: string[] = [];
    const skipped: string[] = [];
    let checked = 0;

    for (const route of routes) {
      if (route.role === 'public') continue;
      const session = sessions.get(route.role);
      if (!session) {
        skipped.push(`${route.pattern} (no ${route.role} session)`);
        continue;
      }

      const path = fillRoute(route.pattern, session.ids);
      if (path === null) {
        skipped.push(`${route.pattern} (no row to supply its id)`);
        continue;
      }

      const response = await fetch(new URL(path, BASE_URL), {
        headers: { cookie: session.cookies },
        redirect: 'follow',
      });
      const body = await response.text();
      checked++;

      // Landing on the login page means the session was rejected, which would
      // make every other "pass" in this run meaningless. Treat it as a failure.
      if (new URL(response.url).pathname.startsWith('/login')) {
        failures.push(`${path} [${route.role}] redirected to login — session rejected`);
        continue;
      }
      if (response.status >= 500) {
        failures.push(`${path} [${route.role}] HTTP ${response.status}`);
        continue;
      }
      if (body.includes(ERROR_BOUNDARY_MARKER)) {
        failures.push(`${path} [${route.role}] rendered the error boundary`);
      }
    }

    if (skipped.length > 0) console.warn('  [smoke] skipped:\n    ' + skipped.join('\n    '));
    console.log(
      `  [smoke] checked ${checked} pages` + (riderCovered ? '' : ' (rider pages NOT covered)'),
    );

    expect(failures.length === 0 ? '' : '\n  ' + failures.join('\n  ') + '\n').toBe('');
  }, 300_000);
});
