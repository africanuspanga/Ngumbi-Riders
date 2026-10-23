import 'server-only';

import { createHmac } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { normalizeSmsText, toMsisdn } from './text';
import { parseBalance, parseMobishastraResponse } from './codes';

/*
 * Mobishastra SMS adapter (Mobishastra API Integration guide v1.3).
 *
 * TWO TRANSPORTS, ONE RESULT SHAPE
 *
 * 1. RELAY (preferred, client request 2026-10-23: "SMS via my VPS").
 *    Mobishastra accepts API calls only from whitelisted IP addresses, and a
 *    Vercel function has no fixed outbound IP. So the app POSTs the message to
 *    a tiny relay on the owner's VPS (scripts/sms-relay/relay.mjs), which holds
 *    the Mobishastra credentials and calls the gateway from the VPS's fixed,
 *    whitelisted address. The request is HMAC-signed with SMS_RELAY_SECRET over
 *    `${timestamp}.${body}` and the relay refuses anything older than 5
 *    minutes, so a captured request cannot be replayed to spam riders.
 *
 * 2. DIRECT — the original GET to https://mshastra.com/sendurlcomma.aspx, used
 *    when no relay is configured but MOBISHASTRA_USER/PASSWORD are (e.g. a
 *    deployment whose IP is whitelisted).
 *
 * Sender ID defaults to GEAFA, the ID approved for this business. The doc: "In
 * case the sender ID doesn't match the approved ones, SMS will go from the
 * default ID" — so a typo would not fail, it would silently send unbranded.
 *
 * Disabled-safe: with neither transport configured every call returns
 * not_configured, and the outbox leaves the message pending (no attempt
 * burned) so it delivers on the first run after credentials land.
 */
const DEFAULT_BASE = 'https://mshastra.com';
export const DEFAULT_SENDER_ID = 'GEAFA';

export type SmsResult = { ok: true; providerRef: string | null } | { ok: false; error: string };

export { toMsisdn };

type Transport = 'relay' | 'direct' | null;

export function smsTransport(): Transport {
  const env = serverEnv();
  if (env.SMS_RELAY_URL && env.SMS_RELAY_SECRET) return 'relay';
  if (env.MOBISHASTRA_USER && env.MOBISHASTRA_PASSWORD) return 'direct';
  return null;
}

export function isMobishastraConfigured(): boolean {
  return smsTransport() !== null;
}

export function senderId(): string {
  return serverEnv().MOBISHASTRA_SENDER_ID || DEFAULT_SENDER_ID;
}

/** Sign a relay request body. Exported for the relay's own test. */
export function signRelayRequest(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export async function sendSms(input: {
  /** One or more E.164 numbers; multiple are comma-joined per the API. */
  to: string | string[];
  text: string;
}): Promise<SmsResult> {
  const transport = smsTransport();
  if (!transport) return { ok: false, error: 'not_configured' };

  const numbers = (Array.isArray(input.to) ? input.to : [input.to]).map(toMsisdn).filter(Boolean);
  if (numbers.length === 0) return { ok: false, error: 'no_recipient' };
  const text = normalizeSmsText(input.text);
  if (!text) return { ok: false, error: 'empty_message' };

  return transport === 'relay'
    ? sendViaRelay(numbers, text)
    : sendDirect(numbers, text);
}

async function sendViaRelay(numbers: string[], text: string): Promise<SmsResult> {
  const env = serverEnv();
  const body = JSON.stringify({ to: numbers, text, sender: senderId() });
  const timestamp = String(Math.floor(Date.now() / 1000));
  let res: Response;
  try {
    res = await fetch(env.SMS_RELAY_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-relay-timestamp': timestamp,
        'x-relay-signature': signRelayRequest(env.SMS_RELAY_SECRET!, timestamp, body),
      },
      body,
      // Runs inside the nightly dispatcher's budget; one hung socket must not
      // starve the remaining tasks.
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: 'relay_unreachable' };
  }
  const reply = (await res.json().catch(() => null)) as
    | { ok?: boolean; providerRef?: string | null; error?: string }
    | null;
  if (res.ok && reply?.ok) return { ok: true, providerRef: reply.providerRef ?? null };
  return { ok: false, error: (reply?.error || `relay_http_${res.status}`).slice(0, 200) };
}

async function sendDirect(numbers: string[], text: string): Promise<SmsResult> {
  const env = serverEnv();
  const url = new URL('/sendurlcomma.aspx', env.MOBISHASTRA_BASE_URL || DEFAULT_BASE);
  url.searchParams.set('user', env.MOBISHASTRA_USER!);
  url.searchParams.set('pwd', env.MOBISHASTRA_PASSWORD!);
  url.searchParams.set('senderid', senderId());
  url.searchParams.set('mobileno', numbers.join(','));
  url.searchParams.set('msgtext', text);
  url.searchParams.set('priority', 'High');
  // Required, or the gateway treats numbers as UAE (the doc's default).
  url.searchParams.set('CountryCode', 'ALL');
  url.searchParams.set('ShowError', 'C');

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'GET', signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  const reply = ((await res.text().catch(() => '')) ?? '').trim();
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  const parsed = parseMobishastraResponse(reply);
  return parsed.ok ? { ok: true, providerRef: reply || null } : { ok: false, error: parsed.reason };
}

/**
 * Remaining SMS credit. "No More Credits" is a silent killer — reminders keep
 * "sending" on screen while every one fails — so the owner's system page shows
 * it. Read through the relay when configured (the gateway refuses Vercel IPs).
 */
export async function checkSmsBalance(): Promise<
  { ok: true; balance: number } | { ok: false; error: string }
> {
  const env = serverEnv();
  const transport = smsTransport();
  if (!transport) return { ok: false, error: 'not_configured' };
  try {
    if (transport === 'relay') {
      const body = '{}';
      const timestamp = String(Math.floor(Date.now() / 1000));
      // Sibling of the send URL, keeping any path prefix (…/ngumbi/send → …/ngumbi/balance).
      const res = await fetch(env.SMS_RELAY_URL!.replace(/\/send\/?$/, '/balance'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-relay-timestamp': timestamp,
          'x-relay-signature': signRelayRequest(env.SMS_RELAY_SECRET!, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const reply = (await res.json().catch(() => null)) as
        | { ok?: boolean; balance?: number; error?: string }
        | null;
      return reply?.ok && typeof reply.balance === 'number'
        ? { ok: true, balance: reply.balance }
        : { ok: false, error: reply?.error ?? `relay_http_${res.status}` };
    }
    const url = new URL('/balance.aspx', env.MOBISHASTRA_BASE_URL || DEFAULT_BASE);
    url.searchParams.set('user', env.MOBISHASTRA_USER!);
    url.searchParams.set('pwd', env.MOBISHASTRA_PASSWORD!);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const raw = (await res.text()).trim();
    const balance = parseBalance(raw);
    return res.ok && balance !== null ? { ok: true, balance } : { ok: false, error: raw.slice(0, 200) };
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}
