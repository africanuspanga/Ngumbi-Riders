import { describe, it, expect } from 'vitest';
import { computeContractPerformance, gradeFor } from '@/lib/contracts/performance';

const ob = (dueDate: string, status: string, settledDate: string | null = null, amountDue = 10_000) => ({
  dueDate,
  amountDue,
  status,
  settledDate,
});

describe('contract performance report', () => {
  it('counts only days due up to the termination cutoff', () => {
    const p = computeContractPerformance({
      startDate: '2026-10-01',
      cutoffDate: '2026-10-05',
      obligations: [
        ob('2026-10-01', 'paid', '2026-10-01'),
        ob('2026-10-02', 'paid', '2026-10-04'), // 2 days late
        ob('2026-10-03', 'overdue'),
        ob('2026-10-04', 'overdue'),
        ob('2026-10-05', 'cancelled'), // termination cancelled it — never owed
        ob('2026-10-06', 'cancelled'),
      ],
      payments: [
        { amount: 10_000, date: '2026-10-01', method: 'cash' },
        { amount: 10_000, date: '2026-10-04', method: 'mobile_money' },
      ],
    });
    expect(p.daysOnContract).toBe(5);
    expect(p.expectedValue).toBe(40_000);
    expect(p.settledValue).toBe(20_000);
    expect(p.outstandingValue).toBe(20_000);
    expect(p.outstandingCount).toBe(2);
    expect(p.onTimeCount).toBe(1);
    expect(p.lateCount).toBe(1);
    expect(p.averageDaysLate).toBe(2);
    expect(p.totalPaid).toBe(20_000);
    expect(p.collectionRate).toBe(50);
    expect(p.grade).toBe('poor');
    expect(p.firstPaymentDate).toBe('2026-10-01');
    expect(p.daysSinceLastPayment).toBe(1);
  });

  it('reports waived days separately and never as owed or paid', () => {
    const p = computeContractPerformance({
      startDate: '2026-10-01',
      cutoffDate: '2026-10-02',
      obligations: [ob('2026-10-01', 'exempted'), ob('2026-10-02', 'paid', '2026-10-02')],
      payments: [{ amount: 10_000, date: '2026-10-02', method: 'cash' }],
    });
    expect(p.waivedValue).toBe(10_000);
    expect(p.expectedValue).toBe(10_000);
    expect(p.outstandingValue).toBe(0);
    expect(p.collectionRate).toBe(100);
  });

  it('does not double count a postponed day and shows days paid ahead', () => {
    const p = computeContractPerformance({
      startDate: '2026-10-01',
      cutoffDate: '2026-10-02',
      obligations: [
        ob('2026-10-01', 'postponed'),
        ob('2026-10-02', 'overdue'),
        ob('2026-10-09', 'paid_in_advance', '2026-10-01'),
      ],
      payments: [
        { amount: 10_000, date: '2026-10-01', method: 'cash' },
        { amount: 5_000, date: '2026-10-03', method: 'cash' }, // after the cutoff
      ],
    });
    expect(p.expectedCount).toBe(1);
    expect(p.paidAheadValue).toBe(10_000);
    expect(p.totalPaid).toBe(10_000);
  });

  it('groups expected, paid and outstanding by month', () => {
    const p = computeContractPerformance({
      startDate: '2026-09-30',
      cutoffDate: '2026-10-01',
      obligations: [ob('2026-09-30', 'paid', '2026-09-30'), ob('2026-10-01', 'overdue')],
      payments: [],
    });
    expect(p.months).toEqual([
      { month: '2026-09', expected: 10_000, settled: 10_000, outstanding: 0 },
      { month: '2026-10', expected: 10_000, settled: 0, outstanding: 10_000 },
    ]);
  });

  it('grades a rider with nothing due as having no history, not as perfect', () => {
    expect(gradeFor(0, 0)).toBe('no_history');
    expect(gradeFor(95, 10)).toBe('excellent');
    expect(gradeFor(80, 10)).toBe('good');
    expect(gradeFor(60, 10)).toBe('fair');
    expect(gradeFor(59.9, 10)).toBe('poor');
  });

  it('caps the grade by punctuality — all paid but mostly late is not excellent', () => {
    expect(gradeFor(100, 11, 45.5)).toBe('fair');
    expect(gradeFor(100, 11, 60)).toBe('good');
    expect(gradeFor(100, 11, 80)).toBe('excellent');
    expect(gradeFor(70, 11, 90)).toBe('fair');
  });
});
