'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { getSessionProfile } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { localDateString, formatLocalDateTime } from '@/lib/dates/tz';
import { generateSchedule } from '@/lib/obligations/schedule';
import {
  monthlyInstalmentCount,
  normalizeDuration,
} from '@/lib/contracts/duration';
import { resolveContractTerm, TermError, type EndDateMode } from '@/lib/contracts/term';
import { instalmentFromDailyRate } from '@/lib/contracts/pricing';
import { dueTimestampUtc } from '@/lib/obligations/schedule';
import { normalizePlan, planToObligations, validatePlan, type PlanEntry } from '@/lib/obligations/plan';
import { phoneLoanSchedule, splitLoanTotal } from '@/lib/loans/phone';
import { renderContractPdf } from './pdf';
import { contractBuilderSchema, contractEditSchema } from './validation';
import type { ContractStatus, Database, ScheduleType } from '@/lib/supabase/types';

type ContractUpdate = Database['public']['Tables']['contracts']['Update'];

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const CONTRACT_NUMBER_PREFIX = 'NGR-C-';

/** Next contract number = highest issued + 1 (max-based, delete-safe). */
async function nextContractNumber(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const { data } = await admin
    .from('contracts')
    .select('contract_number')
    .order('contract_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = (data as { contract_number: string } | null)?.contract_number;
  const seq = last ? (parseInt(/(\d+)$/.exec(last)?.[1] ?? '0', 10) || 0) + 1 : 1;
  return `${CONTRACT_NUMBER_PREFIX}${String(seq).padStart(4, '0')}`;
}

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

  // Flexible term (#9) + phone loan + payment-day extension, all resolved by
  // the one function the builder's preview also calls, so what the owner saw
  // is exactly what is stored.
  const duration = normalizeDuration({
    years: d.durationYears,
    months: d.durationMonths,
    weeks: d.durationWeeks,
    days: d.durationDays,
  });
  let term;
  try {
    term = resolveContractTerm({
      startDate: d.startDate,
      duration,
      endDateMode: d.endDateMode as EndDateMode,
      exactEndDate: d.exactEndDate ?? null,
      paymentDaysTarget: d.paymentDaysTarget ?? null,
      scheduleType: d.scheduleType,
      selectedWeekdays: selectedWeekdays,
      extendForPaymentDays: d.extendForPaymentDays,
      phoneLoan:
        d.includePhoneLoan && d.phoneLoanAmount
          ? { principal: d.phoneLoanAmount, termMonths: d.phoneLoanMonths ?? 3 }
          : null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof TermError ? 'invalid_duration' : 'invalid_duration' };
  }
  const endDate = term.endDate;

  // The instalment is DERIVED from the daily rate whenever one was given —
  // a client-supplied weekly/monthly figure is never trusted (spec rule 3).
  const installmentAmount = d.dailyRate
    ? instalmentFromDailyRate(d.dailyRate, d.scheduleType)
    : d.installmentAmount;
  if (!installmentAmount || installmentAmount <= 0) {
    return { ok: false, error: 'invalid_amount' };
  }

  // Owner-edited payment plan (#1). Re-validated here against the contract term
  // — the client's dates and amounts are never trusted (spec rule 3).
  let plan: PlanEntry[] | null = null;
  if (d.paymentPlan?.length) {
    // The plan covers the LEASE window. Phone-loan instalments are generated
    // from the loan itself, never from the plan, so a financed phone cannot be
    // silently re-priced by editing the lease schedule.
    const check = validatePlan(d.paymentPlan as PlanEntry[], {
      startDate: term.leaseStartDate,
      endDate,
    });
    if (!check.ok) return { ok: false, error: check.error };
    plan = check.entries;
  }

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

  const base = {
    rider_id: d.riderId,
    motorcycle_id: d.motorcycleId,
    contract_type: 'fixed_term_lease',
    ownership_transfers: d.ownershipTransfers,
    ownership_transfer_notes: d.ownershipTransferNotes || null,
    start_date: d.startDate,
    end_date: endDate,
    lease_start_date: term.leaseStartDate,
    daily_rate: d.dailyRate ?? null,
    payment_days_target:
      d.endDateMode === 'payment_days'
        ? (d.paymentDaysTarget ?? null)
        : (term.paymentDays?.targetDays ?? null),
    duration_months: duration.months,
    duration_years: duration.years,
    duration_weeks: duration.weeks,
    duration_days: duration.days,
    end_date_source: d.endDateMode,
    schedule_type: d.scheduleType,
    selected_weekdays: selectedWeekdays,
    due_day_of_month: dueDayOfMonth,
    installment_amount: installmentAmount,
    payment_deadline_time: d.paymentDeadlineTime,
    special_terms: d.specialTerms || null,
    // The generated/edited plan (#1). NULL keeps the cadence-derived behaviour.
    payment_plan: plan ? plan.map((p) => ({ dueDate: p.dueDate, amount: p.amount })) : null,
    payment_frequency:
      d.scheduleType === 'selected_weekdays' ? 'custom' : d.scheduleType,
    payment_plan_generated_at: plan ? new Date().toISOString() : null,
    template_version: 1,
    status: 'draft' as const,
    current_version: 1,
  };

  // The phone loan is created FIRST so the contract can reference it. It stays
  // 'pending' until the contract is activated — a draft contract that is never
  // signed must not leave a live loan behind. If the contract insert fails
  // below, the orphan loan is deleted before returning.
  let phoneLoanId: string | null = null;
  if (term.phoneLoan) {
    const { data: loan, error: loanErr } = await admin
      .from('phone_loans')
      .insert({
        rider_id: d.riderId,
        principal: term.phoneLoan.principal,
        interest_bps: term.phoneLoan.interestBps,
        interest_amount: term.phoneLoan.interestAmount,
        total_amount: term.phoneLoan.totalAmount,
        term_months: term.phoneLoan.termMonths,
        device_description: d.phoneDescription || null,
        status: 'pending',
        created_by: ownerId,
      })
      .select('id')
      .single();
    if (loanErr || !loan) return { ok: false, error: 'phone_loan_failed' };
    phoneLoanId = (loan as { id: string }).id;
  }

  // Number from the highest issued, not count(*): contracts use `on delete
  // restrict` so they aren't normally deleted, but a count-derived number
  // collides forever after any gap. Mirror the max-based rider numbering, and
  // retry on the (rare) concurrent-creation unique clash. See
  // lib/riders/numbering.ts.
  let id: string | null = null;
  let contractNumber = '';
  for (let attempt = 0; attempt < 4 && !id; attempt++) {
    contractNumber = await nextContractNumber(admin);
    const { data, error } = await admin
      .from('contracts')
      .insert({ contract_number: contractNumber, phone_loan_id: phoneLoanId, ...base })
      .select('id')
      .single();
    if (data) {
      id = (data as { id: string }).id;
      break;
    }
    // 23505 = unique_violation on contract_number → someone raced us; retry
    // with a freshly-computed number. Any other error is fatal.
    if (!error || error.code !== '23505') {
      if (phoneLoanId) await admin.from('phone_loans').delete().eq('id', phoneLoanId);
      return { ok: false, error: 'insert_failed' };
    }
  }
  if (!id) {
    if (phoneLoanId) await admin.from('phone_loans').delete().eq('id', phoneLoanId);
    return { ok: false, error: 'insert_failed' };
  }
  if (phoneLoanId) {
    await admin.from('phone_loans').update({ contract_id: id }).eq('id', phoneLoanId);
  }
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
    .select('id, rider_id, motorcycle_id, start_date, end_date, lease_start_date, phone_loan_id, schedule_type, selected_weekdays, due_day_of_month, duration_months, duration_years, duration_weeks, duration_days, payment_plan, payment_deadline_time, installment_amount, assignment_id')
    .eq('id', contractId)
    .maybeSingle();
  if (!c) return { ok: false, error: 'not_found' };
  const row = c as {
    rider_id: string;
    motorcycle_id: string;
    start_date: string | null;
    end_date: string | null;
    lease_start_date: string | null;
    phone_loan_id: string | null;
    schedule_type: ScheduleType;
    selected_weekdays: number[];
    due_day_of_month: number | null;
    duration_months: number | null;
    duration_years: number | null;
    duration_weeks: number | null;
    duration_days: number | null;
    payment_plan: { dueDate: string; amount: number }[] | null;
    payment_deadline_time: string;
    installment_amount: number;
    assignment_id: string | null;
  };
  if (!row.start_date || !row.end_date) return { ok: false, error: 'missing_dates' };

  const deadline = String(row.payment_deadline_time).slice(0, 5);

  // The LEASE calendar starts after any phone loan has been repaid; the
  // contract's own start date stays the possession date.
  const leaseStart = row.lease_start_date ?? row.start_date;

  // Phone-loan instalments come first in the ledger, so oldest-first
  // allocation collects them before any lease day — which is exactly the
  // "pay for the phone first, then the motorcycle" rule, with no special
  // casing anywhere in the payment engine.
  const admin = createAdminClient();
  let phoneObligations: {
    dueDate: string;
    dueAtUtc: string;
    localDueTime: string;
    amount: number;
    kind: string;
    phoneLoanId: string;
  }[] = [];
  if (row.phone_loan_id) {
    const { data: loanRow } = await admin
      .from('phone_loans')
      .select('id, principal, interest_bps, interest_amount, total_amount, term_months, status')
      .eq('id', row.phone_loan_id)
      .maybeSingle();
    const loan = loanRow as
      | { id: string; principal: number; interest_bps: number; interest_amount: number; total_amount: number; term_months: number; status: string }
      | null;
    if (!loan) return { ok: false, error: 'phone_loan_missing' };
    const terms = {
      principal: loan.principal,
      interestBps: loan.interest_bps,
      interestAmount: loan.interest_amount,
      totalAmount: loan.total_amount,
      termMonths: loan.term_months,
      instalments: splitLoanTotal(loan.total_amount, loan.term_months),
    };
    phoneObligations = phoneLoanSchedule(terms, row.start_date).map((i) => ({
      dueDate: i.dueDate,
      dueAtUtc: dueTimestampUtc(i.dueDate, deadline),
      localDueTime: deadline,
      amount: i.amount,
      kind: 'phone_loan',
      phoneLoanId: loan.id,
    }));
  }

  let obligations;

  if (Array.isArray(row.payment_plan) && row.payment_plan.length > 0) {
    // An explicit owner-approved plan (#1) wins: the owner may have excluded
    // days or changed individual amounts, so it no longer matches any cadence.
    // Re-validated against the stored term even though it was validated at
    // creation — the contract's dates could have been edited since.
    const entries: PlanEntry[] = row.payment_plan.map((p) => ({
      dueDate: p.dueDate,
      amount: p.amount,
      included: true,
    }));
    const check = validatePlan(entries, { startDate: leaseStart, endDate: row.end_date });
    if (!check.ok) return { ok: false, error: 'invalid_schedule' };
    obligations = planToObligations(normalizePlan(check.entries), deadline);
  } else {
    // No stored plan → derive the calendar from the cadence, as before.
    const monthlyCount =
      row.schedule_type === 'monthly'
        ? monthlyInstalmentCount({
            startDate: leaseStart,
            endDate: row.end_date,
            duration: normalizeDuration({
              years: row.duration_years,
              months: row.duration_months,
              weeks: row.duration_weeks,
              days: row.duration_days,
            }),
            dueDayOfMonth: row.due_day_of_month ?? 1,
          })
        : undefined;
    if (row.schedule_type === 'monthly' && !monthlyCount) {
      return { ok: false, error: 'invalid_schedule' };
    }
    try {
      obligations = generateSchedule({
        startDate: leaseStart,
        endDate: row.end_date,
        scheduleType: row.schedule_type,
        selectedWeekdays: row.selected_weekdays,
        dueDayOfMonth: row.due_day_of_month ?? undefined,
        monthlyCount,
        deadlineTime: deadline,
      }).map((o) => ({
        dueDate: o.dueDate,
        dueAtUtc: o.dueAtUtc,
        localDueTime: o.localDueTime,
      }));
    } catch {
      return { ok: false, error: 'invalid_schedule' };
    }
  }

  // Nothing may be scheduled beyond the contract's end date (#8) — a stale
  // plan or a shortened term must never keep billing after the lease is over.
  obligations = obligations.filter(
    (o) => o.dueDate >= leaseStart && o.dueDate <= row.end_date!,
  );
  if (obligations.length === 0) return { ok: false, error: 'invalid_schedule' };

  // Phone instalments precede the lease calendar. Their dates cannot collide
  // (the lease starts the day AFTER the last instalment), but the DB's
  // unique (contract_id, due_date) is the real guarantee either way.
  const calendar = [...phoneObligations, ...obligations];

  // Ensure the contract points at an active assignment for this rider+moto.
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
    { p_contract_id: contractId, p_obligations: calendar },
  );
  if (error) {
    return {
      ok: false,
      error: /signatures_required/.test(error.message) ? 'signatures_required' : 'activation_failed',
    };
  }

  // The loan is live once its instalments exist in the ledger.
  if (row.phone_loan_id) {
    await admin.from('phone_loans').update({ status: 'active' }).eq('id', row.phone_loan_id);
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
): Promise<ActionResult<{ path: string; url: string | null }>> {
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

  // Hand back a ready-to-open signed URL so the UI can download immediately
  // instead of leaving the owner staring at a "generated" message with no file.
  const { data: signed } = await admin.storage
    .from('contract-documents')
    .createSignedUrl(path, 120);
  return { ok: true, data: { path, url: signed?.signedUrl ?? null } };
}

/** Short-lived signed URL to download a stored contract document (owner-only). */
export async function getContractDocumentUrl(
  documentId: string,
): Promise<ActionResult<{ url: string }>> {
  await assertOwner();
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from('contract_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: 'not_found' };
  const path = (doc as { storage_path: string }).storage_path;
  const { data, error } = await admin.storage
    .from('contract-documents')
    .createSignedUrl(path, 120);
  if (error || !data) return { ok: false, error: 'sign_failed' };
  return { ok: true, data: { url: data.signedUrl } };
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

/* =========================================================================
 * CONTRACT EDITING, EXTENSION AND REACTIVATION (client feedback 2026-09-05)
 * ========================================================================= */

/** Statuses whose obligation calendar has not been generated yet. */
const PRE_ACTIVATION: ContractStatus[] = ['draft', 'awaiting_signatures', 'scheduled'];

/**
 * Edit an existing contract.
 *
 * The motorcycle, ownership terms, special terms and payment deadline can be
 * corrected at any time — that is the "I entered the wrong plate number" case,
 * and none of them restate money. The term, schedule and amounts may only be
 * edited BEFORE activation: after it, the obligations are the money record and
 * rewriting the price underneath them would silently restate settled history
 * (spec rule 6). The owner extends the term or re-issues the contract instead.
 */
export async function updateContract(
  contractId: string,
  input: unknown,
): Promise<ActionResult<{ endDate: string | null }>> {
  const ownerId = await assertOwner();
  const parsed = contractEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const d = parsed.data;

  const admin = createAdminClient();
  const { data: current } = await admin
    .from('contracts')
    .select(
      'id, rider_id, motorcycle_id, status, start_date, end_date, lease_start_date, phone_loan_id, schedule_type, selected_weekdays, due_day_of_month, duration_months, duration_years, duration_weeks, duration_days, installment_amount, daily_rate, payment_deadline_time, payment_plan',
    )
    .eq('id', contractId)
    .maybeSingle();
  if (!current) return { ok: false, error: 'not_found' };
  const c = current as {
    id: string;
    rider_id: string;
    motorcycle_id: string;
    status: ContractStatus;
    start_date: string | null;
    end_date: string | null;
    lease_start_date: string | null;
    phone_loan_id: string | null;
    schedule_type: ScheduleType;
    selected_weekdays: number[];
    due_day_of_month: number | null;
    duration_months: number | null;
    duration_years: number | null;
    duration_weeks: number | null;
    duration_days: number | null;
    installment_amount: number;
    daily_rate: number | null;
    payment_deadline_time: string;
    payment_plan: { dueDate: string; amount: number }[] | null;
  };

  const patch: ContractUpdate = {
    last_edited_at: new Date().toISOString(),
    last_edited_by: ownerId,
  };

  // ---- always editable ---------------------------------------------------
  if (d.ownershipTransfers !== undefined) patch.ownership_transfers = d.ownershipTransfers;
  if (d.ownershipTransferNotes !== undefined) {
    patch.ownership_transfer_notes = d.ownershipTransferNotes || null;
  }
  if (d.specialTerms !== undefined) patch.special_terms = d.specialTerms || null;
  if (d.paymentDeadlineTime !== undefined) patch.payment_deadline_time = d.paymentDeadlineTime;

  // Motorcycle swap. The replacement must be leasable for THIS rider, exactly
  // as at creation — never trust the dropdown (spec rule 3).
  let newMotorcycleId: string | null = null;
  if (d.motorcycleId && d.motorcycleId !== c.motorcycle_id) {
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
      .neq('id', contractId)
      .maybeSingle();
    if (liveContract) return { ok: false, error: 'motorcycle_in_contract' };
    if ((moto as { status: string }).status === 'assigned') {
      const { data: activeAssign } = await admin
        .from('motorcycle_assignments')
        .select('rider_id')
        .eq('motorcycle_id', d.motorcycleId)
        .eq('is_active', true)
        .maybeSingle();
      if (!activeAssign || (activeAssign as { rider_id: string }).rider_id !== c.rider_id) {
        return { ok: false, error: 'motorcycle_assigned_to_other' };
      }
    }
    patch.motorcycle_id = d.motorcycleId;
    newMotorcycleId = d.motorcycleId;
  }

  // ---- term / schedule / price: pre-activation only ----------------------
  const wantsTermEdit =
    d.startDate !== undefined ||
    d.endDateMode !== undefined ||
    d.exactEndDate !== undefined ||
    d.paymentDaysTarget !== undefined ||
    d.scheduleType !== undefined ||
    d.dailyRate !== undefined ||
    d.installmentAmount !== undefined ||
    d.durationYears !== undefined ||
    d.durationMonths !== undefined ||
    d.durationWeeks !== undefined ||
    d.durationDays !== undefined ||
    d.selectedWeekdays !== undefined ||
    d.weeklyWeekday !== undefined ||
    d.dueDayOfMonth !== undefined;

  let endDate = c.end_date;
  if (wantsTermEdit) {
    if (!PRE_ACTIVATION.includes(c.status)) {
      return { ok: false, error: 'locked_after_activation' };
    }
    const scheduleType = (d.scheduleType ?? c.schedule_type) as ScheduleType;
    const startDate = d.startDate ?? c.start_date;
    if (!startDate) return { ok: false, error: 'missing_dates' };

    const selectedWeekdays =
      scheduleType === 'weekly'
        ? [d.weeklyWeekday ?? c.selected_weekdays?.[0] ?? 0]
        : scheduleType === 'selected_weekdays'
          ? (d.selectedWeekdays ?? c.selected_weekdays ?? [])
          : [];
    if (scheduleType === 'selected_weekdays' && selectedWeekdays.length === 0) {
      return { ok: false, error: 'validation' };
    }
    const dueDayOfMonth =
      scheduleType === 'monthly' ? (d.dueDayOfMonth ?? c.due_day_of_month ?? 1) : null;

    const duration = normalizeDuration({
      years: d.durationYears ?? c.duration_years,
      months: d.durationMonths ?? c.duration_months,
      weeks: d.durationWeeks ?? c.duration_weeks,
      days: d.durationDays ?? c.duration_days,
    });

    // The phone loan (if any) still defers the lease — read its real term
    // rather than trusting the stored lease_start_date, which the edit moves.
    let phoneLoan: { principal: number; termMonths: number; interestBps: number } | null = null;
    if (c.phone_loan_id) {
      const { data: loan } = await admin
        .from('phone_loans')
        .select('principal, term_months, interest_bps')
        .eq('id', c.phone_loan_id)
        .maybeSingle();
      const l = loan as { principal: number; term_months: number; interest_bps: number } | null;
      if (l) phoneLoan = { principal: l.principal, termMonths: l.term_months, interestBps: l.interest_bps };
    }

    let term;
    try {
      term = resolveContractTerm({
        startDate,
        duration,
        endDateMode: (d.endDateMode ?? 'duration') as EndDateMode,
        exactEndDate: d.exactEndDate ?? null,
        paymentDaysTarget: d.paymentDaysTarget ?? null,
        scheduleType,
        selectedWeekdays,
        extendForPaymentDays: d.extendForPaymentDays ?? true,
        phoneLoan,
      });
    } catch {
      return { ok: false, error: 'invalid_duration' };
    }

    const dailyRate = d.dailyRate ?? c.daily_rate;
    const installmentAmount = dailyRate
      ? instalmentFromDailyRate(dailyRate, scheduleType)
      : (d.installmentAmount ?? c.installment_amount);
    if (!installmentAmount || installmentAmount <= 0) return { ok: false, error: 'invalid_amount' };

    // A stored payment plan was generated against the OLD term — it can no
    // longer be trusted, so it is dropped rather than silently replayed onto
    // dates outside the new window.
    endDate = term.endDate;
    Object.assign(patch, {
      start_date: startDate,
      end_date: term.endDate,
      lease_start_date: term.leaseStartDate,
      duration_years: duration.years,
      duration_months: duration.months,
      duration_weeks: duration.weeks,
      duration_days: duration.days,
      end_date_source: d.endDateMode ?? 'duration',
      payment_days_target:
        d.endDateMode === 'payment_days'
          ? (d.paymentDaysTarget ?? null)
          : (term.paymentDays?.targetDays ?? null),
      schedule_type: scheduleType,
      selected_weekdays: selectedWeekdays,
      due_day_of_month: dueDayOfMonth,
      daily_rate: dailyRate ?? null,
      installment_amount: installmentAmount,
      payment_frequency: scheduleType === 'selected_weekdays' ? 'custom' : scheduleType,
      payment_plan: null,
      payment_plan_generated_at: null,
    });
  }

  const { error } = await admin.from('contracts').update(patch).eq('id', contractId);
  if (error) return { ok: false, error: 'update_failed' };

  // Obligations carry the motorcycle id; a swap must move the live ones with
  // it or the ledger would still point at the wrong bike. Settled history is
  // left alone — it records what was true when the money moved.
  if (newMotorcycleId) {
    await admin
      .from('payment_obligations')
      .update({ motorcycle_id: newMotorcycleId })
      .eq('contract_id', contractId)
      .in('status', ['scheduled', 'due', 'overdue']);
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.updated',
    entityType: 'contract',
    entityId: contractId,
    metadata: { fields: Object.keys(patch), termEdited: wantsTermEdit },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  revalidatePath('/owner/contracts');
  return { ok: true, data: { endDate } };
}

/**
 * Extend a live or finished contract to a later end date and generate the
 * obligations for the added period.
 *
 * Existing obligations are never touched — this only ADDS days, using the
 * contract's own cadence and instalment, so the ledger stays append-only.
 */
export async function extendContractTerm(
  contractId: string,
  newEndDate: string,
): Promise<ActionResult<{ generated: number; endDate: string }>> {
  const ownerId = await assertOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) return { ok: false, error: 'invalid_date' };

  const admin = createAdminClient();
  const { data: current } = await admin
    .from('contracts')
    .select(
      'id, rider_id, motorcycle_id, status, start_date, end_date, lease_start_date, schedule_type, selected_weekdays, due_day_of_month, installment_amount, payment_deadline_time, current_version',
    )
    .eq('id', contractId)
    .maybeSingle();
  if (!current) return { ok: false, error: 'not_found' };
  const c = current as {
    rider_id: string;
    motorcycle_id: string;
    status: ContractStatus;
    start_date: string | null;
    end_date: string | null;
    lease_start_date: string | null;
    schedule_type: ScheduleType;
    selected_weekdays: number[];
    due_day_of_month: number | null;
    installment_amount: number;
    payment_deadline_time: string;
    current_version: number;
  };
  if (!c.start_date || !c.end_date) return { ok: false, error: 'missing_dates' };
  if (newEndDate <= c.end_date) return { ok: false, error: 'not_an_extension' };

  const deadline = String(c.payment_deadline_time).slice(0, 5);
  // Generate from the day after the current end date so nothing existing is
  // re-created; the DB's unique (contract_id, due_date) is the backstop.
  const fromMs = Date.parse(`${c.end_date}T00:00:00Z`) + 86_400_000;
  const from = new Date(fromMs).toISOString().slice(0, 10);

  let generated;
  try {
    generated = generateSchedule({
      startDate: from,
      endDate: newEndDate,
      scheduleType: c.schedule_type,
      selectedWeekdays: c.selected_weekdays ?? [],
      dueDayOfMonth: c.due_day_of_month ?? undefined,
      monthlyCount:
        c.schedule_type === 'monthly'
          ? monthlyInstalmentCount({
              startDate: from,
              endDate: newEndDate,
              duration: { years: 0, months: 0, weeks: 0, days: 0 },
              dueDayOfMonth: c.due_day_of_month ?? 1,
            })
          : undefined,
      deadlineTime: deadline,
    });
  } catch {
    return { ok: false, error: 'invalid_schedule' };
  }
  const rows = generated.filter((o) => o.dueDate <= newEndDate);
  if (rows.length === 0) return { ok: false, error: 'invalid_schedule' };

  const { data: inserted, error } = await admin
    .from('payment_obligations')
    .upsert(
      rows.map((o) => ({
        contract_id: contractId,
        rider_id: c.rider_id,
        motorcycle_id: c.motorcycle_id,
        due_date: o.dueDate,
        due_at: o.dueAtUtc,
        local_due_time: o.localDueTime,
        amount_due: c.installment_amount,
        status: 'scheduled' as const,
        contract_version: c.current_version,
        kind: 'lease' as const,
      })),
      { onConflict: 'contract_id,due_date', ignoreDuplicates: true },
    )
    .select('id');
  if (error) return { ok: false, error: 'generation_failed' };

  const { error: updErr } = await admin
    .from('contracts')
    .update({ end_date: newEndDate, last_edited_at: new Date().toISOString(), last_edited_by: ownerId })
    .eq('id', contractId);
  if (updErr) return { ok: false, error: 'update_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.extended',
    entityType: 'contract',
    entityId: contractId,
    metadata: { from: c.end_date, to: newEndDate, generated: (inserted ?? []).length },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  revalidatePath('/owner/contracts');
  return { ok: true, data: { generated: (inserted ?? []).length, endDate: newEndDate } };
}

/**
 * Put a terminated / early-completed / completed contract back into service.
 *
 * The client's report: "I tried terminating a contract and later activating it
 * again, but the system does not allow it — the rider cannot make payments."
 * `contractLifecycle` deliberately has no path back from a terminal state
 * (resume only accepts `paused`), and termination CANCELS the future
 * obligations, so even flipping the status would have left the rider with an
 * empty calendar and nothing to pay.
 *
 * So reactivation does both halves: restore the status AND restore the
 * obligations termination cancelled. Only `cancelled` obligations inside the
 * contract term are restored — settled, exempted and postponed rows are
 * history and are never touched. If the term has already expired the caller
 * must pass a new end date, which extends the calendar too; without it the
 * nightly completion job would simply close the contract again on its next run.
 */
export async function reactivateContract(
  contractId: string,
  options?: { newEndDate?: string | null },
): Promise<ActionResult<{ restored: number; generated: number; endDate: string | null }>> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const { data: current } = await admin
    .from('contracts')
    .select('id, status, start_date, end_date')
    .eq('id', contractId)
    .maybeSingle();
  if (!current) return { ok: false, error: 'not_found' };
  const c = current as {
    status: ContractStatus;
    start_date: string | null;
    end_date: string | null;
  };

  const REACTIVATABLE: ContractStatus[] = ['terminated', 'completed', 'completed_early', 'cancelled'];
  if (!REACTIVATABLE.includes(c.status)) return { ok: false, error: 'invalid_status' };
  if (!c.start_date || !c.end_date) return { ok: false, error: 'missing_dates' };

  const today = localDateString();
  const newEndDate = options?.newEndDate?.trim() || null;
  if (newEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) {
    return { ok: false, error: 'invalid_date' };
  }
  const effectiveEnd = newEndDate && newEndDate > c.end_date ? newEndDate : c.end_date;
  // A contract whose term is already over would be auto-completed again by
  // tonight's job — say so instead of "reactivating" it for a few hours.
  if (effectiveEnd < today) return { ok: false, error: 'term_expired' };

  // 1. Status back to active, conditional on it still being terminal.
  const { data: changed, error: statusErr } = await admin
    .from('contracts')
    .update({ status: 'active', last_edited_at: new Date().toISOString(), last_edited_by: ownerId })
    .eq('id', contractId)
    .in('status', REACTIVATABLE)
    .select('id');
  if (statusErr) return { ok: false, error: 'update_failed' };
  if (!changed || changed.length === 0) return { ok: false, error: 'invalid_status' };

  // 2. Restore the obligations termination cancelled, inside the term only.
  const { data: restored, error: restoreErr } = await admin
    .from('payment_obligations')
    .update({ status: 'scheduled' })
    .eq('contract_id', contractId)
    .eq('status', 'cancelled')
    .gte('due_date', c.start_date)
    .lte('due_date', effectiveEnd)
    .select('id');
  if (restoreErr) return { ok: false, error: 'restore_failed' };

  // 3. Extend if the owner gave a later end date.
  let generated = 0;
  if (newEndDate && newEndDate > c.end_date) {
    const ext = await extendContractTerm(contractId, newEndDate);
    if (!ext.ok) return { ok: false, error: ext.error };
    generated = ext.data?.generated ?? 0;
  }

  // 4. Re-run the due/overdue sweep for this contract so the rider's screen is
  //    correct immediately rather than after tonight's cron.
  await admin
    .from('payment_obligations')
    .update({ status: 'overdue' })
    .eq('contract_id', contractId)
    .eq('status', 'scheduled')
    .lt('due_date', today);
  await admin
    .from('payment_obligations')
    .update({ status: 'due' })
    .eq('contract_id', contractId)
    .eq('status', 'scheduled')
    .eq('due_date', today);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'contract.reactivated',
    entityType: 'contract',
    entityId: contractId,
    metadata: {
      from: c.status,
      restored: (restored ?? []).length,
      generated,
      endDate: effectiveEnd,
    },
  });
  revalidatePath(`/owner/contracts/${contractId}`);
  revalidatePath('/owner/contracts');
  return {
    ok: true,
    data: { restored: (restored ?? []).length, generated, endDate: effectiveEnd },
  };
}
