'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { createNotification, notifyOwner } from '@/lib/notifications/service';
import { sniffFileType } from '@/lib/applications/file-signature';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { localDateString } from '@/lib/dates/tz';
import { requisitionSchema, type RequisitionInput } from './validation';
import {
  requisitionTotal,
  canTransition,
  canSetPaymentStatus,
  canChangePaymentStatus,
} from './compute';
import { nextRequisitionNumber } from './numbering';
import { enqueueSms } from '@/lib/messaging/outbox';
import { onRequisitionDecidedForPhoneLoan } from '@/lib/loans/requests';
import {
  PAYMENT_STATUS_LABELS,
  REQUISITION_PAYMENT_STATUSES,
  type RequisitionPaymentStatus,
  type RequisitionStatus,
  MAX_REQUISITION_DOCUMENTS,
  MAX_REQUISITION_DOC_BYTES,
  REQUISITION_DOC_TYPES,
  PRE_DECISION_DOC_TYPES,
  RETIREMENT_STATUS_LABELS,
  type RequisitionDocType,
  type RequisitionRetirementStatus,
  REQUISITION_CURRENCY,
  yearOf,
} from './constants';

/*
 * Purchase requisitions (client feedback 2026-09-05): the accountant asks the
 * Managing Director for approval to buy motorcycles, spare parts, fuel and the
 * rest; the Director confirms or rejects.
 *
 * Every rule that matters is enforced HERE and in the DB (0028), never in the
 * form:
 *
 *   • the total is recomputed from the lines on every write — a client-supplied
 *     amount is ignored entirely (spec rule 3);
 *   • only the OWNER may approve or reject, and `requisitions.decide` is a
 *     permission no accountant holds, so they cannot approve their own request;
 *   • a decided request is frozen — the 0028 triggers refuse the write even if
 *     this file were bypassed (spec rule 6);
 *   • an accountant may only touch their OWN draft; the Director may touch any.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type RequisitionRow = {
  id: string;
  requisition_number: string;
  status: string;
  requested_by: string;
  approver_id: string | null;
  title: string;
};

function revalidateRequisitionSurfaces(id?: string) {
  revalidatePath('/accountant/requisitions');
  revalidatePath('/owner/requisitions');
  revalidatePath('/accountant');
  revalidatePath('/owner');
  if (id) {
    revalidatePath(`/accountant/requisitions/${id}`);
    revalidatePath(`/owner/requisitions/${id}`);
  }
}

/** Load a requisition and check the actor is allowed to work on it. */
async function loadForActor(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  actor: { userId: string; role: string },
): Promise<{ ok: true; row: RequisitionRow } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('purchase_requisitions')
    .select('id, requisition_number, status, requested_by, approver_id, title')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, error: 'server_error' };
  const row = data as RequisitionRow | null;
  if (!row) return { ok: false, error: 'not_found' };
  // The Director oversees everything; an accountant works only on what they
  // raised, so one accountant cannot edit or withdraw another's request.
  if (actor.role !== 'owner' && row.requested_by !== actor.userId) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, row };
}

/** The chosen approver must really be an owner account. */
async function resolveApprover(
  admin: ReturnType<typeof createAdminClient>,
  approverId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', approverId)
    .maybeSingle();
  const p = data as { id: string; role: string } | null;
  return p && p.role === 'owner' ? p.id : null;
}

/** Replace a draft's line items with `items`, in the order given. */
async function writeItems(
  admin: ReturnType<typeof createAdminClient>,
  requisitionId: string,
  items: RequisitionInput['items'],
): Promise<boolean> {
  const { error: delErr } = await admin
    .from('requisition_items')
    .delete()
    .eq('requisition_id', requisitionId);
  if (delErr) return false;
  const { error } = await admin.from('requisition_items').insert(
    items.map((item, index) => ({
      requisition_id: requisitionId,
      position: index,
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unitPrice,
      budget_cover: item.budgetCover,
    })),
  );
  return !error;
}

/**
 * Create a new requisition as a DRAFT, or save changes to an existing one.
 * "Save as draft" and "Submit request" are the same save — submission is a
 * separate, explicit transition afterwards, so a failed submit never loses
 * what was typed.
 */
export async function saveRequisition(
  input: RequisitionInput,
  requisitionId?: string,
): Promise<ActionResult<{ id: string; requisitionNumber: string; total: number }>> {
  const actor = await checkPermission('requisitions.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  // Re-validate server-side: the form's copy of this schema proves nothing.
  const parsed = requisitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const value = parsed.data;

  if (value.requestDate > localDateString()) return { ok: false, error: 'future_date' };

  const admin = createAdminClient();
  const approverId = await resolveApprover(admin, value.approverId);
  if (!approverId) return { ok: false, error: 'invalid_approver' };

  const fields = {
    title: value.title,
    description: value.description?.trim() || null,
    department: value.department,
    fiscal_year: yearOf(value.requestDate),
    request_date: value.requestDate,
    currency: REQUISITION_CURRENCY,
    payment_information: value.paymentInformation?.trim() || null,
    approver_id: approverId,
  };

  if (requisitionId) {
    const found = await loadForActor(admin, requisitionId, actor);
    if (!found.ok) return found;
    if (found.row.status !== 'draft') return { ok: false, error: 'not_draft' };

    const { data: changed, error } = await admin
      .from('purchase_requisitions')
      .update(fields)
      .eq('id', requisitionId)
      // Conditional on the status we read: a submit that landed in between
      // must win rather than be overwritten by a stale edit.
      .eq('status', 'draft')
      .select('id, requisition_number');
    if (error) return { ok: false, error: 'server_error' };
    if (!changed || changed.length === 0) return { ok: false, error: 'not_draft' };

    if (!(await writeItems(admin, requisitionId, value.items))) {
      return { ok: false, error: 'items_failed' };
    }

    await writeAudit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'requisition.updated',
      entityType: 'purchase_requisition',
      entityId: requisitionId,
      metadata: { total: requisitionTotal(value.items.map(toLine)), items: value.items.length },
    });
    revalidateRequisitionSurfaces(requisitionId);
    return {
      ok: true,
      data: {
        id: requisitionId,
        requisitionNumber: (changed[0] as { requisition_number: string }).requisition_number,
        total: requisitionTotal(value.items.map(toLine)),
      },
    };
  }

  // New request. The number is allocated from the highest issued that month;
  // a genuinely concurrent creation loses the unique constraint and retries.
  let created: { id: string; requisition_number: string } | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const requisitionNumber = await nextRequisitionNumber(admin, value.requestDate);
    const { data, error } = await admin
      .from('purchase_requisitions')
      .insert({
        ...fields,
        requisition_number: requisitionNumber,
        status: 'draft',
        requested_by: actor.userId,
      })
      .select('id, requisition_number')
      .single();
    if (data) {
      created = data as { id: string; requisition_number: string };
      break;
    }
    lastError = error?.code ?? '';
    if (lastError !== '23505') break; // not a number collision — give up
  }
  if (!created) return { ok: false, error: 'server_error' };

  if (!(await writeItems(admin, created.id, value.items))) {
    // A requisition with no lines is meaningless; remove the shell so the
    // accountant does not find an empty draft they cannot explain.
    await admin.from('purchase_requisitions').delete().eq('id', created.id);
    return { ok: false, error: 'items_failed' };
  }

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.created',
    entityType: 'purchase_requisition',
    entityId: created.id,
    metadata: {
      requisitionNumber: created.requisition_number,
      total: requisitionTotal(value.items.map(toLine)),
      items: value.items.length,
    },
  });
  revalidateRequisitionSurfaces(created.id);
  return {
    ok: true,
    data: {
      id: created.id,
      requisitionNumber: created.requisition_number,
      total: requisitionTotal(value.items.map(toLine)),
    },
  };
}

/** Send the request up to the Managing Director. */
export async function submitRequisition(requisitionId: string): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const found = await loadForActor(admin, requisitionId, actor);
  if (!found.ok) return found;
  if (!canTransition(found.row.status as 'draft', 'submitted')) {
    return { ok: false, error: 'not_draft' };
  }

  // Refuse to submit an empty request rather than putting a 0 TZS approval in
  // front of the Director.
  const total = await totalOf(admin, requisitionId);
  if (total.items === 0) return { ok: false, error: 'no_items' };

  const { data: changed, error } = await admin
    .from('purchase_requisitions')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', requisitionId)
    .eq('status', 'draft')
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'not_draft' };

  await notifyOwner({
    type: 'requisition_submitted',
    title: 'Purchase request awaiting your approval',
    body: `${actor.fullName ?? 'An accountant'} raised ${found.row.requisition_number} — ${found.row.title} — for ${formatTZS(total.amount)}.`,
    deepLink: `/owner/requisitions/${requisitionId}`,
    dedupeKey: `requisition_submitted:${requisitionId}`,
  });

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.submitted',
    entityType: 'purchase_requisition',
    entityId: requisitionId,
    metadata: { requisitionNumber: found.row.requisition_number, total: total.amount },
  });
  revalidateRequisitionSurfaces(requisitionId);
  return { ok: true };
}

/**
 * Approve. OWNER ONLY — this is the Managing Director's decision, and
 * `requisitions.decide` is deliberately absent from the accountant's
 * permissions so they can never approve what they asked for.
 */
export async function approveRequisition(
  requisitionId: string,
  note?: string,
): Promise<ActionResult<{ total: number }>> {
  const actor = await checkPermission('requisitions.decide');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  return decide(requisitionId, 'approved', actor, note?.trim() || null);
}

/** Reject, with a reason the accountant will read. */
export async function rejectRequisition(
  requisitionId: string,
  reason: string,
): Promise<ActionResult<{ total: number }>> {
  const actor = await checkPermission('requisitions.decide');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };
  return decide(requisitionId, 'rejected', actor, trimmed.slice(0, 1000));
}

async function decide(
  requisitionId: string,
  to: 'approved' | 'rejected',
  actor: { userId: string; role: string; fullName: string | null },
  note: string | null,
): Promise<ActionResult<{ total: number }>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('purchase_requisitions')
    .select('id, requisition_number, status, requested_by, title')
    .eq('id', requisitionId)
    .maybeSingle();
  const row = data as RequisitionRow | null;
  if (!row) return { ok: false, error: 'not_found' };
  if (!canTransition(row.status as 'submitted', to)) return { ok: false, error: 'not_pending' };

  const total = await totalOf(admin, requisitionId);

  // Conditional on 'submitted': a second decision racing this one finds the
  // request already decided and stops, so it can never be decided twice.
  const { data: changed, error } = await admin
    .from('purchase_requisitions')
    .update({
      status: to,
      decided_by: actor.userId,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq('id', requisitionId)
    .eq('status', 'submitted')
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'not_pending' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: to === 'approved' ? 'requisition.approved' : 'requisition.rejected',
    entityType: 'purchase_requisition',
    entityId: requisitionId,
    metadata: { requisitionNumber: row.requisition_number, total: total.amount, note },
  });

  await createNotification({
    profileId: row.requested_by,
    type: 'requisition_decided',
    title: to === 'approved' ? 'Purchase request approved' : 'Purchase request rejected',
    body:
      to === 'approved'
        ? `${row.requisition_number} — ${row.title} — ${formatTZS(total.amount)} was approved by the Managing Director on ${formatDate(new Date())}.`
        : `${row.requisition_number} — ${row.title} — was rejected: ${note ?? ''}`,
    deepLink: `/accountant/requisitions/${requisitionId}`,
    dedupeKey: `requisition_decided:${requisitionId}`,
  });

  // A phone-purchase requisition carries a rider's loan request behind it
  // (0031/0033). The Director deciding the purchase IS the decision on the
  // loan, so the request advances here rather than waiting for the accountant
  // to notice. Best-effort: the decision above is the record that matters and
  // must never be undone because this follow-on failed — a request left at
  // 'requisition_raised' is still visible in the queue and advanceable by hand.
  try {
    await onRequisitionDecidedForPhoneLoan(requisitionId, to, note);
  } catch {
    /* the requisition decision stands */
  }

  revalidateRequisitionSurfaces(requisitionId);
  return { ok: true, data: { total: total.amount } };
}

/** Withdraw a request raised in error (its author, or the Director). */
export async function cancelRequisition(requisitionId: string): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const found = await loadForActor(admin, requisitionId, actor);
  if (!found.ok) return found;
  if (!canTransition(found.row.status as 'draft', 'cancelled')) {
    return { ok: false, error: 'not_open' };
  }

  const { data: changed } = await admin
    .from('purchase_requisitions')
    .update({
      status: 'cancelled',
      decided_by: actor.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', requisitionId)
    .in('status', ['draft', 'submitted'])
    .select('id');
  if (!changed || changed.length === 0) return { ok: false, error: 'not_open' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.cancelled',
    entityType: 'purchase_requisition',
    entityId: requisitionId,
    metadata: { requisitionNumber: found.row.requisition_number },
  });
  revalidateRequisitionSurfaces(requisitionId);
  return { ok: true };
}

/**
 * Delete a draft outright. Only a draft: once submitted the request is part of
 * the approval record and is withdrawn, not erased (0028 enforces this with a
 * trigger regardless of what this file does).
 */
export async function deleteDraftRequisition(requisitionId: string): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const found = await loadForActor(admin, requisitionId, actor);
  if (!found.ok) return found;
  if (found.row.status !== 'draft') return { ok: false, error: 'not_draft' };

  // Storage objects are not cascaded by the FK, so clear them first or the
  // bucket accumulates files nothing references.
  const { data: docs } = await admin
    .from('requisition_documents')
    .select('storage_path')
    .eq('requisition_id', requisitionId);
  const paths = ((docs ?? []) as { storage_path: string }[]).map((d) => d.storage_path);
  if (paths.length > 0) await admin.storage.from('requisition-documents').remove(paths);

  const { error } = await admin
    .from('purchase_requisitions')
    .delete()
    .eq('id', requisitionId)
    .eq('status', 'draft');
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.draft_deleted',
    entityType: 'purchase_requisition',
    entityId: requisitionId,
    metadata: { requisitionNumber: found.row.requisition_number },
  });
  revalidateRequisitionSurfaces();
  return { ok: true };
}

// =========================================================================
// Supporting documents
// =========================================================================

/**
 * Attach one quotation/proforma/photo. One file per request, like the /apply
 * uploader (D-030): Vercel caps request bodies at ~4.5 MB, so batching ten
 * files into one submit would fail with an opaque 413.
 */
export async function uploadRequisitionDocument(
  formData: FormData,
): Promise<ActionResult<{ id: string; fileName: string }>> {
  const actor = await checkPermission('requisitions.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const requisitionId = formData.get('requisitionId');
  const file = formData.get('file');
  // Absent means 'supporting', which is what every existing caller uploads.
  const rawDocType = formData.get('docType');
  const docType: RequisitionDocType =
    typeof rawDocType === 'string' && (REQUISITION_DOC_TYPES as readonly string[]).includes(rawDocType)
      ? (rawDocType as RequisitionDocType)
      : 'supporting';
  if (typeof requisitionId !== 'string' || !requisitionId) return { ok: false, error: 'bad_request' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_REQUISITION_DOC_BYTES) return { ok: false, error: 'too_large' };

  const admin = createAdminClient();
  const found = await loadForActor(admin, requisitionId, actor);
  if (!found.ok) return found;

  /*
   * WHEN each kind of document may be attached (0033's child-row trigger
   * enforces the same rule, so this is the readable half of a control that
   * exists in both places):
   *
   *   supporting / invoice          draft only. These are what the Director's
   *                                 decision was made on, so they must be
   *                                 exactly what was seen.
   *   proof_of_payment / receipt /  approved only. A receipt exists by
   *   retirement                    definition after the money left.
   */
  if (PRE_DECISION_DOC_TYPES.includes(docType)) {
    if (found.row.status !== 'draft') return { ok: false, error: 'not_draft' };
  } else {
    if (found.row.status !== 'approved') return { ok: false, error: 'not_approved' };
  }

  // The ten-document cap counts PER KIND, so a long list of retirement receipts
  // cannot crowd out the quotations the request was approved on.
  const { count } = await admin
    .from('requisition_documents')
    .select('id', { count: 'exact', head: true })
    .eq('requisition_id', requisitionId)
    .eq('doc_type', docType);
  if ((count ?? 0) >= MAX_REQUISITION_DOCUMENTS) return { ok: false, error: 'too_many' };

  const buffer = Buffer.from(await file.arrayBuffer());
  // The bytes decide, not the filename or the browser-supplied Content-Type.
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
  const path = `${requisitionId}/${Date.now()}-${hash.slice(0, 8)}.${ext}`;
  const { error: upErr } = await admin.storage
    .from('requisition-documents')
    .upload(path, buffer, { contentType: mime });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { data: row, error } = await admin
    .from('requisition_documents')
    .insert({
      requisition_id: requisitionId,
      file_name: file.name.slice(0, 255),
      storage_path: path,
      mime_type: mime,
      size_bytes: file.size,
      sha256_hash: hash,
      doc_type: docType,
      uploaded_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !row) {
    // Never leave an orphan in the bucket when its row failed to write.
    await admin.storage.from('requisition-documents').remove([path]);
    return { ok: false, error: 'insert_failed' };
  }

  revalidateRequisitionSurfaces(requisitionId);
  return { ok: true, data: { id: (row as { id: string }).id, fileName: file.name } };
}

/** Remove an attachment from a draft. */
export async function removeRequisitionDocument(documentId: string): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('requisition_documents')
    .select('id, requisition_id, storage_path')
    .eq('id', documentId)
    .maybeSingle();
  const doc = data as { id: string; requisition_id: string; storage_path: string } | null;
  if (!doc) return { ok: false, error: 'not_found' };

  const found = await loadForActor(admin, doc.requisition_id, actor);
  if (!found.ok) return found;
  if (found.row.status !== 'draft') return { ok: false, error: 'not_draft' };

  const { error } = await admin.from('requisition_documents').delete().eq('id', documentId);
  if (error) return { ok: false, error: 'server_error' };
  await admin.storage.from('requisition-documents').remove([doc.storage_path]);

  revalidateRequisitionSurfaces(doc.requisition_id);
  return { ok: true };
}

/** Short-lived signed URL for one attachment (identity of the bucket is private). */
export async function requisitionDocumentUrl(documentId: string): Promise<ActionResult<{ url: string }>> {
  const actor = await checkPermission('requisitions.read');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('requisition_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle();
  const doc = data as { storage_path: string } | null;
  if (!doc) return { ok: false, error: 'not_found' };

  const { data: signed, error } = await admin.storage
    .from('requisition-documents')
    .createSignedUrl(doc.storage_path, 120);
  if (error || !signed) return { ok: false, error: 'sign_failed' };
  return { ok: true, data: { url: signed.signedUrl } };
}

// ---- helpers -------------------------------------------------------------

function toLine(item: { quantity: number; unitPrice: number }) {
  return { quantity: item.quantity, unitPrice: item.unitPrice };
}

/** Recompute a requisition's total from its lines — never read from a column. */
async function totalOf(
  admin: ReturnType<typeof createAdminClient>,
  requisitionId: string,
): Promise<{ amount: number; items: number }> {
  const { data } = await admin
    .from('requisition_items')
    .select('quantity, unit_price')
    .eq('requisition_id', requisitionId);
  const rows = (data ?? []) as { quantity: number; unit_price: number }[];
  return {
    amount: requisitionTotal(rows.map((r) => ({ quantity: r.quantity, unitPrice: r.unit_price }))),
    items: rows.length,
  };
}

/* ------------------------------------------------------------------------ *
 * Payment progress after approval (client feedback 2026-09-06)
 * ------------------------------------------------------------------------ */

/**
 * Record whether money for an APPROVED purchase has been released.
 *
 * OWNER ONLY. `requisitions.pay` is deliberately absent from the accountant's
 * permissions: they raised the request and they can see how it is progressing,
 * but declaring that the business has paid a supplier is the Director's
 * statement, not theirs. Approving a purchase and paying for it are separate
 * acts, which is why this is a separate permission from `requisitions.decide`.
 *
 * The accountant is told either way — in the app, and by SMS when Mobishastra
 * credentials are live. That is the whole point of the feature: the accountant
 * asked in person because nothing ever told them.
 *
 * This creates NO payment, obligation, allocation or receipt. It is an
 * operational marker on a purchase order, and no report may treat it as
 * collections.
 */
export async function setRequisitionPaymentStatus(
  requisitionId: string,
  to: RequisitionPaymentStatus,
  note?: string,
): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.pay');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  if (!REQUISITION_PAYMENT_STATUSES.includes(to)) return { ok: false, error: 'invalid_status' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('purchase_requisitions')
    .select('id, requisition_number, status, payment_status, requested_by, title')
    .eq('id', requisitionId)
    .maybeSingle();
  const row = data as (RequisitionRow & { payment_status: RequisitionPaymentStatus }) | null;
  if (!row) return { ok: false, error: 'not_found' };

  // Only an approved purchase can be paid for. The DB refuses this too (0029);
  // checking here turns a raised exception into a message the owner can read.
  if (!canSetPaymentStatus(row.status as RequisitionStatus)) {
    return { ok: false, error: 'not_approved' };
  }
  const from = row.payment_status ?? 'unpaid';
  if (from === to) return { ok: true };
  if (!canChangePaymentStatus(from, to)) return { ok: false, error: 'invalid_transition' };

  const total = await totalOf(admin, requisitionId);

  // Conditional on the stage we read, so two owners clicking at once cannot
  // both apply their change — the second finds it moved and stops.
  const { data: changed, error } = await admin
    .from('purchase_requisitions')
    .update({
      payment_status: to,
      payment_marked_by: actor.userId,
      payment_marked_at: new Date().toISOString(),
      payment_note: note?.trim() || null,
    })
    .eq('id', requisitionId)
    .eq('payment_status', from)
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.payment_status_changed',
    entityType: 'purchase_requisition',
    entityId: requisitionId,
    metadata: {
      requisitionNumber: row.requisition_number,
      from,
      to,
      total: total.amount,
      note: note?.trim() || null,
    },
  });

  /*
   * Paying an approved purchase is what puts it on the accountant's retirement
   * worklist. Done here rather than left to a human step: the whole point of
   * retirement is that released money gets accounted for, and a queue nobody
   * is placed into is a queue nobody works. Conditional and best-effort — the
   * payment stage above is the record that matters.
   */
  if (to === 'paid') {
    await admin
      .from('purchase_requisitions')
      .update({ retirement_status: 'pending' })
      .eq('id', requisitionId)
      .eq('retirement_status', 'not_started');
  }

  // --- tell the accountant who asked -------------------------------------
  const headline =
    to === 'paid'
      ? 'Purchase request paid'
      : to === 'processing'
        ? 'Purchase request payment started'
        : 'Purchase request marked not paid';
  const body =
    `${row.requisition_number} — ${row.title} — ${formatTZS(total.amount)}: ` +
    `${PAYMENT_STATUS_LABELS[to].toLowerCase()} as of ${formatDate(new Date())}.`;

  await createNotification({
    profileId: row.requested_by,
    type: 'requisition_payment',
    title: headline,
    body,
    deepLink: `/accountant/requisitions/${requisitionId}`,
    // Keyed on the STAGE, not just the request: moving to processing and later
    // to paid are two things the accountant needs to hear, but clicking the
    // same button twice is one.
    dedupeKey: `requisition_payment:${requisitionId}:${to}`,
  });

  // SMS is supplementary and never load-bearing: the outbox no-ops safely
  // until the Mobishastra credentials are live, and a failure here must not
  // undo a stage the owner has already recorded.
  try {
    const { data: requester } = await admin
      .from('profiles')
      .select('phone')
      .eq('id', row.requested_by)
      .maybeSingle();
    const phone = (requester as { phone: string | null } | null)?.phone;
    if (phone) await enqueueSms({ recipient: phone, text: `${headline}. ${body}`, subject: headline });
  } catch {
    /* notification already delivered in-app */
  }

  revalidateRequisitionSurfaces(requisitionId);
  return { ok: true };
}

// =========================================================================
// Retirement (client feedback 2026-09-11 #14)
// =========================================================================

/**
 * Retire an approved, paid requisition: account for what was ACTUALLY spent.
 *
 * This is the accountant's step, and the one that finally closes the loop
 * between an authorisation and a real cost. Three things make it safe:
 *
 *   1. It requires `requisitions.retire`, which the accountant holds and which
 *      is NOT `requisitions.pay` — declaring money paid stays the Director's.
 *   2. The DB refuses to retire anything that is not approved AND paid (0033),
 *      so a request cannot be accounted for before the money left.
 *   3. `retired_amount` is stored SEPARATELY from the approved total and never
 *      overwrites it. A purchase that came in under or over budget shows the
 *      variance; the Director's authorisation is left exactly as they signed it
 *      (spec rule 6).
 *
 * Optionally files the spend as a department expense in the same step, which is
 * where an approved purchase becomes a real operating cost in the reports.
 */
export async function retireRequisition(
  requisitionId: string,
  input: {
    /** Actual spend in integer TZS. Defaults to the approved total. */
    actualAmount?: number;
    note?: string;
    /** File the spend against this department at the same time. */
    departmentId?: string;
  } = {},
): Promise<ActionResult<{ expenseId: string | null }>> {
  const actor = await checkPermission('requisitions.retire');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('purchase_requisitions')
    .select(
      'id, requisition_number, title, status, payment_status, retirement_status, requested_by, ' +
        'department_id, request_date',
    )
    .eq('id', requisitionId)
    .maybeSingle();
  const row = data as
    | {
        id: string;
        requisition_number: string;
        title: string;
        status: string;
        payment_status: string;
        retirement_status: string;
        requested_by: string;
        department_id: string | null;
        request_date: string;
      }
    | null;
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'approved') return { ok: false, error: 'not_approved' };
  if (row.payment_status !== 'paid') return { ok: false, error: 'not_paid' };
  if (row.retirement_status === 'completed') return { ok: false, error: 'already_retired' };

  const approved = await totalOf(admin, requisitionId);
  const actual =
    input.actualAmount === undefined || input.actualAmount === null
      ? approved.amount
      : Math.trunc(Number(input.actualAmount));
  if (!Number.isFinite(actual) || actual < 0) return { ok: false, error: 'invalid_amount' };

  // Conditional on the stage we read: a colleague retiring the same request
  // between the read and this write wins rather than being overwritten.
  const { data: changed, error } = await admin
    .from('purchase_requisitions')
    .update({
      retirement_status: 'completed',
      retired_by: actor.userId,
      retired_at: new Date().toISOString(),
      retired_amount: actual,
      retirement_note: input.note?.trim() || null,
    })
    .eq('id', requisitionId)
    .neq('retirement_status', 'completed')
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'already_retired' };

  // Optionally record the cost. Done AFTER the retirement flag so a failure
  // here leaves a retired request with no expense — visible and fixable —
  // rather than an expense with no retirement, which would double-count once
  // somebody retired it properly.
  let expenseId: string | null = null;
  const departmentId = input.departmentId?.trim() || row.department_id;
  if (departmentId && actual > 0) {
    const { data: exp } = await admin
      .from('department_expenses')
      .insert({
        department_id: departmentId,
        expense_date: localDateString(),
        category: 'other',
        amount: actual,
        description: `${row.requisition_number} — ${row.title}`.slice(0, 300),
        reference: row.requisition_number,
        requisition_id: requisitionId,
        created_by: actor.userId,
      })
      .select('id')
      .maybeSingle();
    expenseId = (exp as { id: string } | null)?.id ?? null;
  }

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.retired',
    entityType: 'purchase_requisition',
    entityId: requisitionId,
    metadata: {
      requisitionNumber: row.requisition_number,
      approved: approved.amount,
      actual,
      variance: actual - approved.amount,
      departmentId,
      expenseId,
      note: input.note?.trim() || null,
    },
  });

  await notifyOwner({
    type: 'requisition_retired',
    title: 'Purchase request retired',
    body:
      `${row.requisition_number} — ${row.title}: approved ${formatTZS(approved.amount)}, ` +
      `actually spent ${formatTZS(actual)}` +
      (actual === approved.amount
        ? '.'
        : ` (${actual > approved.amount ? 'over' : 'under'} by ${formatTZS(Math.abs(actual - approved.amount))}).`),
    deepLink: `/owner/requisitions/${requisitionId}`,
    dedupeKey: `requisition_retired:${requisitionId}`,
  });

  revalidateRequisitionSurfaces(requisitionId);
  revalidatePath('/owner/departments');
  revalidatePath('/accountant/departments');
  return { ok: true, data: { expenseId } };
}

/**
 * Move a paid requisition into 'retirement pending', so it appears on the
 * accountant's worklist. Called by the owner when they mark it paid, and
 * available by hand for the requests paid before this feature existed.
 */
export async function markRetirementPending(requisitionId: string): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.retire');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: changed, error } = await admin
    .from('purchase_requisitions')
    .update({ retirement_status: 'pending' })
    .eq('id', requisitionId)
    .eq('status', 'approved')
    .eq('payment_status', 'paid')
    .eq('retirement_status', 'not_started')
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_transition' };

  revalidateRequisitionSurfaces(requisitionId);
  return { ok: true };
}

/** Label for a retirement stage — exported so the UI never spells one itself. */
export async function retirementLabel(
  status: RequisitionRetirementStatus,
): Promise<string> {
  return RETIREMENT_STATUS_LABELS[status];
}
