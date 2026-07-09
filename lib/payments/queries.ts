import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { presetOptions, outstanding, type SelectableObligation, type PaymentOption } from './selection';
import { localDateString } from '@/lib/dates/tz';
import type { PaymentStatus } from '@/lib/supabase/types';

/* Rider-facing pay view (reads own data under RLS). */
export type RiderPayView = {
  hasActiveContract: boolean;
  contractId: string | null;
  phone: string;
  outstandingCount: number;
  arrearsCount: number;
  arrearsAmount: number;
  options: PaymentOption[];
  pendingPaymentId: string | null;
};

export async function getRiderPayView(): Promise<RiderPayView | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rider } = await supabase
    .from('riders')
    .select('id, phone')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!rider) return null;
  const r = rider as { id: string; phone: string };

  const { data: contract } = await supabase
    .from('contracts')
    .select('id')
    .eq('rider_id', r.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!contract) {
    return {
      hasActiveContract: false,
      contractId: null,
      phone: r.phone,
      outstandingCount: 0,
      arrearsCount: 0,
      arrearsAmount: 0,
      options: [],
      pendingPaymentId: null,
    };
  }
  const contractId = (contract as { id: string }).id;

  const { data: obs } = await supabase
    .from('payment_obligations')
    .select('id, due_date, amount_due, status')
    .eq('contract_id', contractId)
    .in('status', ['scheduled', 'due', 'overdue']);
  const obligations: SelectableObligation[] = ((obs ?? []) as { id: string; due_date: string; amount_due: number; status: string }[]).map(
    (o) => ({ id: o.id, dueDate: o.due_date, amountDue: o.amount_due, status: o.status }),
  );

  const today = localDateString();
  const list = outstanding(obligations);
  const arrears = list.filter((o) => o.dueDate < today);

  const { data: pending } = await supabase
    .from('payments')
    .select('id')
    .eq('rider_id', r.id)
    .in('status', ['created', 'pending'])
    .limit(1);

  return {
    hasActiveContract: true,
    contractId,
    phone: r.phone,
    outstandingCount: list.length,
    arrearsCount: arrears.length,
    arrearsAmount: arrears.reduce((s, o) => s + o.amountDue, 0),
    options: presetOptions(obligations, today),
    pendingPaymentId: (pending as { id: string }[] | null)?.[0]?.id ?? null,
  };
}

export type PaymentListItem = {
  id: string;
  amount: number;
  method: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  rider_name?: string;
};

export async function listRiderPayments(): Promise<PaymentListItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('payments')
    .select('id, amount, method, status, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as PaymentListItem[];
}

export type ReceiptView = {
  paymentId: string;
  amount: number;
  method: string;
  status: string;
  completedAt: string | null;
  receiptNumber: string | null;
  verificationCode: string | null;
  coveredDates: string[];
};

export async function getReceiptView(paymentId: string): Promise<ReceiptView | null> {
  const supabase = await createServerSupabase();
  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount, method, status, completed_at')
    .eq('id', paymentId)
    .maybeSingle();
  if (!payment) return null;
  const p = payment as { id: string; amount: number; method: string; status: string; completed_at: string | null };

  const { data: receipt } = await supabase
    .from('receipts')
    .select('receipt_number, verification_code')
    .eq('payment_id', paymentId)
    .maybeSingle();

  const { data: allocations } = await supabase
    .from('payment_allocations')
    .select('obligation_id, payment_obligations(due_date)')
    .eq('payment_id', paymentId);

  type AllocRow = { payment_obligations: { due_date: string } | null };
  const coveredDates = ((allocations ?? []) as unknown as AllocRow[])
    .map((a) => a.payment_obligations?.due_date)
    .filter((d): d is string => Boolean(d))
    .sort();

  const rc = receipt as { receipt_number: string; verification_code: string } | null;
  return {
    paymentId: p.id,
    amount: p.amount,
    method: p.method,
    status: p.status,
    completedAt: p.completed_at,
    receiptNumber: rc?.receipt_number ?? null,
    verificationCode: rc?.verification_code ?? null,
    coveredDates,
  };
}

/* Owner reads. */
const PAYMENT_STATUSES = [
  'created',
  'pending',
  'completed',
  'failed',
  'expired',
  'cancelled',
  'reversed',
] as const;

function asPaymentStatus(value: string): PaymentStatus | null {
  return (PAYMENT_STATUSES as readonly string[]).includes(value) ? (value as PaymentStatus) : null;
}

export async function listAllPayments(status?: string): Promise<PaymentListItem[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('payments')
    .select('id, amount, method, status, created_at, completed_at, riders(first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(300);
  const validStatus = status ? asPaymentStatus(status) : null;
  if (validStatus) q = q.eq('status', validStatus);
  const { data } = await q;
  type Raw = PaymentListItem & { riders: { first_name: string; last_name: string } | null };
  return ((data ?? []) as unknown as Raw[]).map((p) => ({
    ...p,
    rider_name: p.riders ? `${p.riders.first_name} ${p.riders.last_name}` : '—',
  }));
}

export type CashCandidate = {
  riderId: string;
  contractId: string;
  riderName: string;
  obligations: { id: string; dueDate: string; amount: number; status: string }[];
};

/** Riders with an active contract and their outstanding obligations (owner). */
export async function listCashCandidates(): Promise<CashCandidate[]> {
  const supabase = await createServerSupabase();
  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, rider_id, riders(first_name, last_name)')
    .eq('status', 'active');

  type CRow = { id: string; rider_id: string; riders: { first_name: string; last_name: string } | null };
  const rows = (contracts ?? []) as unknown as CRow[];
  if (rows.length === 0) return [];

  const { data: obs } = await supabase
    .from('payment_obligations')
    .select('id, contract_id, due_date, amount_due, status')
    .in('contract_id', rows.map((c) => c.id))
    .in('status', ['scheduled', 'due', 'overdue']);
  const obRows = (obs ?? []) as { id: string; contract_id: string; due_date: string; amount_due: number; status: string }[];

  return rows.map((c) => ({
    riderId: c.rider_id,
    contractId: c.id,
    riderName: c.riders ? `${c.riders.first_name} ${c.riders.last_name}` : '—',
    obligations: obRows
      .filter((o) => o.contract_id === c.id)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))
      .map((o) => ({ id: o.id, dueDate: o.due_date, amount: o.amount_due, status: o.status })),
  }));
}

export async function reconciliationSummary(): Promise<{
  pending: number;
  failed: number;
  completedToday: number;
  stalePending: PaymentListItem[];
}> {
  const supabase = await createServerSupabase();
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString(); // > 1h old
  const [{ data: pend }, { data: fail }, { data: stale }] = await Promise.all([
    supabase.from('payments').select('id', { count: 'exact', head: false }).eq('status', 'pending'),
    supabase.from('payments').select('id', { count: 'exact', head: false }).eq('status', 'failed'),
    supabase
      .from('payments')
      .select('id, amount, method, status, created_at, completed_at')
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .limit(50),
  ]);
  return {
    pending: (pend ?? []).length,
    failed: (fail ?? []).length,
    completedToday: 0,
    stalePending: (stale ?? []) as unknown as PaymentListItem[],
  };
}
