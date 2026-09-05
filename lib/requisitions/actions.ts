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
import { requisitionTotal, canTransition } from './compute';
import { nextRequisitionNumber } from './numbering';
import {
  MAX_REQUISITION_DOCUMENTS,
  MAX_REQUISITION_DOC_BYTES,
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
  if (typeof requisitionId !== 'string' || !requisitionId) return { ok: false, error: 'bad_request' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_REQUISITION_DOC_BYTES) return { ok: false, error: 'too_large' };

  const admin = createAdminClient();
  const found = await loadForActor(admin, requisitionId, actor);
  if (!found.ok) return found;
  if (found.row.status !== 'draft') return { ok: false, error: 'not_draft' };

  const { count } = await admin
    .from('requisition_documents')
    .select('id', { count: 'exact', head: true })
    .eq('requisition_id', requisitionId);
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
