import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { notifyRider } from '@/lib/notifications/service';

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
  // event cannot destroy the settlement inputs.
  const { data: reservations } = await admin
    .from('payment_reservations')
    .select('obligation_id')
    .eq('payment_id', paymentId);
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
