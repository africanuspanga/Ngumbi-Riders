import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySnippeSignature } from '@/lib/payments/webhook-verify';
import { writeAudit } from '@/lib/audit/audit';
import { notifyOwner } from '@/lib/notifications/service';

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
      metadata?: { payment_id?: string };
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
    // 23505 = unique_violation; the message text is not a stable contract.
    if (dupErr.code === '23505' || /duplicate key/i.test(dupErr.message)) {
      deduped = true;
    } else {
      return NextResponse.json({ error: 'store_failed' }, { status: 500 });
    }
  }

  // Locate the local payment by provider reference; fall back to the
  // payment_id we sent Snippe in metadata (covers the crash window where the
  // initiate route created the provider intent but failed to store the
  // reference locally — without this the payment is unmatchable forever).
  type PaymentRow = { id: string; rider_id: string; amount: number; status: string };
  const { data: byRef } = await admin
    .from('payments')
    .select('id, rider_id, amount, status')
    .eq('snippe_reference', event.data.reference)
    .maybeSingle();
  let matched = byRef as PaymentRow | null;
  const metaPaymentId = event.data.metadata?.payment_id;
  if (!matched && metaPaymentId && /^[0-9a-f-]{36}$/i.test(metaPaymentId)) {
    const { data: byId } = await admin
      .from('payments')
      .select('id, rider_id, amount, status, snippe_reference')
      .eq('id', metaPaymentId)
      .maybeSingle();
    // Only trust the metadata match for a payment that has no (or the same)
    // stored reference — never re-route an event onto a different intent.
    const candidate = byId as (PaymentRow & { snippe_reference: string | null }) | null;
    if (candidate && (candidate.snippe_reference === null || candidate.snippe_reference === event.data.reference)) {
      if (candidate.snippe_reference === null) {
        await admin
          .from('payments')
          .update({ snippe_reference: event.data.reference, provider_payment_id: event.data.reference })
          .eq('id', candidate.id)
          .is('snippe_reference', null);
      }
      matched = candidate;
    }
  }
  if (!matched) {
    // The initiate route stores snippe_reference only after Snippe responds,
    // so a very fast webhook can race it. Return non-2xx so Snippe retries;
    // the retry falls through the dedupe row and processes normally.
    return NextResponse.json({ error: 'unknown_reference' }, { status: 404 });
  }
  const p = matched;
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

  // A provider-side discrepancy must be LOUD: persisted for audit and pushed
  // to the owner, because it means real money moved but must not auto-settle.
  async function alertOwnerPaymentIssue(kind: string, metadata: Record<string, unknown>) {
    await writeAudit({
      actorId: null,
      actorRole: 'system',
      action: `payment.${kind}`,
      entityType: 'payment',
      entityId: p.id,
      metadata,
    });
    await notifyOwner({
      type: 'payment_issue',
      title: 'Payment needs manual review',
      body: `Payment ${p.id}: ${kind}. See /owner/reconciliation.`,
      deepLink: '/owner/reconciliation',
      dedupeKey: `payment_issue:${kind}:${p.id}`,
    });
  }

  if (event.type === 'payment.completed') {
    // Amount/currency must match the reserved payment (spec §12.2 step 13).
    const value = event.data.amount?.value;
    const currency = event.data.amount?.currency;
    if (currency !== 'TZS' || value !== p.amount) {
      // Do not settle a mismatched payment — flag it for the owner. 200 stops
      // provider retries; the audit row + notification carry the evidence.
      await alertOwnerPaymentIssue('amount_mismatch', {
        expected: p.amount,
        received: value ?? null,
        currency: currency ?? null,
        provider_event_id: event.id,
      });
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

    // The provider timestamp is provider-controlled input: a malformed value
    // must not turn into a Postgres cast error → endless 500 retry loop.
    const providerCompletedAt = event.data.completed_at;
    const completedAt =
      providerCompletedAt && !Number.isNaN(Date.parse(providerCompletedAt))
        ? new Date(Date.parse(providerCompletedAt)).toISOString()
        : new Date().toISOString();

    const { error } = await admin.rpc('record_completed_payment', {
      p_payment_id: p.id,
      p_obligation_ids: obligationIds,
      p_receipt_number: '', // allocated inside the function (migration 0017)
      p_completed_at: completedAt,
    });
    if (error) {
      // Invariant violations (migration 0018 guards) are permanent for this
      // event — retrying can never succeed, so alert the owner and stop the
      // retry loop. Anything else is treated as transient → 500 → retry.
      const invariant =
        /invalid_payment_status|obligation_not_outstanding|obligation_rider_mismatch|obligation_reserved_by_other_payment|allocation_mismatch/.test(
          error.message,
        );
      if (invariant) {
        await alertOwnerPaymentIssue('settlement_blocked', {
          reason: error.message,
          provider_event_id: event.id,
        });
        return NextResponse.json({ ok: true, settlement_blocked: true });
      }
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

  // Reversal/chargeback/refund events have no automated flow yet (controlled
  // un-settlement is a tracked follow-up) — but they involve money that
  // already settled, so they must never be silently ignored.
  if (/revers|chargeback|refund/i.test(event.type)) {
    await alertOwnerPaymentIssue('reversal_received', {
      event_type: event.type,
      provider_event_id: event.id,
    });
    return NextResponse.json({ ok: true, reversal_flagged: true, deduped });
  }

  return NextResponse.json({ ok: true, ignored: true, deduped });
}
