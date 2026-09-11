'use server';

import { revalidatePath } from 'next/cache';
import { checkPermission, getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { createNotification, notifyOwner, notifyRider } from '@/lib/notifications/service';
import { enqueueSms } from '@/lib/messaging/outbox';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { localDateString } from '@/lib/dates/tz';
import { dueTimestampUtc, addMonths } from '@/lib/obligations/schedule';
import { computePhoneLoan, splitLoanTotal } from './phone';
import { phoneLoanRequestSchema } from './validation';
import {
  canTransitionRequest,
  isWithdrawable,
  REQUEST_STATUS_LABELS,
  type PhoneLoanRequestStatus,
} from './constants';
import { getPhoneLoanLimits } from './queries';

/*
 * THE PHONE-LOAN WORKFLOW (client feedback 2026-09-11 #11, #12, #13).
 *
 *   rider submits      -> 'submitted'
 *   finance reviews    -> 'under_review'
 *   finance raises a   -> 'requisition_raised'      (purchase_requisitions)
 *     purchase request
 *   Director approves  -> 'requisition_approved'    (hook from the requisition)
 *   finance buys it    -> 'purchased'
 *   finance activates  -> 'active'  + instalments + THE LEASE PAUSES
 *   last instalment    -> 'completed' + the lease resumes  (lib/loans/settle.ts)
 *
 * SEPARATION OF DUTIES, restated because it is the reason for the shape:
 * the accountant holds 'phone_loans.review' and NOT 'phone_loans.decide'. They
 * prepare — check eligibility, get the invoice, raise the requisition, buy the
 * phone, activate the loan — but the authority to commit the company's money
 * is the Director's, and it is exercised on the REQUISITION, through the
 * existing approval workflow rather than a second one built here.
 *
 * MONEY IS CREATED AT EXACTLY ONE POINT: `activatePhoneLoan`. Everything
 * before it writes nothing to payments, obligations or allocations.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function revalidateLoanSurfaces(riderId?: string) {
  revalidatePath('/owner');
  revalidatePath('/owner/phone-loans');
  revalidatePath('/accountant');
  revalidatePath('/accountant/phone-loans');
  revalidatePath('/rider');
  revalidatePath('/rider/loans');
  if (riderId) {
    revalidatePath(`/owner/riders/${riderId}`);
    revalidatePath(`/accountant/riders/${riderId}`);
  }
}

type RequestRow = {
  id: string;
  rider_id: string;
  contract_id: string | null;
  principal: number;
  term_months: number;
  interest_bps: number;
  interest_amount: number;
  total_amount: number;
  status: PhoneLoanRequestStatus;
  requisition_id: string | null;
  phone_loan_id: string | null;
  device_description: string | null;
};

const REQUEST_COLUMNS =
  'id, rider_id, contract_id, principal, term_months, interest_bps, interest_amount, ' +
  'total_amount, status, requisition_id, phone_loan_id, device_description';

async function loadRequest(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<RequestRow | null> {
  const { data } = await admin
    .from('phone_loan_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
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

/* ------------------------------------------------------------------------ *
 * 1. The rider asks
 * ------------------------------------------------------------------------ */

/**
 * Submit a phone-loan request. The rider must hold an ACTIVE contract: this
 * feature exists for somebody already riding, and a loan with no contract has
 * no calendar to attach instalments to.
 *
 * The agreed figures are computed HERE from the live settings and stored on the
 * request. The rider was shown a quote before submitting, and that quote has to
 * survive the Director later changing the interest rate — the same reason
 * phone_loans stores its totals rather than recomputing them (0026).
 */
export async function submitPhoneLoanRequest(input: unknown): Promise<ActionResult<{ id: string }>> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'rider' || !profile.riderId) {
    return { ok: false, error: 'forbidden' };
  }
  const parsed = phoneLoanRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();
  const limits = await getPhoneLoanLimits();

  // Never trust the amount or term the browser sent: they are re-checked
  // against the SAME limits the rider was shown (spec rule 3).
  if (parsed.data.principal > limits.maxAmount) return { ok: false, error: 'over_max_amount' };
  if (parsed.data.termMonths > limits.maxMonths) return { ok: false, error: 'over_max_term' };

  const { data: contractRow } = await admin
    .from('contracts')
    .select('id, start_date')
    .eq('rider_id', profile.riderId)
    .eq('status', 'active')
    .maybeSingle();
  const contract = contractRow as { id: string; start_date: string | null } | null;
  if (!contract) return { ok: false, error: 'no_active_contract' };

  // An already-active loan, or one still moving through the workflow, blocks a
  // second. The 0031 partial unique index enforces this too; checking here
  // turns a 23505 into a sentence.
  const { data: existing } = await admin
    .from('phone_loan_requests')
    .select('id')
    .eq('rider_id', profile.riderId)
    .in('status', [
      'submitted',
      'under_review',
      'requisition_raised',
      'requisition_approved',
      'purchased',
      'active',
    ])
    .limit(1);
  if (existing && existing.length > 0) return { ok: false, error: 'request_in_progress' };

  let terms;
  try {
    terms = computePhoneLoan({
      principal: parsed.data.principal,
      termMonths: parsed.data.termMonths,
      interestBps: limits.interestBps,
    });
  } catch {
    return { ok: false, error: 'invalid_terms' };
  }

  const { data: row, error } = await admin
    .from('phone_loan_requests')
    .insert({
      rider_id: profile.riderId,
      contract_id: contract.id,
      principal: terms.principal,
      term_months: terms.termMonths,
      interest_bps: terms.interestBps,
      interest_amount: terms.interestAmount,
      total_amount: terms.totalAmount,
      device_description: parsed.data.deviceDescription?.trim() || null,
      reason: parsed.data.reason?.trim() || null,
      status: 'submitted',
    })
    .select('id')
    .single();
  if (error || !row) {
    if (error?.code === '23505') return { ok: false, error: 'request_in_progress' };
    return { ok: false, error: 'server_error' };
  }
  const requestId = (row as { id: string }).id;

  const rider = await riderLabel(admin, profile.riderId);
  await notifyOwner({
    type: 'phone_loan_request',
    title: 'New phone-loan request',
    body: `${rider.name} asked for ${formatTZS(terms.principal)} over ${terms.termMonths} month(s) — ${formatTZS(terms.totalAmount)} to repay.`,
    deepLink: '/owner/phone-loans',
    dedupeKey: `phone_loan_request:${requestId}`,
  });
  await notifyStaff(admin, 'accountant', {
    type: 'phone_loan_request',
    title: 'New phone-loan request to review',
    body: `${rider.name} — ${formatTZS(terms.principal)} over ${terms.termMonths} month(s).`,
    deepLink: '/accountant/phone-loans',
    dedupeKey: `phone_loan_request_acct:${requestId}`,
  });

  await writeAudit({
    actorId: profile.userId,
    actorRole: 'rider',
    action: 'phone_loan.requested',
    entityType: 'phone_loan_request',
    entityId: requestId,
    metadata: { principal: terms.principal, termMonths: terms.termMonths, total: terms.totalAmount },
  });

  revalidateLoanSurfaces(profile.riderId);
  return { ok: true, data: { id: requestId } };
}

/** The rider withdraws their own request, while nobody has committed money. */
export async function withdrawPhoneLoanRequest(requestId: string): Promise<ActionResult> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'rider' || !profile.riderId) {
    return { ok: false, error: 'forbidden' };
  }
  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (req.rider_id !== profile.riderId) return { ok: false, error: 'forbidden' };
  if (!isWithdrawable(req.status)) return { ok: false, error: 'too_late' };

  const { data: changed } = await admin
    .from('phone_loan_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .in('status', ['submitted', 'under_review'])
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'too_late' };

  await writeAudit({
    actorId: profile.userId,
    actorRole: 'rider',
    action: 'phone_loan.withdrawn',
    entityType: 'phone_loan_request',
    entityId: requestId,
  });
  revalidateLoanSurfaces(profile.riderId);
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * 2. Finance prepares
 * ------------------------------------------------------------------------ */

/** Move a submitted request into finance review. */
export async function startPhoneLoanReview(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  return advance(requestId, 'under_review', 'phone_loans.review', {
    note: note ?? null,
    auditAction: 'phone_loan.review_started',
  });
}

/**
 * Record that the accountant has raised the purchase requisition for the
 * handset. The requisition itself is created through the normal requisition
 * flow (it needs lines, an invoice and an approver); this links the two so the
 * Director's approval of the purchase can advance the loan request
 * automatically.
 */
export async function linkPhoneLoanRequisition(
  requestId: string,
  requisitionId: string,
): Promise<ActionResult> {
  const actor = await checkPermission('phone_loans.review');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransitionRequest(req.status, 'requisition_raised')) {
    return { ok: false, error: 'invalid_transition' };
  }

  const { data: reqn } = await admin
    .from('purchase_requisitions')
    .select('id, requisition_number, status')
    .eq('id', requisitionId)
    .maybeSingle();
  const requisition = reqn as { id: string; requisition_number: string; status: string } | null;
  if (!requisition) return { ok: false, error: 'requisition_not_found' };
  // Linking a request that was already decided would either re-open a closed
  // decision or silently strand the loan at a stage nothing can advance.
  if (requisition.status === 'rejected' || requisition.status === 'cancelled') {
    return { ok: false, error: 'requisition_closed' };
  }

  const { error } = await admin
    .from('phone_loan_requests')
    .update({
      status: 'requisition_raised',
      requisition_id: requisitionId,
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', ['submitted', 'under_review']);
  if (error) return { ok: false, error: 'server_error' };

  // Tag the requisition back, so the Director approving it sees what it is for
  // and the reports can count phone purchases as their own type.
  await admin
    .from('purchase_requisitions')
    .update({ phone_loan_request_id: requestId, requisition_type: 'phone' })
    .eq('id', requisitionId)
    .eq('status', 'draft');

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'phone_loan.requisition_linked',
    entityType: 'phone_loan_request',
    entityId: requestId,
    metadata: { requisitionId, requisitionNumber: requisition.requisition_number },
  });

  const rider = await riderLabel(admin, req.rider_id);
  await notifyRider(req.rider_id, {
    type: 'phone_loan_progress',
    title: 'Ombi lako la simu limeendelea',
    body: `Ombi la kununua simu limepelekwa kwa Mkurugenzi kwa idhini.`,
    deepLink: '/rider/loans',
    dedupeKey: `phone_loan_stage:${requestId}:requisition_raised`,
  });
  void rider;

  revalidateLoanSurfaces(req.rider_id);
  return { ok: true };
}

/**
 * Called from the requisition decision (lib/requisitions/actions.ts) so the
 * Director approving the purchase advances the loan request without anybody
 * having to remember to.
 *
 * Best-effort by design: the requisition decision is the record that matters
 * and must not be undone because this follow-on write failed. A request left
 * at 'requisition_raised' with an approved requisition is visible in the queue
 * and can be advanced by hand.
 */
export async function onRequisitionDecidedForPhoneLoan(
  requisitionId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('phone_loan_requests')
    .select('id, rider_id, status')
    .eq('requisition_id', requisitionId)
    .maybeSingle();
  const req = data as { id: string; rider_id: string; status: PhoneLoanRequestStatus } | null;
  if (!req || req.status !== 'requisition_raised') return;

  const to: PhoneLoanRequestStatus = decision === 'approved' ? 'requisition_approved' : 'rejected';
  await admin
    .from('phone_loan_requests')
    .update({
      status: to,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq('id', req.id)
    .eq('status', 'requisition_raised');

  await notifyRider(req.rider_id, {
    type: 'phone_loan_progress',
    title: decision === 'approved' ? 'Mkopo wa simu umeidhinishwa' : 'Ombi la simu halikukubaliwa',
    body:
      decision === 'approved'
        ? 'Mkurugenzi ameidhinisha manunuzi ya simu yako. Utaarifiwa itakaponunuliwa.'
        : `Ombi lako halikukubaliwa. ${note ?? ''}`.trim(),
    deepLink: '/rider/loans',
    dedupeKey: `phone_loan_stage:${req.id}:${to}`,
  });

  revalidateLoanSurfaces(req.rider_id);
}

/** The handset has been bought and the requisition retired. */
export async function markPhoneLoanPurchased(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  return advance(requestId, 'purchased', 'phone_loans.review', {
    note: note ?? null,
    auditAction: 'phone_loan.purchased',
    riderMessage: {
      title: 'Simu yako imenunuliwa',
      body: 'Simu imenunuliwa. Mkopo utaanza na malipo ya pikipiki yatasimama kwa muda.',
    },
  });
}

/* ------------------------------------------------------------------------ *
 * 3. Activation — the only step that creates money
 * ------------------------------------------------------------------------ */

/**
 * Create the loan and its instalment calendar, and pause the lease.
 *
 * All three happen inside `activate_phone_loan` (0031) so a failure leaves
 * NOTHING behind: half of this applied would mean either a rider owing a phone
 * and a lease at once, or a paused lease with no phone instalments to pay.
 *
 * The instalment dates are computed here, by the same pure function that
 * produced the quote, and the DB re-checks that they sum to the agreed total
 * before it commits. Two independent checks on the one number that must not be
 * wrong.
 */
export async function activatePhoneLoan(requestId: string): Promise<ActionResult<{ loanId: string }>> {
  const actor = await checkPermission('phone_loans.review');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransitionRequest(req.status, 'active')) return { ok: false, error: 'invalid_transition' };
  if (!req.contract_id) return { ok: false, error: 'no_contract' };

  const { data: contractRow } = await admin
    .from('contracts')
    .select('id, status, payment_deadline_time, lease_paused_for_loan_id, contract_number')
    .eq('id', req.contract_id)
    .maybeSingle();
  const contract = contractRow as
    | {
        id: string;
        status: string;
        payment_deadline_time: string;
        lease_paused_for_loan_id: string | null;
        contract_number: string;
      }
    | null;
  if (!contract) return { ok: false, error: 'no_contract' };
  if (contract.status !== 'active') return { ok: false, error: 'contract_not_active' };
  if (contract.lease_paused_for_loan_id) return { ok: false, error: 'already_paused' };

  // The instalment calendar: first payment one calendar month from today, the
  // rest a month apart, clamped for short months by addMonths().
  const today = localDateString();
  const amounts = splitLoanTotal(req.total_amount, req.term_months);
  const deadline = (contract.payment_deadline_time ?? '18:00').slice(0, 5);
  const instalments = amounts.map((amount, i) => {
    const dueDate = addMonths(today, i + 1);
    return {
      due_date: dueDate,
      due_at: dueTimestampUtc(dueDate, deadline),
      local_due_time: `${deadline}:00`,
      amount,
    };
  });

  // Create the loan row first: activate_phone_loan() needs something to
  // activate, and a 'pending' loan with no obligations is inert — it creates
  // no money and blocks nothing if the next step fails.
  const { data: loanRow, error: loanErr } = await admin
    .from('phone_loans')
    .insert({
      rider_id: req.rider_id,
      contract_id: req.contract_id,
      principal: req.principal,
      interest_bps: req.interest_bps,
      interest_amount: req.interest_amount,
      total_amount: req.total_amount,
      term_months: req.term_months,
      device_description: req.device_description,
      status: 'pending',
      source: 'mid_contract',
      request_id: requestId,
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (loanErr || !loanRow) return { ok: false, error: 'server_error' };
  const loanId = (loanRow as { id: string }).id;

  const { error: rpcErr } = await admin.rpc('activate_phone_loan', {
    p_loan_id: loanId,
    p_instalments: instalments,
    p_pause_lease: true,
  });
  if (rpcErr) {
    // Nothing was created by the function (it is one transaction), so the
    // inert loan row is all that exists — mark it cancelled rather than
    // leaving a 'pending' loan that looks like it is about to start.
    await admin.from('phone_loans').update({ status: 'cancelled' }).eq('id', loanId);
    return { ok: false, error: describeActivationError(rpcErr.message) };
  }

  await admin
    .from('phone_loan_requests')
    .update({ status: 'active', phone_loan_id: loanId })
    .eq('id', requestId);

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'phone_loan.activated',
    entityType: 'phone_loan',
    entityId: loanId,
    metadata: {
      requestId,
      riderId: req.rider_id,
      contractNumber: contract.contract_number,
      total: req.total_amount,
      instalments: instalments.length,
      leasePaused: true,
    },
  });

  const rider = await riderLabel(admin, req.rider_id);
  await notifyRider(req.rider_id, {
    type: 'phone_loan_active',
    title: 'Mkopo wa simu umeanza',
    body:
      `Utalipa ${formatTZS(req.total_amount)} kwa miezi ${req.term_months}. ` +
      `Malipo ya kwanza ${formatDate(instalments[0]!.due_date)}. ` +
      'Malipo ya pikipiki yamesimama mpaka utakapomaliza simu.',
    deepLink: '/rider/loans',
    dedupeKey: `phone_loan_active:${loanId}`,
  });
  if (rider.phone) {
    await enqueueSms({
      recipient: rider.phone,
      text: `Ng'umbi Riders: Mkopo wa simu umeanza. Utalipa ${formatTZS(req.total_amount)} kwa miezi ${req.term_months}. Malipo ya pikipiki yamesimama mpaka utakapomaliza.`,
      subject: 'phone_loan_active',
    });
  }
  await notifyOwner({
    type: 'phone_loan_active',
    title: 'Phone loan activated',
    body: `${rider.name} — ${formatTZS(req.total_amount)} over ${req.term_months} month(s). The motorcycle lease is paused until it is repaid.`,
    deepLink: '/owner/phone-loans',
    dedupeKey: `phone_loan_active_owner:${loanId}`,
  });

  revalidateLoanSurfaces(req.rider_id);
  return { ok: true, data: { loanId } };
}

/** Turn a raised PL/pgSQL message into something the accountant can act on. */
function describeActivationError(message: string): string {
  if (/already scheduled on/.test(message)) return 'date_conflict';
  if (/already paused/.test(message)) return 'already_paused';
  if (/refusing to activate/.test(message)) return 'total_mismatch';
  if (/is (?!active)\w+ — a phone loan attaches/.test(message)) return 'contract_not_active';
  return 'activation_failed';
}

/* ------------------------------------------------------------------------ *
 * 4. Refusal
 * ------------------------------------------------------------------------ */

/**
 * Reject the request.
 *
 * Finance may refuse it on ELIGIBILITY while it is still theirs (submitted or
 * under review) — that is a bookkeeping judgement, not a spending decision.
 * Once a purchase requisition exists, only the Director may refuse it, because
 * by then the refusal is a decision about committed company money.
 */
export async function rejectPhoneLoanRequest(
  requestId: string,
  reason: string,
): Promise<ActionResult> {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };

  const actor = await checkPermission('phone_loans.review');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransitionRequest(req.status, 'rejected')) return { ok: false, error: 'invalid_transition' };

  const financeStage = req.status === 'submitted' || req.status === 'under_review';
  if (!financeStage && actor.role !== 'owner') return { ok: false, error: 'owner_only' };

  const { data: changed } = await admin
    .from('phone_loan_requests')
    .update({
      status: 'rejected',
      decided_by: actor.userId,
      decided_at: new Date().toISOString(),
      decision_note: trimmed.slice(0, 1000),
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'phone_loan.rejected',
    entityType: 'phone_loan_request',
    entityId: requestId,
    metadata: { from: req.status, reason: trimmed.slice(0, 200) },
  });

  await notifyRider(req.rider_id, {
    type: 'phone_loan_progress',
    title: 'Ombi la mkopo wa simu halikukubaliwa',
    body: trimmed.slice(0, 300),
    deepLink: '/rider/loans',
    dedupeKey: `phone_loan_stage:${requestId}:rejected`,
  });

  revalidateLoanSurfaces(req.rider_id);
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * shared stage-advance
 * ------------------------------------------------------------------------ */

async function advance(
  requestId: string,
  to: PhoneLoanRequestStatus,
  permission: 'phone_loans.review' | 'phone_loans.decide',
  opts: {
    note: string | null;
    auditAction: string;
    riderMessage?: { title: string; body: string };
  },
): Promise<ActionResult> {
  const actor = await checkPermission(permission);
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransitionRequest(req.status, to)) return { ok: false, error: 'invalid_transition' };

  // Conditional on the status we READ: a colleague advancing the same request
  // between the read and this write wins, rather than being overwritten.
  const { data: changed } = await admin
    .from('phone_loan_requests')
    .update({
      status: to,
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
      review_note: opts.note,
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: opts.auditAction,
    entityType: 'phone_loan_request',
    entityId: requestId,
    metadata: { from: req.status, to, note: opts.note },
  });

  if (opts.riderMessage) {
    await notifyRider(req.rider_id, {
      type: 'phone_loan_progress',
      title: opts.riderMessage.title,
      body: opts.riderMessage.body,
      deepLink: '/rider/loans',
      dedupeKey: `phone_loan_stage:${requestId}:${to}`,
    });
  }

  revalidateLoanSurfaces(req.rider_id);
  return { ok: true };
}

/** Notify every ACTIVE account holding a role (the accountants' shared queue). */
async function notifyStaff(
  admin: ReturnType<typeof createAdminClient>,
  role: 'accountant' | 'owner',
  n: { type: string; title: string; body: string; deepLink: string; dedupeKey: string },
): Promise<void> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('role', role)
    .eq('is_active', true);
  for (const p of (data ?? []) as { id: string }[]) {
    await createNotification({
      profileId: p.id,
      type: n.type,
      title: n.title,
      body: n.body,
      deepLink: n.deepLink,
      // One key per RECIPIENT: a shared key would deliver the message to the
      // first accountant and silently drop it for the second.
      dedupeKey: `${n.dedupeKey}:${p.id}`,
    });
  }
}

/** Human labels for the stage, for the queue headers. */
export async function phoneLoanStageLabel(status: PhoneLoanRequestStatus): Promise<string> {
  return REQUEST_STATUS_LABELS[status];
}
