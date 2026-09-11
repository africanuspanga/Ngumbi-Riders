import 'server-only';

import { localDateString } from '@/lib/dates/tz';
import {
  budgetPosition,
  inRange,
  type BudgetPosition,
  type BudgetRow,
  type DateRange,
  type ExpenseRow,
} from './compute';
import { getDepartment, listBudgets, listExpenses, type DepartmentDetailRow } from './queries';

/*
 * One department, in full: its budget allocations, its spend and what is left.
 *
 * Split out of queries.ts so the detail page pulls exactly what it needs. Every
 * figure is derived by compute.ts, as everywhere else in this feature — there is
 * no `spent` column to read and there must not be (D-034 rule 3).
 */
export type DepartmentDetail = {
  department: DepartmentDetailRow;
  range: DateRange;
  position: BudgetPosition;
  budgets: BudgetRow[];
  expenses: ExpenseRow[];
};

export async function getDepartmentDetail(
  departmentId: string,
  range?: Partial<DateRange>,
): Promise<DepartmentDetail | null> {
  const today = localDateString();
  const to = range?.to ?? today;
  const from = range?.from ?? `${to.slice(0, 7)}-01`;
  const resolved: DateRange = { from, to };

  const department = await getDepartment(departmentId);
  if (!department) return null;

  const [budgets, allExpenses] = await Promise.all([
    listBudgets(departmentId),
    listExpenses(resolved),
  ]);
  const expenses = allExpenses.filter(
    (e) => e.departmentId === departmentId && inRange(e.date, resolved),
  );

  return {
    department,
    range: resolved,
    position: budgetPosition(budgets, expenses, resolved),
    budgets,
    expenses,
  };
}
