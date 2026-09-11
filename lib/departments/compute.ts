/*
 * Department budget arithmetic (client feedback 2026-09-11 #2).
 *
 * PURE and dependency-free. Nothing in here is ever stored: a budget row holds
 * only what a human allocated, and `spent`, `remaining` and `utilisation` are
 * derived every time they are read (D-034 rule 3). A stored "remaining" column
 * is wrong the first time an expense is corrected, and then the Director is
 * making purchasing decisions against a number no row in the database supports.
 *
 * PERIOD MATCHING is by DATE, not by label. A budget covers [start, end] and an
 * expense counts against it when its date falls inside that window. Nobody has
 * to keep a "Q1" string spelled the same way in two places for the figures to
 * line up.
 *
 * Dates are ISO YYYY-MM-DD strings compared as strings — ISO dates sort
 * lexicographically, and never constructing a Date is what stops a 1 January
 * expense sliding into the previous year (build spec #5).
 */

export type BudgetRow = {
  id: string;
  departmentId: string;
  label: string;
  fiscalYear: number;
  periodStart: string;
  periodEnd: string;
  amount: number;
};

/**
 * One expense, from EITHER ledger. `source` records which table it came from
 * so a reader can always trace a figure back, and so the two can never be
 * summed twice — a row is in exactly one of them.
 */
export type ExpenseRow = {
  id: string;
  departmentId: string | null;
  date: string;
  category: string;
  amount: number;
  description: string;
  source: 'department' | 'motorcycle';
  /** Present on motorcycle-ledger rows. */
  motorcycleId?: string | null;
  motorcycleLabel?: string | null;
  requisitionId?: string | null;
  supplier?: string | null;
};

export type DateRange = { from: string; to: string };

/** Inclusive on both ends. */
export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Two closed intervals share at least one day. */
export function periodsOverlap(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

export type BudgetPosition = {
  /** Total allocated by budgets overlapping the reporting period. */
  allocated: number;
  /** Total spent inside the reporting period. */
  spent: number;
  /** allocated − spent. NEGATIVE means overspent, and is reported as such. */
  remaining: number;
  /** spent / allocated, or null when nothing has been allocated. */
  utilisation: number | null;
  /** True when spend has passed the allocation. */
  overspent: boolean;
  expenseCount: number;
};

export function budgetPosition(
  budgets: BudgetRow[],
  expenses: ExpenseRow[],
  range: DateRange,
): BudgetPosition {
  const allocated = budgets
    .filter((b) => periodsOverlap({ from: b.periodStart, to: b.periodEnd }, range))
    .reduce((s, b) => s + b.amount, 0);
  const matched = expenses.filter((e) => inRange(e.date, range));
  const spent = matched.reduce((s, e) => s + e.amount, 0);

  return {
    allocated,
    spent,
    remaining: allocated - spent,
    // Division by zero is null, not Infinity: "no budget set" and "spent
    // infinitely more than budget" are different facts.
    utilisation: allocated > 0 ? spent / allocated : null,
    overspent: allocated > 0 && spent > allocated,
    expenseCount: matched.length,
  };
}

export type DepartmentRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type DepartmentPosition = BudgetPosition & {
  department: DepartmentRow;
  budgets: BudgetRow[];
  /** Spend split by category, largest first. */
  byCategory: { category: string; amount: number; count: number }[];
};

/**
 * The whole budget picture for a period, one row per department.
 *
 * Expenses with NO department are deliberately not forced into one — they are
 * returned separately by `untagged()` so the Director can see exactly how much
 * of the business's spend is still unclassified rather than having it quietly
 * padded into "Other".
 */
export function departmentPositions(
  departments: DepartmentRow[],
  budgets: BudgetRow[],
  expenses: ExpenseRow[],
  range: DateRange,
): DepartmentPosition[] {
  return departments
    .map((department) => {
      const own = expenses.filter((e) => e.departmentId === department.id);
      const ownBudgets = budgets.filter((b) => b.departmentId === department.id);
      const position = budgetPosition(ownBudgets, own, range);

      const byCategory = new Map<string, { category: string; amount: number; count: number }>();
      for (const e of own.filter((x) => inRange(x.date, range))) {
        const c = byCategory.get(e.category) ?? { category: e.category, amount: 0, count: 0 };
        c.amount += e.amount;
        c.count += 1;
        byCategory.set(e.category, c);
      }

      return {
        department,
        budgets: ownBudgets,
        ...position,
        byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
      };
    })
    .sort((a, b) => b.spent - a.spent || a.department.name.localeCompare(b.department.name));
}

/** Expenses in the period that nobody has assigned to a department. */
export function untagged(expenses: ExpenseRow[], range: DateRange): ExpenseRow[] {
  return expenses
    .filter((e) => !e.departmentId && inRange(e.date, range))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export type DepartmentTotals = {
  allocated: number;
  spent: number;
  remaining: number;
  untaggedSpend: number;
  /** spent + untaggedSpend — every shilling of operating cost in the period. */
  totalSpend: number;
};

export function departmentTotals(
  positions: DepartmentPosition[],
  untaggedRows: ExpenseRow[],
): DepartmentTotals {
  const allocated = positions.reduce((s, p) => s + p.allocated, 0);
  const spent = positions.reduce((s, p) => s + p.spent, 0);
  const untaggedSpend = untaggedRows.reduce((s, e) => s + e.amount, 0);
  return {
    allocated,
    spent,
    remaining: allocated - spent,
    untaggedSpend,
    totalSpend: spent + untaggedSpend,
  };
}

/** Exactly the CHECK constraint in migration 0030, so the two cannot drift. */
const DEPARTMENT_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

/**
 * A budget code from a department name, for the "create department" form.
 * Uppercase, underscore-separated, ASCII only — it has to satisfy the CHECK
 * constraint in 0030, and a code that fails at the database is a worse
 * experience than one corrected as the owner types.
 */
export function suggestDepartmentCode(name: string): string {
  const cleaned = name
    .normalize('NFD')
    // Strip combining marks, so "Idara ya Uendeshaji" and accented input
    // reduce to plain ASCII rather than to characters the constraint rejects.
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // The constraint requires a leading LETTER and 2–32 characters overall.
  const withLetter = /^[A-Z]/.test(cleaned) ? cleaned : `D_${cleaned}`;
  const trimmed = withLetter.slice(0, 32).replace(/_+$/, '');

  // Validate the RESULT, not the intermediate. Testing truthiness here used to
  // let "!!!" through as the single character "D" — truthy, and rejected by the
  // database a moment later, which is the one outcome this function exists to
  // prevent.
  return DEPARTMENT_CODE_RE.test(trimmed) ? trimmed : 'DEPARTMENT';
}
