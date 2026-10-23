/*
 * Mobishastra response parsing (API Integration v1.3), ported from the HAKIKI
 * relay that already runs against the same account on the same VPS.
 *
 * The gateway answers HTTP 200 even when it refuses to send, so the BODY is
 * the only truth. With ShowError=C it answers a numeric code; without it, free
 * text. Several failures ("No More Credits", "Submission Stops", "Country not
 * activated") contain no word like "error", so failures are enumerated and
 * success must be positively confirmed — never inferred from the absence of an
 * error. Pure, so the relay's behaviour is unit tested here.
 */

export const MOBISHASTRA_CODES: Record<string, string> = {
  '000': 'Send Successful',
  '001': 'Invalid receiver',
  '003': 'Invalid message',
  '005': 'Authorization failed',
  '006': 'DND number',
  '007': 'Cannot extract country code',
  '008': 'Empty receiver',
  '009': 'Profile blocked',
  '010': 'Invalid profile ID',
  '011': 'Profile ID expired',
  '012': 'Sender ID longer than 13 characters',
  '013': 'Server error',
};

const TEXT_FAILURES = [
  'invalid mobile no',
  'invalid password',
  'profile id blocked',
  'submission stops',
  'no more credits',
  'enter mobile number',
  'enter text message',
  'invalid profile id',
  'country not activated',
  'ip address not allowed',
];

export type ParsedSmsResponse = { ok: boolean; reason: string };

export function parseMobishastraResponse(raw: string): ParsedSmsResponse {
  const body = (raw ?? '').trim();
  if (!body) return { ok: false, reason: 'Empty response from gateway' };

  const code = body.match(/^(\d{3})\b/)?.[1];
  if (code && code in MOBISHASTRA_CODES) {
    return { ok: code === '000', reason: MOBISHASTRA_CODES[code]! };
  }

  const lower = body.toLowerCase();
  if (lower.includes('send successful') || lower.includes('send success')) {
    return { ok: true, reason: 'Send Successful' };
  }
  if (TEXT_FAILURES.some((f) => lower.includes(f))) return { ok: false, reason: body.slice(0, 200) };
  return { ok: false, reason: `Unrecognised gateway response: ${body.slice(0, 160)}` };
}

/**
 * Credit balance from `/balance.aspx`. The live account answers
 * `Tanzania (+255) = 9654,` — taking the first number would read the dialling
 * code (255) and make a healthy account look nearly empty.
 */
export function parseBalance(raw: string): number | null {
  const afterEquals = raw.match(/=\s*([\d,]+(?:\.\d+)?)/);
  if (afterEquals) {
    const n = Number(afterEquals[1]!.replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  const cleaned = raw.replace(/\(\s*\+?\d+\s*\)|\+\d+/g, ' ');
  const numbers = [...cleaned.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : null;
}
