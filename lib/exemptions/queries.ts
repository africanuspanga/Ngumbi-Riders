import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';

export type ExemptionRow = {
  id: string;
  reason: string;
  status: string;
  postponed_to_date: string | null;
  decided_at: string | null;
  created_at: string;
  due_date: string | null;
  rider_name?: string;
};

type Raw = {
  id: string;
  reason: string;
  status: string;
  postponed_to_date: string | null;
  decided_at: string | null;
  created_at: string;
  payment_obligations: { due_date: string } | null;
  riders: { first_name: string; last_name: string } | null;
};

export async function listRiderExemptions(): Promise<ExemptionRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('exemption_requests')
    .select('id, reason, status, postponed_to_date, decided_at, created_at, payment_obligations(due_date)')
    .order('created_at', { ascending: false })
    .limit(100);
  return ((data ?? []) as unknown as Raw[]).map((e) => ({
    id: e.id,
    reason: e.reason,
    status: e.status,
    postponed_to_date: e.postponed_to_date,
    decided_at: e.decided_at,
    created_at: e.created_at,
    due_date: e.payment_obligations?.due_date ?? null,
  }));
}

export async function listOwnerExemptions(): Promise<ExemptionRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('exemption_requests')
    .select('id, reason, status, postponed_to_date, decided_at, created_at, payment_obligations(due_date), riders(first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(300);
  return ((data ?? []) as unknown as Raw[]).map((e) => ({
    id: e.id,
    reason: e.reason,
    status: e.status,
    postponed_to_date: e.postponed_to_date,
    decided_at: e.decided_at,
    created_at: e.created_at,
    due_date: e.payment_obligations?.due_date ?? null,
    rider_name: e.riders ? `${e.riders.first_name} ${e.riders.last_name}` : '—',
  }));
}

/** Rider's outstanding obligations available to request an exemption for. */
export async function listRiderOutstandingForExemption(): Promise<{ id: string; dueDate: string; amount: number }[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('payment_obligations')
    .select('id, due_date, amount_due, status')
    .in('status', ['scheduled', 'due', 'overdue'])
    .order('due_date', { ascending: true })
    .limit(100);
  return ((data ?? []) as { id: string; due_date: string; amount_due: number }[]).map((o) => ({
    id: o.id,
    dueDate: o.due_date,
    amount: o.amount_due,
  }));
}
