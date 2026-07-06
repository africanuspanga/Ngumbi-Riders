import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type { MotorcycleStatus } from '@/lib/supabase/types';

/* Owner-side motorcycle reads (RLS confirms owner). */

export type MotorcycleListItem = {
  id: string;
  motorcycle_number: string;
  registration_number: string;
  make: string | null;
  model: string | null;
  status: MotorcycleStatus;
};

export type AssignmentHistoryRow = {
  id: string;
  rider_id: string;
  is_active: boolean;
  start_date: string;
  end_date: string | null;
  transfer_reason: string | null;
  rider_name: string;
  rider_number: string;
};

export type ExpenseRow = {
  id: string;
  expense_date: string;
  category: string;
  amount: number;
  note: string | null;
};

export type MotorcycleDetail = MotorcycleListItem & {
  assignments: AssignmentHistoryRow[];
  expenses: ExpenseRow[];
  totalExpenses: number;
};

export async function listMotorcycles(
  status?: MotorcycleStatus,
): Promise<MotorcycleListItem[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('motorcycles')
    .select('id, motorcycle_number, registration_number, make, model, status')
    .order('motorcycle_number', { ascending: true })
    .limit(500);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return (data ?? []) as unknown as MotorcycleListItem[];
}

export async function listAvailableMotorcycles(): Promise<MotorcycleListItem[]> {
  return listMotorcycles('available');
}

export async function getMotorcycle(
  id: string,
): Promise<MotorcycleDetail | null> {
  const supabase = await createServerSupabase();
  const { data: m } = await supabase
    .from('motorcycles')
    .select('id, motorcycle_number, registration_number, make, model, status')
    .eq('id', id)
    .maybeSingle();
  if (!m) return null;

  const { data: assignments } = await supabase
    .from('motorcycle_assignments')
    .select('id, rider_id, is_active, start_date, end_date, transfer_reason, riders(first_name, last_name, rider_number)')
    .eq('motorcycle_id', id)
    .order('start_date', { ascending: false });

  const { data: expenses } = await supabase
    .from('motorcycle_expenses')
    .select('id, expense_date, category, amount, note')
    .eq('motorcycle_id', id)
    .order('expense_date', { ascending: false });

  type RawAssignment = {
    id: string;
    rider_id: string;
    is_active: boolean;
    start_date: string;
    end_date: string | null;
    transfer_reason: string | null;
    riders: { first_name: string; last_name: string; rider_number: string } | null;
  };

  const assignmentRows: AssignmentHistoryRow[] = (
    (assignments ?? []) as unknown as RawAssignment[]
  ).map((a) => ({
    id: a.id,
    rider_id: a.rider_id,
    is_active: a.is_active,
    start_date: a.start_date,
    end_date: a.end_date,
    transfer_reason: a.transfer_reason,
    rider_name: a.riders
      ? `${a.riders.first_name} ${a.riders.last_name}`
      : '—',
    rider_number: a.riders?.rider_number ?? '—',
  }));

  const expenseRows = (expenses ?? []) as unknown as ExpenseRow[];
  const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0);

  return {
    ...(m as unknown as MotorcycleListItem),
    assignments: assignmentRows,
    expenses: expenseRows,
    totalExpenses,
  };
}
