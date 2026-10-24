import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { resendStaffChallenge } from '@/lib/auth/staff-otp';

// "Send the code again" on the staff sign-in code screen (D-053). Cooldown,
// per-challenge send cap and attempts are enforced in lib/auth/staff-otp-core.
export const runtime = 'nodejs';

const bodySchema = z.object({ challengeId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const result = await resendStaffChallenge(parsed.data.challengeId);
  if (!result.ok) {
    const status = result.error === 'sms_failed' || result.error === 'server_error' ? 503 : 429;
    return NextResponse.json(
      { error: `otp_${result.error}`, retryAfterSeconds: result.retryAfterSeconds },
      { status },
    );
  }
  return NextResponse.json({ ok: true, maskedPhone: result.maskedPhone });
}
