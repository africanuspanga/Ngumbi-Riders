'use server';

import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { newIdempotencyKey } from './idempotency';
import { localDateString } from '@/lib/dates/tz';
import { formatDate } from '@/lib/dates/format';
import { formatTZS } from '@/lib/money/format';
import { createNotification, notifyOwner, notifyRider } from '@/lib/notifications/service';
import { enqueueSms, isMobishastraConfigured } from '@/lib/messaging/outbox';

/*
 * Cash-payment APPROVAL workflow (client feedback 2026-09-05).
 *
 * "When an accountant records that they have received a cash payment, I as the
 *  Director should receive it as a request that I can Confirm or Reject before
 *  the system permanently records the payment as Cash Received. There should
 *  also be an option to edit the payment in case the wrong amount was entered.
 *  Once I confirm it, the rider should receive a notification."
 *
 * Design decision — NOTHING is written to `payments` while a request is
 * pending. A payment row that exists but "doesn't count yet" is exactly the
 * kind of half-recorded money this codebase has already been bitten by
 * (settlement never firing, stranded pendings). So:
 *
 *   accountant records   → cash_payment_requests row, status 'pending'
 *   Director edits       → the same row is revalidated and rewritten
 *   Director confirms    → payments row + record_completed_payment, in that
 *                          order, with EVERY guard recordCashPayment applies
 *   Director rejects     → the row is closed; no money ever existed
 *
 * The owner recording cash themselves still settles immediately
 * (`recordCashPayment`) — the Director does not approve their own entry.
 *
 * Because the amount is derived from whole obligations, "edit the amount" and
 * "edit which days this covers" are the same operation, which is what keeps
 * the ledger whole-obligation and the arithmetic impossible to fudge.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type ValidatedRequest = {
  amount: number;
  completedAt: string;
};

/**
 * Everything `recordCashPayment` checks, minus the settlement itself, plus one
 * extra: obligations already claimed by ANOTHER pending request. Two
 * accountants must not be able to raise overlapping requests for the same days
 * — the second would fail at approval time, after the Director had already
 * confirmed it.
 */
async function validateSelection(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    riderId: string;
    contractId: string;
    obligationIds: string[];
    paymentDate: string;
    excludeRequestId?: string;
  },
): Promise<{ ok: true; data: ValidatedRequest } | { ok: false; error: string }> {
  if (!input.obligationIds?.length) return { ok: false, error: 'no_obligations' };
  if (new Set(input.obligationIds).size !== input.obligationIds.length) {
    return { ok: false, error: 'duplicate_obligations' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) return { ok: false, error: 'invalid_date' };
  const completedAtMs = Date.parse(`${input.paymentDate}T12:00:00+03:00`);
  if (Number.isNaN(completedAtMs)) return { ok: false, error: 'invalid_date' };
  if (input.paymentDate > localDateString()) return { ok: false, error: 'future_date' };

  const { data: contract } = await admin
    .from('contracts')
    .select('id, rider_id')
    .eq('id', input.contractId)
    .maybeSingle();
  if (!contract || (contract as { rider_id: string }).rider_id !== input.riderId) {
    return { ok: false, error: 'contract_rider_mismatch' };
  }

  const { data: obs } = await admin
    .from('payment_obligations')
    .select('id, amount_due, status')
    .eq('contract_id', input.contractId)
    .in('id', input.obligationIds);
  const rows = (obs ?? []) as { id: string; amount_due: number; status: string }[];
  if (rows.length !== input.obligationIds.length) return { ok: false, error: 'invalid_obligations' };
  const outstanding = new Set(['scheduled', 'due', 'overdue']);
  if (rows.some((o) => !outstanding.has(o.status))) return { ok: false, error: 'not_outstanding' };
  const amount = rows.reduce((s, o) => s + o.amount_due, 0);
  if (amount <= 0) return { ok: false, error: 'invalid_amount' };

  const { data: reserved } = await admin
    .from('payment_reservations')
    .select('obligation_id')
    .in('obligation_id', input.obligationIds)
    .eq('is_active', true)
    .limit(1);
  if (reserved && reserved.length > 0) return { ok: false, error: 'reserved_by_pending_payment' };

  // Oldest-first (spec §12.2): the selection must be exactly the N oldest
  // outstanding obligations of the contract.
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

  // Another pending request already claims one of these days.
  const { data: pendingReqs } = await admin
    .from('cash_payment_requests')
    .select('id, obligation_ids')
    .eq('contract_id', input.contractId)
    .eq('status', 'pending');
  for (const r of (pendingReqs ?? []) as { id: string; obligation_ids: string[] }[]) {
    if (r.id === input.excludeRequestId) continue;
    if (r.obligation_ids.some((id) => selected.has(id))) {
      return { ok: false, error: 'already_requested' };
    }
  }

  return { ok: true, data: { amount, completedAt: new Date(completedAtMs).toISOString() } };
}

function revalidateCashSurfaces(riderId?: string) {
  revalidatePath('/owner/payments');
  revalidatePath('/owner/payments/approvals');
  revalidatePath('/owner');
  revalidatePath('/accountant');
  revalidatePath('/accountant/payments');
  if (riderId) {
    revalidatePath(`/owner/riders/${riderId}`);
    revalidatePath(`/accountant/riders/${riderId}`);
  }
}

/**
 * Raise a cash-received request for the Director to confirm. Used by the
 * accountant; the owner's own cash entry settles immediately instead.
 */
export async function requestCashPayment(input: {
  riderId: string;
  contractId: string;
  obligationIds: string[];
  paymentDate: string;
  note?: string;
  /** Staff member who physically took the money; defaults to the requester. */
  receivedById?: string;
}): Promise<ActionResult<{ requestId: string; amount: number }>> {
  const actor = await checkPermission('payments.record');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const check = await validateSelection(admin, input);
  if (!check.ok) return check;

  // Never trust a client-supplied profile id: it must be an active staff
  // account, otherwise the "who received the cash" record is worthless.
  const receivedById = await resolveReceiver(admin, input.receivedById, actor.userId);
  if (!receivedById) return { ok: false, error: 'invalid_receiver' };

  const { data: row, error } = await admin
    .from('cash_payment_requests')
    .insert({
      rider_id: input.riderId,
      contract_id: input.contractId,
      obligation_ids: input.obligationIds,
      amount: check.data.amount,
      payment_date: input.paymentDate,
      note: input.note?.trim() || null,
      status: 'pending',
      received_by: receivedById,
      requested_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !row) return { ok: false, error: 'server_error' };
  const requestId = (row as { id: string }).id;

  const rider = await riderLabel(admin, input.riderId);
  await notifyOwner({
    type: 'cash_approval_request',
    title: 'Cash payment awaiting your confirmation',
    body: `${actor.fullName ?? 'An accountant'} recorded ${formatTZS(check.data.amount)} from ${rider.name} on ${formatDate(input.paymentDate)}.`,
    deepLink: '/owner/payments/approvals',
    dedupeKey: `cash_approval_request:${requestId}`,
  });

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.cash_requested',
    entityType: 'cash_payment_request',
    entityId: requestId,
    metadata: {
      amount: check.data.amount,
      obligations: input.obligationIds.length,
      riderId: input.riderId,
    },
  });

  revalidateCashSurfaces(input.riderId);
  return { ok: true, data: { requestId, amount: check.data.amount } };
}

/** Edit a still-pending request — the "wrong amount was entered" escape hatch. */
export async function updateCashRequest(
  requestId: string,
  input: {
    obligationIds: string[];
    paymentDate: string;
    note?: string;
    receivedById?: string;
  },
): Promise<ActionResult<{ amount: number }>> {
  const actor = await checkPermission('payments.record');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('cash_payment_requests')
    .select('id, rider_id, contract_id, status, requested_by')
    .eq('id', requestId)
    .maybeSingle();
  const req = existing as
    | { id: string; rider_id: string; contract_id: string; status: string; requested_by: string }
    | null;
  if (!req) return { ok: false, error: 'not_found' };
  if (req.status !== 'pending') return { ok: false, error: 'not_pending' };
  // The Director may edit anything; an accountant only their own request.
  if (actor.role !== 'owner' && req.requested_by !== actor.userId) {
    return { ok: false, error: 'forbidden' };
  }

  const check = await validateSelection(admin, {
    riderId: req.rider_id,
    contractId: req.contract_id,
    obligationIds: input.obligationIds,
    paymentDate: input.paymentDate,
    excludeRequestId: requestId,
  });
  if (!check.ok) return check;

  const receivedById = await resolveReceiver(admin, input.receivedById, actor.userId);
  if (!receivedById) return { ok: false, error: 'invalid_receiver' };

  // Conditional on status='pending': an approval that landed between the read
  // and this write must win, never be overwritten by a stale edit.
  const { data: changed, error } = await admin
    .from('cash_payment_requests')
    .update({
      obligation_ids: input.obligationIds,
      amount: check.data.amount,
      payment_date: input.paymentDate,
      note: input.note?.trim() || null,
      received_by: receivedById,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'not_pending' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.cash_request_edited',
    entityType: 'cash_payment_request',
    entityId: requestId,
    metadata: { amount: check.data.amount, obligations: input.obligationIds.length },
  });

  revalidateCashSurfaces(req.rider_id);
  return { ok: true, data: { amount: check.data.amount } };
}

/**
 * Confirm: settle the money. OWNER only — this is the Director's decision.
 *
 * Everything is revalidated first, because the world may have moved since the
 * request was raised (the rider may have paid the same days by mobile money).
 * Only then is the `payments` row created and settled through
 * `record_completed_payment`, the same atomic function the webhook uses.
 */
export async function approveCashRequest(
  requestId: string,
  decisionNote?: string,
): Promise<ActionResult<{ paymentId: string }>> {
  const actor = await checkPermission('staff.manage'); // owner-only permission
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('cash_payment_requests')
    .select('id, rider_id, contract_id, obligation_ids, payment_date, note, status, received_by, requested_by')
    .eq('id', requestId)
    .maybeSingle();
  const req = existing as
    | {
        id: string;
        rider_id: string;
        contract_id: string;
        obligation_ids: string[];
        payment_date: string;
        note: string | null;
        status: string;
        received_by: string;
        requested_by: string;
      }
    | null;
  if (!req) return { ok: false, error: 'not_found' };
  if (req.status !== 'pending') return { ok: false, error: 'not_pending' };

  const check = await validateSelection(admin, {
    riderId: req.rider_id,
    contractId: req.contract_id,
    obligationIds: req.obligation_ids,
    paymentDate: req.payment_date,
    excludeRequestId: requestId,
  });
  if (!check.ok) return check;

  // Claim the request BEFORE creating money: a second confirmation racing this
  // one finds the row no longer pending and stops, so the same cash can never
  // be settled twice.
  const { data: claimed } = await admin
    .from('cash_payment_requests')
    .update({ status: 'approved', decided_by: actor.userId, decided_at: new Date().toISOString(), decision_note: decisionNote?.trim() || null })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');
  if (!claimed || claimed.length === 0) return { ok: false, error: 'not_pending' };

  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      rider_id: req.rider_id,
      contract_id: req.contract_id,
      method: 'cash',
      amount: check.data.amount,
      status: 'created',
      created_by: req.requested_by,
      received_by: req.received_by,
      note: req.note,
      idempotency_key: newIdempotencyKey(),
    })
    .select('id')
    .single();
  if (payErr || !payment) {
    // Put the request back so the Director can retry rather than losing it.
    await admin.from('cash_payment_requests').update({ status: 'pending', decided_by: null, decided_at: null }).eq('id', requestId);
    return { ok: false, error: 'server_error' };
  }
  const paymentId = (payment as { id: string }).id;

  const { error: rpcErr } = await admin.rpc('record_completed_payment', {
    p_payment_id: paymentId,
    p_obligation_ids: req.obligation_ids,
    p_receipt_number: '',
    p_completed_at: check.data.completedAt,
  });
  if (rpcErr) {
    await admin.from('payments').update({ status: 'failed' }).eq('id', paymentId);
    await admin.from('cash_payment_requests').update({ status: 'pending', decided_by: null, decided_at: null }).eq('id', requestId);
    return { ok: false, error: 'settlement_failed' };
  }

  await admin.from('cash_payment_requests').update({ payment_id: paymentId }).eq('id', requestId);

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'payment.cash_request_approved',
    entityType: 'cash_payment_request',
    entityId: requestId,
    metadata: { paymentId, amount: check.data.amount, riderId: req.rider_id },
  });

  // Tell the rider their cash is now on record — the confirmation the Director
  // asked for. SMS follows the same message once a provider is configured;
  // enqueueing is harmless (and delivers on the first run after) when it isn't.
  const rider = await riderLabel(admin, req.rider_id);
  await notifyRider(req.rider_id, {
    type: 'payment_completed',
    title: 'Malipo ya fedha taslimu yamethibitishwa',
    body: `Malipo yako ya ${formatTZS(check.data.amount)} ya tarehe ${formatDate(req.payment_date)} yamepokelewa na kuthibitishwa. Asante.`,
    deepLink: `/rider/payments/${paymentId}`,
    dedupeKey: `cash_confirmed:${paymentId}`,
  });
  if (rider.phone) {
    await enqueueSms({
      recipient: rider.phone,
      text: `Ng'umbi Riders: Malipo yako ya fedha taslimu ${formatTZS(check.data.amount)} (${formatDate(req.payment_date)}) yamethibitishwa. Asante.`,
      subject: 'cash_payment_confirmed',
    });
  }

  // And the accountant who raised it.
  await createNotification({
    profileId: req.requested_by,
    type: 'cash_request_decided',
    title: 'Cash payment confirmed',
    body: `${rider.name} · ${formatTZS(check.data.amount)} was confirmed by the Director.`,
    deepLink: '/accountant/payments',
    dedupeKey: `cash_request_decided:${requestId}`,
  });

  revalidateCashSurfaces(req.rider_id);
  return { ok: true, data: { paymentId } };
}

/** Reject: nothing is settled and no payment ever existed. */
export async function rejectCashRequest(
  requestId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await checkPermission('staff.manage');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };

  const admin = createAdminClient();
  const { data: changed } = await admin
    .from('cash_payment_requests')
    .update({
      status: 'rejected',
      decided_by: actor.userId,
      decided_at: new Date().toISOString(),
      decision_note: trimmed.slice(0, 1000),
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id, rider_id, amount, requested_by');
  const row = (changed ?? [])[0] as
    | { id: string; rider_id: string; amount: number; requested_by: string }
    | undefined;
  if (!row) return { ok: false, error: 'not_pending' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'payment.cash_request_rejected',
    entityType: 'cash_payment_request',
    entityId: requestId,
    metadata: { amount: row.amount, reason: trimmed.slice(0, 200) },
  });

  await createNotification({
    profileId: row.requested_by,
    type: 'cash_request_decided',
    title: 'Cash payment rejected',
    body: `${formatTZS(row.amount)} was rejected by the Director: ${trimmed.slice(0, 200)}`,
    deepLink: '/accountant/payments',
    dedupeKey: `cash_request_decided:${requestId}`,
  });

  revalidateCashSurfaces(row.rider_id);
  return { ok: true };
}

/** Withdraw a request you raised in error (accountant or owner, while pending). */
export async function cancelCashRequest(requestId: string): Promise<ActionResult> {
  const actor = await checkPermission('payments.record');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('cash_payment_requests')
    .select('id, status, requested_by, rider_id')
    .eq('id', requestId)
    .maybeSingle();
  const req = existing as { id: string; status: string; requested_by: string; rider_id: string } | null;
  if (!req) return { ok: false, error: 'not_found' };
  if (actor.role !== 'owner' && req.requested_by !== actor.userId) {
    return { ok: false, error: 'forbidden' };
  }

  const { data: changed } = await admin
    .from('cash_payment_requests')
    .update({ status: 'cancelled', decided_by: actor.userId, decided_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'not_pending' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'payment.cash_request_cancelled',
    entityType: 'cash_payment_request',
    entityId: requestId,
  });
  revalidateCashSurfaces(req.rider_id);
  return { ok: true };
}

// ---- helpers -------------------------------------------------------------

/** Validate a "received by" choice: it must be an active owner/accountant. */
async function resolveReceiver(
  admin: ReturnType<typeof createAdminClient>,
  candidateId: string | undefined,
  fallbackId: string,
): Promise<string | null> {
  const id = candidateId?.trim() || fallbackId;
  const { data } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', id)
    .maybeSingle();
  const p = data as { id: string; role: string; is_active: boolean | null } | null;
  if (!p) return null;
  if (p.role !== 'owner' && p.role !== 'accountant') return null;
  if (p.role === 'accountant' && p.is_active === false) return null;
  return p.id;
}

async function riderLabel(
  admin: ReturnType<typeof createAdminClient>,
  riderId: string,
): Promise<{ name: string; phone: string | null }> {
  const { data } = await admin
    .from('riders')
    .select('first_name, last_name, phone')
    .eq('id', riderId)
    .maybeSingle();
  const r = data as { first_name: string; last_name: string; phone: string | null } | null;
  return { name: r ? `${r.first_name} ${r.last_name}` : 'Rider', phone: r?.phone ?? null };
}

/** SMS availability, for the UI to say whether the rider will also get a text. */
export async function smsConfigured(): Promise<boolean> {
  return isMobishastraConfigured();
}
