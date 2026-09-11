'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { checkPermission, getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { createNotification, notifyOwner, notifyRider } from '@/lib/notifications/service';
import { enqueueSms } from '@/lib/messaging/outbox';
import { sniffFileType } from '@/lib/applications/file-signature';
import { formatTZS } from '@/lib/money/format';
import { localDateString } from '@/lib/dates/tz';
import type { Json } from '@/lib/supabase/types';
import {
  canTransition,
  STATUS_LABELS,
  type CompletionStatus,
} from './machine';
import { nextRequestNumber, nextCertificateNumber } from './numbering';
import { renderCertificate, type CertificateData } from './certificate';

/*
 * THE END-OF-CONTRACT CHAIN (client feedback 2026-09-11 #6, #7, #8, #10).
 *
 *   rider submits        -> 'requested'
 *   finance reviews      -> 'finance_review'
 *   finance clears       -> 'finance_cleared'      (records what they saw)
 *   finance sends up     -> 'director_review'
 *   Director approves    -> 'director_approved' then 'certificate_issued'
 *                           (the certificate is generated in the same action —
 *                            "automatically", as asked)
 *   finance starts       -> 'transfer_in_progress'
 *   finance uploads doc  -> 'transfer_uploaded'
 *   finance sends up     -> 'final_review'
 *   Director signs off   -> 'completed'  + the contract is LOCKED
 *
 * THREE THINGS THIS FILE IS CAREFUL ABOUT
 *
 * 1. THE CHAIN CANNOT BE SHORT-CIRCUITED. Every step checks a permission the
 *    right role holds and only that role holds (`completion.review` /
 *    `completion.transfer` for finance, `completion.decide` for the Director),
 *    then checks the transition is legal, then writes CONDITIONALLY on the
 *    status it read. Migration 0034's trigger independently refuses an approval
 *    without finance clearance and a sign-off without approval, because the
 *    client asked for a control rather than a convention.
 *
 * 2. OUTSTANDING MONEY IS RE-CHECKED AT EVERY DECISION POINT, from the ledger.
 *    Finance clears a balance that was true when they looked; days accrue. The
 *    approval re-checks, and the sign-off re-checks again in the database
 *    itself, which is the last point at which a mistake is still cheap.
 *
 * 3. SIGN-OFF LOCKS THE RECORD (feedback #10). After it, the contract's terms
 *    and the motorcycle's registration identity are frozen; changing either
 *    needs `unlock_contract_for_amendment`, which is itself audited. That is
 *    the difference between amending a completed contract and quietly editing
 *    one.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const MAX_TRANSFER_DOC_BYTES = 4 * 1024 * 1024; // Vercel body cap (D-030)
const TRANSFER_DOC_TYPES = ['transfer_form', 'registration_card', 'tra_receipt', 'other'] as const;

function revalidateCompletionSurfaces(ids: { riderId?: string; contractId?: string } = {}) {
  revalidatePath('/owner');
  revalidatePath('/owner/completions');
  revalidatePath('/owner/contracts');
  revalidatePath('/accountant');
  revalidatePath('/accountant/completions');
  revalidatePath('/rider');
  revalidatePath('/rider/completion');
  if (ids.contractId) {
    revalidatePath(`/owner/contracts/${ids.contractId}`);
    revalidatePath(`/accountant/contracts/${ids.contractId}`);
  }
  if (ids.riderId) {
    revalidatePath(`/owner/riders/${ids.riderId}`);
    revalidatePath(`/accountant/riders/${ids.riderId}`);
  }
}

type RequestRow = {
  id: string;
  request_number: string;
  status: CompletionStatus;
  contract_id: string;
  rider_id: string;
  motorcycle_id: string;
  requested_by: string;
  finance_cleared: boolean | null;
  director_decided_at: string | null;
};

const COLUMNS =
  'id, request_number, status, contract_id, rider_id, motorcycle_id, requested_by, ' +
  'finance_cleared, director_decided_at';

type Admin = ReturnType<typeof createAdminClient>;

async function loadRequest(admin: Admin, id: string): Promise<RequestRow | null> {
  const { data } = await admin
    .from('contract_completion_requests')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
}

/** Outstanding obligations for a contract, from the ledger, right now. */
async function outstandingFor(admin: Admin, contractId: string): Promise<number> {
  const { data, error } = await admin
    .from('payment_obligations')
    .select('amount_due')
    .eq('contract_id', contractId)
    .in('status', ['scheduled', 'due', 'overdue']);
  // A failed read must NOT read as "nothing outstanding" — that is the one
  // wrong answer that would let a contract be signed off with money owing
  // (the D-033 rule: never destructure data without checking error).
  if (error) throw new Error(`outstanding read failed: ${error.message}`);
  return ((data ?? []) as { amount_due: number }[]).reduce((s, o) => s + o.amount_due, 0);
}

/** Append to the stage history. Append-only: corrections are new rows. */
async function recordEvent(
  admin: Admin,
  requestId: string,
  from: CompletionStatus | null,
  to: CompletionStatus,
  actor: { userId: string; role: string } | null,
  note: string | null,
): Promise<void> {
  await admin.from('contract_completion_events').insert({
    request_id: requestId,
    from_status: from,
    to_status: to,
    actor_id: actor?.userId ?? null,
    actor_role: actor?.role ?? 'system',
    note,
  });
}

async function riderLabel(
  admin: Admin,
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

/** Every active accountant, so the shared finance queue is actually notified. */
async function notifyFinance(
  admin: Admin,
  n: { type: string; title: string; body: string; deepLink: string; dedupeKey: string },
): Promise<void> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'accountant')
    .eq('is_active', true);
  for (const p of (data ?? []) as { id: string }[]) {
    await createNotification({
      profileId: p.id,
      type: n.type,
      title: n.title,
      body: n.body,
      deepLink: n.deepLink,
      // One key PER RECIPIENT: a shared key delivers to the first accountant
      // and silently drops the message for the second.
      dedupeKey: `${n.dedupeKey}:${p.id}`,
    });
  }
}

/* ======================================================================== *
 * 1. The rider asks
 * ======================================================================== */

export async function requestContractCompletion(input: {
  note?: string;
}): Promise<ActionResult<{ id: string; requestNumber: string }>> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'rider' || !profile.riderId) {
    return { ok: false, error: 'forbidden' };
  }

  const admin = createAdminClient();
  const { data: contractRow } = await admin
    .from('contracts')
    .select('id, motorcycle_id, status')
    .eq('rider_id', profile.riderId)
    .in('status', ['active', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const contract = contractRow as { id: string; motorcycle_id: string; status: string } | null;
  if (!contract) return { ok: false, error: 'no_contract' };

  const today = localDateString();
  let requestNumber: string;
  try {
    requestNumber = await nextRequestNumber(admin, today);
  } catch {
    return { ok: false, error: 'server_error' };
  }

  const { data: row, error } = await admin
    .from('contract_completion_requests')
    .insert({
      request_number: requestNumber,
      contract_id: contract.id,
      rider_id: profile.riderId,
      motorcycle_id: contract.motorcycle_id,
      status: 'requested',
      requested_by: profile.userId,
      rider_note: input.note?.trim()?.slice(0, 1000) || null,
    })
    .select('id')
    .single();
  if (error || !row) {
    // 23505 = the one-open-request-per-contract index, or a raced number.
    if (error?.code === '23505') return { ok: false, error: 'already_requested' };
    return { ok: false, error: 'server_error' };
  }
  const id = (row as { id: string }).id;

  await recordEvent(admin, id, null, 'requested', { userId: profile.userId, role: 'rider' }, null);

  const rider = await riderLabel(admin, profile.riderId);
  const outstanding = await outstandingFor(admin, contract.id).catch(() => 0);
  const body =
    `${rider.name} has asked to complete their contract.` +
    (outstanding > 0 ? ` They still owe ${formatTZS(outstanding)}.` : ' Nothing is outstanding.');

  await notifyFinance(admin, {
    type: 'completion_requested',
    title: 'Contract completion requested',
    body,
    deepLink: '/accountant/completions',
    dedupeKey: `completion_requested:${id}`,
  });
  await notifyOwner({
    type: 'completion_requested',
    title: 'Contract completion requested',
    body,
    deepLink: '/owner/completions',
    dedupeKey: `completion_requested_owner:${id}`,
  });

  await writeAudit({
    actorId: profile.userId,
    actorRole: 'rider',
    action: 'completion.requested',
    entityType: 'contract_completion_request',
    entityId: id,
    metadata: { requestNumber, contractId: contract.id, outstanding },
  });

  revalidateCompletionSurfaces({ riderId: profile.riderId, contractId: contract.id });
  return { ok: true, data: { id, requestNumber } };
}

/* ======================================================================== *
 * 2. Finance
 * ======================================================================== */

/** Pick the request up. */
export async function startFinanceReview(requestId: string): Promise<ActionResult> {
  return advance(requestId, 'finance_review', 'completion.review', { note: null });
}

/**
 * Finance's decision on the money: does the rider still owe anything?
 *
 * `cleared` is the accountant's JUDGEMENT and it is recorded as such, alongside
 * the balance they saw. It does not override the ledger: an approval or a
 * sign-off re-checks the live figure, and the DB refuses a sign-off while
 * anything is outstanding whatever this flag says.
 */
export async function recordFinanceClearance(
  requestId: string,
  input: { cleared: boolean; note?: string },
): Promise<ActionResult<{ outstanding: number }>> {
  const actor = await checkPermission('completion.review');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };

  // Clearing is legal from 'requested' too, so finance need not click twice.
  if (req.status !== 'requested' && req.status !== 'finance_review') {
    return { ok: false, error: 'invalid_transition' };
  }

  let outstanding: number;
  try {
    outstanding = await outstandingFor(admin, req.contract_id);
  } catch {
    return { ok: false, error: 'balance_read_failed' };
  }

  // Refuse a clearance that contradicts the ledger. Finance can decline to
  // clear a rider who owes nothing (something else may be wrong), but they
  // cannot declare a rider clear who demonstrably is not.
  if (input.cleared && outstanding > 0) {
    return { ok: false, error: 'still_outstanding' };
  }

  const to: CompletionStatus = input.cleared ? 'finance_cleared' : 'returned';
  const { data: changed } = await admin
    .from('contract_completion_requests')
    .update({
      status: to,
      finance_reviewed_by: actor.userId,
      finance_reviewed_at: new Date().toISOString(),
      finance_note: input.note?.trim()?.slice(0, 2000) || null,
      finance_cleared: input.cleared,
      finance_outstanding_snapshot: outstanding,
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await recordEvent(admin, requestId, req.status, to, actor, input.note?.trim() || null);
  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: input.cleared ? 'completion.finance_cleared' : 'completion.returned',
    entityType: 'contract_completion_request',
    entityId: requestId,
    metadata: { requestNumber: req.request_number, outstanding, note: input.note ?? null },
  });

  await notifyRider(req.rider_id, {
    type: 'completion_progress',
    title: input.cleared
      ? 'Uhasibu wamethibitisha hakuna deni'
      : 'Ombi lako la kumaliza mkataba limerudishwa',
    body: input.cleared
      ? 'Ombi lako linapelekwa kwa Mkurugenzi.'
      : `${input.note?.trim() ?? 'Tafadhali wasiliana na uhasibu.'}`,
    deepLink: '/rider/completion',
    dedupeKey: `completion_stage:${requestId}:${to}`,
  });

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true, data: { outstanding } };
}

/** Send a cleared request up to the Managing Director. */
export async function sendCompletionToDirector(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  const result = await advance(requestId, 'director_review', 'completion.review', {
    note: note ?? null,
  });
  if (!result.ok) return result;

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (req) {
    const rider = await riderLabel(admin, req.rider_id);
    await notifyOwner({
      type: 'completion_decision',
      title: 'Contract completion awaiting your approval',
      body: `${rider.name} — ${req.request_number}. Finance has confirmed nothing is outstanding.`,
      deepLink: `/owner/completions/${requestId}`,
      dedupeKey: `completion_director_review:${requestId}`,
    });
  }
  return { ok: true };
}

/* ======================================================================== *
 * 3. The Director approves, and the certificate is generated
 * ======================================================================== */

/**
 * Approve completion AND issue the certificate, in one action.
 *
 * The brief says the certificate is generated automatically after approval, so
 * it is generated here rather than left to a button somebody has to remember.
 *
 * Ordering matters. The approval is written FIRST and the certificate second:
 * if PDF rendering or the upload fails, the request sits at 'director_approved'
 * — visibly mid-chain, retryable with `issueCertificate` — rather than the
 * approval being lost. The reverse order would produce a certificate for an
 * approval that does not exist.
 */
export async function approveCompletion(
  requestId: string,
  note?: string,
): Promise<ActionResult<{ certificateNumber: string | null }>> {
  const actor = await checkPermission('completion.decide');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransition(req.status, 'director_approved')) {
    return { ok: false, error: 'invalid_transition' };
  }
  // The DB refuses this too (0034 rule 1); checking here turns a raised
  // exception into a sentence the Director can act on.
  if (req.finance_cleared !== true) return { ok: false, error: 'not_finance_cleared' };

  let outstanding: number;
  try {
    outstanding = await outstandingFor(admin, req.contract_id);
  } catch {
    return { ok: false, error: 'balance_read_failed' };
  }
  // Finance cleared a balance that was true when they looked. Days accrue.
  if (outstanding > 0) return { ok: false, error: 'still_outstanding' };

  const { data: changed } = await admin
    .from('contract_completion_requests')
    .update({
      status: 'director_approved',
      director_decided_by: actor.userId,
      director_decided_at: new Date().toISOString(),
      director_note: note?.trim()?.slice(0, 2000) || null,
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await recordEvent(admin, requestId, req.status, 'director_approved', actor, note?.trim() || null);
  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'completion.approved',
    entityType: 'contract_completion_request',
    entityId: requestId,
    metadata: { requestNumber: req.request_number, contractId: req.contract_id },
  });

  const issued = await issueCertificateInternal(admin, requestId, actor);

  const rider = await riderLabel(admin, req.rider_id);
  await notifyRider(req.rider_id, {
    type: 'completion_approved',
    title: 'Mkurugenzi ameidhinisha kumaliza mkataba',
    body: issued.ok
      ? 'Hongera! Cheti chako cha kumaliza mkataba kimetolewa. Uhasibu wanaandaa uhamisho wa umiliki.'
      : 'Hongera! Mkurugenzi ameidhinisha. Cheti chako kinaandaliwa.',
    deepLink: '/rider/completion',
    dedupeKey: `completion_approved:${requestId}`,
  });
  if (rider.phone) {
    await enqueueSms({
      recipient: rider.phone,
      text: "Ng'umbi Riders: Hongera! Mkurugenzi ameidhinisha kuwa umekamilisha mkataba wako. Cheti chako kipo kwenye mfumo.",
      subject: 'completion_approved',
    });
  }
  await notifyFinance(admin, {
    type: 'completion_transfer',
    title: 'Ownership transfer to arrange',
    body: `${rider.name} — ${req.request_number}. The Director has approved completion; the transfer is now with finance.`,
    deepLink: `/accountant/completions/${requestId}`,
    dedupeKey: `completion_transfer:${requestId}`,
  });

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true, data: { certificateNumber: issued.certificateNumber } };
}

/** Retry certificate generation for an approved request (see approveCompletion). */
export async function issueCertificate(
  requestId: string,
): Promise<ActionResult<{ certificateNumber: string | null }>> {
  const actor = await checkPermission('completion.decide');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (req.director_decided_at === null) return { ok: false, error: 'not_approved' };

  const issued = await issueCertificateInternal(admin, requestId, actor);
  if (!issued.ok) return { ok: false, error: issued.error ?? 'certificate_failed' };
  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true, data: { certificateNumber: issued.certificateNumber } };
}

/**
 * Generate, store and record the certificate.
 *
 * Best-effort from the caller's point of view: a failure leaves the request at
 * 'director_approved' and returns `ok: false`, and the approval stands. A
 * certificate is a document, not a decision.
 */
async function issueCertificateInternal(
  admin: Admin,
  requestId: string,
  actor: { userId: string; role: string; fullName: string | null },
): Promise<{ ok: boolean; certificateNumber: string | null; error?: string }> {
  try {
    const { data } = await admin
      .from('contract_completion_requests')
      .select(
        'id, request_number, status, contract_id, rider_id, motorcycle_id, signed_off_at, ' +
          'contracts(contract_number, start_date, end_date, ownership_transfers), ' +
          'riders(first_name, middle_name, last_name, rider_number), ' +
          'motorcycles(motorcycle_number, registration_number, make, model, chassis_number)',
      )
      .eq('id', requestId)
      .maybeSingle();
    const r = data as unknown as {
      id: string;
      request_number: string;
      status: CompletionStatus;
      contract_id: string;
      rider_id: string;
      motorcycle_id: string;
      signed_off_at: string | null;
      contracts: {
        contract_number: string;
        start_date: string | null;
        end_date: string | null;
        ownership_transfers: boolean;
      } | null;
      riders: {
        first_name: string;
        middle_name: string | null;
        last_name: string;
        rider_number: string;
      } | null;
      motorcycles: {
        motorcycle_number: string;
        registration_number: string | null;
        make: string | null;
        model: string | null;
        chassis_number: string | null;
      } | null;
    } | null;
    if (!r) return { ok: false, certificateNumber: null, error: 'not_found' };

    // What the rider has actually paid, for the face of the certificate.
    const { data: payRows } = await admin
      .from('payments')
      .select('amount')
      .eq('contract_id', r.contract_id)
      .eq('status', 'completed');
    const totalPaid = ((payRows ?? []) as { amount: number }[]).reduce((s, p) => s + p.amount, 0);

    const today = localDateString();
    const certificateNumber = await nextCertificateNumber(admin, today);

    // Reissues become a NEW VERSION, never an overwrite: a certificate already
    // in a rider's hands must never be silently replaced (0034's immutability
    // trigger refuses the overwrite anyway).
    const { data: existing } = await admin
      .from('contract_certificates')
      .select('version')
      .eq('request_id', requestId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((existing as { version: number } | null)?.version ?? 0) + 1;

    const fullName = [r.riders?.first_name, r.riders?.middle_name, r.riders?.last_name]
      .filter(Boolean)
      .join(' ');

    const certificate: CertificateData = {
      certificateNumber,
      riderName: fullName || 'Rider',
      riderNumber: r.riders?.rider_number ?? '—',
      motorcycleNumber: r.motorcycles?.motorcycle_number ?? '—',
      motorcycleRegistration: r.motorcycles?.registration_number ?? null,
      motorcycleMake: r.motorcycles?.make ?? null,
      motorcycleModel: r.motorcycles?.model ?? null,
      motorcycleChassis: r.motorcycles?.chassis_number ?? null,
      contractNumber: r.contracts?.contract_number ?? '—',
      contractStartDate: r.contracts?.start_date ?? null,
      contractEndDate: r.contracts?.end_date ?? null,
      totalPaid,
      ownershipTransfers: r.contracts?.ownership_transfers ?? false,
      directorName: actor.fullName ?? 'Managing Director',
      issuedOn: today,
      signedOffOn: r.signed_off_at ? r.signed_off_at.slice(0, 10) : null,
    };

    const buffer = await renderCertificate(certificate);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const path = `${r.contract_id}/${certificateNumber}-v${version}.pdf`;

    const { error: upErr } = await admin.storage
      .from('contract-certificates')
      .upload(path, buffer, { contentType: 'application/pdf', upsert: false });
    if (upErr) return { ok: false, certificateNumber: null, error: 'upload_failed' };

    const { error: insErr } = await admin.from('contract_certificates').insert({
      certificate_number: certificateNumber,
      request_id: requestId,
      contract_id: r.contract_id,
      rider_id: r.rider_id,
      motorcycle_id: r.motorcycle_id,
      version,
      storage_path: path,
      sha256_hash: hash,
      // The facts AS PRINTED. Re-deriving them years later from rows that have
      // since moved would make an old PDF and a new screen disagree.
      // Cast through the generated Json type: CertificateData is a flat record
      // of strings, numbers, booleans and nulls, which is exactly Json.
      snapshot: certificate as unknown as Json,
      issued_by: actor.userId,
    });
    if (insErr) {
      // Never leave an orphan in the bucket when its row failed to write.
      await admin.storage.from('contract-certificates').remove([path]);
      return { ok: false, certificateNumber: null, error: 'insert_failed' };
    }

    // Advance only from 'director_approved': a reissue on a later stage must
    // not drag the request backwards.
    await admin
      .from('contract_completion_requests')
      .update({ status: 'certificate_issued' })
      .eq('id', requestId)
      .eq('status', 'director_approved');

    await recordEvent(
      admin,
      requestId,
      'director_approved',
      'certificate_issued',
      actor,
      `Certificate ${certificateNumber} (v${version})`,
    );
    await writeAudit({
      actorId: actor.userId,
      actorRole: actor.role as 'owner',
      action: 'completion.certificate_issued',
      entityType: 'contract_certificate',
      entityId: requestId,
      metadata: { certificateNumber, version, contractId: r.contract_id, sha256: hash },
    });

    return { ok: true, certificateNumber };
  } catch {
    return { ok: false, certificateNumber: null, error: 'certificate_failed' };
  }
}

/* ======================================================================== *
 * 4. Ownership transfer
 * ======================================================================== */

export async function startOwnershipTransfer(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  const actor = await checkPermission('completion.transfer');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransition(req.status, 'transfer_in_progress')) {
    return { ok: false, error: 'invalid_transition' };
  }

  const { data: changed } = await admin
    .from('contract_completion_requests')
    .update({
      status: 'transfer_in_progress',
      transfer_started_at: new Date().toISOString(),
      transfer_handled_by: actor.userId,
      transfer_note: note?.trim()?.slice(0, 2000) || null,
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await recordEvent(admin, requestId, req.status, 'transfer_in_progress', actor, note?.trim() || null);
  await notifyRider(req.rider_id, {
    type: 'completion_progress',
    title: 'Uhamisho wa umiliki unaendelea',
    body: 'Uhasibu wanaandaa hati za uhamisho wa umiliki wa pikipiki yako.',
    deepLink: '/rider/completion',
    dedupeKey: `completion_stage:${requestId}:transfer_in_progress`,
  });

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true };
}

/**
 * Upload the signed ownership-transfer document (client feedback #8).
 *
 * One file per request (D-030): Vercel rejects a body over ~4.5 MB with an
 * opaque 413, and a transfer form photographed on a phone is easily 3 MB.
 *
 * The BYTES decide the type, never the filename or the browser's
 * Content-Type — the same magic-byte sniffer every other upload in this system
 * goes through (spec §24).
 */
export async function uploadTransferDocument(
  formData: FormData,
): Promise<ActionResult<{ id: string; fileName: string }>> {
  const actor = await checkPermission('completion.transfer');
  if (!actor) return { ok: false, error: 'forbidden' };

  const requestId = formData.get('requestId');
  const file = formData.get('file');
  const rawType = formData.get('docType');
  const note = formData.get('note');
  const docType =
    typeof rawType === 'string' && (TRANSFER_DOC_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : 'transfer_form';

  if (typeof requestId !== 'string' || !requestId) return { ok: false, error: 'bad_request' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_TRANSFER_DOC_BYTES) return { ok: false, error: 'too_large' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  // The document belongs to the transfer stage. Accepted at 'transfer_uploaded'
  // too, so a second page of a form can follow the first.
  if (req.status !== 'transfer_in_progress' && req.status !== 'transfer_uploaded') {
    return { ok: false, error: 'not_in_transfer' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffFileType(buffer);
  if (!sniffed) return { ok: false, error: 'invalid_type' };
  const mime =
    sniffed === 'pdf'
      ? 'application/pdf'
      : sniffed === 'jpeg'
        ? 'image/jpeg'
        : sniffed === 'png'
          ? 'image/png'
          : 'image/webp';
  const ext = sniffed === 'jpeg' ? 'jpg' : sniffed;

  const hash = createHash('sha256').update(buffer).digest('hex');
  const path = `${req.contract_id}/${Date.now()}-${hash.slice(0, 8)}.${ext}`;
  const { error: upErr } = await admin.storage
    .from('ownership-transfers')
    .upload(path, buffer, { contentType: mime });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { data: row, error } = await admin
    .from('ownership_transfer_documents')
    .insert({
      request_id: requestId,
      contract_id: req.contract_id,
      rider_id: req.rider_id,
      motorcycle_id: req.motorcycle_id,
      doc_type: docType,
      file_name: file.name.slice(0, 255),
      storage_path: path,
      mime_type: mime,
      size_bytes: file.size,
      sha256_hash: hash,
      note: typeof note === 'string' ? note.trim().slice(0, 1000) || null : null,
      uploaded_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !row) {
    await admin.storage.from('ownership-transfers').remove([path]);
    return { ok: false, error: 'insert_failed' };
  }

  // The first document moves the stage; later ones only add to it.
  if (req.status === 'transfer_in_progress') {
    await admin
      .from('contract_completion_requests')
      .update({ status: 'transfer_uploaded' })
      .eq('id', requestId)
      .eq('status', 'transfer_in_progress');
    await recordEvent(
      admin,
      requestId,
      'transfer_in_progress',
      'transfer_uploaded',
      actor,
      file.name.slice(0, 200),
    );
  }

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'completion.transfer_document_uploaded',
    entityType: 'ownership_transfer_document',
    entityId: (row as { id: string }).id,
    metadata: { requestId, docType, fileName: file.name.slice(0, 120), sha256: hash },
  });

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true, data: { id: (row as { id: string }).id, fileName: file.name } };
}

/** Hand the request back to the Director for the final check. */
export async function sendTransferForFinalReview(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  const result = await advance(requestId, 'final_review', 'completion.transfer', {
    note: note ?? null,
  });
  if (!result.ok) return result;

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (req) {
    const rider = await riderLabel(admin, req.rider_id);
    await notifyOwner({
      type: 'completion_decision',
      title: 'Ownership transfer awaiting your confirmation',
      body: `${rider.name} — ${req.request_number}. The transfer document is on file; your sign-off completes the contract.`,
      deepLink: `/owner/completions/${requestId}`,
      dedupeKey: `completion_final_review:${requestId}`,
    });
  }
  return { ok: true };
}

/* ======================================================================== *
 * 5. Final sign-off — and the record is locked
 * ======================================================================== */

/**
 * The Director confirms the transfer and signs off.
 *
 * This is the only place a contract becomes `completed` through this chain, and
 * it does four things that must hold together:
 *
 *   1. moves the request to 'completed' (the DB re-checks approval, sign-off
 *      and the live outstanding balance — 0034 rules 2 and 2b),
 *   2. marks the contract completed and LOCKS it (feedback #10),
 *   3. records the motorcycle as transferred and locks its registration
 *      identity, when the contract transfers ownership,
 *   4. tells the rider.
 *
 * Step 1 first. If a later step fails, the request is completed and the
 * contract is not yet locked — visible, and fixable by re-running. The reverse
 * order could lock a contract whose completion was refused.
 */
export async function signOffCompletion(
  requestId: string,
  note?: string,
): Promise<ActionResult> {
  const actor = await checkPermission('completion.decide');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransition(req.status, 'completed')) return { ok: false, error: 'invalid_transition' };

  let outstanding: number;
  try {
    outstanding = await outstandingFor(admin, req.contract_id);
  } catch {
    return { ok: false, error: 'balance_read_failed' };
  }
  if (outstanding > 0) return { ok: false, error: 'still_outstanding' };

  const now = new Date().toISOString();
  const { data: changed, error } = await admin
    .from('contract_completion_requests')
    .update({
      status: 'completed',
      signed_off_by: actor.userId,
      signed_off_at: now,
      signoff_note: note?.trim()?.slice(0, 2000) || null,
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (error) {
    // The 0034 trigger raises on a skipped step or an outstanding balance.
    return { ok: false, error: describeGuardError(error.message) };
  }
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await recordEvent(admin, requestId, req.status, 'completed', actor, note?.trim() || null);

  // --- 2. complete and lock the contract ---------------------------------
  const { data: contractRow } = await admin
    .from('contracts')
    .select('id, status, ownership_transfers, contract_number')
    .eq('id', req.contract_id)
    .maybeSingle();
  const contract = contractRow as
    | { id: string; status: string; ownership_transfers: boolean; contract_number: string }
    | null;

  await admin
    .from('contracts')
    .update({
      status: 'completed',
      locked_at: now,
      locked_by: actor.userId,
      lock_reason: `Completion signed off (${req.request_number})`,
      completion_request_id: requestId,
    })
    .eq('id', req.contract_id);

  // --- 3. the motorcycle ------------------------------------------------
  if (contract?.ownership_transfers) {
    await admin
      .from('motorcycles')
      .update({
        transferred_to_rider_id: req.rider_id,
        transferred_at: now,
        locked_at: now,
        locked_by: actor.userId,
        status: 'inactive',
      })
      .eq('id', req.motorcycle_id);
  }

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'completion.signed_off',
    entityType: 'contract_completion_request',
    entityId: requestId,
    metadata: {
      requestNumber: req.request_number,
      contractId: req.contract_id,
      contractNumber: contract?.contract_number ?? null,
      motorcycleId: req.motorcycle_id,
      ownershipTransferred: contract?.ownership_transfers ?? false,
      lockedAt: now,
    },
  });

  // --- 4. tell the rider -------------------------------------------------
  const rider = await riderLabel(admin, req.rider_id);
  await notifyRider(req.rider_id, {
    type: 'completion_completed',
    title: 'Hongera! Mkataba wako umekamilika',
    body: contract?.ownership_transfers
      ? 'Mkurugenzi amesaini kukamilisha mkataba na umiliki wa pikipiki umehamishwa kwako. Cheti chako kipo kwenye mfumo.'
      : 'Mkurugenzi amesaini kukamilisha mkataba wako. Cheti chako kipo kwenye mfumo.',
    deepLink: '/rider/completion',
    dedupeKey: `completion_completed:${requestId}`,
  });
  if (rider.phone) {
    await enqueueSms({
      recipient: rider.phone,
      text: "Ng'umbi Riders: Hongera! Mkataba wako umekamilika na umesainiwa na Mkurugenzi. Cheti chako kipo kwenye mfumo.",
      subject: 'completion_completed',
    });
  }
  await notifyFinance(admin, {
    type: 'completion_completed',
    title: 'Contract completed and signed off',
    body: `${rider.name} — ${req.request_number}. The contract is now locked; changes need an amendment.`,
    deepLink: `/accountant/completions/${requestId}`,
    dedupeKey: `completion_completed_finance:${requestId}`,
  });

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true };
}

/* ======================================================================== *
 * 6. Refusal and return
 * ======================================================================== */

export async function rejectCompletion(
  requestId: string,
  reason: string,
): Promise<ActionResult> {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };

  // Either role may refuse — finance on the money, the Director on the
  // decision — so the softer permission gates it and the audit records who.
  const actor = await checkPermission('completion.review');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransition(req.status, 'rejected')) return { ok: false, error: 'invalid_transition' };

  // Past the Director's approval only the Director may refuse: by then a
  // certificate exists and a transfer may be under way.
  const pastApproval = req.director_decided_at !== null;
  if (pastApproval && actor.role !== 'owner') return { ok: false, error: 'owner_only' };

  const { data: changed } = await admin
    .from('contract_completion_requests')
    .update({
      status: 'rejected',
      rejected_by: actor.userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: trimmed.slice(0, 2000),
    })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await recordEvent(admin, requestId, req.status, 'rejected', actor, trimmed.slice(0, 2000));
  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'completion.rejected',
    entityType: 'contract_completion_request',
    entityId: requestId,
    metadata: { requestNumber: req.request_number, from: req.status, reason: trimmed.slice(0, 200) },
  });

  await notifyRider(req.rider_id, {
    type: 'completion_progress',
    title: 'Ombi la kumaliza mkataba halikukubaliwa',
    body: trimmed.slice(0, 300),
    deepLink: '/rider/completion',
    dedupeKey: `completion_stage:${requestId}:rejected`,
  });

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true };
}

/** Send the request back for correction, without refusing it outright. */
export async function returnCompletion(
  requestId: string,
  reason: string,
): Promise<ActionResult> {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };
  return advance(requestId, 'returned', 'completion.review', {
    note: trimmed.slice(0, 2000),
    riderMessage: {
      title: 'Ombi lako limerudishwa kwa marekebisho',
      body: trimmed.slice(0, 300),
    },
  });
}

/* ======================================================================== *
 * shared stage-advance
 * ======================================================================== */

async function advance(
  requestId: string,
  to: CompletionStatus,
  permission: 'completion.review' | 'completion.transfer' | 'completion.decide',
  opts: { note: string | null; riderMessage?: { title: string; body: string } },
): Promise<ActionResult> {
  const actor = await checkPermission(permission);
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const req = await loadRequest(admin, requestId);
  if (!req) return { ok: false, error: 'not_found' };
  if (!canTransition(req.status, to)) return { ok: false, error: 'invalid_transition' };

  // Conditional on the status READ, so a colleague who moved it first wins.
  const { data: changed, error } = await admin
    .from('contract_completion_requests')
    .update({ status: to })
    .eq('id', requestId)
    .eq('status', req.status)
    .select('id');
  if (error) return { ok: false, error: describeGuardError(error.message) };
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await recordEvent(admin, requestId, req.status, to, actor, opts.note);
  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: `completion.${to}`,
    entityType: 'contract_completion_request',
    entityId: requestId,
    metadata: { requestNumber: req.request_number, from: req.status, to, note: opts.note },
  });

  if (opts.riderMessage) {
    await notifyRider(req.rider_id, {
      type: 'completion_progress',
      title: opts.riderMessage.title,
      body: opts.riderMessage.body,
      deepLink: '/rider/completion',
      dedupeKey: `completion_stage:${requestId}:${to}`,
    });
  }

  revalidateCompletionSurfaces({ riderId: req.rider_id, contractId: req.contract_id });
  return { ok: true };
}

/** Turn a raised PL/pgSQL guard message into an error code the UI explains. */
function describeGuardError(message: string): string {
  if (/not been cleared by finance/.test(message)) return 'not_finance_cleared';
  if (/never approved by the Director/.test(message)) return 'not_approved';
  if (/no final sign-off/.test(message)) return 'no_signoff';
  if (/outstanding/.test(message)) return 'still_outstanding';
  if (/is closed/.test(message)) return 'closed';
  return 'server_error';
}

/** Stage label, so no surface spells one itself. */
export async function completionStatusLabel(status: CompletionStatus): Promise<string> {
  return STATUS_LABELS[status];
}

/* ======================================================================== *
 * 7. Reading the documents back
 * ======================================================================== */

/**
 * A short-lived signed URL for a certificate.
 *
 * The bucket is PRIVATE, so the file is only ever reached through a URL minted
 * here after an authorisation check — never embedded in a page, so it cannot
 * outlive the click that produced it (spec §24).
 *
 * A RIDER may fetch their OWN certificate: it is their document, and the brief
 * says it should be downloadable. The ownership check is made explicitly rather
 * than left to RLS, because this runs on the service role.
 */
export async function certificateUrl(
  certificateId: string,
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('contract_certificates')
    .select('id, certificate_number, storage_path, rider_id, version')
    .eq('id', certificateId)
    .maybeSingle();
  const cert = data as
    | {
        id: string;
        certificate_number: string;
        storage_path: string;
        rider_id: string;
        version: number;
      }
    | null;
  if (!cert) return { ok: false, error: 'not_found' };

  if (profile.role === 'rider') {
    if (profile.riderId !== cert.rider_id) return { ok: false, error: 'forbidden' };
  } else if (profile.role !== 'owner' && profile.role !== 'accountant') {
    return { ok: false, error: 'forbidden' };
  } else if (profile.role === 'accountant' && !profile.isActive) {
    return { ok: false, error: 'forbidden' };
  }

  const { data: signed, error } = await admin.storage
    .from('contract-certificates')
    .createSignedUrl(cert.storage_path, 120);
  if (error || !signed?.signedUrl) return { ok: false, error: 'sign_failed' };
  return {
    ok: true,
    data: {
      url: signed.signedUrl,
      fileName: `${cert.certificate_number}-v${cert.version}.pdf`,
    },
  };
}

/**
 * A short-lived signed URL for an ownership-transfer document.
 *
 * STAFF ONLY, unlike the certificate. A transfer document carries counterparty
 * and registration detail that belongs in the business's records; the rider
 * receives the physical document, and 0034 gives them no read policy on this
 * table at all.
 */
export async function transferDocumentUrl(
  documentId: string,
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const actor = await checkPermission('completion.read');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('ownership_transfer_documents')
    .select('id, storage_path, file_name')
    .eq('id', documentId)
    .maybeSingle();
  const doc = data as { id: string; storage_path: string; file_name: string } | null;
  if (!doc) return { ok: false, error: 'not_found' };

  const { data: signed, error } = await admin.storage
    .from('ownership-transfers')
    .createSignedUrl(doc.storage_path, 120);
  if (error || !signed?.signedUrl) return { ok: false, error: 'sign_failed' };
  return { ok: true, data: { url: signed.signedUrl, fileName: doc.file_name } };
}
