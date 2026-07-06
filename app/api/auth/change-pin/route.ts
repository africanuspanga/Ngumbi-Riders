import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { derivePassword } from '@/lib/auth/pin-derive';
import { validatePin } from '@/lib/auth/pin';
import { changePinSchema } from '@/lib/validation/auth';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/auth/rate-limit';
import { getClientIp } from '@/lib/security/request';
import { writeAudit } from '@/lib/audit/audit';

// Authenticated rider changes their own PIN (spec §7.3). Verifies the current
// PIN, enforces weak-PIN rules on the new PIN, rotates the derived Supabase
// password, and clears the temporary-PIN flag. Also brute-force throttled.
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = changePinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { currentPin, newPin, confirmPin } = parsed.data;

  if (newPin !== confirmPin) {
    return NextResponse.json({ error: 'mismatch' }, { status: 400 });
  }

  // The canonical phone we control is on the rider row (stored with +255...).
  const { data: rider } = await supabase
    .from('riders')
    .select('id, phone')
    .eq('profile_id', user.id)
    .maybeSingle();
  const riderRow = rider as { id: string; phone: string } | null;
  if (!riderRow?.phone) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const canonicalPhone = riderRow.phone;

  // Weak-PIN enforcement on the NEW pin (rejects 0000/1234/repeats/phone tail).
  const strength = validatePin(newPin, canonicalPhone);
  if (!strength.ok) {
    return NextResponse.json(
      { error: 'weak_pin', reason: strength.reason },
      { status: 422 },
    );
  }

  // Throttle current-PIN verification attempts.
  const decision = await checkLoginRateLimit(canonicalPhone, ip);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'locked', retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429 },
    );
  }

  // Verify the current PIN by re-authenticating with its derived password.
  const currentPassword = derivePassword(canonicalPhone, currentPin);
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    phone: canonicalPhone,
    password: currentPassword,
  });
  if (verifyError) {
    await recordLoginAttempt({
      phone: canonicalPhone,
      ip,
      outcome: 'invalid_credentials',
      userAgent,
    });
    return NextResponse.json({ error: 'invalid_current_pin' }, { status: 401 });
  }

  // Rotate the password to the new derived value.
  const newPassword = derivePassword(canonicalPhone, newPin);
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Clear the temporary-PIN flag with the service role (riders cannot write it).
  const admin = createAdminClient();
  await admin
    .from('profiles')
    .update({ must_change_pin: false })
    .eq('id', user.id);

  await writeAudit({
    actorId: user.id,
    actorRole: 'rider',
    action: 'rider.pin_changed',
    entityType: 'rider',
    entityId: riderRow.id,
    ip,
  });

  return NextResponse.json({ ok: true, redirectTo: '/rider' });
}
