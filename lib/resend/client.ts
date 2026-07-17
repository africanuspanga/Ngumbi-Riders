import 'server-only';

import { serverEnv } from '@/lib/env';

/*
 * Resend email adapter (spec §18). Uses the REST API directly (no SDK dep).
 * Disabled until RESEND_API_KEY + RESEND_FROM_EMAIL are configured — every call
 * returns not_configured so nothing breaks before credentials land.
 */
export function isResendConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return { ok: false, error: 'not_configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // Timeout: runs inside the 300s nightly dispatcher — a hung socket must
      // not starve the remaining tasks.
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });
    const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) return { ok: false, error: json?.message ?? 'resend_error' };
    return { ok: true, id: json?.id ?? null };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
