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
