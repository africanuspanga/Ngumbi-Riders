import 'server-only';

import { serverEnv } from '@/lib/env';

/*
 * Snippe API client (Integration Guide, API v2026-01-25). ALL calls originate
 * server-side; the API key and webhook secret never reach the browser. Mobile
 * money is the only rider-facing method. TZS only; minimum 500.
 */
const DEFAULT_BASE = 'https://api.snippe.sh';

export type SnippeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: number };

export type CreatedPayment = {
  reference: string;
  status: string;
  expiresAt: string | null;
};

function config() {
  const env = serverEnv();
  return {
    apiKey: env.SNIPPE_API_KEY,
    base: env.SNIPPE_BASE_URL || DEFAULT_BASE,
  };
}

export function isSnippeConfigured(): boolean {
  return Boolean(serverEnv().SNIPPE_API_KEY);
}

export async function createMobilePayment(input: {
  amount: number;
  phone: string;
  firstname: string;
  lastname: string;
  email: string;
  idempotencyKey: string;
  webhookUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<SnippeResult<CreatedPayment>> {
  const { apiKey, base } = config();
  if (!apiKey) return { ok: false, error: 'not_configured' };

  let res: Response;
  try {
    res = await fetch(`${base}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        payment_type: 'mobile',
        details: { amount: input.amount, currency: 'TZS' },
        phone_number: input.phone,
        customer: {
          firstname: input.firstname || 'Rider',
          lastname: input.lastname || 'Ngumbi',
          email: input.email || 'noreply@ngumbi.co.tz',
        },
        webhook_url: input.webhookUrl,
        metadata: input.metadata ?? {},
      }),
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }

  const json = (await res.json().catch(() => null)) as
    | { status?: string; data?: { reference: string; status: string; expires_at?: string }; message?: string }
    | null;

  if (!res.ok || json?.status !== 'success' || !json.data) {
    return { ok: false, error: json?.message ?? 'snippe_error', code: res.status };
  }
  return {
    ok: true,
    data: {
      reference: json.data.reference,
      status: json.data.status,
      expiresAt: json.data.expires_at ?? null,
    },
  };
}

export async function getPaymentStatus(
  reference: string,
): Promise<SnippeResult<{ status: string; amountValue: number | null }>> {
  const { apiKey, base } = config();
  if (!apiKey) return { ok: false, error: 'not_configured' };
  let res: Response;
  try {
    res = await fetch(`${base}/v1/payments/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  const json = (await res.json().catch(() => null)) as
    | { status?: string; data?: { status: string; amount?: { value: number } }; message?: string }
    | null;
  if (!res.ok || json?.status !== 'success' || !json.data) {
    return { ok: false, error: json?.message ?? 'snippe_error', code: res.status };
  }
  return { ok: true, data: { status: json.data.status, amountValue: json.data.amount?.value ?? null } };
}

/** Re-trigger the USSD push for an existing pending payment (spec §12.5). */
export async function triggerPush(reference: string): Promise<SnippeResult<true>> {
  const { apiKey, base } = config();
  if (!apiKey) return { ok: false, error: 'not_configured' };
  let res: Response;
  try {
    res = await fetch(`${base}/v1/payments/${encodeURIComponent(reference)}/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  if (!res.ok) return { ok: false, error: 'snippe_error', code: res.status };
  return { ok: true, data: true };
}
