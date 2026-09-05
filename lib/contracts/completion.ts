/*
 * Contract balance + projected completion date (client feedback 2026-09-05).
 *
 * Two numbers the Director asked to see everywhere, in two colours:
 *
 *   GREEN — "outstanding": what the rider owes RIGHT NOW, i.e. every unpaid
 *           obligation dated today or earlier (their accumulated arrears plus
 *           today's payment).
 *   RED   — "remaining": everything still to pay before the contract is
 *           finished, today's arrears included.
 *
 * (Green-for-arrears inverts the usual traffic-light reading; it is the
 * colour language the owner asked for, so it is applied consistently rather
 * than silently "corrected".)
 *
 * And one date: when will this contract actually finish, given the payments
 * that have ALREADY been made? A rider who keeps missing days finishes later
 * than the calendar says, and the owner wants that date, not the theoretical
 * one — shown in full: "Monday, 25 June 2030".
 *
 * Pure and dependency-free so every rule is unit tested.
 */

export type ProgressObligation = {
  dueDate: string; // YYYY-MM-DD
  amountDue: number;
  status: string;
  /** Local calendar date the obligation was settled, when it was. */
  settledDate?: string | null;
};

const SETTLED = new Set(['paid', 'paid_in_advance']);
const UNPAID = new Set(['scheduled', 'due', 'overdue']);
/** 'postponed' is replaced by a new obligation, so counting it double-bills. */
const COUNTED = new Set(['scheduled', 'due', 'overdue', 'paid', 'paid_in_advance']);

const DAY_MS = 86_400_000;

function toMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function toDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const daysBetween = (a: string, b: string): number => Math.round((toMs(b) - toMs(a)) / DAY_MS);

export type ContractProgress = {
  /** GREEN — unpaid and already due (arrears + today). */
  outstandingNow: number;
  outstandingCount: number;
  /** RED — the whole remaining balance to finish the contract. */
  totalRemaining: number;
  remainingCount: number;
  paidAmount: number;
  paidCount: number;
  totalCount: number;
  totalValue: number;
  progressPercent: number;
  /** Last scheduled obligation — the calendar's answer. */
  scheduledEndDate: string | null;
  /**
   * When the contract is expected to actually finish, given the observed
   * payment pace. Equals the scheduled end date for a rider who is on time.
   */
  projectedEndDate: string | null;
  /** How the projection was reached, so the UI can explain itself. */
  projectionBasis: 'complete' | 'schedule' | 'pace' | 'unknown';
  /** Observed settled obligations per calendar day (null = not enough data). */
  paceperDay: number | null;
  /** Calendar days the projection is behind the schedule (0 when on time). */
  daysBehindSchedule: number;
};

/**
 * Never project further out than this. A rider who has paid once in six months
 * has a mathematically valid completion date in the 2200s — printing it would
 * be worse than printing nothing.
 */
const MAX_PROJECTION_DAYS = 366 * 15;

export function computeContractProgress(
  obligations: ProgressObligation[],
  today: string,
): ContractProgress {
  const counted = obligations.filter((o) => COUNTED.has(o.status));
  const paid = counted.filter((o) => SETTLED.has(o.status));
  const unpaid = counted.filter((o) => UNPAID.has(o.status));
  const dueNow = unpaid.filter((o) => o.dueDate <= today);

  const totalValue = counted.reduce((s, o) => s + o.amountDue, 0);
  const paidAmount = paid.reduce((s, o) => s + o.amountDue, 0);
  const totalRemaining = unpaid.reduce((s, o) => s + o.amountDue, 0);
  const outstandingNow = dueNow.reduce((s, o) => s + o.amountDue, 0);

  const scheduledEndDate =
    counted.length > 0
      ? counted.reduce((max, o) => (o.dueDate > max ? o.dueDate : max), counted[0]!.dueDate)
      : null;

  const base: ContractProgress = {
    outstandingNow,
    outstandingCount: dueNow.length,
    totalRemaining,
    remainingCount: unpaid.length,
    paidAmount,
    paidCount: paid.length,
    totalCount: counted.length,
    totalValue,
    progressPercent: counted.length > 0 ? Math.round((paid.length / counted.length) * 100) : 0,
    scheduledEndDate,
    projectedEndDate: scheduledEndDate,
    projectionBasis: 'schedule',
    paceperDay: null,
    daysBehindSchedule: 0,
  };

  // Nothing left to pay: the contract is finished on its last settled day (or
  // today, when that was never recorded).
  if (unpaid.length === 0) {
    const lastSettled = paid
      .map((o) => o.settledDate ?? o.dueDate)
      .sort()
      .at(-1);
    return {
      ...base,
      projectedEndDate: lastSettled ?? scheduledEndDate,
      projectionBasis: 'complete',
    };
  }

  // Observed pace: settled obligations per elapsed calendar day, measured from
  // the first obligation's due date (when the lease began billing) to today.
  // Only obligations already DUE count toward the elapsed window — days that
  // have not arrived cannot be "missed", and counting them would slander a
  // brand-new contract as hopelessly behind.
  const firstDue = counted.reduce(
    (min, o) => (o.dueDate < min ? o.dueDate : min),
    counted[0]!.dueDate,
  );
  const elapsedDays = daysBetween(firstDue, today) + 1;
  if (elapsedDays < 1 || firstDue > today) {
    // The lease has not started billing yet — the calendar is the best answer.
    return base;
  }

  const pace = paid.length / elapsedDays;
  if (pace <= 0) {
    return { ...base, projectionBasis: 'unknown', projectedEndDate: scheduledEndDate };
  }

  const projectedDays = Math.ceil(unpaid.length / pace);
  if (projectedDays > MAX_PROJECTION_DAYS) {
    return { ...base, projectionBasis: 'unknown', paceperDay: pace, projectedEndDate: null };
  }

  const projectedEndDate = toDateStr(toMs(today) + projectedDays * DAY_MS);
  const daysBehindSchedule = scheduledEndDate
    ? Math.max(0, daysBetween(scheduledEndDate, projectedEndDate))
    : 0;

  return {
    ...base,
    projectedEndDate,
    projectionBasis: 'pace',
    paceperDay: pace,
    daysBehindSchedule,
  };
}
