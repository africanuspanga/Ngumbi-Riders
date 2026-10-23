import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import { requisitionTotal } from './compute';
import { DEPARTMENT_LABELS, type RequisitionDepartment } from './constants';
import {
  computeRetirementRow,
  type RetirableRequisition,
  type RetirementEntryInput,
  type RetirementRow,
} from './retirement';

/*
 * Retirement reads (client request 2026-10-23). Both back-office roles read
 * under RLS — staff SELECT on requisitions (0028) and on retirement entries
 * (0036). Totals are derived by lib/requisitions/retirement.ts.
 */

export type RetirementEntry = {
  id: string;
  requisitionId: string;
  spentAmount: number;
  returnedAmount: number;
  spentOn: string;
  description: string;
  departmentId: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  submittedById: string;
  submittedByName: string;
  submittedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expenseId: string | null;
  documents: { id: string; fileName: string }[];
};

export type RetirementBoard = {
  rows: RetirementRow[];
  /** False until migration 0036 is live: only legacy retirements are known. */
  entriesAvailable: boolean;
};

/** "The table is not there yet" — the ONLY error a board read tolerates. */
function isTableMissing(message: string): boolean {
  return (
    /42P01/.test(message) ||
    /PGRST205/.test(message) ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

async function profileNames(supabase: Supabase, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name || p.email || 'Staff',
    ]),
  );
}

async function loadEntries(
  supabase: Supabase,
  requisitionId?: string,
): Promise<{ entries: RetirementEntry[]; available: boolean }> {
  let query = supabase
    .from('requisition_retirements')
    .select(
      'id, requisition_id, spent_amount, returned_amount, spent_on, description, department_id, status, ' +
        'submitted_by, submitted_at, decided_by, decided_at, decision_note, expense_id',
    )
    .order('submitted_at', { ascending: true });
  if (requisitionId) query = query.eq('requisition_id', requisitionId);
  const { data, error } = await query;
  if (error) {
    if (isTableMissing(error.message)) return { entries: [], available: false };
    throw new Error(`retirement entries read failed: ${error.message}`);
  }
  const raw = (data ?? []) as unknown as {
    id: string;
    requisition_id: string;
    spent_amount: number;
    returned_amount: number;
    spent_on: string;
    description: string;
    department_id: string | null;
    status: RetirementEntry['status'];
    submitted_by: string;
    submitted_at: string;
    decided_by: string | null;
    decided_at: string | null;
    decision_note: string | null;
    expense_id: string | null;
  }[];
  const names = await profileNames(supabase, raw.flatMap((r) => [r.submitted_by, r.decided_by]));

  const docsByEntry = new Map<string, { id: string; fileName: string }[]>();
  if (raw.length > 0) {
    const { data: docs } = await supabase
      .from('requisition_documents')
      .select('id, file_name, retirement_id')
      .in('retirement_id', raw.map((r) => r.id));
    for (const d of (docs ?? []) as { id: string; file_name: string; retirement_id: string }[]) {
      const list = docsByEntry.get(d.retirement_id) ?? [];
      list.push({ id: d.id, fileName: d.file_name });
      docsByEntry.set(d.retirement_id, list);
    }
  }

  return {
    available: true,
    entries: raw.map((r) => ({
      id: r.id,
      requisitionId: r.requisition_id,
      spentAmount: r.spent_amount,
      returnedAmount: r.returned_amount,
      spentOn: r.spent_on,
      description: r.description,
      departmentId: r.department_id,
      status: r.status,
      submittedById: r.submitted_by,
      submittedByName: names.get(r.submitted_by) ?? 'Staff',
      submittedAt: r.submitted_at,
      decidedByName: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
      expenseId: r.expense_id,
      documents: docsByEntry.get(r.id) ?? [],
    })),
  };
}

/** The entries of one requisition, oldest first. */
export async function listRetirementEntries(
  requisitionId: string,
): Promise<{ entries: RetirementEntry[]; available: boolean }> {
  return loadEntries(await createServerSupabase(), requisitionId);
}

function toEntryInput(e: RetirementEntry): RetirementEntryInput {
  return {
    id: e.id,
    requisitionId: e.requisitionId,
    spentAmount: e.spentAmount,
    returnedAmount: e.returnedAmount,
    status: e.status,
  };
}

/**
 * Every RETIRABLE requisition (approved + paid) with its derived retirement
 * row. Filters apply to the payment date — "money released between these
 * dates" — and to the person who holds it.
 */
export async function getRetirementBoard(filters: {
  from?: string | null;
  to?: string | null;
  staffId?: string | null;
} = {}): Promise<RetirementBoard> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const reqs = await fetchAllPages<{
    id: string;
    requisition_number: string;
    title: string;
    requested_by: string;
    department: string;
    requisition_type: string | null;
    payment_marked_at: string | null;
    retirement_status: string | null;
    retired_amount: number | null;
    requisition_items: { quantity: number; unit_price: number }[];
  }>(
    (a, b) => {
      let q = supabase
        .from('purchase_requisitions')
        .select(
          'id, requisition_number, title, requested_by, department, requisition_type, payment_marked_at, ' +
            'retirement_status, retired_amount, requisition_items(quantity, unit_price)',
        )
        .eq('status', 'approved')
        .eq('payment_status', 'paid')
        .order('payment_marked_at', { ascending: false })
        .order('id', { ascending: true });
      if (filters.staffId) q = q.eq('requested_by', filters.staffId);
      return q.range(a, b) as unknown as PromiseLike<{
        data: never[] | null;
        error: { message: string } | null;
      }>;
    },
    { label: 'retirement board' },
  );

  const { entries, available } = await loadEntries(supabase);
  const names = await profileNames(supabase, reqs.map((r) => r.requested_by));
  const inputs = entries.map(toEntryInput);

  const rows = reqs
    .map((r): RetirableRequisition => ({
      id: r.id,
      requisitionNumber: r.requisition_number,
      title: r.title,
      requestedById: r.requested_by,
      requestedByName: names.get(r.requested_by) ?? 'Staff',
      departmentName: DEPARTMENT_LABELS[r.department as RequisitionDepartment] ?? r.department,
      requisitionType: r.requisition_type ?? 'general',
      paidAmount: requisitionTotal(
        (r.requisition_items ?? []).map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price })),
      ),
      paidDate: r.payment_marked_at ? localDateString(new Date(r.payment_marked_at)) : null,
      legacyRetirementStatus: r.retirement_status ?? 'not_started',
      legacyRetiredAmount: r.retired_amount,
    }))
    .filter((r) => (!filters.from || (r.paidDate ?? '') >= filters.from) && (!filters.to || (r.paidDate ?? '9999') <= filters.to))
    .map((r) => computeRetirementRow(r, inputs, today));

  return { rows, entriesAvailable: available };
}

/** Staff who have ever held a paid requisition — the board's person filter. */
export async function listRetirementStaff(): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['owner', 'accountant']);
  return ((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
    .map((p) => ({ id: p.id, name: p.full_name || p.email || 'Staff' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
