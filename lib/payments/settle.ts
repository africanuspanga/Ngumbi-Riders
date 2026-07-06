import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { nextReceiptNumber } from './service';
import { notifyRider } from '@/lib/notifications/service';

/*
 * Shared payment settlement helpers used by the webhook and the reconciliation
 * job. Settlement itself is the atomic, idempotent record_completed_payment
 * function; these wrappers gather the reserved obligations and a receipt number.
 */
export async function settlePaymentCompleted(
  paymentId: string,
  riderId: string,
  completedAtIso: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: reservations } = await admin
    .from('payment_reservations')
    .select('obligation_id')
    .eq('payment_id', paymentId)
    .eq('is_active', true);
  const obligationIds = ((reservations ?? []) as { obligation_id: string }[]).map((r) => r.obligation_id);

  const receiptNumber = await nextReceiptNumber(new Date(completedAtIso).getFullYear());
  const { error } = await admin.rpc('record_completed_payment', {
    p_payment_id: paymentId,
    p_obligation_ids: obligationIds,
    p_receipt_number: receiptNumber,
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
  await admin.from('payments').update({ status }).eq('id', paymentId);
  await admin.from('payment_reservations').update({ is_active: false }).eq('payment_id', paymentId);
  await notifyRider(riderId, {
    type: 'payment_failed',
    title: 'Malipo hayakukamilika',
    body: 'Malipo yako hayakukamilika. Tafadhali jaribu tena.',
    deepLink: `/rider/payments/${paymentId}`,
    dedupeKey: `payment_${status}:${paymentId}`,
  });
}
