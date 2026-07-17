import 'server-only';

import { serverEnv } from '@/lib/env';

/*
 * Mobishastra SMS adapter (build spec #4 guarantor SMS, #6 owner request
 * notification). Uses the HTTP GET "sendurlcomma" endpoint documented in the
 * Mobishastra API Integration guide (v1.3):
 *
 *   https://mshastra.com/sendurlcomma.aspx
 *     ?user=<8-digit profile id>&pwd=<password>&senderid=<approved sender>
 *     &mobileno=<comma-separated msisdns>&msgtext=<url-encoded text>
 *     &priority=High&CountryCode=ALL
 *
 * A successful send returns a body containing "Send Successful". CountryCode=ALL
 * is required so Tanzanian (+255) numbers are accepted (the doc defaults to UAE).
 *
 * Disabled-safe: every call returns not_configured until MOBISHASTRA_USER,
 * MOBISHASTRA_PASSWORD and MOBISHASTRA_SENDER_ID are set — exactly like the
 * Resend and Snippe adapters, so nothing breaks before credentials land.
 */
const DEFAULT_BASE = 'https://mshastra.com';

export function isMobishastraConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.MOBISHASTRA_USER && env.MOBISHASTRA_PASSWORD && env.MOBISHASTRA_SENDER_ID);
}

export type SmsResult = { ok: true; providerRef: string | null } | { ok: false; error: string };

/** Mobishastra accepts digits only; keep a leading country code, drop "+"/spaces. */
export function toMsisdn(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export async function sendSms(input: {
  /** One or more E.164 numbers; multiple are comma-joined per the API. */
  to: string | string[];
  text: string;
}): Promise<SmsResult> {
  const env = serverEnv();
  if (!env.MOBISHASTRA_USER || !env.MOBISHASTRA_PASSWORD || !env.MOBISHASTRA_SENDER_ID) {
    return { ok: false, error: 'not_configured' };
  }
  const numbers = (Array.isArray(input.to) ? input.to : [input.to]).map(toMsisdn).filter(Boolean);
  if (numbers.length === 0) return { ok: false, error: 'no_recipient' };

  const base = env.MOBISHASTRA_BASE_URL || DEFAULT_BASE;
  const url = new URL('/sendurlcomma.aspx', base);
  url.searchParams.set('user', env.MOBISHASTRA_USER);
  url.searchParams.set('pwd', env.MOBISHASTRA_PASSWORD);
  url.searchParams.set('senderid', env.MOBISHASTRA_SENDER_ID);
  url.searchParams.set('mobileno', numbers.join(','));
  url.searchParams.set('msgtext', input.text);
  url.searchParams.set('priority', 'High');
  url.searchParams.set('CountryCode', 'ALL');

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'GET' });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  const body = (await res.text().catch(() => '')) ?? '';
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  // The gateway returns 200 with a plain-text body; "Send Successful" (with a
  // trailing message id) signals acceptance. Anything else is a provider error.
  if (/send\s*successful/i.test(body)) {
    return { ok: true, providerRef: body.trim() || null };
  }
  return { ok: false, error: body.trim().slice(0, 200) || 'sms_error' };
}
