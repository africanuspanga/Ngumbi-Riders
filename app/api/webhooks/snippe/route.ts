import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySnippeSignature } from '@/lib/payments/webhook-verify';

/*
 * Snippe webhook — the PRIMARY source of truth for payment status (spec §12.1).
 *
 *   1. Read the RAW body and verify HMAC-SHA256 over "{timestamp}.{body}".
 *   2. Reject stale timestamps (replay protection).
 *   3. Record the event id (unique) for audit/dedupe — but a duplicate event
 *      still falls through to processing, because every step below is
 *      idempotent. This way a delivery that failed mid-processing is retried
 *      by Snippe and actually completes, instead of being swallowed by the
 *      dedupe row its failed attempt left behind.
 *   4. Confirm reference, currency and amount against the local payment.
 *   5. Settle atomically via record_completed_payment (allocations + receipt;
 *      the receipt number is allocated from a sequence inside the function).
 *
 * Never trusts a browser callback. Failure events never overwrite a payment
 * that already reached 'completed' — late/out-of-order failed/voided events
 * are recorded but must not corrupt settled money (spec rule 6).
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

  // Record the event for audit. A duplicate is NOT an early exit — processing
  // below is idempotent, and the previous attempt may have failed after this
  // insert succeeded.
  let deduped = false;
  const { error: dupErr } = await admin.from('payment_events').insert({
    event_type: event.type,
    provider_event_id: event.id,
    payload_hash: payloadHash,
    raw_payload: event,
  });
  if (dupErr) {
    if (/duplicate key/i.test(dupErr.message)) {
      deduped = true;
    } else {
      return NextResponse.json({ error: 'store_failed' }, { status: 500 });
    }
  }

  // Locate the local payment by provider reference.
  const { data: payment } = await admin
    .from('payments')
    .select('id, rider_id, amount, status')
    .eq('snippe_reference', event.data.reference)
    .maybeSingle();
  if (!payment) {
    // The initiate route stores snippe_reference only after Snippe responds,
    // so a very fast webhook can race it. Return non-2xx so Snippe retries;
    // the retry falls through the dedupe row and processes normally.
    return NextResponse.json({ error: 'unknown_reference' }, { status: 404 });
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
    if (p.status === 'completed') return NextResponse.json({ ok: true, deduped });

    // The reservation rows are the immutable record of which obligations this
    // payment covers — read them regardless of is_active, so an out-of-order
    // failure event or an expiry sweep can't destroy the settlement inputs.
    const { data: reservations } = await admin
      .from('payment_reservations')
      .select('obligation_id')
      .eq('payment_id', p.id);
    const obligationIds = ((reservations ?? []) as { obligation_id: string }[]).map((r) => r.obligation_id);

    const completedAt = event.data.completed_at ?? new Date().toISOString();

    const { error } = await admin.rpc('record_completed_payment', {
      p_payment_id: p.id,
      p_obligation_ids: obligationIds,
      p_receipt_number: '', // allocated inside the function (migration 0017)
      p_completed_at: completedAt,
    });
    if (error) {
      return NextResponse.json({ error: 'settlement_failed' }, { status: 500 });
    }
    await notifyRider('payment_completed', 'Malipo yamekamilika', 'Malipo yako yamepokelewa. Asante.');
    return NextResponse.json({ ok: true, settled: true, deduped });
  }

  if (event.type === 'payment.failed' || event.type === 'payment.expired' || event.type === 'payment.voided') {
    const status = event.type === 'payment.failed' ? 'failed' : event.type === 'payment.expired' ? 'expired' : 'cancelled';
    // Guard: never overwrite a payment that already completed (allocations,
    // receipt and paid obligations exist) — reversals are a controlled,
    // separate flow, not a status overwrite.
    const { data: changed } = await admin
      .from('payments')
      .update({ status })
      .eq('id', p.id)
      .in('status', ['created', 'pending'])
      .select('id');
    if (!changed || changed.length === 0) {
      return NextResponse.json({ ok: true, ignored_terminal: true, deduped });
    }
    await admin.from('payment_reservations').update({ is_active: false }).eq('payment_id', p.id);
    await notifyRider('payment_failed', 'Malipo hayakukamilika', 'Malipo yako hayakukamilika. Tafadhali jaribu tena.');
    return NextResponse.json({ ok: true, status, deduped });
  }

  return NextResponse.json({ ok: true, ignored: true, deduped });
}
