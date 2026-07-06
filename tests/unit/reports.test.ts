import { describe, it, expect } from 'vitest';
import {
  collectionReport,
  arrearsReport,
  paymentPerformance,
  contractProgress,
  cashOperatingMargin,
  type ReportObligation,
  type ReportPayment,
} from '@/lib/reports/compute';
import { toCsv } from '@/lib/reports/csv';

const ob = (dueDate: string, status: string, amountDue = 5000, extra: Partial<ReportObligation> = {}): ReportObligation => ({ dueDate, status, amountDue, ...extra });

describe('collectionReport', () => {
  const obligations = [
    ob('2026-07-01', 'paid', 5000, { settledDate: '2026-07-01' }),
    ob('2026-07-02', 'overdue'),
    ob('2026-07-03', 'exempted'), // excluded from expected
    ob('2026-06-20', 'paid', 5000, { settledDate: '2026-07-02' }), // arrears recovered in range
  ];
  const payments: ReportPayment[] = [
    { amount: 5000, method: 'mobile_money', completedDate: '2026-07-01', status: 'completed' },
    { amount: 10000, method: 'cash', completedDate: '2026-07-02', status: 'completed' },
    { amount: 5000, method: 'mobile_money', completedDate: '2026-07-02', status: 'pending' },
  ];
  const r = collectionReport(obligations, payments, '2026-07-01', '2026-07-07');

  it('expected excludes exempted', () => expect(r.expected).toBe(10000)); // paid + overdue
  it('settled counts paid in range', () => expect(r.settled).toBe(5000));
  it('payments received counts completed only', () => expect(r.paymentsReceived).toBe(15000));
  it('splits cash vs mobile', () => { expect(r.cash).toBe(10000); expect(r.mobile).toBe(5000); });
  it('arrears created = overdue in range', () => expect(r.arrearsCreated).toBe(5000));
  it('arrears recovered = older obligation settled in range', () => expect(r.arrearsRecovered).toBe(5000));
});

describe('arrearsReport', () => {
  it('groups overdue per rider with oldest + days', () => {
    const obs = [
      ob('2026-07-01', 'overdue', 5000, { riderId: 'A' }),
      ob('2026-07-03', 'overdue', 5000, { riderId: 'A' }),
      ob('2026-07-05', 'overdue', 5000, { riderId: 'B' }),
      ob('2026-07-06', 'due', 5000, { riderId: 'B' }), // today, not arrears
    ];
    const r = arrearsReport(obs, '2026-07-06');
    expect(r.totalCount).toBe(3);
    expect(r.totalAmount).toBe(15000);
    const a = r.rows.find((x) => x.riderId === 'A')!;
    expect(a.oldestOverdue).toBe('2026-07-01');
    expect(a.daysOverdue).toBe(5);
    expect(a.count).toBe(2);
  });
});

describe('paymentPerformance', () => {
  it('classifies on-time, advance and late with average delay', () => {
    const obs = [
      ob('2026-07-01', 'paid', 5000, { settledDate: '2026-07-01' }), // on time
      ob('2026-07-02', 'paid_in_advance', 5000, { settledDate: '2026-07-01' }), // advance
      ob('2026-07-03', 'paid', 5000, { settledDate: '2026-07-06' }), // 3 days late
      ob('2026-07-04', 'paid', 5000, { settledDate: '2026-07-08' }), // 4 days late
    ];
    const p = paymentPerformance(obs);
    expect(p.settledCount).toBe(4);
    expect(p.lateCount).toBe(2);
    expect(p.averageDelayDays).toBe(3.5);
    expect(p.onTimeRate).toBeCloseTo(2 / 4);
  });
});

describe('contractProgress', () => {
  it('computes totals and expected completion', () => {
    const obs = [
      ob('2026-07-01', 'paid'),
      ob('2026-07-02', 'paid_in_advance'),
      ob('2026-07-03', 'due'),
      ob('2026-07-10', 'scheduled'),
    ];
    const p = contractProgress(obs);
    expect(p.total).toBe(4);
    expect(p.paid).toBe(2);
    expect(p.remaining).toBe(2);
    expect(p.expectedCompletion).toBe('2026-07-10');
  });
});

describe('cashOperatingMargin', () => {
  it('is collected minus expenses', () => {
    expect(cashOperatingMargin(100000, 30000)).toEqual({ collected: 100000, expenses: 30000, margin: 70000 });
  });
});

describe('toCsv', () => {
  it('escapes commas, quotes and newlines', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [1, null]]);
    expect(csv).toBe('a,b\n"x,y","he said ""hi"""\n1,\n');
  });
});
