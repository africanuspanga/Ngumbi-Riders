import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySnippeSignature } from '@/lib/payments/webhook-verify';
import { nextReceiptNumber } from '@/lib/payments/service';

/*
 * Snippe webhook — the PRIMARY source of truth for payment status (spec §12.1).
 *
 *   1. Read the RAW body and verify HMAC-SHA256 over "{timestamp}.{body}".
 *   2. Reject stale timestamps (replay protection).
 *   3. Deduplicate by event id (unique) — a replayed event is a harmless no-op.
 *   4. Confirm reference, currency and amount against the local payment.
 *   5. Settle atomically via record_completed_payment (allocations + receipt).
 *
 * Never trusts a browser callback; always returns 2xx quickly after recording.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = serverEnv().SNIPPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp');
  const signature = request.headers.get('x-webhook-signature');

  const verified = verifySnippeSignature({
    rawBody,
    timestamp,
    signature,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!verified.valid) {
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  let event: {
    id?: string;
    type?: string;
    data?: {
      reference?: string;
      status?: string;
      amount?: { value?: number; currency?: string };
      completed_at?: string;
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }
  if (!event.id || !event.type || !event.data?.reference) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const admin = createAdminClient();
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');

  // Deduplicate: unique provider_event_id / payload_hash make replays no-ops.
  const { error: dupErr } = await admin.from('payment_events').insert({
    event_type: event.type,
    provider_event_id: event.id,
    payload_hash: payloadHash,
    raw_payload: event,
  });
  if (dupErr) {
    if (/duplicate key/i.test(dupErr.message)) {
      return NextResponse.json({ ok: true, deduped: true }); // already processed
    }
    return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  }

  // Locate the local payment by provider reference.
  const { data: payment } = await admin
    .from('payments')
    .select('id, rider_id, amount, status')
    .eq('snippe_reference', event.data.reference)
    .maybeSingle();
  if (!payment) {
    return NextResponse.json({ ok: true, unknown_reference: true });
  }
  const p = payment as { id: string; rider_id: string; amount: number; status: string };
  await admin.from('payment_events').update({ payment_id: p.id }).eq('provider_event_id', event.id);

  async function notifyRider(type: string, title: string, body: string) {
    const { data: rider } = await admin
      .from('riders')
      .select('profile_id')
      .eq('id', p.rider_id)
      .maybeSingle();
    const profileId = (rider as { profile_id: string } | null)?.profile_id;
    if (profileId) {
      await admin.from('notifications').insert({
        recipient_profile_id: profileId,
        type,
        title,
        body,
        deep_link: `/rider/payments/${p.id}`,
        dedupe_key: `${type}:${p.id}`,
      });
    }
  }

  if (event.type === 'payment.completed') {
    // Amount/currency must match the reserved payment (spec §12.2 step 13).
    const value = event.data.amount?.value;
    const currency = event.data.amount?.currency;
    if (currency !== 'TZS' || value !== p.amount) {
      // Do not settle a mismatched payment; reconciliation surfaces it.
      return NextResponse.json({ ok: true, amount_mismatch: true });
    }
    if (p.status === 'completed') return NextResponse.json({ ok: true });

    const { data: reservations } = await admin
      .from('payment_reservations')
      .select('obligation_id')
      .eq('payment_id', p.id)
      .eq('is_active', true);
    const obligationIds = ((reservations ?? []) as { obligation_id: string }[]).map((r) => r.obligation_id);

    const receiptNumber = await nextReceiptNumber(new Date().getFullYear());
    const completedAt = event.data.completed_at ?? new Date().toISOString();

    const { error } = await admin.rpc('record_completed_payment', {
      p_payment_id: p.id,
      p_obligation_ids: obligationIds,
      p_receipt_number: receiptNumber,
      p_completed_at: completedAt,
    });
    if (error) {
      return NextResponse.json({ error: 'settlement_failed' }, { status: 500 });
    }
    await notifyRider('payment_completed', 'Malipo yamekamilika', 'Malipo yako yamepokelewa. Asante.');
    return NextResponse.json({ ok: true, settled: true });
  }

  if (event.type === 'payment.failed' || event.type === 'payment.expired' || event.type === 'payment.voided') {
    const status = event.type === 'payment.failed' ? 'failed' : event.type === 'payment.expired' ? 'expired' : 'cancelled';
    await admin.from('payments').update({ status }).eq('id', p.id);
    await admin.from('payment_reservations').update({ is_active: false }).eq('payment_id', p.id);
    await notifyRider('payment_failed', 'Malipo hayakukamilika', 'Malipo yako hayakukamilika. Tafadhali jaribu tena.');
    return NextResponse.json({ ok: true, status });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
