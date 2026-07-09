/*
 * Rider dashboard + calendar derivation (spec §15, §15.1). Pure so the
 * "what do I owe right now / how far along am I" logic is unit tested. Payment
 * state is derived from obligation status only — never optimistic.
 */
export type RiderObligation = {
  dueDate: string; // YYYY-MM-DD
  amountDue: number;
  status: string;
};

const SETTLED = new Set(['paid', 'paid_in_advance']);
const UNPAID = new Set(['scheduled', 'due', 'overdue']);
// 'postponed' is excluded: postponement creates a replacement obligation on
// the same contract, so counting the original too would double-count the
// installment in totals/progress.
const COUNTS_TOWARD_TOTAL = new Set([
  'scheduled',
  'due',
  'overdue',
  'paid',
  'paid_in_advance',
]);

export type RiderState = 'paid' | 'due' | 'overdue';

export type RiderDashboard = {
  state: RiderState;
  amountRequiredNow: number;
  arrearsCount: number;
  arrearsAmount: number;
  nextDueDate: string | null;
  totalObligations: number;
  paidCount: number;
  remainingCount: number;
  paidValue: number;
  remainingValue: number;
  progressPercent: number;
};

export function computeRiderDashboard(
  obligations: RiderObligation[],
  today: string,
): RiderDashboard {
  const overdue = obligations.filter((o) => o.dueDate < today && UNPAID.has(o.status));
  const dueTodayUnpaid = obligations.filter((o) => o.dueDate === today && UNPAID.has(o.status));

  const arrearsAmount = overdue.reduce((s, o) => s + o.amountDue, 0);
  const amountRequiredNow = arrearsAmount + dueTodayUnpaid.reduce((s, o) => s + o.amountDue, 0);

  const state: RiderState =
    overdue.length > 0 ? 'overdue' : dueTodayUnpaid.length > 0 ? 'due' : 'paid';

  const upcoming = obligations
    .filter((o) => o.dueDate >= today && UNPAID.has(o.status))
    .map((o) => o.dueDate)
    .sort();

  const counted = obligations.filter((o) => COUNTS_TOWARD_TOTAL.has(o.status));
  const paid = counted.filter((o) => SETTLED.has(o.status));
  const totalObligations = counted.length;
  const paidCount = paid.length;

  return {
    state,
    amountRequiredNow,
    arrearsCount: overdue.length,
    arrearsAmount,
    nextDueDate: upcoming[0] ?? null,
    totalObligations,
    paidCount,
    remainingCount: totalObligations - paidCount,
    paidValue: paid.reduce((s, o) => s + o.amountDue, 0),
    remainingValue: counted
      .filter((o) => !SETTLED.has(o.status))
      .reduce((s, o) => s + o.amountDue, 0),
    progressPercent: totalObligations > 0 ? Math.round((paidCount / totalObligations) * 100) : 0,
  };
}

// ---- Payment calendar colours (spec §15.1) ------------------------------
export type CalendarColor = 'green' | 'red' | 'amber' | 'blue' | 'grey' | 'neutral';

export function statusColor(status: string): CalendarColor {
  switch (status) {
    case 'paid':
      return 'green';
    case 'paid_in_advance':
      return 'blue';
    case 'overdue':
      return 'red';
    case 'due':
      return 'amber';
    case 'exempted':
    case 'postponed':
    case 'cancelled':
      return 'grey';
    default:
      return 'neutral'; // scheduled / future
  }
}

export type CalendarDay = { date: string; status: string; color: CalendarColor };

export function riderCalendar(obligations: RiderObligation[]): CalendarDay[] {
  return obligations
    .map((o) => ({ date: o.dueDate, status: o.status, color: statusColor(o.status) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
