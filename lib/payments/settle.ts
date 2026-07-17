import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { notifyRider } from '@/lib/notifications/service';
import { getPaymentStatus } from '@/lib/snippe/client';

/*
 * Shared payment settlement helpers used by the webhook and the reconciliation
 * job. Settlement itself is the atomic, idempotent record_completed_payment
 * function; these wrappers gather the reserved obligations. The receipt number
 * is allocated from a Postgres sequence inside the function (migration 0017).
 */
export async function settlePaymentCompleted(
  paymentId: string,
  riderId: string,
  completedAtIso: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  // Reservations are the immutable record of the selected obligations — read
  // them regardless of is_active so an expiry sweep or out-of-order failure
  // event cannot destroy the settlement inputs. A FAILED read must abort: an
  // empty-because-errored list would reach record_completed_payment as zero
  // obligations and throw allocation_mismatch — misread as a permanent
  // invariant violation when it was a transient read failure.
  const { data: reservations, error: resErr } = await admin
    .from('payment_reservations')
    .select('obligation_id')
    .eq('payment_id', paymentId);
  if (resErr) return { ok: false, error: `reservations_read_failed: ${resErr.message}` };
  const obligationIds = ((reservations ?? []) as { obligation_id: string }[]).map((r) => r.obligation_id);

  const { error } = await admin.rpc('record_completed_payment', {
    p_payment_id: paymentId,
    p_obligation_ids: obligationIds,
    p_receipt_number: '', // allocated inside the function (migration 0017)
    p_completed_at: completedAtIso,
  });
  if (error) return { ok: false, error: error.message };

  await notifyRider(riderId, {
    type: 'payment_completed',
    title: 'Malipo yamekamilika',
    body: 'Malipo yako yamepokelewa. Asante.',
    deepLink: `/rider/payments/${paymentId}`,
    dedupeKey: `payment_completed:${paymentId}`,
  });
  return { ok: true };
}

export async function markPaymentFailed(
  paymentId: string,
  riderId: string,
  status: 'failed' | 'expired' | 'cancelled',
): Promise<void> {
  const admin = createAdminClient();
  // Never overwrite a completed payment: late/out-of-order failure events must
  // not corrupt settled money (allocations, receipt, paid obligations).
  const { data: changed } = await admin
    .from('payments')
    .update({ status })
    .eq('id', paymentId)
    .in('status', ['created', 'pending'])
    .select('id');
  if (!changed || changed.length === 0) return;

  await admin.from('payment_reservations').update({ is_active: false }).eq('payment_id', paymentId);
  await notifyRider(riderId, {
    type: 'payment_failed',
    title: 'Malipo hayakukamilika',
    body: 'Malipo yako hayakukamilika. Tafadhali jaribu tena.',
    deepLink: `/rider/payments/${paymentId}`,
    dedupeKey: `payment_${status}:${paymentId}`,
  });
}

/**
 * Ask the provider whether a still-pending payment has resolved, then settle or
 * fail it locally. This is the SAME server-side verification the reconcile cron
 * performs — the completion decision comes from Snippe's authoritative API, not
 * the browser — so it is safe to trigger from the rider's status poll. It makes
 * a payment complete even when the webhook callback never reaches us (e.g. a
 * misconfigured public URL / webhook secret in production), instead of the
 * rider spinning on "waiting for confirmation" forever.
 *
 * Returns the resolved local status. Idempotent: record_completed_payment and
 * the conditional failure update both no-op on an already-terminal payment.
 */
export async function reconcilePaymentWithProvider(paymentId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('payments')
    .select('id, rider_id, amount, status, snippe_reference')
    .eq('id', paymentId)
    .maybeSingle();
  const p = data as
    | { id: string; rider_id: string; amount: number; status: string; snippe_reference: string | null }
    | null;
  if (!p || p.status !== 'pending' || !p.snippe_reference) return p?.status ?? 'not_found';

  const provider = await getPaymentStatus(p.snippe_reference);
  if (!provider.ok) return 'pending'; // provider unreachable — leave pending, try again next poll

  if (provider.data.status === 'completed') {
    // Block only on a POSITIVE amount disagreement; a status response that omits
    // the amount is trusted because the reference identifies our own intent.
    if (provider.data.amountValue !== null && provider.data.amountValue !== p.amount) {
      return 'pending'; // needs owner reconciliation, don't auto-settle a mismatch
    }
    const r = await settlePaymentCompleted(p.id, p.rider_id, new Date().toISOString());
    return r.ok ? 'completed' : 'pending';
  }
  if (['failed', 'expired', 'voided'].includes(provider.data.status)) {
    const mapped =
      provider.data.status === 'failed' ? 'failed' : provider.data.status === 'expired' ? 'expired' : 'cancelled';
    await markPaymentFailed(p.id, p.rider_id, mapped);
    return mapped;
  }
  return 'pending';
}
