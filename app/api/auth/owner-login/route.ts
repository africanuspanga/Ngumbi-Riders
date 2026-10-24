import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  checkStaffPassword,
  isStaffOtpRequired,
  mintVerifiedStaffSession,
  startStaffChallenge,
} from '@/lib/auth/staff-otp';
import { ownerLoginSchema } from '@/lib/validation/auth';
import { normalizePhone } from '@/lib/auth/phone';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/auth/rate-limit';
import { getClientIp } from '@/lib/security/request';
import { writeAudit } from '@/lib/audit/audit';
import { homePathFor, isStaffRole } from '@/lib/auth/roles';
import type { UserRole } from '@/lib/supabase/types';

// Staff authentication, step 1 of 2 (D-053): Supabase email/password OR
// phone/password (spec §7.1 —
// the owner may sign in with either identifier; his auth user carries both a
// confirmed email and a confirmed phone). No PIN. Shares the same brute-force
// throttle, keyed by IP (and the identifier as a pseudo-phone key). A correct
// password earns an SMS code; step 2 is ./verify/route.ts.
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = ownerLoginSchema.safeParse(body);
  if (!parsed.success) {
    // Malformed probes count toward the IP throttle like any failed attempt —
    // otherwise crafted payloads bypass the lockout counter entirely.
    await recordLoginAttempt({ phone: 'invalid', ip, outcome: 'invalid_credentials', userAgent });
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Resolve the identifier strictly: a canonical E.164 phone or a validated
  // email. Nothing else may reach the rate limiter (its filter interpolates
  // the key) or Supabase.
  let identifier: { phone: string } | { email: string };
  try {
    identifier = { phone: normalizePhone(parsed.data.email) };
  } catch {
    const email = z.string().email().safeParse(parsed.data.email.toLowerCase());
    if (!email.success) {
      await recordLoginAttempt({ phone: 'invalid', ip, outcome: 'invalid_credentials', userAgent });
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    identifier = { email: email.data };
  }
  const emailKey = 'phone' in identifier ? identifier.phone : identifier.email;
  const decision = await checkLoginRateLimit(emailKey, ip);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'locked', retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429 },
    );
  }

  // Step 1 checks the password on a throwaway client: no cookie is written
  // here. The browser session is only created once the SMS code is entered
  // (D-053) — or straight away while the kill switch is off.
  const check = await checkStaffPassword(identifier, parsed.data.password);
  if (!check.ok) {
    await recordLoginAttempt({
      phone: emailKey,
      ip,
      outcome: 'invalid_credentials',
      userAgent,
    });
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Confirm this account is back-office staff; riders must not enter here.
  // Accountants (spec #10) share this email/password entrance with the owner
  // and are routed to their own area.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', check.userId)
    .maybeSingle();
  const p = profile as { role: UserRole; is_active: boolean | null } | null;
  const role = p?.role;

  if (!isStaffRole(role)) {
    await recordLoginAttempt({
      phone: emailKey,
      ip,
      outcome: 'invalid_credentials',
      userAgent,
    });
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // A deactivated accountant is refused at the door — the owner withdrawing
  // access must end the session path immediately, not at token expiry. The
  // owner is never gated on this flag (locking the sole owner out would be
  // unrecoverable from inside the app).
  if (role !== 'owner' && p?.is_active === false) {
    await recordLoginAttempt({ phone: emailKey, ip, outcome: 'invalid_credentials', userAgent });
    return NextResponse.json({ error: 'account_disabled' }, { status: 403 });
  }

  if (await isStaffOtpRequired()) {
    const challenge = await startStaffChallenge({ userId: check.userId, ip });
    if (!challenge.ok) {
      const status = challenge.error === 'too_many_codes' ? 429 : challenge.error === 'no_phone' ? 403 : 503;
      return NextResponse.json({ error: `otp_${challenge.error}` }, { status });
    }
    await writeAudit({
      actorId: check.userId,
      actorRole: role!,
      action: `${role}.login_code_sent`,
      ip,
    });
    return NextResponse.json({
      otpRequired: true,
      challengeId: challenge.challengeId,
      maskedPhone: challenge.maskedPhone,
    });
  }

  // Kill switch off: sign straight in. The session is still recorded as
  // verified, so turning the switch on later does not sign this person out.
  const minted = await mintVerifiedStaffSession({
    userId: check.userId,
    challengeId: null,
    mustRecord: false,
  });
  if (!minted.ok) {
    console.error('[owner-login] session mint failed:', minted.error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  await recordLoginAttempt({ phone: emailKey, ip, outcome: 'success', userAgent });
  await writeAudit({
    actorId: check.userId,
    actorRole: role!,
    action: `${role}.login`,
    ip,
  });

  return NextResponse.json({ ok: true, redirectTo: homePathFor(role) });
}
