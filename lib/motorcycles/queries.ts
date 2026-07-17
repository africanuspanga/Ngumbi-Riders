import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type { MotorcycleStatus } from '@/lib/supabase/types';

/* Owner-side motorcycle reads (RLS confirms owner). */

export type MotorcycleListItem = {
  id: string;
  motorcycle_number: string;
  registration_number: string | null;
  make: string | null;
  model: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  colour: string | null;
  region: string | null;
  district: string | null;
  status: MotorcycleStatus;
};

/** Display label for a motorcycle — the code is the primary id; registration
 *  (which may not be issued yet) is shown alongside when present. */
export function motorcycleLabel(m: { motorcycle_number: string; registration_number: string | null }): string {
  return m.registration_number ? `${m.motorcycle_number} · ${m.registration_number}` : m.motorcycle_number;
}

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
  collected: number;
  cashOperatingMargin: number;
};

export async function listMotorcycles(
  status?: MotorcycleStatus,
): Promise<MotorcycleListItem[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('motorcycles')
    .select('id, motorcycle_number, registration_number, make, model, chassis_number, engine_number, colour, region, district, status')
    .order('motorcycle_number', { ascending: true })
    .limit(500);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return (data ?? []) as unknown as MotorcycleListItem[];
}

export async function listAvailableMotorcycles(): Promise<MotorcycleListItem[]> {
  return listMotorcycles('available');
}

export type ContractableMotorcycle = {
  id: string;
  label: string;
  // Set when the bike is already assigned to a rider (via the standalone
  // "Assign motorcycle" flow) but has no live contract yet. Such a bike is
  // leasable — but only to the rider it is already assigned to. Available
  // (unassigned) bikes have this null.
  assignedRiderId: string | null;
  assignedRiderLabel: string | null;
};

/**
 * Motorcycles that a new contract may be written for: unassigned `available`
 * bikes, plus `assigned` bikes that are not yet under any live (draft/active/
 * paused) contract. An assigned bike is only offered for the rider it is
 * assigned to (enforced in the builder UI and re-checked in createContract).
 *
 * This closes the workflow trap where assigning a bike to a rider first (which
 * flips its status to `assigned`) made it impossible to then write that rider's
 * contract, since the builder previously listed `available` bikes only.
 */
export async function listContractableMotorcycles(): Promise<ContractableMotorcycle[]> {
  const supabase = await createServerSupabase();

  const { data: motos } = await supabase
    .from('motorcycles')
    .select('id, motorcycle_number, registration_number, status')
    .in('status', ['available', 'assigned'])
    .order('motorcycle_number', { ascending: true })
    .limit(500);
  const list = (motos ?? []) as {
    id: string;
    motorcycle_number: string;
    registration_number: string | null;
    status: MotorcycleStatus;
  }[];
  if (list.length === 0) return [];
  const ids = list.map((m) => m.id);

  // Exclude bikes already tied to a live contract (never double-book).
  const { data: liveContracts } = await supabase
    .from('contracts')
    .select('motorcycle_id')
    .in('motorcycle_id', ids)
    .in('status', ['draft', 'active', 'paused']);
  const contracted = new Set(
    ((liveContracts ?? []) as { motorcycle_id: string }[]).map((c) => c.motorcycle_id),
  );

  // Active assignment → the rider a bike is currently assigned to.
  const { data: assigns } = await supabase
    .from('motorcycle_assignments')
    .select('motorcycle_id, rider_id, riders(first_name, last_name, rider_number)')
    .in('motorcycle_id', ids)
    .eq('is_active', true);
  type RawAssign = {
    motorcycle_id: string;
    rider_id: string;
    riders: { first_name: string; last_name: string; rider_number: string } | null;
  };
  const assignMap = new Map<string, { riderId: string; label: string }>();
  for (const a of (assigns ?? []) as unknown as RawAssign[]) {
    assignMap.set(a.motorcycle_id, {
      riderId: a.rider_id,
      label: a.riders
        ? `${a.riders.first_name} ${a.riders.last_name} (${a.riders.rider_number})`
        : '—',
    });
  }

  return list
    .filter((m) => !contracted.has(m.id))
    .map((m) => {
      const a = assignMap.get(m.id) ?? null;
      return {
        id: m.id,
        label: motorcycleLabel(m),
        assignedRiderId: a?.riderId ?? null,
        assignedRiderLabel: a?.label ?? null,
      };
    });
}

export async function getMotorcycle(
  id: string,
): Promise<MotorcycleDetail | null> {
  const supabase = await createServerSupabase();
  const { data: m } = await supabase
    .from('motorcycles')
    .select('id, motorcycle_number, registration_number, make, model, chassis_number, engine_number, colour, region, district, status')
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

  // Collected revenue for this motorcycle = settled obligation value (§3.6).
  const { data: settledObs } = await supabase
    .from('payment_obligations')
    .select('amount_due')
    .eq('motorcycle_id', id)
    .in('status', ['paid', 'paid_in_advance']);
  const collected = ((settledObs ?? []) as { amount_due: number }[]).reduce((s, o) => s + o.amount_due, 0);

  return {
    ...(m as unknown as MotorcycleListItem),
    assignments: assignmentRows,
    expenses: expenseRows,
    totalExpenses,
    collected,
    cashOperatingMargin: collected - totalExpenses,
  };
}
