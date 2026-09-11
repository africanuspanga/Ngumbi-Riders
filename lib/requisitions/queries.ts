import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { requisitionTotal, lineAmount } from './compute';
import type {
  RequisitionBudgetCover,
  RequisitionDepartment,
  RequisitionDocType,
  RequisitionItemCategory,
  RequisitionStatus,
  RequisitionPaymentStatus,
  RequisitionRetirementStatus,
  RequisitionType,
  RequisitionUnit,
} from './constants';

/*
 * Requisition reads. Both back-office roles read the same shapes under RLS
 * (0028 gives owner and accountant SELECT); the accountant list is filtered by
 * author in SQL rather than trusted to the UI.
 *
 * Totals are computed here from the line items, never read from a column —
 * there is no total column, by design (D-034 rule 3).
 */

export type RequisitionItemRow = {
  id: string;
  position: number;
  description: string;
  category: RequisitionItemCategory;
  quantity: number;
  unit: RequisitionUnit;
  unitPrice: number;
  amount: number;
  budgetCover: RequisitionBudgetCover;
};

export type RequisitionDocumentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** What the file IS: quotation, invoice, proof of payment, receipt (0033). */
  docType: RequisitionDocType;
};

export type RequisitionSummary = {
  id: string;
  requisitionNumber: string;
  title: string;
  department: RequisitionDepartment;
  fiscalYear: number;
  requestDate: string;
  status: RequisitionStatus;
  /* Whether the owner has released money for an APPROVED purchase (0029).
     Always present; only meaningful once `status` is 'approved'. */
  paymentStatus: RequisitionPaymentStatus;
  paymentMarkedByName: string | null;
  paymentMarkedAt: string | null;
  paymentNote: string | null;
  /* Whether money already released has been accounted for (0033). The third
     independent axis after the decision and the payment. */
  retirementStatus: RequisitionRetirementStatus;
  retiredByName: string | null;
  retiredAt: string | null;
  retiredAmount: number | null;
  retirementNote: string | null;
  requisitionType: RequisitionType;
  departmentId: string | null;
  phoneLoanRequestId: string | null;
  total: number;
  itemCount: number;
  requestedById: string;
  requestedByName: string;
  approverName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  submittedAt: string | null;
};

export type RequisitionDetail = RequisitionSummary & {
  description: string | null;
  currency: string;
  paymentInformation: string | null;
  approverId: string | null;
  items: RequisitionItemRow[];
  documents: RequisitionDocumentRow[];
};

type RawRequisition = {
  id: string;
  requisition_number: string;
  title: string;
  description: string | null;
  department: string;
  fiscal_year: number;
  request_date: string;
  currency: string;
  payment_information: string | null;
  status: string;
  approver_id: string | null;
  requested_by: string;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  payment_status: string | null;
  payment_marked_by: string | null;
  payment_marked_at: string | null;
  payment_note: string | null;
  retirement_status: string | null;
  retired_by: string | null;
  retired_at: string | null;
  retired_amount: number | null;
  retirement_note: string | null;
  requisition_type: string | null;
  department_id: string | null;
  phone_loan_request_id: string | null;
  created_at: string;
  requisition_items: {
    id: string;
    position: number;
    description: string;
    category: string;
    quantity: number;
    unit: string;
    unit_price: number;
    budget_cover: string;
  }[];
};

const SELECT =
  'id, requisition_number, title, description, department, fiscal_year, request_date, currency, ' +
  'payment_information, status, approver_id, requested_by, submitted_at, decided_by, decided_at, ' +
  'decision_note, payment_status, payment_marked_by, payment_marked_at, payment_note, ' +
  'retirement_status, retired_by, retired_at, retired_amount, retirement_note, ' +
  'requisition_type, department_id, phone_loan_request_id, ' +
  'created_at, requisition_items(id, position, description, category, quantity, unit, unit_price, budget_cover)';

/** Display names for a set of profile ids, in one query. */
async function profileNames(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name || p.email || 'Staff',
    ]),
  );
}

function toItems(raw: RawRequisition): RequisitionItemRow[] {
  return [...(raw.requisition_items ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      id: i.id,
      position: i.position,
      description: i.description,
      category: i.category as RequisitionItemCategory,
      quantity: i.quantity,
      unit: i.unit as RequisitionUnit,
      unitPrice: i.unit_price,
      amount: lineAmount({ quantity: i.quantity, unitPrice: i.unit_price }),
      budgetCover: i.budget_cover as RequisitionBudgetCover,
    }));
}

function toSummary(raw: RawRequisition, names: Map<string, string>): RequisitionSummary {
  const items = toItems(raw);
  return {
    id: raw.id,
    requisitionNumber: raw.requisition_number,
    title: raw.title,
    department: raw.department as RequisitionDepartment,
    fiscalYear: raw.fiscal_year,
    requestDate: raw.request_date,
    status: raw.status as RequisitionStatus,
    paymentStatus: (raw.payment_status ?? 'unpaid') as RequisitionPaymentStatus,
    paymentMarkedByName: raw.payment_marked_by
      ? (names.get(raw.payment_marked_by) ?? null)
      : null,
    paymentMarkedAt: raw.payment_marked_at,
    paymentNote: raw.payment_note,
    retirementStatus: (raw.retirement_status ?? 'not_started') as RequisitionRetirementStatus,
    retiredByName: raw.retired_by ? (names.get(raw.retired_by) ?? null) : null,
    retiredAt: raw.retired_at,
    retiredAmount: raw.retired_amount,
    retirementNote: raw.retirement_note,
    requisitionType: (raw.requisition_type ?? 'general') as RequisitionType,
    departmentId: raw.department_id,
    phoneLoanRequestId: raw.phone_loan_request_id,
    total: requisitionTotal(items),
    itemCount: items.length,
    requestedById: raw.requested_by,
    requestedByName: names.get(raw.requested_by) ?? 'Staff',
    approverName: raw.approver_id ? (names.get(raw.approver_id) ?? null) : null,
    decidedByName: raw.decided_by ? (names.get(raw.decided_by) ?? null) : null,
    decidedAt: raw.decided_at,
    decisionNote: raw.decision_note,
    createdAt: raw.created_at,
    submittedAt: raw.submitted_at,
  };
}

/**
 * List requisitions, newest first. `authorId` scopes an accountant to their own
 * requests; the Director passes nothing and sees everything.
 */
export async function listRequisitions(options?: {
  statuses?: RequisitionStatus[];
  authorId?: string;
  limit?: number;
}): Promise<RequisitionSummary[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from('purchase_requisitions')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 200);
  if (options?.statuses?.length) query = query.in('status', options.statuses);
  if (options?.authorId) query = query.eq('requested_by', options.authorId);

  const { data, error } = await query;
  // A request awaiting a decision rendering as "nothing to approve" is the
  // worst possible outcome, so fail loudly rather than showing an empty queue.
  if (error) throw new Error(`requisition list failed: ${error.message}`);

  const rows = (data ?? []) as unknown as RawRequisition[];
  const names = await profileNames(
    supabase,
    rows.flatMap((r) => [
      r.requested_by,
      r.approver_id,
      r.decided_by,
      r.payment_marked_by,
      r.retired_by,
    ]),
  );
  return rows.map((r) => toSummary(r, names));
}

/** One requisition with its lines and attachments, or null. */
export async function getRequisition(id: string): Promise<RequisitionDetail | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('purchase_requisitions')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`requisition read failed: ${error.message}`);
  if (!data) return null;
  const raw = data as unknown as RawRequisition;

  const [names, docs] = await Promise.all([
    profileNames(supabase, [
      raw.requested_by,
      raw.approver_id,
      raw.decided_by,
      raw.payment_marked_by,
      raw.retired_by,
    ]),
    supabase
      .from('requisition_documents')
      .select('id, file_name, mime_type, size_bytes, created_at, doc_type')
      .eq('requisition_id', id)
      .order('created_at', { ascending: true }),
  ]);

  return {
    ...toSummary(raw, names),
    description: raw.description,
    currency: raw.currency,
    paymentInformation: raw.payment_information,
    approverId: raw.approver_id,
    items: toItems(raw),
    documents: ((docs.data ?? []) as {
      id: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      created_at: string;
      doc_type: string | null;
    }[]).map((d) => ({
      id: d.id,
      fileName: d.file_name,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes,
      createdAt: d.created_at,
      // Rows written before 0033 carry no kind; they are all quotations.
      docType: (d.doc_type ?? 'supporting') as RequisitionDocType,
    })),
  };
}

export type Approver = { id: string; name: string };

/** The Managing Director(s) a request may be addressed to. */
export async function listApprovers(): Promise<Approver[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('role', 'owner');
  return ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map(
    (p) => ({ id: p.id, name: p.full_name || p.email || 'Managing Director' }),
  );
}

/** How many requests are sitting on the Director's desk (dashboard badge). */
export async function countPendingRequisitions(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from('purchase_requisitions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'submitted');
  if (error) throw new Error(`requisition count failed: ${error.message}`);
  return count ?? 0;
}

/*
 * Dashboard-only variant that tolerates the requisition tables not existing
 * yet.
 *
 * The strict `listRequisitions` above throws on any error, deliberately: a
 * queue that renders as "nothing to approve" because a query failed is the
 * worst outcome this codebase has (D-033). But the two DASHBOARDS also show a
 * requisition summary, and a dashboard is not the queue — if it threw, the
 * owner would lose their whole home page during the window between the code
 * deploying and migration 0028 being applied to the live database.
 *
 * So this variant swallows EXACTLY ONE condition — "the table is not there" —
 * and rethrows everything else. Once 0028 is applied the branch is dead code
 * that can never fire.
 */
function isTableMissing(message: string): boolean {
  // Postgres 42P01 undefined_table, and PostgREST's schema-cache equivalent.
  return (
    /42P01/.test(message) ||
    /PGRST205/.test(message) ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

export async function listRequisitionsForDashboard(
  options?: Parameters<typeof listRequisitions>[0],
): Promise<RequisitionSummary[]> {
  try {
    return await listRequisitions(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTableMissing(message)) return [];
    throw error;
  }
}
