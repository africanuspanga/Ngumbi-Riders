/*
 * General financial report (client feedback 2026-09-05): "an option to
 * generate a general financial report, similar to a bank statement" showing
 * the total collected in a month or a chosen date range, WHO paid it, and how
 * much each rider contributed.
 *
 * Pure aggregation over completed payments, so the arithmetic is unit tested
 * and identical on the report page and in the CSV/XLSX export.
 */

export type FinancialTransaction = {
  paymentId: string;
  date: string; // YYYY-MM-DD, local (EAT) calendar day the money landed
  riderId: string;
  riderName: string;
  riderNumber: string;
  method: string; // 'cash' | 'mobile_money'
  amount: number;
  receivedByName: string | null;
  receiptNumber: string | null;
};

export type RiderContribution = {
  riderId: string;
  riderName: string;
  riderNumber: string;
  payments: number;
  cash: number;
  mobile: number;
  total: number;
  firstPayment: string;
  lastPayment: string;
};

export type FinancialReport = {
  from: string;
  to: string;
  transactions: FinancialTransaction[];
  contributions: RiderContribution[];
  totals: { cash: number; mobile: number; total: number; payments: number; riders: number };
  /** Daily totals, for a running/period breakdown. */
  byDay: { date: string; cash: number; mobile: number; total: number }[];
};

export function financialReport(
  transactions: FinancialTransaction[],
  from: string,
  to: string,
): FinancialReport {
  const inRange = transactions
    .filter((t) => t.date >= from && t.date <= to)
    .sort((a, b) => (a.date === b.date ? a.riderName.localeCompare(b.riderName) : a.date < b.date ? -1 : 1));

  const byRider = new Map<string, RiderContribution>();
  const byDay = new Map<string, { date: string; cash: number; mobile: number; total: number }>();

  for (const t of inRange) {
    const r =
      byRider.get(t.riderId) ??
      {
        riderId: t.riderId,
        riderName: t.riderName,
        riderNumber: t.riderNumber,
        payments: 0,
        cash: 0,
        mobile: 0,
        total: 0,
        firstPayment: t.date,
        lastPayment: t.date,
      };
    r.payments++;
    r.total += t.amount;
    if (t.method === 'cash') r.cash += t.amount;
    else r.mobile += t.amount;
    if (t.date < r.firstPayment) r.firstPayment = t.date;
    if (t.date > r.lastPayment) r.lastPayment = t.date;
    byRider.set(t.riderId, r);

    const d = byDay.get(t.date) ?? { date: t.date, cash: 0, mobile: 0, total: 0 };
    d.total += t.amount;
    if (t.method === 'cash') d.cash += t.amount;
    else d.mobile += t.amount;
    byDay.set(t.date, d);
  }

  const contributions = [...byRider.values()].sort((a, b) => b.total - a.total);
  const cash = inRange.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amount, 0);
  const mobile = inRange.filter((t) => t.method !== 'cash').reduce((s, t) => s + t.amount, 0);

  return {
    from,
    to,
    transactions: inRange,
    contributions,
    totals: {
      cash,
      mobile,
      total: cash + mobile,
      payments: inRange.length,
      riders: contributions.length,
    },
    byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}
