import { describe, it, expect } from 'vitest';
import {
  budgetPosition,
  departmentPositions,
  departmentTotals,
  untagged,
  periodsOverlap,
  inRange,
  suggestDepartmentCode,
  type BudgetRow,
  type DepartmentRow,
  type ExpenseRow,
} from '@/lib/departments/compute';

const dept = (id: string, name = id, isActive = true): DepartmentRow => ({
  id,
  code: id.toUpperCase(),
  name,
  isActive,
});

const budget = (
  departmentId: string,
  amount: number,
  periodStart: string,
  periodEnd: string,
  id = `${departmentId}-${amount}`,
): BudgetRow => ({
  id,
  departmentId,
  label: 'Annual',
  fiscalYear: Number(periodStart.slice(0, 4)),
  periodStart,
  periodEnd,
  amount,
});

const expense = (
  departmentId: string | null,
  amount: number,
  date: string,
  category = 'fuel',
  source: 'department' | 'motorcycle' = 'department',
): ExpenseRow => ({
  id: `${departmentId}-${amount}-${date}-${source}`,
  departmentId,
  date,
  category,
  amount,
  description: 'x',
  source,
});

const SEPT = { from: '2026-09-01', to: '2026-09-30' };

describe('inRange / periodsOverlap', () => {
  it('is inclusive on both ends', () => {
    expect(inRange('2026-09-01', SEPT)).toBe(true);
    expect(inRange('2026-09-30', SEPT)).toBe(true);
    expect(inRange('2026-08-31', SEPT)).toBe(false);
  });

  it('counts a single shared day as an overlap', () => {
    expect(
      periodsOverlap({ from: '2026-09-30', to: '2026-12-31' }, SEPT),
    ).toBe(true);
    expect(
      periodsOverlap({ from: '2026-10-01', to: '2026-12-31' }, SEPT),
    ).toBe(false);
  });
});

describe('budgetPosition', () => {
  it('derives spent, remaining and utilisation — none of them stored', () => {
    const p = budgetPosition(
      [budget('d1', 1_000_000, '2026-01-01', '2026-12-31')],
      [expense('d1', 250_000, '2026-09-10')],
      SEPT,
    );
    expect(p.allocated).toBe(1_000_000);
    expect(p.spent).toBe(250_000);
    expect(p.remaining).toBe(750_000);
    expect(p.utilisation).toBeCloseTo(0.25);
    expect(p.overspent).toBe(false);
  });

  it('sums every allocation whose period overlaps the report range', () => {
    const p = budgetPosition(
      [
        budget('d1', 400_000, '2026-07-01', '2026-09-30', 'q3'),
        budget('d1', 600_000, '2026-10-01', '2026-12-31', 'q4'),
      ],
      [],
      SEPT,
    );
    // Only Q3 overlaps September.
    expect(p.allocated).toBe(400_000);
  });

  it('reports overspend as a NEGATIVE remaining, never clamped to zero', () => {
    const p = budgetPosition(
      [budget('d1', 100_000, '2026-09-01', '2026-09-30')],
      [expense('d1', 130_000, '2026-09-15')],
      SEPT,
    );
    expect(p.remaining).toBe(-30_000);
    expect(p.overspent).toBe(true);
  });

  it('returns null utilisation rather than Infinity when nothing is budgeted', () => {
    // "No budget set" and "spent infinitely more than budget" are different
    // facts, and a dashboard must not render the second for the first.
    const p = budgetPosition([], [expense('d1', 50_000, '2026-09-05')], SEPT);
    expect(p.allocated).toBe(0);
    expect(p.utilisation).toBeNull();
    expect(p.overspent).toBe(false);
    expect(p.remaining).toBe(-50_000);
  });

  it('ignores spend outside the period', () => {
    const p = budgetPosition(
      [budget('d1', 100_000, '2026-01-01', '2026-12-31')],
      [expense('d1', 10_000, '2026-08-31'), expense('d1', 20_000, '2026-09-01')],
      SEPT,
    );
    expect(p.spent).toBe(20_000);
    expect(p.expenseCount).toBe(1);
  });
});

describe('departmentPositions', () => {
  const departments = [dept('d1', 'Operations'), dept('d2', 'Maintenance')];
  const budgets = [
    budget('d1', 500_000, '2026-09-01', '2026-09-30'),
    budget('d2', 300_000, '2026-09-01', '2026-09-30'),
  ];
  const expenses = [
    expense('d1', 100_000, '2026-09-02', 'fuel'),
    expense('d1', 50_000, '2026-09-03', 'repair'),
    // A motorcycle-ledger row tagged to a department counts against it.
    expense('d2', 400_000, '2026-09-04', 'repair', 'motorcycle'),
    expense(null, 75_000, '2026-09-05'),
  ];

  it('counts a tagged motorcycle expense against its department', () => {
    const [maintenance] = departmentPositions(departments, budgets, expenses, SEPT);
    expect(maintenance!.department.name).toBe('Maintenance');
    expect(maintenance!.spent).toBe(400_000);
    expect(maintenance!.overspent).toBe(true);
  });

  it('never counts an expense twice, whichever ledger it came from', () => {
    const positions = departmentPositions(departments, budgets, expenses, SEPT);
    const tagged = positions.reduce((s, p) => s + p.spent, 0);
    // 100k + 50k + 400k assigned; the 75k untagged row is NOT in any department.
    expect(tagged).toBe(550_000);
  });

  it('breaks spend down by category, largest first', () => {
    const positions = departmentPositions(departments, budgets, expenses, SEPT);
    const ops = positions.find((p) => p.department.id === 'd1')!;
    expect(ops.byCategory.map((c) => c.category)).toEqual(['fuel', 'repair']);
    expect(ops.byCategory.reduce((s, c) => s + c.amount, 0)).toBe(ops.spent);
  });

  it('includes inactive departments so their history stays visible', () => {
    const positions = departmentPositions(
      [...departments, dept('d3', 'Old', false)],
      budgets,
      expenses,
      SEPT,
    );
    expect(positions).toHaveLength(3);
  });
});

describe('untagged', () => {
  it('surfaces unassigned spend instead of folding it into a department', () => {
    const rows = untagged(
      [expense('d1', 10_000, '2026-09-01'), expense(null, 75_000, '2026-09-05')],
      SEPT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(75_000);
  });
});

describe('departmentTotals', () => {
  it('separates assigned spend from unassigned, and totals both', () => {
    const departments = [dept('d1')];
    const budgets = [budget('d1', 200_000, '2026-09-01', '2026-09-30')];
    const expenses = [expense('d1', 50_000, '2026-09-02'), expense(null, 30_000, '2026-09-03')];
    const positions = departmentPositions(departments, budgets, expenses, SEPT);
    const t = departmentTotals(positions, untagged(expenses, SEPT));

    expect(t.allocated).toBe(200_000);
    expect(t.spent).toBe(50_000);
    expect(t.untaggedSpend).toBe(30_000);
    expect(t.totalSpend).toBe(80_000);
    // Remaining is against ASSIGNED spend only — untagged money belongs to no
    // budget, so it cannot reduce one.
    expect(t.remaining).toBe(150_000);
  });
});

describe('suggestDepartmentCode', () => {
  it('produces a code the 0030 CHECK constraint accepts', () => {
    const valid = /^[A-Z][A-Z0-9_]{1,31}$/;
    for (const name of [
      'Maintenance',
      'Motorcycle purchasing',
      'Finance & Admin',
      'Idara ya Uendeshaji',
      '2026 projects',
      'a',
    ]) {
      expect(suggestDepartmentCode(name)).toMatch(valid);
    }
  });

  it('prefixes a leading digit so the code still starts with a letter', () => {
    expect(suggestDepartmentCode('2026 projects')).toMatch(/^[A-Z]/);
  });

  it('never returns an empty code', () => {
    expect(suggestDepartmentCode('!!!')).toBe('DEPARTMENT');
    expect(suggestDepartmentCode('')).toBe('DEPARTMENT');
  });

  it('caps the length at what the constraint allows', () => {
    expect(suggestDepartmentCode('a'.repeat(80)).length).toBeLessThanOrEqual(32);
  });
});
