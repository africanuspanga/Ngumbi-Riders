import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import {
  collectionReport,
  arrearsReport,
  type ReportObligation,
  type ReportPayment,
  type CollectionReport,
  type ArrearsRow,
} from './compute';
import {
  financialReport,
  type FinancialReport,
  type FinancialTransaction,
} from './financial';
import {
  cashflowStatement,
  filterExpenses,
  filterRequisitions,
  filterTransactions,
  type CashflowStatement,
  type ReportFilters,
  type RequisitionSpendRow,
} from './cashflow';
import { listExpenses } from '@/lib/departments/queries';
import type { ExpenseRow } from '@/lib/departments/compute';
import { requisitionTotal } from '@/lib/requisitions/compute';

function dayRangeUtc(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+03:00`).toISOString();
  const end = new Date(Date.parse(`${to}T00:00:00+03:00`) + 86_400_000).toISOString();
  return { start, end };
}

export async function getCollectionReport(from: string, to: string): Promise<CollectionReport> {
  const supabase = await createServerSupabase();
  const { start, end } = dayRangeUtc(from, to);

  // Paginated: report math cross-sums whole ranges of history; PostgREST caps
  // any single select at 1000 rows regardless of .limit(), which would silently
  // truncate the report the fleet's owner hands to their accountant.
  const [obs, { data: pays, error: paysErr }] = await Promise.all([
    fetchAllPages<{ due_date: string; amount_due: number; status: string; settled_at: string | null }>(
      (from, to2) =>
        supabase
          .from('payment_obligations')
          .select('due_date, amount_due, status, settled_at')
          .lte('due_date', to)
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to2),
      { label: 'collection report obligations' },
    ),
    supabase.from('payments').select('amount, method, status, completed_at').eq('status', 'completed').gte('completed_at', start).lt('completed_at', end),
  ]);
  if (paysErr) throw new Error(`collection report payments failed: ${paysErr.message}`);

  const obligations: ReportObligation[] = obs.map((o) => ({
    dueDate: o.due_date,
    amountDue: o.amount_due,
    status: o.status,
    settledDate: o.settled_at ? localDateString(new Date(o.settled_at)) : null,
  }));
  const payments: ReportPayment[] = ((pays ?? []) as { amount: number; method: string; status: string; completed_at: string | null }[]).map((p) => ({
    amount: p.amount,
    method: p.method,
    status: p.status,
    // EAT calendar date, not the UTC date: payments settled 00:00–03:00 EAT
    // land on the previous UTC day and would silently drop out of the report.
    completedDate: p.completed_at ? localDateString(new Date(p.completed_at)) : null,
  }));

  return collectionReport(obligations, payments, from, to);
}

export type ArrearsReportRow = ArrearsRow & { riderName: string; riderNumber: string };

export async function getArrearsReport(today = localDateString()): Promise<{ rows: ArrearsReportRow[]; totalAmount: number; totalCount: number }> {
  const supabase = await createServerSupabase();
  const obs = await fetchAllPages<{ rider_id: string; due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      supabase
        .from('payment_obligations')
        .select('rider_id, due_date, amount_due, status')
        .in('status', ['scheduled', 'due', 'overdue'])
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'arrears report obligations' },
  );

  const obligations: ReportObligation[] = obs.map((o) => ({
    riderId: o.rider_id,
    dueDate: o.due_date,
    amountDue: o.amount_due,
    status: o.status,
  }));
  const base = arrearsReport(obligations, today);

  const riderIds = base.rows.map((r) => r.riderId);
  const names = new Map<string, { name: string; number: string }>();
  if (riderIds.length) {
    const { data: riders } = await supabase.from('riders').select('id, first_name, last_name, rider_number').in('id', riderIds);
    for (const r of (riders ?? []) as { id: string; first_name: string; last_name: string; rider_number: string }[]) {
      names.set(r.id, { name: `${r.first_name} ${r.last_name}`, number: r.rider_number });
    }
  }

  return {
    rows: base.rows.map((r) => ({ ...r, riderName: names.get(r.riderId)?.name ?? '—', riderNumber: names.get(r.riderId)?.number ?? '—' })),
    totalAmount: base.totalAmount,
    totalCount: base.totalCount,
  };
}

export type ExpenseReportRow = { date: string; registration: string; category: string; amount: number; note: string | null };

export async function getExpenseReport(from: string, to: string): Promise<{ rows: ExpenseReportRow[]; total: number }> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('motorcycle_expenses')
    .select('expense_date, category, amount, note, motorcycles(registration_number)')
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })
    .limit(5000);
  type Raw = { expense_date: string; category: string; amount: number; note: string | null; motorcycles: { registration_number: string } | null };
  const rows = ((data ?? []) as unknown as Raw[]).map((e) => ({
    date: e.expense_date,
    registration: e.motorcycles?.registration_number ?? '—',
    category: e.category,
    amount: e.amount,
    note: e.note,
  }));
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}

/* =========================================================================
 * General financial report — bank-statement style (client feedback 2026-09-05)
 * ========================================================================= */

/**
 * Every completed payment in the window, with the rider who paid it, the
 * method, and (for cash) the staff member who received it. Paginated: this is
 * the report the owner hands to an accountant, and a silently truncated one is
 * worse than no report at all.
 */
export async function getFinancialReport(from: string, to: string): Promise<FinancialReport> {
  const supabase = await createServerSupabase();
  const { start, end } = dayRangeUtc(from, to);

  const payments = await fetchAllPages<{
    id: string;
    rider_id: string;
    amount: number;
    method: string;
    completed_at: string | null;
    received_by: string | null;
    riders: { first_name: string; last_name: string; rider_number: string } | null;
  }>(
    (a, b) =>
      supabase
        .from('payments')
        .select('id, rider_id, amount, method, completed_at, received_by, riders(first_name, last_name, rider_number)')
        .eq('status', 'completed')
        .gte('completed_at', start)
        .lt('completed_at', end)
        .order('completed_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b) as unknown as PromiseLike<{
        data:
          | {
              id: string;
              rider_id: string;
              amount: number;
              method: string;
              completed_at: string | null;
              received_by: string | null;
              riders: { first_name: string; last_name: string; rider_number: string } | null;
            }[]
          | null;
        error: { message: string } | null;
      }>,
    { label: 'financial report payments' },
  );

  if (payments.length === 0) return financialReport([], from, to);

  const [receipts, staff] = await Promise.all([
    fetchAllPages<{ payment_id: string; receipt_number: string }>(
      (a, b) =>
        supabase
          .from('receipts')
          .select('payment_id, receipt_number')
          .in('payment_id', payments.map((p) => p.id))
          .order('payment_id', { ascending: true })
          .range(a, b),
      { label: 'financial report receipts' },
    ),
    (async () => {
      const ids = [...new Set(payments.map((p) => p.received_by).filter((v): v is string => Boolean(v)))];
      if (ids.length === 0) return new Map<string, string>();
      const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
      return new Map(
        ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
          p.id,
          p.full_name || p.email || 'Staff',
        ]),
      );
    })(),
  ]);
  const receiptByPayment = new Map(receipts.map((r) => [r.payment_id, r.receipt_number]));

  const transactions: FinancialTransaction[] = payments.map((p) => ({
    paymentId: p.id,
    // EAT calendar day, not the UTC day: payments settled 00:00–03:00 EAT land
    // on the previous UTC day and would fall out of the wrong end of a month.
    date: p.completed_at ? localDateString(new Date(p.completed_at)) : from,
    riderId: p.rider_id,
    riderName: p.riders ? `${p.riders.first_name} ${p.riders.last_name}` : '—',
    riderNumber: p.riders?.rider_number ?? '—',
    method: p.method,
    amount: p.amount,
    receivedByName: p.received_by ? (staff.get(p.received_by) ?? null) : null,
    receiptNumber: receiptByPayment.get(p.id) ?? null,
  }));

  return financialReport(transactions, from, to);
}

/* =========================================================================
 * Requisitions, expenses, income and the cashflow statement
 * (client feedback 2026-09-11 #4)
 * ========================================================================= */

/**
 * Every requisition touching the period, with its total recomputed from its
 * lines. There is no total column by design (0028), so the sum is derived here
 * exactly as it is on the screen and in the printed PDF — three readers, one
 * arithmetic.
 *
 * The range is applied to BOTH the request date and the decision date: a
 * request raised in March and approved in April belongs to both months'
 * reports, for different reasons (raised in one, committed in the other), and
 * `requisitionTotals` decides which figure it lands in.
 */
export async function listRequisitionSpend(
  from: string,
  to: string,
): Promise<RequisitionSpendRow[]> {
  const supabase = await createServerSupabase();

  const rows = await fetchAllPages<{
    id: string;
    requisition_number: string;
    title: string;
    request_date: string;
    decided_at: string | null;
    department: string;
    department_id: string | null;
    requisition_type: string;
    status: string;
    payment_status: string;
    retirement_status: string;
    retired_amount: number | null;
    requisition_items: { quantity: number; unit_price: number }[];
  }>(
    (a, b) =>
      supabase
        .from('purchase_requisitions')
        .select(
          'id, requisition_number, title, request_date, decided_at, department, department_id, ' +
            'requisition_type, status, payment_status, retirement_status, retired_amount, ' +
            'requisition_items(quantity, unit_price)',
        )
        // Raised in the window OR decided in it. `or` across two columns is
        // one round trip; filtering in JS afterwards would need every
        // requisition ever raised.
        .or(
          `and(request_date.gte.${from},request_date.lte.${to}),` +
            `and(decided_at.gte.${from}T00:00:00Z,decided_at.lte.${to}T23:59:59Z)`,
        )
        .order('request_date', { ascending: false })
        .order('id', { ascending: true })
        .range(a, b) as unknown as PromiseLike<{
        data: RawRequisitionSpend[] | null;
        error: { message: string } | null;
      }>,
    { label: 'requisition spend' },
  );

  const departmentNames = await departmentNameMap(supabase);

  return rows.map((r) => ({
    id: r.id,
    requisitionNumber: r.requisition_number,
    title: r.title,
    date: r.request_date,
    // A calendar day, read from the instant in EAT so a late-evening approval
    // does not land in the previous day's report.
    decidedDate: r.decided_at ? localDateString(new Date(r.decided_at)) : null,
    departmentId: r.department_id,
    departmentName: r.department_id
      ? (departmentNames.get(r.department_id) ?? r.department)
      : r.department,
    requisitionType: r.requisition_type ?? 'general',
    status: r.status,
    paymentStatus: r.payment_status ?? 'unpaid',
    retirementStatus: r.retirement_status ?? 'not_started',
    total: requisitionTotal(
      (r.requisition_items ?? []).map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unit_price,
      })),
    ),
    retiredAmount: r.retired_amount,
  }));
}

type RawRequisitionSpend = {
  id: string;
  requisition_number: string;
  title: string;
  request_date: string;
  decided_at: string | null;
  department: string;
  department_id: string | null;
  requisition_type: string;
  status: string;
  payment_status: string;
  retirement_status: string;
  retired_amount: number | null;
  requisition_items: { quantity: number; unit_price: number }[];
};

async function departmentNameMap(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<Map<string, string>> {
  const { data } = await supabase.from('departments').select('id, name');
  return new Map(((data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
}

export type CashflowReport = {
  filters: ReportFilters;
  statement: CashflowStatement;
  transactions: FinancialTransaction[];
  expenses: ExpenseRow[];
  requisitions: RequisitionSpendRow[];
  departments: { id: string; name: string }[];
};

/**
 * The statement the brief asks for: income received, expenses made,
 * requisitions made and the net balance, for one period and one filter set.
 *
 * Every filter is applied HERE, to the fetched rows, so the on-screen figures
 * and the exported file are produced by the same code path. A filter that
 * applies on one and not the other is the specific failure this shape exists
 * to prevent.
 */
export async function getCashflowReport(filters: ReportFilters): Promise<CashflowReport> {
  const supabase = await createServerSupabase();
  const range = { from: filters.from, to: filters.to };

  const [financial, allExpenses, allRequisitions, deptRows] = await Promise.all([
    getFinancialReport(filters.from, filters.to),
    listExpenses(range),
    listRequisitionSpend(filters.from, filters.to),
    supabase.from('departments').select('id, name').order('name'),
  ]);

  const departments = ((deptRows.data ?? []) as { id: string; name: string }[]).map((d) => ({
    id: d.id,
    name: d.name,
  }));
  const departmentNames = new Map(departments.map((d) => [d.id, d.name]));

  const transactions = filterTransactions(financial.transactions, filters);
  const expenses = filterExpenses(allExpenses, filters);
  const requisitions = filterRequisitions(allRequisitions, filters);

  return {
    filters,
    statement: cashflowStatement({
      transactions,
      expenses,
      requisitions,
      departmentNames,
      from: filters.from,
      to: filters.to,
    }),
    transactions,
    expenses,
    requisitions,
    departments,
  };
}
