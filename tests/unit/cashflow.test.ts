import { describe, it, expect } from 'vitest';
import {
  cashflowStatement,
  incomeTotals,
  expenseTotals,
  requisitionTotals,
  monthlyCashflow,
  parseFilters,
  filtersToQuery,
  filterTransactions,
  filterExpenses,
  filterRequisitions,
  emptyFilters,
  type RequisitionSpendRow,
} from '@/lib/reports/cashflow';
import type { FinancialTransaction } from '@/lib/reports/financial';
import type { ExpenseRow } from '@/lib/departments/compute';

const tx = (
  date: string,
  method: 'cash' | 'mobile_money',
  amount: number,
  riderId = 'r1',
): FinancialTransaction => ({
  paymentId: `${date}-${amount}`,
  date,
  riderId,
  riderName: 'Rider',
  riderNumber: 'NGR-R-0001',
  method,
  amount,
  receivedByName: null,
  receiptNumber: null,
});

const exp = (
  date: string,
  amount: number,
  departmentId: string | null = 'd1',
  category = 'fuel',
  source: 'department' | 'motorcycle' = 'department',
): ExpenseRow => ({
  id: `${date}-${amount}-${source}`,
  departmentId,
  date,
  category,
  amount,
  description: 'x',
  source,
});

const req = (over: Partial<RequisitionSpendRow> = {}): RequisitionSpendRow => ({
  id: 'q1',
  requisitionNumber: 'REQ/2026/09/0001',
  title: 'Spares',
  date: '2026-09-02',
  decidedDate: '2026-09-03',
  departmentId: 'd1',
  departmentName: 'Operations',
  requisitionType: 'general',
  status: 'approved',
  paymentStatus: 'unpaid',
  retirementStatus: 'not_started',
  total: 100_000,
  retiredAmount: null,
  ...over,
});

const names = new Map([
  ['d1', 'Operations'],
  ['d2', 'Maintenance'],
]);

describe('incomeTotals', () => {
  it('splits collections by source and counts them', () => {
    const t = incomeTotals(
      [tx('2026-09-01', 'cash', 10_000), tx('2026-09-02', 'mobile_money', 25_000)],
      '2026-09-01',
      '2026-09-30',
    );
    expect(t).toEqual({ cash: 10_000, mobile: 25_000, total: 35_000, count: 2 });
  });

  it('excludes transactions outside the period', () => {
    const t = incomeTotals([tx('2026-08-31', 'cash', 10_000)], '2026-09-01', '2026-09-30');
    expect(t.total).toBe(0);
  });
});

describe('expenseTotals', () => {
  it('groups by department and by category without double counting', () => {
    const rows = [
      exp('2026-09-01', 10_000, 'd1', 'fuel'),
      exp('2026-09-02', 5_000, 'd2', 'repair', 'motorcycle'),
      exp('2026-09-03', 2_000, 'd1', 'repair'),
    ];
    const t = expenseTotals(rows, '2026-09-01', '2026-09-30', names);
    expect(t.total).toBe(17_000);
    expect(t.byDepartment.reduce((s, d) => s + d.amount, 0)).toBe(t.total);
    expect(t.byCategory.reduce((s, c) => s + c.amount, 0)).toBe(t.total);
  });

  it('keeps unassigned spend visible instead of folding it into a department', () => {
    const t = expenseTotals([exp('2026-09-01', 8_000, null)], '2026-09-01', '2026-09-30', names);
    expect(t.byDepartment).toHaveLength(1);
    expect(t.byDepartment[0]!.departmentId).toBeNull();
    expect(t.byDepartment[0]!.name).toBe('Not assigned');
  });
});

describe('requisitionTotals', () => {
  it('counts approvals on the DECISION date, not the request date', () => {
    // Raised in August, approved in September: September's commitment.
    const r = requisitionTotals(
      [req({ date: '2026-08-20', decidedDate: '2026-09-03' })],
      '2026-09-01',
      '2026-09-30',
    );
    expect(r.raisedCount).toBe(0);
    expect(r.approvedCount).toBe(1);
    expect(r.approved).toBe(100_000);
  });

  it('reports approved-but-unpaid as the outstanding commitment', () => {
    const r = requisitionTotals(
      [
        req({ id: 'a', paymentStatus: 'paid', total: 60_000 }),
        req({ id: 'b', paymentStatus: 'unpaid', total: 40_000 }),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    expect(r.approved).toBe(100_000);
    expect(r.paid).toBe(60_000);
    expect(r.commitmentsOutstanding).toBe(40_000);
  });

  it('retires at the actual spend where the accountant restated it', () => {
    const r = requisitionTotals(
      [
        req({
          paymentStatus: 'paid',
          retirementStatus: 'completed',
          total: 100_000,
          retiredAmount: 92_500,
        }),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    expect(r.retired).toBe(92_500);
  });

  it('falls back to the approved total when no actual spend was recorded', () => {
    const r = requisitionTotals(
      [req({ paymentStatus: 'paid', retirementStatus: 'completed', retiredAmount: null })],
      '2026-09-01',
      '2026-09-30',
    );
    expect(r.retired).toBe(100_000);
  });

  it('never counts a rejected request as approved money', () => {
    const r = requisitionTotals(
      [req({ status: 'rejected', decidedDate: '2026-09-05' })],
      '2026-09-01',
      '2026-09-30',
    );
    expect(r.approved).toBe(0);
    expect(r.approvedCount).toBe(0);
  });
});

describe('cashflowStatement', () => {
  const base = {
    transactions: [tx('2026-09-01', 'cash', 100_000), tx('2026-09-02', 'mobile_money', 50_000)],
    expenses: [exp('2026-09-03', 30_000)],
    requisitions: [req({ paymentStatus: 'unpaid', total: 500_000 })],
    departmentNames: names,
    from: '2026-09-01',
    to: '2026-09-30',
  };

  it('nets income against RECORDED EXPENSES only', () => {
    const s = cashflowStatement(base);
    expect(s.income.total).toBe(150_000);
    expect(s.expenses.total).toBe(30_000);
    expect(s.net).toBe(120_000);
  });

  it('EXCLUDES requisitions from the net — they are authorisations, not costs', () => {
    // The half-million approved request must not move the net by one shilling.
    // Counting it here and again when it is retired into an expense would
    // double every purchase the business makes.
    const s = cashflowStatement(base);
    expect(s.requisitions.approved).toBe(500_000);
    expect(s.net).toBe(120_000);
  });

  it('reports a negative net rather than clamping it at zero', () => {
    const s = cashflowStatement({ ...base, expenses: [exp('2026-09-03', 400_000)] });
    expect(s.net).toBe(-250_000);
  });
});

describe('monthlyCashflow', () => {
  it('buckets by calendar month and nets each one', () => {
    const rows = monthlyCashflow(
      [tx('2026-08-15', 'cash', 10_000), tx('2026-09-15', 'cash', 20_000)],
      [exp('2026-09-20', 5_000)],
      '2026-08-01',
      '2026-09-30',
    );
    expect(rows).toEqual([
      { month: '2026-08', income: 10_000, expenses: 0, net: 10_000 },
      { month: '2026-09', income: 20_000, expenses: 5_000, net: 15_000 },
    ]);
  });
});

describe('parseFilters', () => {
  const fallback = { from: '2026-09-01', to: '2026-09-11' };

  it('keeps valid values and drops malformed ones', () => {
    const f = parseFilters(
      {
        from: '2026-09-05',
        to: '2026-09-09',
        department: '11111111-2222-3333-4444-555555555555',
        rider: 'not-a-uuid',
        method: 'cash',
        reqtype: 'phone',
      },
      fallback,
    );
    expect(f.from).toBe('2026-09-05');
    expect(f.departmentId).toBe('11111111-2222-3333-4444-555555555555');
    // A malformed id is dropped, not passed to the database.
    expect(f.riderId).toBeNull();
    expect(f.paymentMethod).toBe('cash');
    expect(f.requisitionType).toBe('phone');
  });

  it('refuses an unknown payment method rather than filtering on nonsense', () => {
    expect(parseFilters({ method: 'bitcoin' }, fallback).paymentMethod).toBeNull();
  });

  it('collapses a reversed range instead of silently returning nothing', () => {
    // from > to would match no rows and read as "there was no activity",
    // which is the most misleading thing a report can say.
    const f = parseFilters({ from: '2026-09-20', to: '2026-09-10' }, fallback);
    expect(f.from).toBe('2026-09-10');
    expect(f.to).toBe('2026-09-10');
  });

  it('round-trips through the query string it produces', () => {
    const f = parseFilters(
      { from: '2026-09-01', to: '2026-09-30', method: 'mobile_money', reqtype: 'motorcycle' },
      fallback,
    );
    const q = filtersToQuery(f);
    const back = parseFilters(
      Object.fromEntries(new URLSearchParams(q.slice(1)).entries()),
      fallback,
    );
    expect(back).toEqual(f);
  });
});

describe('filters', () => {
  const f = { ...emptyFilters('2026-09-01', '2026-09-30'), riderId: 'r2' };

  it('scopes transactions to one rider', () => {
    const rows = filterTransactions(
      [tx('2026-09-01', 'cash', 1, 'r1'), tx('2026-09-01', 'cash', 2, 'r2')],
      f,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(2);
  });

  it('scopes expenses by department and motorcycle independently', () => {
    const byDept = filterExpenses(
      [exp('2026-09-01', 1, 'd1'), exp('2026-09-01', 2, 'd2')],
      { ...emptyFilters('2026-09-01', '2026-09-30'), departmentId: 'd2' },
    );
    expect(byDept).toHaveLength(1);
    expect(byDept[0]!.amount).toBe(2);
  });

  it('scopes requisitions by type', () => {
    const rows = filterRequisitions(
      [req({ id: 'a', requisitionType: 'phone' }), req({ id: 'b', requisitionType: 'motorcycle' })],
      { ...emptyFilters('2026-09-01', '2026-09-30'), requisitionType: 'phone' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('a');
  });
});
