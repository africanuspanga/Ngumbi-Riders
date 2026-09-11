import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages, chunkIds } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import {
  phoneLoanPortfolio,
  repaymentFocus,
  type LoanObligation,
  type PhoneLoanPortfolio,
  type PortfolioLoan,
  type RepaymentFocus,
} from './portfolio';
import { FALLBACK_LIMITS, isOpenRequest, type PhoneLoanRequestStatus } from './constants';
import { splitLoanTotal } from './phone';

/*
 * Phone-loan reads. Staff see everything under the 0031 staff policy; a rider
 * sees their own row under the self policy, so the same functions serve both
 * and RLS — not a parameter — decides what comes back.
 */

export type PhoneLoanLimits = {
  maxAmount: number;
  maxMonths: number;
  interestBps: number;
};

/**
 * The commercial limits shown to the rider BEFORE they submit. Read from
 * app_settings so the Director can change "TZS 350,000 / 3 months" without a
 * deployment — the brief says "for now", which is a promise that they will.
 *
 * Falls back to the documented defaults rather than throwing: a settings read
 * failing must not stop a rider seeing the terms, and the defaults are the
 * same numbers the column defaults hold.
 */
export async function getPhoneLoanLimits(): Promise<PhoneLoanLimits> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('app_settings')
    .select('phone_loan_max_amount, phone_loan_max_months, phone_loan_interest_bps')
    .maybeSingle();
  const s = data as
    | {
        phone_loan_max_amount: number | null;
        phone_loan_max_months: number | null;
        phone_loan_interest_bps: number | null;
      }
    | null;
  return {
    maxAmount: s?.phone_loan_max_amount ?? FALLBACK_LIMITS.maxAmount,
    maxMonths: s?.phone_loan_max_months ?? FALLBACK_LIMITS.maxMonths,
    interestBps: s?.phone_loan_interest_bps ?? FALLBACK_LIMITS.interestBps,
  };
}

export type PhoneLoanRequestRow = {
  id: string;
  riderId: string;
  riderName: string;
  riderNumber: string;
  riderPhone: string | null;
  contractId: string | null;
  contractNumber: string | null;
  principal: number;
  termMonths: number;
  interestBps: number;
  interestAmount: number;
  totalAmount: number;
  /** The agreed monthly instalments, re-split from the stored total. */
  instalments: number[];
  deviceDescription: string | null;
  reason: string | null;
  status: PhoneLoanRequestStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  requisitionId: string | null;
  requisitionNumber: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  phoneLoanId: string | null;
  createdAt: string;
};

const REQUEST_SELECT =
  'id, rider_id, contract_id, principal, term_months, interest_bps, interest_amount, ' +
  'total_amount, device_description, reason, status, reviewed_by, reviewed_at, review_note, ' +
  'requisition_id, decided_by, decided_at, decision_note, phone_loan_id, created_at, ' +
  'riders(first_name, last_name, rider_number, phone), contracts(contract_number), ' +
  /* Named for the same reason as in lib/completion/queries.ts: 0033 added
     purchase_requisitions.phone_loan_request_id, so there are now two
     relationships between these tables and an unqualified embed is ambiguous. */
  'purchase_requisitions!phone_loan_requests_requisition_id_fkey(requisition_number)';

type RawRequest = {
  id: string;
  rider_id: string;
  contract_id: string | null;
  principal: number;
  term_months: number;
  interest_bps: number;
  interest_amount: number;
  total_amount: number;
  device_description: string | null;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  requisition_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  phone_loan_id: string | null;
  created_at: string;
  riders: {
    first_name: string;
    last_name: string;
    rider_number: string;
    phone: string | null;
  } | null;
  contracts: { contract_number: string } | null;
  purchase_requisitions: { requisition_number: string } | null;
};

async function profileNames(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name || p.email || 'Staff',
    ]),
  );
}

function toRequest(raw: RawRequest, names: Map<string, string>): PhoneLoanRequestRow {
  return {
    id: raw.id,
    riderId: raw.rider_id,
    riderName: raw.riders ? `${raw.riders.first_name} ${raw.riders.last_name}` : 'Rider',
    riderNumber: raw.riders?.rider_number ?? '—',
    riderPhone: raw.riders?.phone ?? null,
    contractId: raw.contract_id,
    contractNumber: raw.contracts?.contract_number ?? null,
    principal: raw.principal,
    termMonths: raw.term_months,
    interestBps: raw.interest_bps,
    interestAmount: raw.interest_amount,
    totalAmount: raw.total_amount,
    // Re-split rather than stored: the schedule generated at activation must
    // be the one the rider was quoted, and splitLoanTotal is the single
    // function that decides where the rounding remainder goes.
    instalments: splitLoanTotal(raw.total_amount, raw.term_months),
    deviceDescription: raw.device_description,
    reason: raw.reason,
    status: raw.status as PhoneLoanRequestStatus,
    reviewedByName: raw.reviewed_by ? (names.get(raw.reviewed_by) ?? null) : null,
    reviewedAt: raw.reviewed_at,
    reviewNote: raw.review_note,
    requisitionId: raw.requisition_id,
    requisitionNumber: raw.purchase_requisitions?.requisition_number ?? null,
    decidedByName: raw.decided_by ? (names.get(raw.decided_by) ?? null) : null,
    decidedAt: raw.decided_at,
    decisionNote: raw.decision_note,
    phoneLoanId: raw.phone_loan_id,
    createdAt: raw.created_at,
  };
}

export async function listPhoneLoanRequests(
  opts: { statuses?: readonly PhoneLoanRequestStatus[]; riderId?: string; limit?: number } = {},
): Promise<PhoneLoanRequestRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('phone_loan_requests')
    .select(REQUEST_SELECT)
    .order('created_at', { ascending: false });
  if (opts.statuses?.length) q = q.in('status', [...opts.statuses]);
  if (opts.riderId) q = q.eq('rider_id', opts.riderId);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`listPhoneLoanRequests failed: ${error.message}`);
  const rows = (data ?? []) as unknown as RawRequest[];
  const names = await profileNames(supabase, rows.flatMap((r) => [r.reviewed_by, r.decided_by]));
  return rows.map((r) => toRequest(r, names));
}

export async function getPhoneLoanRequest(id: string): Promise<PhoneLoanRequestRow | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('phone_loan_requests')
    .select(REQUEST_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getPhoneLoanRequest failed: ${error.message}`);
  if (!data) return null;
  const raw = data as unknown as RawRequest;
  const names = await profileNames(supabase, [raw.reviewed_by, raw.decided_by]);
  return toRequest(raw, names);
}

/* ------------------------------------------------------------------------ *
 * Portfolio (the dashboard section)
 * ------------------------------------------------------------------------ */

export async function getPhoneLoanPortfolio(): Promise<PhoneLoanPortfolio> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const { data: loanRows, error } = await supabase
    .from('phone_loans')
    .select(
      'id, rider_id, contract_id, principal, interest_amount, total_amount, term_months, ' +
        'status, activated_at, completed_at, riders(first_name, last_name)',
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getPhoneLoanPortfolio failed: ${error.message}`);

  type RawLoan = {
    id: string;
    rider_id: string;
    contract_id: string | null;
    principal: number;
    interest_amount: number;
    total_amount: number;
    term_months: number;
    status: string;
    activated_at: string | null;
    completed_at: string | null;
    riders: { first_name: string; last_name: string } | null;
  };
  const raw = (loanRows ?? []) as unknown as RawLoan[];
  if (raw.length === 0) return phoneLoanPortfolio([], [], today);

  // Which loans are currently pausing a lease. Read from the CONTRACT, which
  // is where the pause actually lives — inferring it from the loan's status
  // would report a pause that had already been lifted.
  const { data: pausedRows } = await supabase
    .from('contracts')
    .select('lease_paused_for_loan_id')
    .not('lease_paused_for_loan_id', 'is', null);
  const pausing = new Set(
    ((pausedRows ?? []) as { lease_paused_for_loan_id: string | null }[])
      .map((c) => c.lease_paused_for_loan_id)
      .filter((v): v is string => Boolean(v)),
  );

  const loans: PortfolioLoan[] = raw.map((l) => ({
    id: l.id,
    riderId: l.rider_id,
    riderName: l.riders ? `${l.riders.first_name} ${l.riders.last_name}` : 'Rider',
    contractId: l.contract_id,
    principal: l.principal,
    interestAmount: l.interest_amount,
    totalAmount: l.total_amount,
    termMonths: l.term_months,
    status: l.status,
    activatedAt: l.activated_at,
    completedAt: l.completed_at,
    pausingLease: pausing.has(l.id),
  }));

  // Phone instalments across every loan. Chunked: a `.in()` built from every
  // loan id would exceed the querystring limit long before the fleet does
  // (D-033), and a failed request is not a truncated one — it is an error.
  const obligations: LoanObligation[] = [];
  for (const chunk of chunkIds(loans.map((l) => l.id))) {
    const rows = await fetchAllPages<{
      id: string;
      phone_loan_id: string | null;
      amount_due: number;
      status: string;
      due_date: string;
    }>(
      (from, to) =>
        supabase
          .from('payment_obligations')
          .select('id, phone_loan_id, amount_due, status, due_date')
          .in('phone_loan_id', chunk)
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'phone loan obligations' },
    );
    for (const o of rows) {
      if (!o.phone_loan_id) continue;
      obligations.push({
        id: o.id,
        phoneLoanId: o.phone_loan_id,
        amountDue: o.amount_due,
        status: o.status,
        dueDate: o.due_date,
      });
    }
  }

  return phoneLoanPortfolio(loans, obligations, today);
}

/* ------------------------------------------------------------------------ *
 * One rider's phone-loan state (their own page, and the pay flow)
 * ------------------------------------------------------------------------ */

export type RiderPhoneLoanState = {
  limits: PhoneLoanLimits;
  /** The request currently moving through the workflow, if any. */
  openRequest: PhoneLoanRequestRow | null;
  history: PhoneLoanRequestRow[];
  activeLoan: {
    id: string;
    totalAmount: number;
    termMonths: number;
    repaid: number;
    outstanding: number;
    instalments: { id: string; dueDate: string; amount: number; status: string }[];
  } | null;
  /** True while lease days are being postponed for this rider's loan. */
  leasePaused: boolean;
  focus: RepaymentFocus;
  /** True when the rider may submit a new request right now. */
  canRequest: boolean;
  /** Why not, when they cannot. */
  blockedReason:
    | null
    | 'no_active_contract'
    | 'request_in_progress'
    | 'loan_in_progress'
    | 'lease_not_started';
};

export async function getRiderPhoneLoanState(riderId: string): Promise<RiderPhoneLoanState> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const [limits, requests, contractRes] = await Promise.all([
    getPhoneLoanLimits(),
    listPhoneLoanRequests({ riderId }),
    supabase
      .from('contracts')
      .select('id, status, lease_paused_for_loan_id, start_date')
      .eq('rider_id', riderId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);

  const contract = contractRes.data as
    | { id: string; status: string; lease_paused_for_loan_id: string | null; start_date: string | null }
    | null;

  const openRequest = requests.find((r) => isOpenRequest(r.status)) ?? null;

  // The active loan and its instalments.
  const { data: loanRow } = await supabase
    .from('phone_loans')
    .select('id, total_amount, term_months')
    .eq('rider_id', riderId)
    .eq('status', 'active')
    .maybeSingle();
  const loan = loanRow as { id: string; total_amount: number; term_months: number } | null;

  let activeLoan: RiderPhoneLoanState['activeLoan'] = null;
  if (loan) {
    const { data: obRows } = await supabase
      .from('payment_obligations')
      .select('id, due_date, amount_due, status')
      .eq('phone_loan_id', loan.id)
      .order('due_date', { ascending: true });
    const obs = (obRows ?? []) as {
      id: string;
      due_date: string;
      amount_due: number;
      status: string;
    }[];
    const settled = new Set(['paid', 'paid_in_advance']);
    activeLoan = {
      id: loan.id,
      totalAmount: loan.total_amount,
      termMonths: loan.term_months,
      repaid: obs.filter((o) => settled.has(o.status)).reduce((s, o) => s + o.amount_due, 0),
      outstanding: obs
        .filter((o) => ['scheduled', 'due', 'overdue'].includes(o.status))
        .reduce((s, o) => s + o.amount_due, 0),
      instalments: obs.map((o) => ({
        id: o.id,
        dueDate: o.due_date,
        amount: o.amount_due,
        status: o.status,
      })),
    };
  }

  // Outstanding LEASE days, for the "what am I paying" question. Counted, not
  // summed — the rider's own dashboard already shows the amounts.
  const { count: leaseOutstanding } = contract
    ? await supabase
        .from('payment_obligations')
        .select('id', { count: 'exact', head: true })
        .eq('contract_id', contract.id)
        .eq('kind', 'lease')
        .in('status', ['scheduled', 'due', 'overdue'])
    : { count: 0 };

  const leasePaused = Boolean(contract?.lease_paused_for_loan_id);

  let blockedReason: RiderPhoneLoanState['blockedReason'] = null;
  if (!contract) blockedReason = 'no_active_contract';
  else if (openRequest) blockedReason = 'request_in_progress';
  else if (activeLoan) blockedReason = 'loan_in_progress';
  else if (contract.start_date && contract.start_date > today) blockedReason = 'lease_not_started';

  return {
    limits,
    openRequest,
    history: requests,
    activeLoan,
    leasePaused,
    focus: repaymentFocus({
      hasActivePhoneLoan: Boolean(activeLoan),
      leasePaused,
      hasOutstandingLeaseDays: (leaseOutstanding ?? 0) > 0,
      hasOutstandingPhoneInstalments: (activeLoan?.outstanding ?? 0) > 0,
    }),
    canRequest: blockedReason === null,
    blockedReason,
  };
}
