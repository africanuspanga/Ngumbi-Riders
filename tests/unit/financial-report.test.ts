import { describe, it, expect } from 'vitest';
import { financialReport, type FinancialTransaction } from '@/lib/reports/financial';

const tx = (
  over: Partial<FinancialTransaction> & Pick<FinancialTransaction, 'date' | 'amount'>,
): FinancialTransaction => ({
  paymentId: `p${Math.random()}`,
  riderId: 'r1',
  riderName: 'Daud Mwakatika',
  riderNumber: 'NGR-R-0001',
  method: 'cash',
  receivedByName: 'Asha',
  receiptNumber: null,
  ...over,
});

describe('financialReport', () => {
  const rows = [
    tx({ date: '2026-03-01', amount: 10_000 }),
    tx({ date: '2026-03-02', amount: 20_000, method: 'mobile_money' }),
    tx({ date: '2026-03-05', amount: 30_000, riderId: 'r2', riderName: 'Neema Juma', riderNumber: 'NGR-R-0002' }),
    tx({ date: '2026-04-01', amount: 99_000 }), // outside the window
  ];

  it('totals only what was collected inside the range', () => {
    const r = financialReport(rows, '2026-03-01', '2026-03-31');
    expect(r.totals.total).toBe(60_000);
    expect(r.totals.cash).toBe(40_000);
    expect(r.totals.mobile).toBe(20_000);
    expect(r.totals.payments).toBe(3);
    expect(r.totals.riders).toBe(2);
  });

  it('summarises what each rider contributed, largest first', () => {
    const r = financialReport(rows, '2026-03-01', '2026-03-31');
    expect(r.contributions.map((c) => c.riderName)).toEqual(['Daud Mwakatika', 'Neema Juma']);
    expect(r.contributions[0]!.total).toBe(30_000);
    expect(r.contributions[0]!.cash).toBe(10_000);
    expect(r.contributions[0]!.mobile).toBe(20_000);
    expect(r.contributions[0]!.firstPayment).toBe('2026-03-01');
    expect(r.contributions[0]!.lastPayment).toBe('2026-03-02');
  });

  it('breaks the period down by day', () => {
    const r = financialReport(rows, '2026-03-01', '2026-03-31');
    expect(r.byDay).toEqual([
      { date: '2026-03-01', cash: 10_000, mobile: 0, total: 10_000 },
      { date: '2026-03-02', cash: 0, mobile: 20_000, total: 20_000 },
      { date: '2026-03-05', cash: 30_000, mobile: 0, total: 30_000 },
    ]);
  });

  it('returns empty totals for a period with no money', () => {
    const r = financialReport(rows, '2026-05-01', '2026-05-31');
    expect(r.totals.total).toBe(0);
    expect(r.contributions).toEqual([]);
  });
});
