'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { getSessionProfile } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { localDateString, formatLocalDateTime } from '@/lib/dates/tz';
import {
  generateSchedule,
  contractEndDate,
} from '@/lib/obligations/schedule';
import { renderContractPdf } from './pdf';
import { contractBuilderSchema } from './validation';
import type { ContractStatus, ScheduleType } from '@/lib/supabase/types';

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function createContract(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ownerId = await assertOwner();
  const parsed = contractBuilderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const d = parsed.data;

  // Weekly stores its single payment weekday in selected_weekdays; monthly
  // stores the owner-set due day in due_day_of_month. Normalise here so the
  // stored row is unambiguous regardless of which schedule fields the form sent.
  const selectedWeekdays =
    d.scheduleType === 'weekly'
      ? [d.weeklyWeekday!]
      : d.scheduleType === 'selected_weekdays'
        ? d.selectedWeekdays
        : [];
  const dueDayOfMonth = d.scheduleType === 'monthly' ? d.dueDayOfMonth! : null;

  const endDate = contractEndDate({
    scheduleType: d.scheduleType,
    startDate: d.startDate,
    durationMonths: d.durationMonths,
    dueDayOfMonth: dueDayOfMonth ?? undefined,
    deadlineTime: d.paymentDeadlineTime,
  });
  const admin = createAdminClient();

  // The motorcycle must be leasable for THIS rider (never trust the client's
  // dropdown): available, or already assigned to this same rider — and not
  // inactive nor already under a live (draft/active/paused) contract.
  const { data: moto } = await admin
    .from('motorcycles')
    .select('status')
    .eq('id', d.motorcycleId)
    .maybeSingle();
  if (!moto) return { ok: false, error: 'motorcycle_not_found' };
  if ((moto as { status: string }).status === 'inactive') {
    return { ok: false, error: 'motorcycle_unavailable' };
  }
  const { data: liveContract } = await admin
    .from('contracts')
    .select('id')
    .eq('motorcycle_id', d.motorcycleId)
    .in('status', ['draft', 'active', 'paused'])
    .maybeSingle();
  if (liveContract) return { ok: false, error: 'motorcycle_in_contract' };
  if ((moto as { status: string }).status === 'assigned') {
    const { data: activeAssign } = await admin
      .from('motorcycle_assignments')
      .select('rider_id')
      .eq('motorcycle_id', d.motorcycleId)
      .eq('is_active', true)
      .maybeSingle();
    if (!activeAssign || (activeAssign as { rider_id: string }).rider_id !== d.riderId) {
      return { ok: false, error: 'motorcycle_assigned_to_other' };
    }
  }

  const { count } = await admin.from('contracts').select('*', { count: 'exact', head: true });
  const contractNumber = `NGR-C-${String((count ?? 0) + 1).padStart(4, '0')}`;

  const { data, error } = await admin
    .from('contracts')
    .insert({
      contract_number: contractNumber,
      rider_id: d.riderId,
      motorcycle_id: d.motorcycleId,
      contract_type: 'fixed_term_lease',
      ownership_transfers: d.ownershipTransfers,
      ownership_transfer_notes: d.ownershipTransferNotes || null,
      start_date: d.startDate,
      end_date: endDate,
      duration_months: d.durationMonths,
      schedule_type: d.scheduleType,
      selected_weekdays: selectedWeekdays,
      due_day_of_month: dueDayOfMonth,
      installment_amount: d.installmentAmount,
      payment_deadline_time: d.paymentDeadlineTime,
      special_terms: d.specialTerms || null,
      template_version: 1,
      status: 'draft',
      current_version: 1,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'insert_failed' };

  const id = (data as { id: string }).id;
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.created',
    entityType: 'contract',
    entityId: id,
    metadata: { contractNumber },
  });
  revalidatePath('/owner/contracts');
  return { ok: true, data: { id } };
}

export async function addDrawnSignature(
  contractId: string,
  role: 'owner' | 'rider' | 'guarantor' | 'witness',
  signatureDataUrl: string,
  signerName: string,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  if (!signatureDataUrl.startsWith('data:image/')) {
    return { ok: false, error: 'invalid_signature' };
  }
  const admin = createAdminClient();
  const base64 = signatureDataUrl.split(',')[1] ?? '';
  const path = `${contractId}/sig-${role}-${Date.now()}.png`;
  const { error: upErr } = await admin.storage
    .from('contract-documents')
    .upload(path, Buffer.from(base64, 'base64'), { contentType: 'image/png' });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { error } = await admin.from('contract_signatures').insert({
    contract_id: contractId,
    signer_role: role,
    signer_name: signerName || null,
    signature_image_path: path,
    method: 'drawn',
  });
  if (error) return { ok: false, error: 'insert_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.signed',
    entityType: 'contract',
    entityId: contractId,
    metadata: { role, method: 'drawn' },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  return { ok: true };
}

/** Physical signed-copy fallback (spec §10.3 step 8). Immutable once stored. */
export async function uploadPhysicalCopy(formData: FormData): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const contractId = formData.get('contractId');
  const file = formData.get('file');
  if (typeof contractId !== 'string' || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'bad_request' };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash('sha256').update(buffer).digest('hex');
  const ext = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'img';
  const path = `${contractId}/signed-physical-${Date.now()}.${ext}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from('contract-documents')
    .upload(path, buffer, { contentType: file.type || 'application/pdf' });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { error } = await admin.from('contract_documents').insert({
    contract_id: contractId,
    doc_type: 'contract',
    storage_path: path,
    sha256_hash: hash,
    is_signed: true,
    version: 1,
  });
  if (error) return { ok: false, error: 'insert_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.physical_copy_uploaded',
    entityType: 'contract',
    entityId: contractId,
    metadata: { sha256: hash },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  return { ok: true };
}

/**
 * Activate a signed contract and generate its obligation calendar in one DB
 * transaction (spec §10.3 step 10, §11.3). The schedule is computed here with
 * the tested engine and committed atomically by the SECURITY DEFINER function.
 */
export async function activateContract(
  contractId: string,
): Promise<ActionResult<{ generated: number }>> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();

  const { data: c } = await supabase
    .from('contracts')
    .select('id, rider_id, motorcycle_id, start_date, end_date, schedule_type, selected_weekdays, due_day_of_month, duration_months, payment_deadline_time, installment_amount, assignment_id')
    .eq('id', contractId)
    .maybeSingle();
  if (!c) return { ok: false, error: 'not_found' };
  const row = c as {
    rider_id: string;
    motorcycle_id: string;
    start_date: string | null;
    end_date: string | null;
    schedule_type: ScheduleType;
    selected_weekdays: number[];
    due_day_of_month: number | null;
    duration_months: number | null;
    payment_deadline_time: string;
    installment_amount: number;
    assignment_id: string | null;
  };
  if (!row.start_date || !row.end_date) return { ok: false, error: 'missing_dates' };
  if (row.schedule_type === 'monthly' && !row.duration_months) {
    return { ok: false, error: 'invalid_schedule' };
  }

  let obligations;
  try {
    obligations = generateSchedule({
      startDate: row.start_date,
      endDate: row.end_date,
      scheduleType: row.schedule_type,
      selectedWeekdays: row.selected_weekdays,
      dueDayOfMonth: row.due_day_of_month ?? undefined,
      monthlyCount: row.duration_months ?? undefined,
      deadlineTime: String(row.payment_deadline_time).slice(0, 5),
    }).map((o) => ({
      dueDate: o.dueDate,
      dueAtUtc: o.dueAtUtc,
      localDueTime: o.localDueTime,
    }));
  } catch {
    return { ok: false, error: 'invalid_schedule' };
  }

  // Ensure the contract points at an active assignment for this rider+moto.
  const admin = createAdminClient();
  if (!row.assignment_id) {
    const { data: assignment } = await admin
      .from('motorcycle_assignments')
      .select('id')
      .eq('rider_id', row.rider_id)
      .eq('motorcycle_id', row.motorcycle_id)
      .eq('is_active', true)
      .maybeSingle();
    if (assignment) {
      await admin
        .from('contracts')
        .update({ assignment_id: (assignment as { id: string }).id })
        .eq('id', contractId);
    }
  }

  const { data: generated, error } = await supabase.rpc(
    'activate_contract_and_generate_obligations',
    { p_contract_id: contractId, p_obligations: obligations },
  );
  if (error) {
    return {
      ok: false,
      error: /signatures_required/.test(error.message) ? 'signatures_required' : 'activation_failed',
    };
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.activated',
    entityType: 'contract',
    entityId: contractId,
    metadata: { generated },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  return { ok: true, data: { generated: Number(generated ?? 0) } };
}

/** Generate the contract PDF from the versioned template and store it (§10.4). */
export async function generateContractPdf(
  contractId: string,
): Promise<ActionResult<{ path: string }>> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const { data: c } = await admin
    .from('contracts')
    .select('*, riders(first_name, last_name, rider_number), motorcycles(registration_number)')
    .eq('id', contractId)
    .maybeSingle();
  if (!c) return { ok: false, error: 'not_found' };
  const row = c as Record<string, unknown> & {
    riders: { first_name: string; last_name: string; rider_number: string } | null;
    motorcycles: { registration_number: string } | null;
  };

  const version = Number(row.template_version ?? 1);
  const { data: template } = await admin
    .from('contract_templates')
    .select('body')
    .eq('version', version)
    .maybeSingle();

  let buffer: Buffer;
  try {
    buffer = await renderContractPdf({
      contractNumber: String(row.contract_number),
      templateBody: (template as { body: string } | null)?.body ?? 'Lease agreement.',
      templateVersion: version,
      riderName: row.riders ? `${row.riders.first_name} ${row.riders.last_name}` : '—',
      riderNumber: row.riders?.rider_number ?? '—',
      registration: row.motorcycles?.registration_number ?? '—',
      installmentAmount: Number(row.installment_amount ?? 0),
      paymentDeadlineTime: String(row.payment_deadline_time ?? '18:00').slice(0, 5),
      startDate: (row.start_date as string) ?? null,
      endDate: (row.end_date as string) ?? null,
      scheduleType: row.schedule_type as ScheduleType,
      selectedWeekdays: (row.selected_weekdays as number[]) ?? [],
      dueDayOfMonth: (row.due_day_of_month as number | null) ?? null,
      ownershipTransfers: Boolean(row.ownership_transfers),
      ownershipTransferNotes: (row.ownership_transfer_notes as string) ?? null,
      specialTerms: (row.special_terms as string) ?? null,
      generatedAtLabel: formatLocalDateTime(new Date()),
    });
  } catch {
    return { ok: false, error: 'render_failed' };
  }

  const hash = createHash('sha256').update(buffer).digest('hex');
  const path = `${contractId}/contract-v${version}-${Date.now()}.pdf`;
  const { error: upErr } = await admin.storage
    .from('contract-documents')
    .upload(path, buffer, { contentType: 'application/pdf' });
  if (upErr) return { ok: false, error: 'upload_failed' };

  await admin.from('contract_documents').insert({
    contract_id: contractId,
    doc_type: 'contract',
    storage_path: path,
    sha256_hash: hash,
    is_signed: false,
    version,
  });

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.pdf_generated',
    entityType: 'contract',
    entityId: contractId,
    metadata: { sha256: hash },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  return { ok: true, data: { path } };
}

const LIFECYCLE: Record<string, { from: ContractStatus[]; to: ContractStatus; cancelFuture: boolean }> = {
  pause: { from: ['active'], to: 'paused', cancelFuture: false },
  resume: { from: ['paused'], to: 'active', cancelFuture: false },
  complete_early: { from: ['active', 'paused'], to: 'completed_early', cancelFuture: true },
  terminate: { from: ['active', 'paused'], to: 'terminated', cancelFuture: true },
};

export async function contractLifecycle(
  contractId: string,
  action: keyof typeof LIFECYCLE,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const cfg = LIFECYCLE[action];
  if (!cfg) return { ok: false, error: 'bad_action' };
  const supabase = await createServerSupabase();

  // State machine enforced server-side: the update only applies when the
  // contract is in a valid source state (never trust the client's buttons) —
  // e.g. resume must not reactivate a terminated contract whose future
  // obligations were already cancelled.
  const { data: changed, error } = await supabase
    .from('contracts')
    .update({ status: cfg.to })
    .eq('id', contractId)
    .in('status', cfg.from)
    .select('id');
  if (error) return { ok: false, error: 'update_failed' };
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_status' };

  if (cfg.cancelFuture) {
    // Cancel future UNPAID obligations; paid history is preserved (spec §3.4).
    // Written via the service role: direct writes to money tables are revoked
    // from the authenticated role (migration 0016).
    const admin = createAdminClient();
    await admin
      .from('payment_obligations')
      .update({ status: 'cancelled' })
      .eq('contract_id', contractId)
      .gte('due_date', localDateString())
      .in('status', ['scheduled', 'due', 'overdue']);
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: `contract.${action}`,
    entityType: 'contract',
    entityId: contractId,
    metadata: { to: cfg.to },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  revalidatePath('/owner/contracts');
  return { ok: true };
}
