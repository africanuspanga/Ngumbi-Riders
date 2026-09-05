import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages, chunkIds } from '@/lib/supabase/fetch-all';
import { isSnippeConfigured } from '@/lib/snippe/client';
import { localDateString } from '@/lib/dates/tz';
import {
  computeOwnerKpis,
  arrearsAging,
  type KpiObligation,
  type OwnerKpis,
  type AgingBuckets,
} from './kpis';
import { computeContractProgress, type ContractProgress, type ProgressObligation } from '@/lib/contracts/completion';
import {
  computeRiderDashboard,
  riderCalendar,
  type RiderObligation,
  type RiderDashboard,
  type CalendarDay,
} from './rider';

// ---- Owner dashboard -----------------------------------------------------
export type UnpaidRider = { riderId: string; name: string; arrears: number };
export type EndingContract = { id: string; number: string; rider: string; endDate: string };

export type OwnerDashboard = {
  kpis: OwnerKpis;
  aging: AgingBuckets;
  activeRiders: number;
  activeMotorcycles: number;
  unpaidRiders: UnpaidRider[];
  endingContracts: EndingContract[];
  applicationsAwaiting: number;
  highRiskRiders: { id: string; name: string; risk: string }[];
  warnings: string[];
};

const UNPAID = new Set(['scheduled', 'due', 'overdue']);

export async function getOwnerDashboard(): Promise<OwnerDashboard> {
  const supabase = await createServerSupabase();
  const today = localDateString();
  const todayStartUtc = new Date(`${today}T00:00:00+03:00`).toISOString();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00+03:00`) + 86_400_000);
  const tomorrowStartUtc = tomorrow.toISOString();
  const in30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [obRows, payRes, ridersActive, motosActive, endingRes, appsRes, riskRes, pendingRes] =
    await Promise.all([
      // Only rows the KPI math uses: still-unpaid history (arrears/aging) and
      // everything due today. Paginated with a stable order: PostgREST caps
      // ANY single select at 1000 rows regardless of .limit(), and the unpaid
      // backlog alone can exceed that (it did in the pilot) — a capped fetch
      // silently corrupts every number on this dashboard.
      fetchAllPages<{ rider_id: string; due_date: string; amount_due: number; status: string }>(
        (from, to) =>
          supabase
            .from('payment_obligations')
            .select('rider_id, due_date, amount_due, status')
            .lte('due_date', today)
            .or(`status.in.(scheduled,due,overdue),due_date.eq.${today}`)
            .order('due_date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'owner KPI obligations' },
      ),
      supabase
        .from('payments')
        .select('amount, status, method')
        .eq('status', 'completed')
        .gte('completed_at', todayStartUtc)
        .lt('completed_at', tomorrowStartUtc),
      supabase.from('riders').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('motorcycles').select('id', { count: 'exact', head: true }).eq('status', 'assigned'),
      supabase
        .from('contracts')
        .select('id, contract_number, end_date, riders(first_name, last_name)')
        .eq('status', 'active')
        .gte('end_date', today)
        .lte('end_date', in30)
        .order('end_date', { ascending: true }),
      supabase
        .from('rider_applications')
        .select('id', { count: 'exact', head: true })
        .in('status', ['submitted', 'under_review', 'interview', 'verification']),
      supabase
        .from('riders')
        .select('id, first_name, last_name, risk_level')
        .in('risk_level', ['high', 'critical'])
        .limit(20),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);

  const obligations: KpiObligation[] = obRows.map((o) => ({
    riderId: o.rider_id,
    dueDate: o.due_date,
    amountDue: o.amount_due,
    status: o.status,
  }));
  const payments = ((payRes.data ?? []) as { amount: number; status: string; method: string }[]).map(
    (p) => ({ amount: p.amount, status: p.status, method: p.method, completedDate: today }),
  );

  const kpis = computeOwnerKpis(obligations, payments, today);
  const aging = arrearsAging(obligations, today);

  // Unpaid rider arrears rollup.
  const arrearsByRider = new Map<string, number>();
  for (const o of obligations) {
    if (o.dueDate <= today && UNPAID.has(o.status)) {
      arrearsByRider.set(o.riderId, (arrearsByRider.get(o.riderId) ?? 0) + o.amountDue);
    }
  }
  let unpaidRiders: UnpaidRider[] = [];
  if (arrearsByRider.size > 0) {
    const { data: riderRows } = await supabase
      .from('riders')
      .select('id, first_name, last_name')
      .in('id', [...arrearsByRider.keys()]);
    unpaidRiders = ((riderRows ?? []) as { id: string; first_name: string; last_name: string }[])
      .map((r) => ({ riderId: r.id, name: `${r.first_name} ${r.last_name}`, arrears: arrearsByRider.get(r.id) ?? 0 }))
      .sort((a, b) => b.arrears - a.arrears);
  }

  type EndRaw = { id: string; contract_number: string; end_date: string; riders: { first_name: string; last_name: string } | null };
  const endingContracts: EndingContract[] = ((endingRes.data ?? []) as unknown as EndRaw[]).map((c) => ({
    id: c.id,
    number: c.contract_number,
    rider: c.riders ? `${c.riders.first_name} ${c.riders.last_name}` : '—',
    endDate: c.end_date,
  }));

  const warnings: string[] = [];
  if (!isSnippeConfigured()) warnings.push('Snippe is not configured — mobile payments are disabled.');
  const pendingCount = (pendingRes as { count?: number }).count ?? 0;
  if (pendingCount > 0) warnings.push(`${pendingCount} pending payment(s) awaiting confirmation.`);

  return {
    kpis,
    aging,
    activeRiders: (ridersActive as { count?: number }).count ?? 0,
    activeMotorcycles: (motosActive as { count?: number }).count ?? 0,
    unpaidRiders,
    endingContracts,
    applicationsAwaiting: (appsRes as { count?: number }).count ?? 0,
    highRiskRiders: ((riskRes.data ?? []) as { id: string; first_name: string; last_name: string; risk_level: string }[]).map(
      (r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, risk: r.risk_level }),
    ),
    warnings,
  };
}

// ---- Rider dashboard -----------------------------------------------------
export type RiderHome = {
  dashboard: RiderDashboard;
  /** Green/red position + expected completion date (client feedback). */
  progress: ContractProgress;
  /** Phone-loan instalments still owed, when the rider financed a phone. */
  phoneLoan: { outstandingCount: number; outstandingAmount: number; totalCount: number } | null;
  motorcycle: { code: string; registration: string | null; model: string | null } | null;
  recentPayments: { id: string; amount: number; status: string; date: string; method: string }[];
  unreadNotifications: number;
};

export async function getRiderHome(): Promise<RiderHome | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const today = localDateString();

  const { data: rider } = await supabase
    .from('riders')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!rider) return null;
  const riderId = (rider as { id: string }).id;

  const { data: contract } = await supabase
    .from('contracts')
    .select('id')
    .eq('rider_id', riderId)
    .eq('status', 'active')
    .maybeSingle();

  let obligations: RiderObligation[] = [];
  let progressRows: ProgressObligation[] = [];
  let phoneLoan: RiderHome['phoneLoan'] = null;
  if (contract) {
    // Paginated: a full-length daily contract exceeds the 1000-row cap and a
    // truncated set would understate the rider's own arrears/progress.
    const obs = await fetchAllPages<{
      due_date: string;
      amount_due: number;
      status: string;
      kind: string | null;
      settled_at: string | null;
    }>(
      (from, to) =>
        supabase
          .from('payment_obligations')
          .select('due_date, amount_due, status, kind, settled_at')
          .eq('contract_id', (contract as { id: string }).id)
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'rider home obligations' },
    );
    obligations = obs.map((o) => ({ dueDate: o.due_date, amountDue: o.amount_due, status: o.status }));
    progressRows = obs.map((o) => ({
      dueDate: o.due_date,
      amountDue: o.amount_due,
      status: o.status,
      settledDate: o.settled_at ? localDateString(new Date(o.settled_at)) : null,
    }));
    const loanRows = obs.filter((o) => o.kind === 'phone_loan');
    if (loanRows.length > 0) {
      const unpaid = loanRows.filter((o) => ['scheduled', 'due', 'overdue'].includes(o.status));
      phoneLoan = {
        totalCount: loanRows.length,
        outstandingCount: unpaid.length,
        outstandingAmount: unpaid.reduce((sum, o) => sum + o.amount_due, 0),
      };
    }
  }

  const { data: assignment } = await supabase
    .from('motorcycle_assignments')
    .select('motorcycles(motorcycle_number, registration_number, model)')
    .eq('rider_id', riderId)
    .eq('is_active', true)
    .maybeSingle();
  // registration_number is nullable since migration 0021 (the auto-generated
  // motorcycle_number is the primary identifier) — never assume it exists.
  const moto = (assignment as { motorcycles: { motorcycle_number: string; registration_number: string | null; model: string | null } | null } | null)?.motorcycles;

  const { data: pays } = await supabase
    .from('payments')
    .select('id, amount, status, method, completed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: notifs } = await supabase
    .from('notifications')
    .select('id')
    .is('read_at', null);

  return {
    dashboard: computeRiderDashboard(obligations, today),
    progress: computeContractProgress(progressRows, today),
    phoneLoan,
    motorcycle: moto
      ? { code: moto.motorcycle_number, registration: moto.registration_number, model: moto.model }
      : null,
    recentPayments: (
      (pays ?? []) as {
        id: string;
        amount: number;
        status: string;
        method: string;
        completed_at: string | null;
        created_at: string;
      }[]
    ).map(
      // EAT calendar date, not the UTC slice — a payment completed 00:00–03:00
      // EAT would otherwise display the previous day.
      (p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        method: p.method,
        date: localDateString(new Date(p.completed_at ?? p.created_at)),
      }),
    ),
    unreadNotifications: (notifs ?? []).length,
  };
}

export async function getRiderCalendar(): Promise<CalendarDay[]> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: rider } = await supabase.from('riders').select('id').eq('profile_id', user.id).maybeSingle();
  if (!rider) return [];
  const { data: contract } = await supabase
    .from('contracts')
    .select('id')
    .eq('rider_id', (rider as { id: string }).id)
    .eq('status', 'active')
    .maybeSingle();
  if (!contract) return [];
  const obs = await fetchAllPages<{ due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      supabase
        .from('payment_obligations')
        .select('due_date, amount_due, status')
        .eq('contract_id', (contract as { id: string }).id)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'rider calendar' },
  );
  return riderCalendar(obs.map((o) => ({ dueDate: o.due_date, amountDue: o.amount_due, status: o.status })));
}

// ---- Collections chart (owner dashboard) -----------------------------------
export type CollectionsPoint = { date: string; collected: number };

/** Completed payment totals per EAT day for the last `days` days (inclusive
 * of today). Days without payments are zero-filled so the chart axis is
 * continuous. */
export async function getCollectionsSeries(days = 14): Promise<CollectionsPoint[]> {
  const supabase = await createServerSupabase();
  const today = localDateString();
  // Anchor at noon EAT so day arithmetic never crosses a boundary.
  const anchorMs = Date.parse(`${today}T12:00:00+03:00`);
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(localDateString(new Date(anchorMs - i * 86_400_000)));
  }
  const startUtc = new Date(Date.parse(`${dates[0]}T00:00:00+03:00`)).toISOString();

  const data = await fetchAllPages<{ amount: number; completed_at: string | null }>(
    (from, to) =>
      supabase
        .from('payments')
        .select('amount, completed_at')
        .eq('status', 'completed')
        .gte('completed_at', startUtc)
        .order('completed_at', { ascending: true })
        .range(from, to),
    { label: 'collections series' },
  );

  const byDay = new Map<string, number>(dates.map((d) => [d, 0]));
  for (const p of data) {
    if (!p.completed_at) continue;
    const day = localDateString(new Date(p.completed_at));
    if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + p.amount);
  }
  return dates.map((date) => ({ date, collected: byDay.get(date) ?? 0 }));
}

/* =========================================================================
 * Outstanding vs remaining balance, per rider (client feedback 2026-09-05)
 * ========================================================================= */

export type RiderBalancePoint = {
  riderId: string;
  name: string;
  /** GREEN — owed right now (arrears + today). */
  outstandingNow: number;
  /** RED — the rest of the contract, on top of what is owed now. */
  remainingLater: number;
  /** outstandingNow + remainingLater. */
  totalRemaining: number;
};

export type RiderBalances = {
  points: RiderBalancePoint[];
  totalOutstandingNow: number;
  totalRemaining: number;
  riderCount: number;
};

/**
 * Every rider with money still to pay, split into the two figures the Director
 * asked to see as one two-colour bar: what is owed NOW (green) and the whole
 * remaining contract balance (red). Sorted by what is owed now, worst first,
 * because that is the list the owner acts on.
 */
export async function getRiderBalances(limit = 12): Promise<RiderBalances> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const rows = await fetchAllPages<{
    rider_id: string;
    due_date: string;
    amount_due: number;
    status: string;
  }>(
    (from, to) =>
      supabase
        .from('payment_obligations')
        .select('rider_id, due_date, amount_due, status')
        .in('status', ['scheduled', 'due', 'overdue'])
        .order('rider_id', { ascending: true })
        .order('due_date', { ascending: true })
        .range(from, to),
    { label: 'rider balances' },
  );

  const byRider = new Map<string, { now: number; later: number }>();
  for (const o of rows) {
    const cur = byRider.get(o.rider_id) ?? { now: 0, later: 0 };
    if (o.due_date <= today) cur.now += o.amount_due;
    else cur.later += o.amount_due;
    byRider.set(o.rider_id, cur);
  }
  if (byRider.size === 0) {
    return { points: [], totalOutstandingNow: 0, totalRemaining: 0, riderCount: 0 };
  }

  const names = new Map<string, string>();
  const ids = [...byRider.keys()];
  for (const chunk of chunkIds(ids)) {
    const { data } = await supabase
      .from('riders')
      .select('id, first_name, last_name')
      .in('id', chunk);
    for (const r of (data ?? []) as { id: string; first_name: string; last_name: string }[]) {
      names.set(r.id, `${r.first_name} ${r.last_name}`);
    }
  }

  const all: RiderBalancePoint[] = ids.map((id) => {
    const v = byRider.get(id)!;
    return {
      riderId: id,
      name: names.get(id) ?? '—',
      outstandingNow: v.now,
      remainingLater: v.later,
      totalRemaining: v.now + v.later,
    };
  });

  return {
    points: [...all]
      .sort((a, b) => b.outstandingNow - a.outstandingNow || b.totalRemaining - a.totalRemaining)
      .slice(0, limit),
    totalOutstandingNow: all.reduce((s, p) => s + p.outstandingNow, 0),
    totalRemaining: all.reduce((s, p) => s + p.totalRemaining, 0),
    riderCount: all.length,
  };
}
