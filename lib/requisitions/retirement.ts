/*
 * Retirement arithmetic (client request 2026-10-23) — PURE, so the dashboard,
 * the request page and the export all read the same numbers.
 *
 * A requisition becomes RETIRABLE once it is approved and paid: that is the
 * moment money left the business and has to be accounted for. It is retired
 * by one or more ENTRIES (spent + cash returned), each verified by the
 * Director. Only APPROVED entries count towards the retired total; submitted
 * ones are shown as "awaiting verification", rejected ones not at all.
 *
 * Nothing here is stored (D-034 rule 3). In particular "partially retired" is
 * not a status anybody sets — it is what a request IS when some but not all of
 * its money has been accounted for.
 *
 * Requests retired with the old single-click flow (0033) have no entries; they
 * are fully retired, with the amount they recorded as spent.
 */

export type RetirementState = 'unretired' | 'partially_retired' | 'fully_retired';

/** Days a holder has to retire an advance before it counts as overdue. */
export const RETIREMENT_PERIOD_DAYS = 7;

export type AgingBucket = 'within_period' | 'days_8_14' | 'days_15_30' | 'days_over_30';

export const AGING_LABELS: Record<AgingBucket, string> = {
  within_period: `0–${RETIREMENT_PERIOD_DAYS} days (within period)`,
  days_8_14: '8–14 days',
  days_15_30: '15–30 days',
  days_over_30: '30+ days',
};

export const STATE_LABELS: Record<RetirementState, string> = {
  unretired: 'Unretired',
  partially_retired: 'Partially retired',
  fully_retired: 'Fully retired',
};

export type RetirementEntryInput = {
  id: string;
  requisitionId: string;
  spentAmount: number;
  returnedAmount: number;
  status: 'submitted' | 'approved' | 'rejected';
};

export type RetirableRequisition = {
  id: string;
  requisitionNumber: string;
  title: string;
  requestedById: string;
  requestedByName: string;
  departmentName: string;
  requisitionType: string;
  /** Approved total, which is what was paid out. */
  paidAmount: number;
  /** Local date the payment was marked, when known. */
  paidDate: string | null;
  /** 0033's flag — 'completed' with no entries means retired the old way. */
  legacyRetirementStatus: string;
  legacyRetiredAmount: number | null;
};

export type RetirementRow = RetirableRequisition & {
  state: RetirementState;
  /** Verified spent + verified cash returned. */
  retiredAmount: number;
  spentAmount: number;
  returnedAmount: number;
  /** Submitted but not yet verified by the Director. */
  pendingAmount: number;
  pendingCount: number;
  outstanding: number;
  /** Spending above what was paid out (staff out of pocket), when any. */
  overspend: number;
  retiredPercent: number;
  daysSincePayment: number | null;
  /** Only for money still outstanding. */
  aging: AgingBucket | null;
  entryCount: number;
};

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function agingBucket(days: number): AgingBucket {
  if (days <= RETIREMENT_PERIOD_DAYS) return 'within_period';
  if (days <= 14) return 'days_8_14';
  if (days <= 30) return 'days_15_30';
  return 'days_over_30';
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function computeRetirementRow(
  req: RetirableRequisition,
  entries: readonly RetirementEntryInput[],
  today: string,
): RetirementRow {
  const mine = entries.filter((e) => e.requisitionId === req.id);
  const approved = mine.filter((e) => e.status === 'approved');
  const submitted = mine.filter((e) => e.status === 'submitted');

  let spentAmount = approved.reduce((s, e) => s + e.spentAmount, 0);
  let returnedAmount = approved.reduce((s, e) => s + e.returnedAmount, 0);
  const legacy = mine.length === 0 && req.legacyRetirementStatus === 'completed';
  if (legacy) {
    spentAmount = req.legacyRetiredAmount ?? req.paidAmount;
    returnedAmount = 0;
  }
  // A legacy retirement is complete by definition, whatever it recorded.
  const retiredAmount = legacy ? Math.max(req.paidAmount, spentAmount) : spentAmount + returnedAmount;
  const outstanding = Math.max(0, req.paidAmount - retiredAmount);
  const state: RetirementState =
    outstanding === 0 && (retiredAmount > 0 || req.paidAmount === 0)
      ? 'fully_retired'
      : retiredAmount > 0
        ? 'partially_retired'
        : 'unretired';

  const daysSincePayment = req.paidDate
    ? Math.max(0, Math.round((toMs(today) - toMs(req.paidDate)) / DAY_MS))
    : null;

  return {
    ...req,
    state,
    retiredAmount,
    spentAmount,
    returnedAmount,
    pendingAmount: submitted.reduce((s, e) => s + e.spentAmount + e.returnedAmount, 0),
    pendingCount: submitted.length,
    outstanding,
    overspend: Math.max(0, spentAmount + returnedAmount - req.paidAmount),
    retiredPercent: Math.min(100, pct(retiredAmount, req.paidAmount)),
    daysSincePayment,
    aging: state === 'fully_retired' || daysSincePayment === null ? null : agingBucket(daysSincePayment),
    entryCount: mine.length,
  };
}

export type RetirementSummary = {
  totalRequests: number;
  totalPaid: number;
  totalRetired: number;
  totalOutstanding: number;
  overallRetiredPercent: number;
  fullyRetired: number;
  partiallyRetired: number;
  unretired: number;
  aging: Record<AgingBucket, number>;
  awaitingVerificationCount: number;
  awaitingVerificationAmount: number;
};

export function summarizeRetirements(rows: readonly RetirementRow[]): RetirementSummary {
  const aging: Record<AgingBucket, number> = {
    within_period: 0,
    days_8_14: 0,
    days_15_30: 0,
    days_over_30: 0,
  };
  for (const r of rows) if (r.aging) aging[r.aging] += 1;
  const totalPaid = rows.reduce((s, r) => s + r.paidAmount, 0);
  // Retired is capped at what was paid per request, so one overspent request
  // cannot make the whole book look more than 100% retired.
  const totalRetired = rows.reduce((s, r) => s + Math.min(r.retiredAmount, r.paidAmount), 0);
  return {
    totalRequests: rows.length,
    totalPaid,
    totalRetired,
    totalOutstanding: rows.reduce((s, r) => s + r.outstanding, 0),
    overallRetiredPercent: pct(totalRetired, totalPaid),
    fullyRetired: rows.filter((r) => r.state === 'fully_retired').length,
    partiallyRetired: rows.filter((r) => r.state === 'partially_retired').length,
    unretired: rows.filter((r) => r.state === 'unretired').length,
    aging,
    awaitingVerificationCount: rows.reduce((s, r) => s + r.pendingCount, 0),
    awaitingVerificationAmount: rows.reduce((s, r) => s + r.pendingAmount, 0),
  };
}

/** Per-person summary table: who is holding unretired money. */
export type StaffRetirementSummary = {
  staffId: string;
  staffName: string;
  requests: number;
  paid: number;
  retired: number;
  outstanding: number;
  retiredPercent: number;
  oldestOutstandingDays: number | null;
};

export function summarizeByStaff(rows: readonly RetirementRow[]): StaffRetirementSummary[] {
  const by = new Map<string, StaffRetirementSummary>();
  for (const r of rows) {
    const s = by.get(r.requestedById) ?? {
      staffId: r.requestedById,
      staffName: r.requestedByName,
      requests: 0,
      paid: 0,
      retired: 0,
      outstanding: 0,
      retiredPercent: 0,
      oldestOutstandingDays: null,
    };
    s.requests += 1;
    s.paid += r.paidAmount;
    s.retired += Math.min(r.retiredAmount, r.paidAmount);
    s.outstanding += r.outstanding;
    if (r.outstanding > 0 && r.daysSincePayment !== null) {
      s.oldestOutstandingDays = Math.max(s.oldestOutstandingDays ?? 0, r.daysSincePayment);
    }
    by.set(r.requestedById, s);
  }
  return [...by.values()]
    .map((s) => ({ ...s, retiredPercent: pct(s.retired, s.paid) }))
    .sort((a, b) => b.outstanding - a.outstanding);
}

/**
 * Validate a new entry against what is still open. Cash RETURNED can never
 * exceed what is outstanding (you cannot hand back money you were not given);
 * SPENDING may exceed it — staff sometimes pay the difference themselves — and
 * that overspend is reported, not refused.
 */
export function validateRetirementEntry(input: {
  spentAmount: number;
  returnedAmount: number;
  paidAmount: number;
  alreadyAccounted: number;
}): { ok: true } | { ok: false; error: 'invalid_amount' | 'nothing_to_retire' | 'returned_exceeds_outstanding' | 'already_retired' } {
  const spent = Math.trunc(input.spentAmount);
  const returned = Math.trunc(input.returnedAmount);
  if (!Number.isFinite(spent) || !Number.isFinite(returned) || spent < 0 || returned < 0) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (spent + returned <= 0) return { ok: false, error: 'nothing_to_retire' };
  const open = input.paidAmount - input.alreadyAccounted;
  if (open <= 0) return { ok: false, error: 'already_retired' };
  if (returned > open) return { ok: false, error: 'returned_exceeds_outstanding' };
  return { ok: true };
}
