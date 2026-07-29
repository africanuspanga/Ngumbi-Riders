import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
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

// Owner authentication: Supabase email/password OR phone/password (spec §7.1 —
// the owner may sign in with either identifier; his auth user carries both a
// confirmed email and a confirmed phone). No PIN. Shares the same brute-force
// throttle, keyed by IP (and the identifier as a pseudo-phone key).
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

  const supabase = await createServerSupabase();
  const { data, error } =
    'phone' in identifier
      ? await supabase.auth.signInWithPassword({
          phone: identifier.phone,
          password: parsed.data.password,
        })
      : await supabase.auth.signInWithPassword({
          email: identifier.email,
          password: parsed.data.password,
        });

  if (error || !data.user) {
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
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  const p = profile as { role: UserRole; is_active: boolean | null } | null;
  const role = p?.role;

  if (!isStaffRole(role)) {
    await supabase.auth.signOut();
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
    await supabase.auth.signOut();
    await recordLoginAttempt({ phone: emailKey, ip, outcome: 'invalid_credentials', userAgent });
    return NextResponse.json({ error: 'account_disabled' }, { status: 403 });
  }

  await recordLoginAttempt({ phone: emailKey, ip, outcome: 'success', userAgent });
  await writeAudit({
    actorId: data.user.id,
    actorRole: role!,
    action: `${role}.login`,
    ip,
  });

  return NextResponse.json({ ok: true, redirectTo: homePathFor(role) });
}
