import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkLoginRateLimit, recordLoginAttempt } from '@/lib/auth/rate-limit';
import { mintVerifiedStaffSession, verifyStaffChallenge } from '@/lib/auth/staff-otp';
import { getClientIp } from '@/lib/security/request';
import { writeAudit } from '@/lib/audit/audit';
import { homePathFor, isStaffRole } from '@/lib/auth/roles';
import type { UserRole } from '@/lib/supabase/types';

// Staff authentication, step 2 of 2 (D-053): the SMS code. Only here is the
// browser session created, and it is recorded as verified so the RLS helpers
// treat it as owner/accountant (0037).
export const runtime = 'nodejs';

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().max(20),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Per-challenge attempts are capped on the row; this caps one IP spraying
  // guesses across many challenges.
  const decision = await checkLoginRateLimit(null, ip);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'locked', retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429 },
    );
  }

  const result = await verifyStaffChallenge(parsed.data.challengeId, parsed.data.code);
  if (!result.ok) {
    if (result.error === 'wrong_code') {
      await recordLoginAttempt({ phone: null, ip, outcome: 'invalid_credentials', userAgent });
    }
    return NextResponse.json(
      { error: `otp_${result.error}`, attemptsLeft: result.attemptsLeft },
      { status: 401 },
    );
  }

  // Re-check the account: it may have been deactivated while the SMS was in
  // flight.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', result.userId)
    .maybeSingle();
  const p = profile as { role: UserRole; is_active: boolean | null } | null;
  const role = p?.role;
  if (!isStaffRole(role)) return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  if (role !== 'owner' && p?.is_active === false) {
    return NextResponse.json({ error: 'account_disabled' }, { status: 403 });
  }

  const minted = await mintVerifiedStaffSession({
    userId: result.userId,
    challengeId: result.challengeId,
    mustRecord: true,
  });
  if (!minted.ok) {
    console.error('[owner-login/verify] session mint failed:', minted.error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  await recordLoginAttempt({ phone: null, ip, outcome: 'success', userAgent });
  await writeAudit({ actorId: result.userId, actorRole: role!, action: `${role}.login`, ip });
  return NextResponse.json({ ok: true, redirectTo: homePathFor(role) });
}
