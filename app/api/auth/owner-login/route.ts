import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { ownerLoginSchema } from '@/lib/validation/auth';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/auth/rate-limit';
import { getClientIp } from '@/lib/security/request';
import { writeAudit } from '@/lib/audit/audit';

// Owner authentication: Supabase email/password (spec §7.1). No PIN. Shares the
// same brute-force throttle, keyed by IP (and the email as a pseudo-phone key).
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
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const emailKey = parsed.data.email.toLowerCase();
  const decision = await checkLoginRateLimit(emailKey, ip);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'locked', retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429 },
    );
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
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

  // Confirm this account is actually the owner; riders must not enter here.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  const role = (profile as { role: string } | null)?.role;

  if (role !== 'owner') {
    await supabase.auth.signOut();
    await recordLoginAttempt({
      phone: emailKey,
      ip,
      outcome: 'invalid_credentials',
      userAgent,
    });
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  await recordLoginAttempt({ phone: emailKey, ip, outcome: 'success', userAgent });
  await writeAudit({
    actorId: data.user.id,
    actorRole: 'owner',
    action: 'owner.login',
    ip,
  });

  return NextResponse.json({ ok: true, redirectTo: '/owner' });
}
