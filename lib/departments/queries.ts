import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import {
  departmentPositions,
  departmentTotals,
  untagged,
  type BudgetRow,
  type DateRange,
  type DepartmentPosition,
  type DepartmentRow,
  type DepartmentTotals,
  type ExpenseRow,
} from './compute';

/*
 * Department reads. Both back-office roles see the same shapes under the 0030
 * staff-read policies. Every figure on the way out is DERIVED by
 * lib/departments/compute.ts — this module's only job is to fetch the rows.
 *
 * The two expense ledgers are unioned here, once, so no caller has to remember
 * that motorcycle spend also counts against a department (and no caller can
 * accidentally add them twice — a row lives in exactly one table).
 */

export async function listDepartments(
  opts: { includeInactive?: boolean } = {},
): Promise<DepartmentRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from('departments').select('id, code, name, is_active').order('name');
  if (!opts.includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(`listDepartments failed: ${error.message}`);
  return ((data ?? []) as { id: string; code: string; name: string; is_active: boolean }[]).map(
    (d) => ({ id: d.id, code: d.code, name: d.name, isActive: d.is_active }),
  );
}

export type DepartmentDetailRow = DepartmentRow & {
  description: string | null;
  createdAt: string;
};

export async function getDepartment(id: string): Promise<DepartmentDetailRow | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('departments')
    .select('id, code, name, description, is_active, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getDepartment failed: ${error.message}`);
  const d = data as
    | {
        id: string;
        code: string;
        name: string;
        description: string | null;
        is_active: boolean;
        created_at: string;
      }
    | null;
  if (!d) return null;
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    description: d.description,
    isActive: d.is_active,
    createdAt: d.created_at,
  };
}

export async function listBudgets(departmentId?: string): Promise<BudgetRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('department_budgets')
    .select('id, department_id, label, fiscal_year, period_start, period_end, amount')
    .order('period_start', { ascending: false });
  if (departmentId) q = q.eq('department_id', departmentId);
  const { data, error } = await q;
  if (error) throw new Error(`listBudgets failed: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    department_id: string;
    label: string;
    fiscal_year: number;
    period_start: string;
    period_end: string;
    amount: number;
  }[]).map((b) => ({
    id: b.id,
    departmentId: b.department_id,
    label: b.label,
    fiscalYear: b.fiscal_year,
    periodStart: b.period_start,
    periodEnd: b.period_end,
    amount: b.amount,
  }));
}

/**
 * Every operating expense in a date range, from BOTH ledgers, as one list.
 *
 * Paginated: expense rows grow with fleet × time, and a capped fetch would
 * silently understate what the business has spent — the failure mode D-033 was
 * written about. A wider range is always fetched than the caller asked for
 * where the caller wants budget matching, so the range is passed through
 * explicitly rather than guessed.
 */
export async function listExpenses(range: DateRange): Promise<ExpenseRow[]> {
  const supabase = await createServerSupabase();

  const [deptRows, motoRows] = await Promise.all([
    fetchAllPages<{
      id: string;
      department_id: string;
      expense_date: string;
      category: string;
      amount: number;
      description: string;
      supplier: string | null;
      requisition_id: string | null;
    }>(
      (from, to) =>
        supabase
          .from('department_expenses')
          .select(
            'id, department_id, expense_date, category, amount, description, supplier, requisition_id',
          )
          .gte('expense_date', range.from)
          .lte('expense_date', range.to)
          .order('expense_date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'department expenses' },
    ),
    fetchAllPages<{
      id: string;
      department_id: string | null;
      motorcycle_id: string;
      expense_date: string;
      category: string;
      amount: number;
      note: string | null;
      motorcycles: { motorcycle_number: string | null; registration_number: string | null } | null;
    }>(
      (from, to) =>
        supabase
          .from('motorcycle_expenses')
          .select(
            'id, department_id, motorcycle_id, expense_date, category, amount, note, motorcycles(motorcycle_number, registration_number)',
          )
          .gte('expense_date', range.from)
          .lte('expense_date', range.to)
          .order('expense_date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'motorcycle expenses' },
    ),
  ]);

  const fromDept: ExpenseRow[] = deptRows.map((e) => ({
    id: e.id,
    departmentId: e.department_id,
    date: e.expense_date,
    category: e.category,
    amount: e.amount,
    description: e.description,
    source: 'department',
    supplier: e.supplier,
    requisitionId: e.requisition_id,
  }));

  const fromMoto: ExpenseRow[] = motoRows.map((e) => {
    const label =
      e.motorcycles?.motorcycle_number || e.motorcycles?.registration_number || 'Motorcycle';
    return {
      id: e.id,
      departmentId: e.department_id,
      date: e.expense_date,
      category: e.category,
      amount: e.amount,
      // A motorcycle expense's note is optional; the motorcycle itself is the
      // meaningful description when there is no note.
      description: e.note?.trim() || label,
      source: 'motorcycle',
      motorcycleId: e.motorcycle_id,
      motorcycleLabel: label,
    };
  });

  return [...fromDept, ...fromMoto].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1,
  );
}

export type DepartmentOverview = {
  range: DateRange;
  positions: DepartmentPosition[];
  untagged: ExpenseRow[];
  totals: DepartmentTotals;
};

/**
 * The budget board: every department, its allocation, its spend and what is
 * left, for one period.
 */
export async function getDepartmentOverview(range?: Partial<DateRange>): Promise<DepartmentOverview> {
  const today = localDateString();
  const to = range?.to ?? today;
  const from = range?.from ?? `${to.slice(0, 7)}-01`;
  const resolved: DateRange = { from, to };

  const [departments, budgets, expenses] = await Promise.all([
    listDepartments({ includeInactive: true }),
    listBudgets(),
    listExpenses(resolved),
  ]);

  const positions = departmentPositions(departments, budgets, expenses, resolved);
  const loose = untagged(expenses, resolved);

  return {
    range: resolved,
    positions,
    untagged: loose,
    totals: departmentTotals(positions, loose),
  };
}
