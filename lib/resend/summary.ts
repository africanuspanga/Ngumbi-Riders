import { formatTZS } from '@/lib/money/format';

/* Daily owner summary email (spec §18.1). */
export type DailySummaryMetrics = {
  date: string;
  expectedToday: number;
  settledToday: number;
  collectedToday: number;
  cashToday: number;
  mobileToday: number;
  outstandingToday: number;
  collectionRate: number | null;
  totalArrears: number;
  paidRiders: number;
  unpaidRiders: number;
  pendingPayments: number;
  applicationsAwaiting: number;
  appUrl: string;
};

export function composeDailySummaryHtml(m: DailySummaryMetrics): string {
  const rate = m.collectionRate === null ? '—' : `${Math.round(m.collectionRate * 100)}%`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#607066">${label}</td><td style="padding:6px 12px;font-weight:600;text-align:right">${value}</td></tr>`;
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#163D24">Ng'umbi Riders — Daily Summary</h2>
    <p style="color:#607066">${m.date}</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #DDE6DF;border-radius:8px">
      ${row('Expected today', formatTZS(m.expectedToday))}
      ${row('Settled for today', formatTZS(m.settledToday))}
      ${row('Collected today', formatTZS(m.collectedToday))}
      ${row('&nbsp;&nbsp;Cash', formatTZS(m.cashToday))}
      ${row('&nbsp;&nbsp;Mobile money', formatTZS(m.mobileToday))}
      ${row('Collection rate', rate)}
      ${row('Outstanding today', formatTZS(m.outstandingToday))}
      ${row('Total arrears', formatTZS(m.totalArrears))}
      ${row('Paid riders', String(m.paidRiders))}
      ${row('Unpaid riders', String(m.unpaidRiders))}
      ${row('Pending Snippe payments', String(m.pendingPayments))}
      ${row('Applications awaiting review', String(m.applicationsAwaiting))}
    </table>
    <p style="margin-top:16px"><a href="${m.appUrl}/owner" style="color:#2F8F46">Open owner dashboard →</a></p>
  </div>`;
}
