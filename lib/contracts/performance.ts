/*
 * Rider performance report for one contract (client request 2026-10-23).
 *
 * "Once a contract is terminated, I would like to be able to generate and
 *  print a detailed driver performance report showing when the driver
 *  started, the total amount paid, and any outstanding balance owed up to the
 *  date of termination."
 *
 * Everything here is DERIVED from the ledger (D-034 rule 3) — obligations and
 * completed payments — up to a CUTOFF date: the termination date for a
 * terminated contract, otherwise today. Nothing is stored, so a report printed
 * twice prints the same figures, and a payment recorded later shows up the
 * next time it is generated.
 *
 * Two money figures are reported side by side and NEVER derived from each
 * other (rule 17):
 *   totalPaid     cash actually received against this contract (payments)
 *   settledValue  the value of the payment days those payments cleared
 * They normally agree; when they do not (an overpayment, a cash note), both
 * appear on the page rather than one silently standing in for the other.
 *
 * Pure and dependency-free so every rule is unit tested.
 */

export type PerformanceObligation = {
  dueDate: string; // YYYY-MM-DD
  amountDue: number;
  status: string;
  /** Local calendar date the obligation was settled, when it was. */
  settledDate: string | null;
};

export type PerformancePayment = {
  amount: number;
  /** Local calendar date the payment completed. */
  date: string;
  method: string;
};

export type PerformanceGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'no_history';

export type PerformanceMonth = {
  month: string; // YYYY-MM
  expected: number;
  settled: number;
  outstanding: number;
};

export type ContractPerformance = {
  startDate: string;
  cutoffDate: string;
  /** Calendar days from the start to the cutoff, both inclusive. */
  daysOnContract: number;

  /** Value of every payment day that fell due on or before the cutoff. */
  expectedValue: number;
  expectedCount: number;
  /** Of those, the value already settled. */
  settledValue: number;
  settledCount: number;
  /** Settled on or before their due date. */
  onTimeCount: number;
  /** Settled, but after their due date. */
  lateCount: number;
  /** Average days late across the late ones (0 when none). */
  averageDaysLate: number;
  /** Unpaid and due on or before the cutoff — what the rider still owes. */
  outstandingValue: number;
  outstandingCount: number;
  /** Days the owner waived — reported, never counted as owed or as paid. */
  waivedValue: number;
  waivedCount: number;
  /** Days paid ahead of the cutoff (due after it, but already settled). */
  paidAheadValue: number;

  /** Cash actually received against the contract up to the cutoff. */
  totalPaid: number;
  paymentCount: number;
  paidByMethod: { method: string; amount: number; count: number }[];
  firstPaymentDate: string | null;
  lastPaymentDate: string | null;
  /** Days from the last payment to the cutoff; null when never paid. */
  daysSinceLastPayment: number | null;

  /** settledValue / expectedValue, 0–100, one decimal. */
  collectionRate: number;
  /** onTimeCount / expectedCount, 0–100, one decimal. */
  onTimeRate: number;
  grade: PerformanceGrade;
  months: PerformanceMonth[];
};

const SETTLED = new Set(['paid', 'paid_in_advance']);
const UNPAID = new Set(['scheduled', 'due', 'overdue']);
const WAIVED = new Set(['exempted']);
const DAY_MS = 86_400_000;

function toMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * The grade reads the collection rate, then CAPS it by punctuality: a rider
 * who eventually pays everything but mostly late is not "excellent" (Alfred's
 * real record: 100% collected, 45% on time, 18.5 days late on average). Both
 * inputs are printed beside the grade, so the owner can see exactly why. A
 * rider with nothing yet due has no history rather than a perfect score.
 */
export function gradeFor(
  collectionRate: number,
  expectedCount: number,
  onTimeRate = 100,
): PerformanceGrade {
  if (expectedCount === 0) return 'no_history';
  const order: PerformanceGrade[] = ['poor', 'fair', 'good', 'excellent'];
  const byCollection: PerformanceGrade =
    collectionRate >= 95 ? 'excellent' : collectionRate >= 80 ? 'good' : collectionRate >= 60 ? 'fair' : 'poor';
  const cap: PerformanceGrade = onTimeRate >= 75 ? 'excellent' : onTimeRate >= 50 ? 'good' : onTimeRate >= 25 ? 'fair' : 'poor';
  return order[Math.min(order.indexOf(byCollection), order.indexOf(cap))]!;
}

export const GRADE_LABELS: Record<PerformanceGrade, string> = {
  excellent: 'Excellent · Bora sana',
  good: 'Good · Nzuri',
  fair: 'Fair · Wastani',
  poor: 'Poor · Dhaifu',
  no_history: 'No payment history yet',
};

export function computeContractPerformance(input: {
  startDate: string;
  cutoffDate: string;
  obligations: readonly PerformanceObligation[];
  payments: readonly PerformancePayment[];
}): ContractPerformance {
  const { startDate, cutoffDate } = input;

  let expectedValue = 0;
  let expectedCount = 0;
  let settledValue = 0;
  let settledCount = 0;
  let onTimeCount = 0;
  let lateCount = 0;
  let lateDaysTotal = 0;
  let outstandingValue = 0;
  let outstandingCount = 0;
  let waivedValue = 0;
  let waivedCount = 0;
  let paidAheadValue = 0;
  const months = new Map<string, PerformanceMonth>();

  for (const o of input.obligations) {
    const amount = Math.max(0, Math.trunc(o.amountDue));
    if (o.dueDate > cutoffDate) {
      // A day after the cutoff is not owed by this report — but if the rider
      // already paid it, that money is theirs and is shown.
      if (SETTLED.has(o.status)) paidAheadValue += amount;
      continue;
    }
    if (WAIVED.has(o.status)) {
      waivedValue += amount;
      waivedCount += 1;
      continue;
    }
    // Cancelled days were never owed; a postponed day is replaced by a new
    // obligation, so counting it too would bill the rider twice.
    if (!SETTLED.has(o.status) && !UNPAID.has(o.status)) continue;

    expectedValue += amount;
    expectedCount += 1;
    const key = o.dueDate.slice(0, 7);
    const month = months.get(key) ?? { month: key, expected: 0, settled: 0, outstanding: 0 };
    month.expected += amount;

    if (SETTLED.has(o.status)) {
      settledValue += amount;
      settledCount += 1;
      month.settled += amount;
      const late = o.settledDate ? daysBetween(o.dueDate, o.settledDate) : 0;
      if (late > 0) {
        lateCount += 1;
        lateDaysTotal += late;
      } else {
        onTimeCount += 1;
      }
    } else {
      outstandingValue += amount;
      outstandingCount += 1;
      month.outstanding += amount;
    }
    months.set(key, month);
  }

  const counted = input.payments.filter((p) => p.date <= cutoffDate && p.amount > 0);
  const byMethod = new Map<string, { method: string; amount: number; count: number }>();
  let totalPaid = 0;
  let firstPaymentDate: string | null = null;
  let lastPaymentDate: string | null = null;
  for (const p of counted) {
    totalPaid += p.amount;
    const m = byMethod.get(p.method) ?? { method: p.method, amount: 0, count: 0 };
    m.amount += p.amount;
    m.count += 1;
    byMethod.set(p.method, m);
    if (!firstPaymentDate || p.date < firstPaymentDate) firstPaymentDate = p.date;
    if (!lastPaymentDate || p.date > lastPaymentDate) lastPaymentDate = p.date;
  }

  const collectionRate = pct(settledValue, expectedValue);
  const onTimeRate = pct(onTimeCount, expectedCount);

  return {
    startDate,
    cutoffDate,
    daysOnContract: cutoffDate >= startDate ? daysBetween(startDate, cutoffDate) + 1 : 0,
    expectedValue,
    expectedCount,
    settledValue,
    settledCount,
    onTimeCount,
    lateCount,
    averageDaysLate: lateCount > 0 ? Math.round((lateDaysTotal / lateCount) * 10) / 10 : 0,
    outstandingValue,
    outstandingCount,
    waivedValue,
    waivedCount,
    paidAheadValue,
    totalPaid,
    paymentCount: counted.length,
    paidByMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
    firstPaymentDate,
    lastPaymentDate,
    daysSinceLastPayment: lastPaymentDate ? daysBetween(lastPaymentDate, cutoffDate) : null,
    collectionRate,
    onTimeRate,
    grade: gradeFor(collectionRate, expectedCount, onTimeRate),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  mobile_money: 'Mobile money',
  cash: 'Cash',
};

export const SCHEDULE_LABELS: Record<string, string> = {
  daily: 'Daily',
  selected_weekdays: 'Selected weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
