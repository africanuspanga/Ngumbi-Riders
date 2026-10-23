'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { createNotification, notifyOwner } from '@/lib/notifications/service';
import { enqueueSms } from '@/lib/messaging/outbox';
import { sniffFileType } from '@/lib/applications/file-signature';
import { formatTZS } from '@/lib/money/format';
import { localDateString } from '@/lib/dates/tz';
import { requisitionTotal } from './compute';
import { MAX_REQUISITION_DOC_BYTES } from './constants';
import { validateRetirementEntry } from './retirement';

/*
 * The retirement flow (client request 2026-10-23, migration 0036):
 *
 *   1. finance SUBMITS an entry against an approved, paid request — what was
 *      spent, any cash returned, and the receipts (one upload per file, the
 *      Vercel body cap, D-030);
 *   2. the Managing Director VERIFIES it — approve or reject with a reason;
 *   3. once verified spent + returned covers what was paid out, the request is
 *      fully retired.
 *
 * `requisitions.retire` submits (the accountant holds it); only the owner
 * decides, so nobody verifies the advance they are accounting for. The DB
 * guard (0036) refuses entries on unpaid or already-retired requests and
 * freezes decided ones, so these checks are the readable half of a control
 * that exists in both places.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function revalidateRetirementSurfaces(requisitionId: string) {
  for (const p of [
    '/owner/retirements',
    '/accountant/retirements',
    '/owner/requisitions',
    '/accountant/requisitions',
    `/owner/requisitions/${requisitionId}`,
    `/accountant/requisitions/${requisitionId}`,
    '/owner',
    '/accountant',
  ]) {
    revalidatePath(p);
  }
}

async function loadRetirable(admin: Admin, requisitionId: string) {
  const { data } = await admin
    .from('purchase_requisitions')
    .select(
      'id, requisition_number, title, status, payment_status, retirement_status, requested_by, department_id, ' +
        'requisition_items(quantity, unit_price)',
    )
    .eq('id', requisitionId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    requisition_number: string;
    title: string;
    status: string;
    payment_status: string;
    retirement_status: string;
    requested_by: string;
    department_id: string | null;
    requisition_items: { quantity: number; unit_price: number }[];
  } | null;
  if (!row) return null;
  const paid = requisitionTotal(
    (row.requisition_items ?? []).map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price })),
  );
  return { ...row, paid };
}

/** Verified + awaiting-verification amounts already accounted for. */
async function accountedSoFar(admin: Admin, requisitionId: string) {
  const { data, error } = await admin
    .from('requisition_retirements')
    .select('spent_amount, returned_amount, status')
    .eq('requisition_id', requisitionId)
    .neq('status', 'rejected');
  if (error) throw new Error(`retirement totals failed: ${error.message}`);
  const rows = (data ?? []) as { spent_amount: number; returned_amount: number; status: string }[];
  const sum = (status: string) =>
    rows.filter((r) => r.status === status).reduce((s, r) => s + r.spent_amount + r.returned_amount, 0);
  return {
    approved: sum('approved'),
    pending: sum('submitted'),
    approvedSpent: rows.filter((r) => r.status === 'approved').reduce((s, r) => s + r.spent_amount, 0),
  };
}

export async function submitRetirementEntry(input: {
  requisitionId: string;
  spentAmount: number;
  returnedAmount: number;
  spentOn: string;
  description: string;
  departmentId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const actor = await checkPermission('requisitions.retire');
  if (!actor) return { ok: false, error: 'forbidden' };

  const description = input.description?.trim() ?? '';
  if (description.length < 3) return { ok: false, error: 'description_required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.spentOn ?? '')) return { ok: false, error: 'invalid_date' };
  if (input.spentOn > localDateString()) return { ok: false, error: 'future_date' };

  const admin = createAdminClient();
  const req = await loadRetirable(admin, input.requisitionId);
  if (!req) return { ok: false, error: 'not_found' };
  if (req.status !== 'approved') return { ok: false, error: 'not_approved' };
  if (req.payment_status !== 'paid') return { ok: false, error: 'not_paid' };
  if (req.retirement_status === 'completed') return { ok: false, error: 'already_retired' };

  const so = await accountedSoFar(admin, req.id);
  const check = validateRetirementEntry({
    spentAmount: Number(input.spentAmount),
    returnedAmount: Number(input.returnedAmount ?? 0),
    paidAmount: req.paid,
    alreadyAccounted: so.approved + so.pending,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const spent = Math.trunc(Number(input.spentAmount));
  const returned = Math.trunc(Number(input.returnedAmount ?? 0));
  const { data: row, error } = await admin
    .from('requisition_retirements')
    .insert({
      requisition_id: req.id,
      spent_amount: spent,
      returned_amount: returned,
      spent_on: input.spentOn,
      description: description.slice(0, 2000),
      department_id: input.departmentId?.trim() || req.department_id,
      submitted_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !row) return { ok: false, error: 'server_error' };
  const id = (row as { id: string }).id;

  // The request is now on the retirement worklist, if it was not already.
  await admin
    .from('purchase_requisitions')
    .update({ retirement_status: 'pending' })
    .eq('id', req.id)
    .eq('retirement_status', 'not_started');

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.retirement_submitted',
    entityType: 'purchase_requisition',
    entityId: req.id,
    metadata: { retirementId: id, spent, returned, paid: req.paid },
  });

  await notifyOwner({
    type: 'retirement_submitted',
    title: 'Retirement awaiting your verification',
    body:
      `${actor.fullName ?? 'Finance'} retired ${formatTZS(spent + returned)} of ${req.requisition_number} — ` +
      `${req.title} (spent ${formatTZS(spent)}${returned > 0 ? `, returned ${formatTZS(returned)}` : ''}).`,
    deepLink: `/owner/requisitions/${req.id}`,
    dedupeKey: `retirement_submitted:${id}`,
    sms:
      `Ng'umbi Riders: Retirement ya ${req.requisition_number} (${formatTZS(spent + returned)}) ` +
      `imewasilishwa na ${actor.fullName ?? 'mhasibu'}. Tafadhali ithibitishe mfumoni.`,
  });

  revalidateRetirementSurfaces(req.id);
  return { ok: true, data: { id } };
}

/** Attach one receipt to a submitted entry (one file per request, D-030). */
export async function uploadRetirementReceipt(
  formData: FormData,
): Promise<ActionResult<{ id: string; fileName: string }>> {
  const actor = await checkPermission('requisitions.retire');
  if (!actor) return { ok: false, error: 'forbidden' };

  const retirementId = formData.get('retirementId');
  const file = formData.get('file');
  if (typeof retirementId !== 'string' || !retirementId) return { ok: false, error: 'bad_request' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_REQUISITION_DOC_BYTES) return { ok: false, error: 'too_large' };

  const admin = createAdminClient();
  const { data: entry } = await admin
    .from('requisition_retirements')
    .select('id, requisition_id, status, submitted_by')
    .eq('id', retirementId)
    .maybeSingle();
  const e = entry as { id: string; requisition_id: string; status: string; submitted_by: string } | null;
  if (!e) return { ok: false, error: 'not_found' };
  if (e.status !== 'submitted') return { ok: false, error: 'already_decided' };
  if (actor.role !== 'owner' && e.submitted_by !== actor.userId) return { ok: false, error: 'forbidden' };

  const buffer = Buffer.from(await file.arrayBuffer());
  // The bytes decide, not the filename or the browser's Content-Type.
  const sniffed = sniffFileType(buffer);
  if (!sniffed) return { ok: false, error: 'invalid_type' };
  const mime =
    sniffed === 'pdf' ? 'application/pdf' : sniffed === 'jpeg' ? 'image/jpeg' : sniffed === 'png' ? 'image/png' : 'image/webp';
  const ext = sniffed === 'jpeg' ? 'jpg' : sniffed;
  const hash = createHash('sha256').update(buffer).digest('hex');
  const path = `${e.requisition_id}/retirement-${e.id}/${Date.now()}-${hash.slice(0, 8)}.${ext}`;

  const { error: upErr } = await admin.storage
    .from('requisition-documents')
    .upload(path, buffer, { contentType: mime });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { data: row, error } = await admin
    .from('requisition_documents')
    .insert({
      requisition_id: e.requisition_id,
      retirement_id: e.id,
      file_name: file.name.slice(0, 255),
      storage_path: path,
      mime_type: mime,
      size_bytes: file.size,
      sha256_hash: hash,
      doc_type: 'receipt',
      uploaded_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !row) {
    await admin.storage.from('requisition-documents').remove([path]);
    // 0033 caps each document kind at 10 per request.
    return { ok: false, error: /at most 10/.test(error?.message ?? '') ? 'too_many' : 'insert_failed' };
  }

  revalidateRetirementSurfaces(e.requisition_id);
  return { ok: true, data: { id: (row as { id: string }).id, fileName: file.name } };
}

/** The submitter takes back an entry the Director has not looked at yet. */
export async function withdrawRetirementEntry(retirementId: string): Promise<ActionResult> {
  const actor = await checkPermission('requisitions.retire');
  if (!actor) return { ok: false, error: 'forbidden' };
  const admin = createAdminClient();
  const { data: entry } = await admin
    .from('requisition_retirements')
    .select('id, requisition_id, status, submitted_by')
    .eq('id', retirementId)
    .maybeSingle();
  const e = entry as { id: string; requisition_id: string; status: string; submitted_by: string } | null;
  if (!e) return { ok: false, error: 'not_found' };
  if (e.status !== 'submitted') return { ok: false, error: 'already_decided' };
  if (actor.role !== 'owner' && e.submitted_by !== actor.userId) return { ok: false, error: 'forbidden' };

  const { data: docs } = await admin
    .from('requisition_documents')
    .select('id, storage_path')
    .eq('retirement_id', e.id);
  const paths = ((docs ?? []) as { storage_path: string }[]).map((d) => d.storage_path);
  if (paths.length > 0) {
    await admin.from('requisition_documents').delete().eq('retirement_id', e.id);
    await admin.storage.from('requisition-documents').remove(paths);
  }
  const { error } = await admin.from('requisition_retirements').delete().eq('id', e.id).eq('status', 'submitted');
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'requisition.retirement_withdrawn',
    entityType: 'purchase_requisition',
    entityId: e.requisition_id,
    metadata: { retirementId: e.id },
  });
  revalidateRetirementSurfaces(e.requisition_id);
  return { ok: true };
}

/**
 * The Director verifies (or rejects) one entry. On approval the spend is filed
 * as a department expense, and if the request is now fully accounted for it is
 * marked retired. Rejection needs a reason the submitter can act on.
 */
export async function decideRetirementEntry(
  retirementId: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<ActionResult<{ fullyRetired: boolean }>> {
  const actor = await checkPermission('requisitions.decide');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  const trimmed = note?.trim() ?? '';
  if (decision === 'reject' && trimmed.length < 3) return { ok: false, error: 'reason_required' };

  const admin = createAdminClient();
  const { data: entry } = await admin
    .from('requisition_retirements')
    .select('id, requisition_id, status, submitted_by, spent_amount, returned_amount, spent_on, department_id, description')
    .eq('id', retirementId)
    .maybeSingle();
  const e = entry as {
    id: string;
    requisition_id: string;
    status: string;
    submitted_by: string;
    spent_amount: number;
    returned_amount: number;
    spent_on: string;
    department_id: string | null;
    description: string;
  } | null;
  if (!e) return { ok: false, error: 'not_found' };
  if (e.status !== 'submitted') return { ok: false, error: 'already_decided' };
  const req = await loadRetirable(admin, e.requisition_id);
  if (!req) return { ok: false, error: 'not_found' };

  // Conditional on still being submitted: two clicks cannot decide it twice.
  const { data: changed, error } = await admin
    .from('requisition_retirements')
    .update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      decided_by: actor.userId,
      decided_at: new Date().toISOString(),
      decision_note: trimmed || null,
    })
    .eq('id', e.id)
    .eq('status', 'submitted')
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'already_decided' };

  let fullyRetired = false;
  if (decision === 'approve') {
    // File the spend as an operating cost (0030) — this is where a purchase
    // becomes an expense in the reports. Best-effort: the verified entry is
    // the record; a missing expense is visible and can be added by hand.
    if (e.department_id && e.spent_amount > 0) {
      const { data: exp } = await admin
        .from('department_expenses')
        .insert({
          department_id: e.department_id,
          expense_date: e.spent_on,
          category: 'other',
          amount: e.spent_amount,
          description: `${req.requisition_number} — ${e.description}`.slice(0, 300),
          reference: req.requisition_number,
          requisition_id: req.id,
          created_by: actor.userId,
        })
        .select('id')
        .maybeSingle();
      const expenseId = (exp as { id: string } | null)?.id;
      if (expenseId) {
        await admin.from('requisition_retirements').update({ expense_id: expenseId }).eq('id', e.id);
      }
    }

    const so = await accountedSoFar(admin, req.id);
    if (so.approved >= req.paid) {
      fullyRetired = true;
      await admin
        .from('purchase_requisitions')
        .update({
          retirement_status: 'completed',
          retired_by: actor.userId,
          retired_at: new Date().toISOString(),
          retired_amount: so.approvedSpent,
          retirement_note: 'Fully retired through verified retirement entries.',
        })
        .eq('id', req.id)
        .neq('retirement_status', 'completed');
    }
  }

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: decision === 'approve' ? 'requisition.retirement_approved' : 'requisition.retirement_rejected',
    entityType: 'purchase_requisition',
    entityId: req.id,
    metadata: { retirementId: e.id, spent: e.spent_amount, returned: e.returned_amount, fullyRetired, note: trimmed || null },
  });

  const headline =
    decision === 'approve'
      ? fullyRetired
        ? 'Retirement verified — request fully retired'
        : 'Retirement verified'
      : 'Retirement rejected';
  const body =
    `${req.requisition_number} — ${formatTZS(e.spent_amount + e.returned_amount)}` +
    (decision === 'reject' ? `: ${trimmed}` : fullyRetired ? '. Nothing is outstanding.' : '.');
  await createNotification({
    profileId: e.submitted_by,
    type: 'retirement_decided',
    title: headline,
    body,
    deepLink: `/accountant/requisitions/${req.id}`,
    dedupeKey: `retirement_decided:${e.id}`,
  });
  if (decision === 'reject') {
    try {
      const { data: p } = await admin.from('profiles').select('phone').eq('id', e.submitted_by).maybeSingle();
      const phone = (p as { phone: string | null } | null)?.phone;
      if (phone) await enqueueSms({ recipient: phone, text: `Ng'umbi Riders: ${headline}. ${body}`, subject: 'retirement_rejected' });
    } catch {
      /* the in-app notification is the record */
    }
  }

  revalidateRetirementSurfaces(req.id);
  revalidatePath('/owner/departments');
  revalidatePath('/accountant/departments');
  return { ok: true, data: { fullyRetired } };
}
