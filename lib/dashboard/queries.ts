import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { isSnippeConfigured } from '@/lib/snippe/client';
import { localDateString } from '@/lib/dates/tz';
import {
  computeOwnerKpis,
  arrearsAging,
  type KpiObligation,
  type OwnerKpis,
  type AgingBuckets,
} from './kpis';
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

  const [obRes, payRes, ridersActive, motosActive, endingRes, appsRes, riskRes, pendingRes] =
    await Promise.all([
      supabase
        .from('payment_obligations')
        .select('rider_id, due_date, amount_due, status')
        .lte('due_date', today)
        .limit(5000),
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

  const obligations: KpiObligation[] = (
    (obRes.data ?? []) as { rider_id: string; due_date: string; amount_due: number; status: string }[]
  ).map((o) => ({ riderId: o.rider_id, dueDate: o.due_date, amountDue: o.amount_due, status: o.status }));
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
  motorcycle: { registration: string; model: string | null } | null;
  recentPayments: { id: string; amount: number; status: string; date: string }[];
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
  if (contract) {
    const { data: obs } = await supabase
      .from('payment_obligations')
      .select('due_date, amount_due, status')
      .eq('contract_id', (contract as { id: string }).id);
    obligations = ((obs ?? []) as { due_date: string; amount_due: number; status: string }[]).map((o) => ({
      dueDate: o.due_date,
      amountDue: o.amount_due,
      status: o.status,
    }));
  }

  const { data: assignment } = await supabase
    .from('motorcycle_assignments')
    .select('motorcycles(registration_number, model)')
    .eq('rider_id', riderId)
    .eq('is_active', true)
    .maybeSingle();
  const moto = (assignment as { motorcycles: { registration_number: string; model: string | null } | null } | null)?.motorcycles;

  const { data: pays } = await supabase
    .from('payments')
    .select('id, amount, status, completed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: notifs } = await supabase
    .from('notifications')
    .select('id')
    .is('read_at', null);

  return {
    dashboard: computeRiderDashboard(obligations, today),
    motorcycle: moto ? { registration: moto.registration_number, model: moto.model } : null,
    recentPayments: ((pays ?? []) as { id: string; amount: number; status: string; completed_at: string | null; created_at: string }[]).map(
      (p) => ({ id: p.id, amount: p.amount, status: p.status, date: (p.completed_at ?? p.created_at).slice(0, 10) }),
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
  const { data: obs } = await supabase
    .from('payment_obligations')
    .select('due_date, amount_due, status')
    .eq('contract_id', (contract as { id: string }).id)
    .order('due_date', { ascending: true });
  return riderCalendar(
    ((obs ?? []) as { due_date: string; amount_due: number; status: string }[]).map((o) => ({
      dueDate: o.due_date,
      amountDue: o.amount_due,
      status: o.status,
    })),
  );
}
