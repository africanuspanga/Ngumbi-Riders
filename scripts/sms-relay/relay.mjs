#!/usr/bin/env node
/*
 * Ng'umbi Riders — SMS relay for the owner's VPS.
 *
 * WHY THIS EXISTS: Mobishastra only accepts API calls from whitelisted IP
 * addresses. The web app runs on Vercel, which has no fixed outbound IP, so
 * the app sends each SMS here and this relay — running on a VPS whose IP IS
 * whitelisted — forwards it to Mobishastra.
 *
 * Zero dependencies: Node 18+ only. Configure with environment variables:
 *
 *   SMS_RELAY_SECRET       shared secret (>= 32 chars), the SAME value as in Vercel
 *   MOBISHASTRA_USER       8-digit profile id
 *   MOBISHASTRA_PASSWORD   password
 *   MOBISHASTRA_SENDER_ID  approved sender id (default GEAFA)
 *   PORT                   default 8089 (8787/8088 are taken on the shared VPS)
 *   HOST                   default 127.0.0.1 (only the reverse proxy reaches it)
 *
 * Endpoints:
 *   POST /send    {"to":["2557…"],"text":"…","sender":"GEAFA"}
 *                 headers x-relay-timestamp (unix seconds) and
 *                 x-relay-signature = hex HMAC-SHA256(secret, `${ts}.${rawBody}`)
 *   POST /balance {} (signed the same way) -> {"ok":true,"balance":9654}
 *   GET  /health  {"ok":true} — no secrets, for uptime checks
 *
 * The gateway answers HTTP 200 even when it refuses to send, so success is
 * only ever CONFIRMED from the body (code 000 or "Send Successful"); every
 * documented failure, and anything unrecognised, is reported as a failure.
 * Same rules as lib/mobishastra/codes.ts in the app, which is unit tested.
 *
 * Security: the signature is checked in constant time over the RAW body, and
 * requests older than 5 minutes are refused, so a captured request cannot be
 * replayed. Recipients must be Tanzanian (255…) numbers, at most 50 per call,
 * so a leaked secret cannot turn this into an international spam gateway.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SMS_RELAY_SECRET ?? '';
const USER = process.env.MOBISHASTRA_USER ?? '';
const PASSWORD = process.env.MOBISHASTRA_PASSWORD ?? '';
const DEFAULT_SENDER = process.env.MOBISHASTRA_SENDER_ID || 'GEAFA';
const PORT = Number(process.env.PORT || 8089);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_SKEW_SECONDS = 300;
const MAX_RECIPIENTS = 50;
const MAX_BODY_BYTES = 16 * 1024;

if (SECRET.length < 32) {
  console.error('SMS_RELAY_SECRET must be set and at least 32 characters.');
  process.exit(1);
}
if (!USER || !PASSWORD) {
  console.error('MOBISHASTRA_USER and MOBISHASTRA_PASSWORD must be set.');
  process.exit(1);
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function validSignature(timestamp, raw, signature) {
  const expected = createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODES = {
  '000': 'Send Successful', '001': 'Invalid receiver', '003': 'Invalid message',
  '005': 'Authorization failed', '006': 'DND number', '007': 'Cannot extract country code',
  '008': 'Empty receiver', '009': 'Profile blocked', '010': 'Invalid profile ID',
  '011': 'Profile ID expired', '012': 'Sender ID longer than 13 characters', '013': 'Server error',
};
const TEXT_FAILURES = [
  'invalid mobile no', 'invalid password', 'profile id blocked', 'submission stops',
  'no more credits', 'enter mobile number', 'enter text message', 'invalid profile id',
  'country not activated', 'ip address not allowed',
];

function parseGateway(raw) {
  const body = (raw ?? '').trim();
  if (!body) return { ok: false, reason: 'Empty response from gateway' };
  const code = body.match(/^(\d{3})\b/)?.[1];
  if (code && CODES[code]) return { ok: code === '000', reason: CODES[code] };
  const lower = body.toLowerCase();
  if (lower.includes('send successful') || lower.includes('send success')) return { ok: true, reason: 'Send Successful' };
  if (TEXT_FAILURES.some((f) => lower.includes(f))) return { ok: false, reason: body.slice(0, 200) };
  return { ok: false, reason: `Unrecognised gateway response: ${body.slice(0, 160)}` };
}

function parseBalance(raw) {
  const m = raw.match(/=\s*([\d,]+(?:\.\d+)?)/);
  if (m) return Number(m[1].replace(/,/g, ''));
  return null;
}

async function sendToMobishastra(numbers, text, sender) {
  const url = new URL('https://mshastra.com/sendurlcomma.aspx');
  url.searchParams.set('user', USER);
  url.searchParams.set('pwd', PASSWORD);
  url.searchParams.set('senderid', sender);
  url.searchParams.set('mobileno', numbers.join(','));
  url.searchParams.set('msgtext', text);
  url.searchParams.set('priority', 'High');
  url.searchParams.set('CountryCode', 'ALL');
  url.searchParams.set('ShowError', 'C');
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const body = (await res.text()).trim();
  if (!res.ok) return { ok: false, error: `mobishastra_http_${res.status}` };
  const parsed = parseGateway(body);
  return parsed.ok ? { ok: true, providerRef: body.slice(0, 200) } : { ok: false, error: parsed.reason };
}

async function balance() {
  const url = new URL('https://mshastra.com/balance.aspx');
  url.searchParams.set('user', USER);
  url.searchParams.set('pwd', PASSWORD);
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const raw = (await res.text()).trim();
  const value = parseBalance(raw);
  return value === null || !res.ok ? { ok: false, error: raw.slice(0, 200) } : { ok: true, balance: value };
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true });
  if (req.method !== 'POST' || (req.url !== '/send' && req.url !== '/balance')) {
    return reply(res, 404, { ok: false, error: 'not_found' });
  }

  let raw = '';
  let size = 0;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) {
      reply(res, 413, { ok: false, error: 'too_large' });
      req.destroy();
      return;
    }
    raw += chunk;
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    const ts = String(req.headers['x-relay-timestamp'] || '');
    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (!/^\d{9,11}$/.test(ts) || !(skew <= MAX_SKEW_SECONDS)) {
      return reply(res, 401, { ok: false, error: 'stale_or_missing_timestamp' });
    }
    if (!validSignature(ts, raw, req.headers['x-relay-signature'])) {
      return reply(res, 401, { ok: false, error: 'bad_signature' });
    }

    if (req.url === '/balance') {
      try {
        const result = await balance();
        return reply(res, result.ok ? 200 : 502, result);
      } catch {
        return reply(res, 502, { ok: false, error: 'gateway_unreachable' });
      }
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return reply(res, 400, { ok: false, error: 'bad_json' });
    }
    const numbers = (Array.isArray(payload.to) ? payload.to : [payload.to])
      .map((n) => String(n ?? '').replace(/[^0-9]/g, ''))
      .filter(Boolean);
    const text = String(payload.text ?? '').trim();
    const sender = /^[A-Za-z0-9 ]{1,11}$/.test(payload.sender ?? '') ? payload.sender : DEFAULT_SENDER;

    if (numbers.length === 0 || numbers.length > MAX_RECIPIENTS) {
      return reply(res, 400, { ok: false, error: 'bad_recipients' });
    }
    if (!numbers.every((n) => /^255[67]\d{8}$/.test(n))) {
      return reply(res, 400, { ok: false, error: 'non_tanzanian_number' });
    }
    if (!text || text.length > 1000) return reply(res, 400, { ok: false, error: 'bad_text' });

    try {
      const result = await sendToMobishastra(numbers, text, sender);
      console.log(new Date().toISOString(), result.ok ? 'sent' : 'failed', numbers.length, result.ok ? '' : result.error);
      return reply(res, result.ok ? 200 : 502, result);
    } catch (e) {
      console.error(new Date().toISOString(), 'gateway unreachable', e?.message);
      return reply(res, 502, { ok: false, error: 'gateway_unreachable' });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SMS relay listening on http://${HOST}:${PORT} (sender ${DEFAULT_SENDER})`);
});
