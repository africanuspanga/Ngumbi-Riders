/*
 * Report aggregation (spec §19.2). Pure functions over plain data so the report
 * definitions are unit tested. Server queries feed these; exports serialize
 * their output. All money is integer TZS.
 */
export type ReportObligation = {
  riderId?: string;
  dueDate: string; // YYYY-MM-DD
  amountDue: number;
  status: string;
  settledDate?: string | null; // YYYY-MM-DD when settled
};

export type ReportPayment = {
  amount: number;
  method: string; // cash | mobile_money
  completedDate: string | null;
  status: string;
};

const SETTLED = new Set(['paid', 'paid_in_advance']);
const UNPAID = new Set(['scheduled', 'due', 'overdue']);
const EXCLUDED = new Set(['exempted', 'postponed', 'cancelled']);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

// ---- Collections (daily / weekly / monthly) -----------------------------
export type CollectionReport = {
  expected: number;
  settled: number;
  paymentsReceived: number;
  cash: number;
  mobile: number;
  collectionRate: number | null;
  arrearsCreated: number;
  arrearsRecovered: number;
};

export function collectionReport(
  obligations: ReportObligation[],
  payments: ReportPayment[],
  from: string,
  to: string,
): CollectionReport {
  const dueInRange = obligations.filter((o) => inRange(o.dueDate, from, to) && !EXCLUDED.has(o.status));
  const expected = dueInRange.reduce((s, o) => s + o.amountDue, 0);
  const settled = dueInRange.filter((o) => SETTLED.has(o.status)).reduce((s, o) => s + o.amountDue, 0);

  const completed = payments.filter((p) => p.status === 'completed' && p.completedDate && inRange(p.completedDate, from, to));
  const paymentsReceived = completed.reduce((s, p) => s + p.amount, 0);
  const cash = completed.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const mobile = completed.filter((p) => p.method === 'mobile_money').reduce((s, p) => s + p.amount, 0);

  const arrearsCreated = obligations
    .filter((o) => o.status === 'overdue' && inRange(o.dueDate, from, to))
    .reduce((s, o) => s + o.amountDue, 0);
  const arrearsRecovered = obligations
    .filter((o) => SETTLED.has(o.status) && o.dueDate < from && o.settledDate && inRange(o.settledDate, from, to))
    .reduce((s, o) => s + o.amountDue, 0);

  return {
    expected,
    settled,
    paymentsReceived,
    cash,
    mobile,
    collectionRate: expected > 0 ? settled / expected : null,
    arrearsCreated,
    arrearsRecovered,
  };
}

// ---- Arrears report ------------------------------------------------------
export type ArrearsRow = {
  riderId: string;
  oldestOverdue: string;
  daysOverdue: number;
  count: number;
  amount: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function arrearsReport(obligations: ReportObligation[], today: string): { rows: ArrearsRow[]; totalAmount: number; totalCount: number } {
  const overdue = obligations.filter((o) => o.dueDate < today && UNPAID.has(o.status) && o.riderId);
  const byRider = new Map<string, ReportObligation[]>();
  for (const o of overdue) {
    const arr = byRider.get(o.riderId!) ?? [];
    arr.push(o);
    byRider.set(o.riderId!, arr);
  }
  const rows: ArrearsRow[] = [...byRider.entries()].map(([riderId, obs]) => {
    const oldest = obs.reduce((m, o) => (o.dueDate < m ? o.dueDate : m), obs[0]!.dueDate);
    return {
      riderId,
      oldestOverdue: oldest,
      daysOverdue: daysBetween(oldest, today),
      count: obs.length,
      amount: obs.reduce((s, o) => s + o.amountDue, 0),
    };
  }).sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    rows,
    totalAmount: rows.reduce((s, r) => s + r.amount, 0),
    totalCount: rows.reduce((s, r) => s + r.count, 0),
  };
}

// ---- Payment performance -------------------------------------------------
export type PaymentPerformance = {
  settledCount: number;
  onTimeCount: number;
  advanceCount: number;
  lateCount: number;
  onTimeRate: number | null;
  advanceRate: number | null;
  averageDelayDays: number;
};

export function paymentPerformance(obligations: ReportObligation[]): PaymentPerformance {
  const settled = obligations.filter((o) => SETTLED.has(o.status) && o.settledDate);
  let onTime = 0;
  let advance = 0;
  let late = 0;
  let totalDelay = 0;
  for (const o of settled) {
    const delay = daysBetween(o.dueDate, o.settledDate!);
    if (o.status === 'paid_in_advance' || delay < 0) advance++;
    if (delay <= 0) onTime++;
    else {
      late++;
      totalDelay += delay;
    }
  }
  return {
    settledCount: settled.length,
    onTimeCount: onTime,
    advanceCount: advance,
    lateCount: late,
    onTimeRate: settled.length > 0 ? onTime / settled.length : null,
    advanceRate: settled.length > 0 ? advance / settled.length : null,
    averageDelayDays: late > 0 ? totalDelay / late : 0,
  };
}

// ---- Contract progress ---------------------------------------------------
export type ContractProgress = {
  total: number;
  paid: number;
  remaining: number;
  paidValue: number;
  remainingValue: number;
  expectedCompletion: string | null;
};

export function contractProgress(obligations: ReportObligation[]): ContractProgress {
  const counted = obligations.filter((o) => !EXCLUDED.has(o.status) || o.status === 'postponed');
  const paid = counted.filter((o) => SETTLED.has(o.status));
  const remaining = counted.filter((o) => !SETTLED.has(o.status));
  const expectedCompletion = remaining.length
    ? remaining.map((o) => o.dueDate).sort().at(-1)!
    : null;
  return {
    total: counted.length,
    paid: paid.length,
    remaining: remaining.length,
    paidValue: paid.reduce((s, o) => s + o.amountDue, 0),
    remainingValue: remaining.reduce((s, o) => s + o.amountDue, 0),
    expectedCompletion,
  };
}

// ---- Cash operating margin (spec §3.6) ----------------------------------
export function cashOperatingMargin(collected: number, expenses: number): { collected: number; expenses: number; margin: number } {
  return { collected, expenses, margin: collected - expenses };
}
