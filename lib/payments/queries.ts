import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { presetOptions, outstanding, type SelectableObligation, type PaymentOption, type PaymentCadence } from './selection';
import { localDateString } from '@/lib/dates/tz';
import type { PaymentStatus } from '@/lib/supabase/types';
import { buildStatement, type Statement } from './statement';
import { computeContractProgress, type ContractProgress } from '@/lib/contracts/completion';

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
    .select('id, schedule_type')
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
  const cadence = (contract as { schedule_type: PaymentCadence }).schedule_type;

  // Ordered + paginated (PostgREST caps any select at 1000 rows): a truncated
  // set would show the rider wrong arrears and mis-price the preset bundles.
  const obs = await fetchAllPages<{ id: string; due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      supabase
        .from('payment_obligations')
        .select('id, due_date, amount_due, status')
        .eq('contract_id', contractId)
        .in('status', ['scheduled', 'due', 'overdue'])
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'rider pay view' },
  );
  const obligations: SelectableObligation[] = obs.map(
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
    options: presetOptions(obligations, today, cadence),
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
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('id, rider_id, riders(first_name, last_name)')
    .eq('status', 'active');
  // Surface the failure instead of silently rendering an empty rider dropdown
  // (indistinguishable from "no active contracts" on a money-recording form).
  if (error) throw new Error(`cash candidates lookup failed: ${error.message}`);

  type CRow = { id: string; rider_id: string; riders: { first_name: string; last_name: string } | null };
  const rows = (contracts ?? []) as unknown as CRow[];
  if (rows.length === 0) return [];

  // Aggregated across ALL active contracts — this crosses the 1000-row cap
  // far sooner than any per-rider query (e.g. 4 riders × 300 remaining days),
  // and a truncated list makes the owner's cash form show wrong obligations.
  const obRows = await fetchAllPages<{ id: string; contract_id: string; due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      supabase
        .from('payment_obligations')
        .select('id, contract_id, due_date, amount_due, status')
        .in('contract_id', rows.map((c) => c.id))
        .in('status', ['scheduled', 'due', 'overdue'])
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'cash candidates' },
  );

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
  // Start of today in EAT (UTC+3) as a UTC instant, for "completed today".
  const dayStart = new Date(`${localDateString()}T00:00:00+03:00`).toISOString();
  // head:true counts — reading rows and taking .length caps at 1000 (failed
  // payments accumulate forever, so that stat would eventually pin at 1000).
  const [pendRes, failRes, doneRes, staleRes] = await Promise.all([
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('completed_at', dayStart),
    supabase
      .from('payments')
      .select('id, amount, method, status, created_at, completed_at')
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(50),
  ]);
  // Reconciliation exists to reveal stuck money — a swallowed error rendering a
  // false "all clear 0/0" is the worst outcome here, so fail loudly instead.
  const err = pendRes.error ?? failRes.error ?? doneRes.error ?? staleRes.error;
  if (err) throw new Error(`reconciliation summary failed: ${err.message}`);
  return {
    pending: pendRes.count ?? 0,
    failed: failRes.count ?? 0,
    completedToday: doneRes.count ?? 0,
    stalePending: (staleRes.data ?? []) as unknown as PaymentListItem[],
  };
}

/* =========================================================================
 * Per-rider payment history + statement (client feedback 2026-09-05)
 * ========================================================================= */

export type RiderPaymentRow = {
  id: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  /** Local (EAT) calendar day the money landed — what a statement shows. */
  completedDate: string | null;
  receiptNumber: string | null;
  /** Staff member who took the cash. Null for mobile money. */
  receivedByName: string | null;
  recordedByName: string | null;
  note: string | null;
  payerPhone: string | null;
  /** Obligation due dates this payment settled. */
  coveredDates: string[];
};

/** Resolve profile ids → display names in one round trip. */
async function profileNames(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
  const out = new Map<string, string>();
  for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    out.set(p.id, p.full_name || p.email || 'Staff');
  }
  return out;
}

/**
 * Every payment a rider has ever made — when, how much, by which method, and
 * for cash, WHO received it. The Director may have two accountants, so the
 * receiver is shown explicitly rather than inferred from who typed it in.
 */
export async function getRiderPaymentHistory(riderId: string): Promise<RiderPaymentRow[]> {
  const supabase = await createServerSupabase();

  const payments = await fetchAllPages<{
    id: string;
    amount: number;
    method: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    received_by: string | null;
    created_by: string | null;
    note: string | null;
    payer_phone: string | null;
  }>(
    (from, to) =>
      supabase
        .from('payments')
        .select('id, amount, method, status, created_at, completed_at, received_by, created_by, note, payer_phone')
        .eq('rider_id', riderId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    { label: 'rider payment history' },
  );
  if (payments.length === 0) return [];

  const ids = payments.map((p) => p.id);
  const [receiptRows, allocRows, names] = await Promise.all([
    fetchAllPages<{ payment_id: string; receipt_number: string }>(
      (from, to) =>
        supabase
          .from('receipts')
          .select('payment_id, receipt_number')
          .in('payment_id', ids)
          .order('payment_id', { ascending: true })
          .range(from, to),
      { label: 'rider payment receipts' },
    ),
    fetchAllPages<{ payment_id: string; payment_obligations: { due_date: string } | null }>(
      (from, to) =>
        supabase
          .from('payment_allocations')
          .select('payment_id, payment_obligations(due_date)')
          .in('payment_id', ids)
          .order('payment_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: { payment_id: string; payment_obligations: { due_date: string } | null }[] | null;
          error: { message: string } | null;
        }>,
      { label: 'rider payment allocations' },
    ),
    profileNames(supabase, payments.flatMap((p) => [p.received_by, p.created_by])),
  ]);

  const receiptByPayment = new Map(receiptRows.map((r) => [r.payment_id, r.receipt_number]));
  const datesByPayment = new Map<string, string[]>();
  for (const a of allocRows) {
    const d = a.payment_obligations?.due_date;
    if (!d) continue;
    const list = datesByPayment.get(a.payment_id) ?? [];
    list.push(d);
    datesByPayment.set(a.payment_id, list);
  }

  return payments.map((p) => ({
    id: p.id,
    amount: p.amount,
    method: p.method,
    status: p.status,
    createdAt: p.created_at,
    completedAt: p.completed_at,
    completedDate: p.completed_at ? localDateString(new Date(p.completed_at)) : null,
    receiptNumber: receiptByPayment.get(p.id) ?? null,
    receivedByName: p.method === 'cash' ? (p.received_by ? (names.get(p.received_by) ?? null) : null) : null,
    recordedByName: p.created_by ? (names.get(p.created_by) ?? null) : null,
    note: p.note,
    payerPhone: p.payer_phone,
    coveredDates: (datesByPayment.get(p.id) ?? []).sort(),
  }));
}

export type RiderStatementView = {
  riderId: string;
  riderName: string;
  riderNumber: string;
  contractNumber: string | null;
  statement: Statement;
  progress: ContractProgress;
  from: string | null;
  to: string | null;
};

/**
 * Bank-statement view for one rider: every charge, every receipt, a running
 * balance, plus the green/red position and the projected completion date.
 */
export async function getRiderStatement(
  riderId: string,
  range?: { from?: string | null; to?: string | null },
): Promise<RiderStatementView | null> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const { data: riderRow } = await supabase
    .from('riders')
    .select('id, first_name, last_name, rider_number')
    .eq('id', riderId)
    .maybeSingle();
  const rider = riderRow as
    | { id: string; first_name: string; last_name: string; rider_number: string }
    | null;
  if (!rider) return null;

  const [obligations, payments, contract] = await Promise.all([
    fetchAllPages<{ due_date: string; amount_due: number; status: string; kind: string | null; settled_at: string | null }>(
      (from, to) =>
        supabase
          .from('payment_obligations')
          .select('due_date, amount_due, status, kind, settled_at')
          .eq('rider_id', riderId)
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'rider statement obligations' },
    ),
    getRiderPaymentHistory(riderId),
    supabase
      .from('contracts')
      .select('contract_number, status, created_at')
      .eq('rider_id', riderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const statement = buildStatement(
    obligations.map((o) => ({
      date: o.due_date,
      amount: o.amount_due,
      status: o.status,
      kind: o.kind ?? 'lease',
    })),
    payments
      .filter((p) => p.status === 'completed' && p.completedDate)
      .map((p) => ({
        date: p.completedDate!,
        amount: p.amount,
        method: p.method,
        paymentId: p.id,
        receiptNumber: p.receiptNumber,
        receivedByName: p.receivedByName,
        note: p.note,
      })),
    range,
  );

  const progress = computeContractProgress(
    obligations.map((o) => ({
      dueDate: o.due_date,
      amountDue: o.amount_due,
      status: o.status,
      settledDate: o.settled_at ? localDateString(new Date(o.settled_at)) : null,
    })),
    today,
  );

  return {
    riderId,
    riderName: `${rider.first_name} ${rider.last_name}`,
    riderNumber: rider.rider_number,
    contractNumber: (contract.data as { contract_number: string } | null)?.contract_number ?? null,
    statement,
    progress,
    from: range?.from ?? null,
    to: range?.to ?? null,
  };
}

/* =========================================================================
 * Cash-approval queue (client feedback 2026-09-05)
 * ========================================================================= */

export type CashRequestRow = {
  id: string;
  riderId: string;
  riderName: string;
  contractId: string;
  amount: number;
  paymentDate: string;
  obligationIds: string[];
  obligationDates: string[];
  note: string | null;
  status: string;
  receivedByName: string;
  requestedByName: string;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  paymentId: string | null;
};

export type CashRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export async function listCashRequests(
  statuses: CashRequestStatus[] = ['pending'],
  limit = 200,
): Promise<CashRequestRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('cash_payment_requests')
    .select(
      'id, rider_id, contract_id, obligation_ids, amount, payment_date, note, status, received_by, requested_by, decided_by, decision_note, created_at, decided_at, payment_id, riders(first_name, last_name)',
    )
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(limit);
  // The approval queue is money waiting for a decision — an error rendering as
  // "nothing to approve" is the worst possible outcome, so fail loudly.
  if (error) throw new Error(`cash request list failed: ${error.message}`);

  type Raw = {
    id: string;
    rider_id: string;
    contract_id: string;
    obligation_ids: string[];
    amount: number;
    payment_date: string;
    note: string | null;
    status: string;
    received_by: string;
    requested_by: string;
    decided_by: string | null;
    decision_note: string | null;
    created_at: string;
    decided_at: string | null;
    payment_id: string | null;
    riders: { first_name: string; last_name: string } | null;
  };
  const rows = (data ?? []) as unknown as Raw[];
  if (rows.length === 0) return [];

  const [names, obligationDates] = await Promise.all([
    profileNames(supabase, rows.flatMap((r) => [r.received_by, r.requested_by, r.decided_by])),
    (async () => {
      const ids = [...new Set(rows.flatMap((r) => r.obligation_ids))];
      if (ids.length === 0) return new Map<string, string>();
      const dates = await fetchAllPages<{ id: string; due_date: string }>(
        (from, to) =>
          supabase
            .from('payment_obligations')
            .select('id, due_date')
            .in('id', ids)
            .order('due_date', { ascending: true })
            .range(from, to),
        { label: 'cash request obligation dates' },
      );
      return new Map(dates.map((d) => [d.id, d.due_date]));
    })(),
  ]);

  return rows.map((r) => ({
    id: r.id,
    riderId: r.rider_id,
    riderName: r.riders ? `${r.riders.first_name} ${r.riders.last_name}` : '—',
    contractId: r.contract_id,
    amount: r.amount,
    paymentDate: r.payment_date,
    obligationIds: r.obligation_ids,
    obligationDates: r.obligation_ids
      .map((id) => obligationDates.get(id))
      .filter((d): d is string => Boolean(d))
      .sort(),
    note: r.note,
    status: r.status,
    receivedByName: names.get(r.received_by) ?? 'Staff',
    requestedByName: names.get(r.requested_by) ?? 'Staff',
    decidedByName: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    paymentId: r.payment_id,
  }));
}

export type StaffReceiver = { id: string; name: string; role: string };

/** Active staff who may be recorded as having received cash. */
export async function listStaffReceivers(): Promise<StaffReceiver[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .in('role', ['owner', 'accountant'])
    .order('role', { ascending: true });
  return ((data ?? []) as { id: string; full_name: string | null; email: string | null; role: string; is_active: boolean | null }[])
    .filter((p) => p.role === 'owner' || p.is_active !== false)
    .map((p) => ({ id: p.id, name: p.full_name || p.email || 'Staff', role: p.role }));
}

/** Obligations already claimed by a pending request, so the form can hide them. */
export async function pendingRequestObligationIds(): Promise<Set<string>> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('cash_payment_requests')
    .select('obligation_ids')
    .eq('status', 'pending');
  const out = new Set<string>();
  for (const r of (data ?? []) as { obligation_ids: string[] }[]) {
    for (const id of r.obligation_ids) out.add(id);
  }
  return out;
}
