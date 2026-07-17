'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { newIdempotencyKey } from './idempotency';
import { triggerPush } from '@/lib/snippe/client';
import { localDateString } from '@/lib/dates/tz';

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/*
 * Owner-only cash payment (spec §12.6). ONLY the owner may record cash — riders
 * cannot. The server recomputes the amount from the selected whole obligations
 * (never trusts a client amount) and settles atomically via the same
 * record_completed_payment function used by the webhook.
 */
export async function recordCashPayment(input: {
  riderId: string;
  contractId: string;
  obligationIds: string[];
  paymentDate: string;
  note?: string;
}): Promise<ActionResult<{ paymentId: string }>> {
  const ownerId = await assertOwner();
  if (!input.obligationIds?.length) return { ok: false, error: 'no_obligations' };

  // The settlement date must be a real calendar date — validated BEFORE any
  // row is written, so a malformed value can't leave an orphan payment.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
    return { ok: false, error: 'invalid_date' };
  }
  const completedAtMs = Date.parse(`${input.paymentDate}T12:00:00+03:00`);
  if (Number.isNaN(completedAtMs)) return { ok: false, error: 'invalid_date' };
  // Cash is recorded after the fact — a future-dated settlement would corrupt
  // paid/paid_in_advance classification and the receipt year.
  if (input.paymentDate > localDateString()) return { ok: false, error: 'future_date' };
  const completedAt = new Date(completedAtMs).toISOString();

  const admin = createAdminClient();

  // The contract must belong to the rider the payment is recorded under —
  // a mismatched pair would attribute money to the wrong rider.
  const { data: contract } = await admin
    .from('contracts')
    .select('id, rider_id')
    .eq('id', input.contractId)
    .maybeSingle();
  if (!contract || (contract as { rider_id: string }).rider_id !== input.riderId) {
    return { ok: false, error: 'contract_rider_mismatch' };
  }

  // Recompute from authoritative rows: obligations must belong to this contract
  // and still be outstanding.
  const { data: obs } = await admin
    .from('payment_obligations')
    .select('id, amount_due, status')
    .eq('contract_id', input.contractId)
    .in('id', input.obligationIds);
  const rows = (obs ?? []) as { id: string; amount_due: number; status: string }[];
  if (rows.length !== input.obligationIds.length) {
    return { ok: false, error: 'invalid_obligations' };
  }
  const outstanding = new Set(['scheduled', 'due', 'overdue']);
  if (rows.some((o) => !outstanding.has(o.status))) {
    return { ok: false, error: 'not_outstanding' };
  }
  const amount = rows.reduce((s, o) => s + o.amount_due, 0);
  if (amount <= 0) return { ok: false, error: 'invalid_amount' };

  // An obligation reserved by an in-flight mobile payment belongs to that
  // payment's settlement — cash-settling it now would leave the rider's mobile
  // money permanently unallocatable when its webhook lands (the DB function
  // also enforces this; checking here gives the owner a clear error).
  const { data: reserved } = await admin
    .from('payment_reservations')
    .select('obligation_id')
    .in('obligation_id', input.obligationIds)
    .eq('is_active', true)
    .limit(1);
  if (reserved && reserved.length > 0) {
    return { ok: false, error: 'reserved_by_pending_payment' };
  }

  // Oldest-first invariant (spec §12.2): the selected set must be exactly the
  // N oldest outstanding obligations of the contract — cash follows the same
  // allocation rule as mobile money.
  const { data: allOutstanding } = await admin
    .from('payment_obligations')
    .select('id')
    .eq('contract_id', input.contractId)
    .in('status', ['scheduled', 'due', 'overdue'])
    .order('due_date', { ascending: true })
    .limit(input.obligationIds.length);
  const oldestIds = ((allOutstanding ?? []) as { id: string }[]).map((o) => o.id);
  const selected = new Set(input.obligationIds);
  if (oldestIds.length !== selected.size || !oldestIds.every((id) => selected.has(id))) {
    return { ok: false, error: 'not_oldest_first' };
  }

  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      rider_id: input.riderId,
      contract_id: input.contractId,
      method: 'cash',
      amount,
      status: 'created',
      created_by: ownerId,
      idempotency_key: newIdempotencyKey(),
    })
    .select('id')
    .single();
  if (payErr || !payment) return { ok: false, error: 'server_error' };
  const paymentId = (payment as { id: string }).id;

  const { error } = await admin.rpc('record_completed_payment', {
    p_payment_id: paymentId,
    p_obligation_ids: input.obligationIds,
    p_receipt_number: '', // allocated inside the function (migration 0017)
    p_completed_at: completedAt,
  });
  if (error) {
    await admin.from('payments').update({ status: 'failed' }).eq('id', paymentId);
    return { ok: false, error: 'settlement_failed' };
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'payment.cash_recorded',
    entityType: 'payment',
    entityId: paymentId,
    metadata: { amount, obligations: input.obligationIds.length, note: input.note ?? null },
  });
  revalidatePath('/owner/payments');
  revalidatePath(`/owner/riders/${input.riderId}`);
  return { ok: true, data: { paymentId } };
}

/** Re-trigger the USSD push for the rider's current pending payment (§12.5). */
export async function resendUssdPush(paymentId: string): Promise<ActionResult> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'unauthenticated' };
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from('payments')
    .select('rider_id, snippe_reference, status')
    .eq('id', paymentId)
    .maybeSingle();
  const p = payment as { rider_id: string; snippe_reference: string | null; status: string } | null;
  if (!p || !p.snippe_reference || p.status !== 'pending') {
    return { ok: false, error: 'not_pending' };
  }

  // Only the payment's own rider (or the owner) may re-trigger the USSD PIN
  // prompt — anyone else could spam prompts to the payer's phone.
  if (profile.role !== 'owner') {
    const { data: rider } = await admin
      .from('riders')
      .select('id')
      .eq('profile_id', profile.userId)
      .maybeSingle();
    if (!rider || (rider as { id: string }).id !== p.rider_id) {
      return { ok: false, error: 'forbidden' };
    }
  }

  const res = await triggerPush(p.snippe_reference);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Abandon the rider's current pending payment so they can start over — e.g. to
 * pay from a different phone number, or after a USSD prompt they never
 * confirmed. Without this a not-yet-completed payment leaves the rider stuck on
 * the "waiting for confirmation" screen with the number locked in.
 *
 * Money-safe: reservations are released and the payment is set 'cancelled' via
 * a conditional update (so a completion that lands first still wins). If Snippe
 * later reports this intent completed, record_completed_payment refuses to
 * settle a non-created/pending payment and the webhook flags it to the owner
 * for reconciliation — never a silent double-charge or lost payment.
 */
export async function cancelPendingPayment(paymentId: string): Promise<ActionResult> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'unauthenticated' };
  const admin = createAdminClient();

  const { data: payment } = await admin
    .from('payments')
    .select('rider_id, status')
    .eq('id', paymentId)
    .maybeSingle();
  const p = payment as { rider_id: string; status: string } | null;
  if (!p) return { ok: false, error: 'not_found' };
  if (!['created', 'pending'].includes(p.status)) return { ok: false, error: 'not_pending' };

  // Only the payment's own rider (or the owner) may cancel it.
  if (profile.role !== 'owner') {
    const { data: rider } = await admin
      .from('riders')
      .select('id')
      .eq('profile_id', profile.userId)
      .maybeSingle();
    if (!rider || (rider as { id: string }).id !== p.rider_id) {
      return { ok: false, error: 'forbidden' };
    }
  }

  // Conditional update: never overwrite a payment that just reached a terminal
  // state (e.g. a completion webhook landed between the read and this write).
  const { data: changed } = await admin
    .from('payments')
    .update({ status: 'cancelled' })
    .eq('id', paymentId)
    .in('status', ['created', 'pending'])
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'not_pending' };

  await admin.from('payment_reservations').update({ is_active: false }).eq('payment_id', paymentId);
  await writeAudit({
    actorId: profile.userId,
    actorRole: profile.role === 'owner' ? 'owner' : 'rider',
    action: 'payment.cancelled_by_user',
    entityType: 'payment',
    entityId: paymentId,
  });
  return { ok: true };
}

/**
 * Cancel whatever payment the current rider currently has outstanding
 * (created/pending), if any. Used so a fresh "Lipa Sasa" is never blocked by a
 * leftover attempt: the pay screen clears STALE attempts automatically and
 * re-initiates, instead of stranding the rider on a "pending" they'd have to
 * cancel by hand. Returns ok even when there is nothing to cancel.
 *
 * SAFETY: a FRESH 'pending' (minutes old) very likely has a live USSD prompt on
 * the payer's phone — auto-cancelling it and firing a second push manufactures
 * the double-pay incident the pilot already hit (payer confirms the first
 * prompt → provider completes a locally-cancelled payment → manual
 * reconciliation; confirms both → double charge). Fresh pendings are returned
 * as `pending_fresh` so the UI resumes their waiting screen (which has explicit
 * resend/cancel buttons) instead of silently killing them. 'created' payments
 * (no USSD ever sent) are always safe to clear.
 */
const FRESH_PENDING_MS = 10 * 60_000;

export async function cancelCurrentPendingPayment(): Promise<
  ActionResult | { ok: false; error: 'pending_fresh'; paymentId: string }
> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'unauthenticated' };
  const admin = createAdminClient();

  const { data: rider } = await admin
    .from('riders')
    .select('id')
    .eq('profile_id', profile.userId)
    .maybeSingle();
  const riderId = (rider as { id: string } | null)?.id;
  if (!riderId) return { ok: false, error: 'not_found' };

  const { data: pending } = await admin
    .from('payments')
    .select('id, status, created_at')
    .eq('rider_id', riderId)
    .in('status', ['created', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1);
  const row = (pending as { id: string; status: string; created_at: string }[] | null)?.[0];
  if (!row) return { ok: true }; // nothing outstanding

  if (row.status === 'pending' && Date.now() - Date.parse(row.created_at) < FRESH_PENDING_MS) {
    return { ok: false, error: 'pending_fresh', paymentId: row.id };
  }
  return cancelPendingPayment(row.id);
}
