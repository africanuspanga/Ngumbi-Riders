'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { newIdempotencyKey } from './idempotency';
import { triggerPush } from '@/lib/snippe/client';

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
