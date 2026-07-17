import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/auth/phone';
import { derivePassword } from '@/lib/auth/pin-derive';
import { riderLoginSchema } from '@/lib/validation/auth';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/auth/rate-limit';
import { getClientIp } from '@/lib/security/request';
import { writeAudit } from '@/lib/audit/audit';

// Rider login runs entirely server-side (spec §7.2). The raw PIN never reaches
// Supabase: we derive the actual password with a keyed HMAC using the
// server-only pepper, then sign in. Responses are deliberately generic to
// resist phone-number enumeration.
export const runtime = 'nodejs';

const GENERIC_401 = { error: 'invalid_credentials' as const };

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = riderLoginSchema.safeParse(body);
  if (!parsed.success) {
    // Do not reveal which field failed; count it against the IP.
    await recordLoginAttempt({ phone: null, ip, outcome: 'invalid_credentials', userAgent });
    return NextResponse.json(GENERIC_401, { status: 401 });
  }

  // Normalize before rate-limiting so the limit keys on the canonical phone.
  let canonicalPhone: string | null = null;
  try {
    canonicalPhone = normalizePhone(parsed.data.phone);
  } catch {
    await recordLoginAttempt({ phone: null, ip, outcome: 'invalid_credentials', userAgent });
    return NextResponse.json(GENERIC_401, { status: 401 });
  }

  // ---- Rate limit / lockout ---------------------------------------------
  const decision = await checkLoginRateLimit(canonicalPhone, ip);
  if (!decision.allowed) {
    await writeAudit({
      actorId: null,
      actorRole: 'anonymous',
      action: 'auth.locked_out',
      metadata: { phone: canonicalPhone },
      ip,
    });
    return NextResponse.json(
      { error: 'locked', retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
    );
  }

  // ---- Derive password + sign in ----------------------------------------
  const password = derivePassword(canonicalPhone, parsed.data.pin);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    phone: canonicalPhone,
    password,
  });

  if (error || !data.user) {
    await recordLoginAttempt({
      phone: canonicalPhone,
      ip,
      outcome: 'invalid_credentials',
      userAgent,
    });
    return NextResponse.json(GENERIC_401, { status: 401 });
  }

  // ---- Rider status gate --------------------------------------------------
  // Credentials alone are not enough: a rider the owner disabled (inactive /
  // suspended / terminated) must not get a session. Without this check,
  // "disable" only changed a column while the login kept working — and the
  // seeded demo riders' PINs are public in scripts/seed.ts. Sign the fresh
  // session out and return the same generic 401 (no status oracle).
  const { data: riderRow } = await supabase
    .from('riders')
    .select('status')
    .eq('profile_id', data.user.id)
    .maybeSingle();
  const riderStatus = (riderRow as { status: string } | null)?.status ?? null;
  if (riderStatus !== 'active' && riderStatus !== 'onboarding') {
    await supabase.auth.signOut();
    await writeAudit({
      actorId: data.user.id,
      actorRole: 'rider',
      action: 'rider.login_blocked_status',
      metadata: { status: riderStatus },
      ip,
    });
    return NextResponse.json(GENERIC_401, { status: 401 });
  }

  // ---- Success -----------------------------------------------------------
  await recordLoginAttempt({ phone: canonicalPhone, ip, outcome: 'success', userAgent });
  await writeAudit({
    actorId: data.user.id,
    actorRole: 'rider',
    action: 'rider.login',
    ip,
  });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, must_change_pin')
    .eq('id', data.user.id)
    .maybeSingle();

  const p = profile as { role: string; must_change_pin: boolean | null } | null;
  const mustChangePin = p?.must_change_pin ?? false;

  return NextResponse.json({
    ok: true,
    mustChangePin,
    redirectTo: mustChangePin ? '/rider/settings/pin?forced=1' : '/rider',
  });
}
