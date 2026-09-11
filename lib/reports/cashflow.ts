/*
 * Income, expenses, requisitions and the cashflow statement
 * (client feedback 2026-09-11 #4).
 *
 * "The owner should be able to generate a statement for a specific period
 *  showing income received, expenses made, requisitions made, and the net
 *  balance for that period."
 *
 * PURE and dependency-free, so the arithmetic is unit tested once and is
 * identical on the report page and in the CSV/XLSX export.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT MATTERS HERE: A REQUISITION IS NOT AN EXPENSE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It is tempting to put approved purchase requests into the expense column and
 * call the difference "net". That would be wrong twice over:
 *
 *   1. An approved requisition is an AUTHORISATION to spend. The money may not
 *      have moved, may move next month, or may come back unspent.
 *   2. When it IS spent, the accountant retires it and records a department
 *      expense (0030/0033). Counting both would count the same shillings
 *      twice, and the error would grow every month.
 *
 * So `net` is INCOME MINUS RECORDED EXPENSES, full stop. Requisitions are
 * reported alongside as commitments — approved, paid and retired — and are
 * deliberately excluded from the net figure. `commitmentsOutstanding` is the
 * number the Director actually wants from them: approved money that has not
 * yet been spent, i.e. what is still coming out of the balance.
 *
 * Income is rider collections only, exactly as the ledger records them. No
 * requisition, budget or expense row can ever enter it.
 */

import type { FinancialTransaction } from './financial';
import type { ExpenseRow } from '@/lib/departments/compute';

export type RequisitionSpendRow = {
  id: string;
  requisitionNumber: string;
  title: string;
  /** Calendar date of the request. */
  date: string;
  /** Date the Director decided, when they have. */
  decidedDate: string | null;
  departmentId: string | null;
  departmentName: string;
  requisitionType: string;
  status: string;
  paymentStatus: string;
  retirementStatus: string;
  /** Sum of the lines — recomputed, never a stored column (D-034 rule 3). */
  total: number;
  /** What was actually accounted for at retirement, when it has been. */
  retiredAmount: number | null;
};

export type IncomeTotals = {
  cash: number;
  mobile: number;
  total: number;
  count: number;
};

export type ExpenseTotals = {
  total: number;
  count: number;
  byDepartment: { departmentId: string | null; name: string; amount: number; count: number }[];
  byCategory: { category: string; amount: number; count: number }[];
};

export type RequisitionTotals = {
  /** Every request raised in the period, whatever became of it. */
  raised: number;
  raisedCount: number;
  /** Approved by the Director. */
  approved: number;
  approvedCount: number;
  /** Approved AND marked paid. */
  paid: number;
  paidCount: number;
  /** Accounted for after payment. */
  retired: number;
  retiredCount: number;
  /**
   * Approved but not yet paid — money the Director has committed that has not
   * left the account. The figure to subtract from a balance when deciding
   * whether there is room for a new purchase.
   */
  commitmentsOutstanding: number;
  byType: { type: string; amount: number; count: number }[];
};

export type CashflowPeriod = {
  /** YYYY-MM */
  month: string;
  income: number;
  expenses: number;
  net: number;
};

export type CashflowStatement = {
  from: string;
  to: string;
  income: IncomeTotals;
  expenses: ExpenseTotals;
  requisitions: RequisitionTotals;
  /** income.total − expenses.total. Requisitions are NOT in here — see above. */
  net: number;
  byMonth: CashflowPeriod[];
};

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export function incomeTotals(
  transactions: FinancialTransaction[],
  from: string,
  to: string,
): IncomeTotals {
  const rows = transactions.filter((t) => inRange(t.date, from, to));
  const cash = rows.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amount, 0);
  const mobile = rows.filter((t) => t.method !== 'cash').reduce((s, t) => s + t.amount, 0);
  return { cash, mobile, total: cash + mobile, count: rows.length };
}

export function expenseTotals(
  expenses: ExpenseRow[],
  from: string,
  to: string,
  departmentNames: Map<string, string>,
): ExpenseTotals {
  const rows = expenses.filter((e) => inRange(e.date, from, to));

  const byDept = new Map<string, { departmentId: string | null; name: string; amount: number; count: number }>();
  const byCat = new Map<string, { category: string; amount: number; count: number }>();

  for (const e of rows) {
    // A null department is its own bucket, never folded into "Other" — the
    // Director needs to see how much spend is still unclassified.
    const key = e.departmentId ?? '__none__';
    const d =
      byDept.get(key) ??
      {
        departmentId: e.departmentId,
        name: e.departmentId ? (departmentNames.get(e.departmentId) ?? 'Unknown') : 'Not assigned',
        amount: 0,
        count: 0,
      };
    d.amount += e.amount;
    d.count += 1;
    byDept.set(key, d);

    const c = byCat.get(e.category) ?? { category: e.category, amount: 0, count: 0 };
    c.amount += e.amount;
    c.count += 1;
    byCat.set(e.category, c);
  }

  return {
    total: rows.reduce((s, e) => s + e.amount, 0),
    count: rows.length,
    byDepartment: [...byDept.values()].sort((a, b) => b.amount - a.amount),
    byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
  };
}

export function requisitionTotals(
  requisitions: RequisitionSpendRow[],
  from: string,
  to: string,
): RequisitionTotals {
  const raisedRows = requisitions.filter((r) => inRange(r.date, from, to));
  // Approvals are counted on the date they were DECIDED, not raised: a request
  // made in March and approved in April is April's commitment.
  const approvedRows = requisitions.filter(
    (r) => r.status === 'approved' && r.decidedDate && inRange(r.decidedDate, from, to),
  );
  const paidRows = approvedRows.filter((r) => r.paymentStatus === 'paid');
  const retiredRows = approvedRows.filter((r) => r.retirementStatus === 'completed');

  const byType = new Map<string, { type: string; amount: number; count: number }>();
  for (const r of raisedRows) {
    const t = byType.get(r.requisitionType) ?? { type: r.requisitionType, amount: 0, count: 0 };
    t.amount += r.total;
    t.count += 1;
    byType.set(r.requisitionType, t);
  }

  const approved = approvedRows.reduce((s, r) => s + r.total, 0);
  const paid = paidRows.reduce((s, r) => s + r.total, 0);

  return {
    raised: raisedRows.reduce((s, r) => s + r.total, 0),
    raisedCount: raisedRows.length,
    approved,
    approvedCount: approvedRows.length,
    paid,
    paidCount: paidRows.length,
    // The retired figure is what was ACTUALLY spent where that is known, and
    // falls back to the approved total where the accountant did not restate it.
    retired: retiredRows.reduce((s, r) => s + (r.retiredAmount ?? r.total), 0),
    retiredCount: retiredRows.length,
    commitmentsOutstanding: approved - paid,
    byType: [...byType.values()].sort((a, b) => b.amount - a.amount),
  };
}

/** Month-by-month income, expenses and net across the period. */
export function monthlyCashflow(
  transactions: FinancialTransaction[],
  expenses: ExpenseRow[],
  from: string,
  to: string,
): CashflowPeriod[] {
  const months = new Map<string, CashflowPeriod>();
  const touch = (month: string) => {
    const m = months.get(month) ?? { month, income: 0, expenses: 0, net: 0 };
    months.set(month, m);
    return m;
  };

  for (const t of transactions.filter((x) => inRange(x.date, from, to))) {
    touch(t.date.slice(0, 7)).income += t.amount;
  }
  for (const e of expenses.filter((x) => inRange(x.date, from, to))) {
    touch(e.date.slice(0, 7)).expenses += e.amount;
  }

  return [...months.values()]
    .map((m) => ({ ...m, net: m.income - m.expenses }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function cashflowStatement(input: {
  transactions: FinancialTransaction[];
  expenses: ExpenseRow[];
  requisitions: RequisitionSpendRow[];
  departmentNames: Map<string, string>;
  from: string;
  to: string;
}): CashflowStatement {
  const income = incomeTotals(input.transactions, input.from, input.to);
  const expenses = expenseTotals(input.expenses, input.from, input.to, input.departmentNames);
  return {
    from: input.from,
    to: input.to,
    income,
    expenses,
    requisitions: requisitionTotals(input.requisitions, input.from, input.to),
    net: income.total - expenses.total,
    byMonth: monthlyCashflow(input.transactions, input.expenses, input.from, input.to),
  };
}

/* ------------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------------ */

/**
 * The filter set the brief asks for: start date, end date, department, rider,
 * motorcycle, payment type, requisition type. Kept as ONE shape so the page,
 * the query layer and the export URL all speak the same language and a filter
 * cannot silently apply on screen but not in the file the owner downloads.
 */
export type ReportFilters = {
  from: string;
  to: string;
  departmentId: string | null;
  riderId: string | null;
  motorcycleId: string | null;
  /** 'cash' | 'mobile_money' | null (both). */
  paymentMethod: string | null;
  /** lib/requisitions/constants.ts REQUISITION_TYPES, or null for all. */
  requisitionType: string | null;
};

export function emptyFilters(from: string, to: string): ReportFilters {
  return {
    from,
    to,
    departmentId: null,
    riderId: null,
    motorcycleId: null,
    paymentMethod: null,
    requisitionType: null,
  };
}

/** Apply the rider/method filters to collections. */
export function filterTransactions(
  transactions: FinancialTransaction[],
  f: ReportFilters,
): FinancialTransaction[] {
  return transactions.filter(
    (t) =>
      (!f.riderId || t.riderId === f.riderId) &&
      (!f.paymentMethod || t.method === f.paymentMethod),
  );
}

/** Apply the department/motorcycle filters to expenses. */
export function filterExpenses(expenses: ExpenseRow[], f: ReportFilters): ExpenseRow[] {
  return expenses.filter(
    (e) =>
      (!f.departmentId || e.departmentId === f.departmentId) &&
      (!f.motorcycleId || e.motorcycleId === f.motorcycleId),
  );
}

/** Apply the department/type filters to requisitions. */
export function filterRequisitions(
  requisitions: RequisitionSpendRow[],
  f: ReportFilters,
): RequisitionSpendRow[] {
  return requisitions.filter(
    (r) =>
      (!f.departmentId || r.departmentId === f.departmentId) &&
      (!f.requisitionType || r.requisitionType === f.requisitionType),
  );
}

/**
 * Read filters out of a URL query, rejecting anything malformed rather than
 * passing it to the database. A filter that silently does nothing is worse
 * than one that is obviously absent: the owner would export a file believing
 * it was scoped.
 */
export function parseFilters(
  params: Record<string, string | undefined>,
  fallback: { from: string; to: string },
): ReportFilters {
  const isDate = (v: string | undefined): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const isUuid = (v: string | undefined): v is string =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const to = isDate(params.to) ? params.to : fallback.to;
  let from = isDate(params.from) ? params.from : fallback.from;
  // A reversed range returns nothing and looks like "there is no data",
  // which is the single most misleading thing a report can do.
  if (from > to) from = to;

  return {
    from,
    to,
    departmentId: isUuid(params.department) ? params.department : null,
    riderId: isUuid(params.rider) ? params.rider : null,
    motorcycleId: isUuid(params.motorcycle) ? params.motorcycle : null,
    paymentMethod:
      params.method === 'cash' || params.method === 'mobile_money' ? params.method : null,
    requisitionType: params.reqtype?.trim() ? params.reqtype.trim().slice(0, 40) : null,
  };
}

/** The filters as a query string, so a page link and an export link agree. */
export function filtersToQuery(f: ReportFilters): string {
  const p = new URLSearchParams({ from: f.from, to: f.to });
  if (f.departmentId) p.set('department', f.departmentId);
  if (f.riderId) p.set('rider', f.riderId);
  if (f.motorcycleId) p.set('motorcycle', f.motorcycleId);
  if (f.paymentMethod) p.set('method', f.paymentMethod);
  if (f.requisitionType) p.set('reqtype', f.requisitionType);
  return `?${p.toString()}`;
}
