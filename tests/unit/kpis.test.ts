import { describe, it, expect } from 'vitest';
import {
  computeOwnerKpis,
  arrearsAging,
  type KpiObligation,
  type KpiPayment,
} from '@/lib/dashboard/kpis';

const TODAY = '2026-07-06';
const ob = (riderId: string, dueDate: string, status: string, amountDue = 5000): KpiObligation => ({ riderId, dueDate, amountDue, status });

describe('computeOwnerKpis', () => {
  const obligations: KpiObligation[] = [
    // Rider A: paid today, one overdue unpaid
    ob('A', TODAY, 'paid'),
    ob('A', '2026-07-04', 'overdue'),
    // Rider B: due today unpaid
    ob('B', TODAY, 'due'),
    // Rider C: fully settled (paid today, no arrears)
    ob('C', TODAY, 'paid'),
    // Excluded ones
    ob('D', TODAY, 'exempted'),
    ob('D', TODAY, 'cancelled'),
  ];
  const payments: KpiPayment[] = [
    { amount: 5000, status: 'completed', completedDate: TODAY, method: 'mobile_money' },
    { amount: 10000, status: 'completed', completedDate: TODAY, method: 'cash' }, // includes arrears
    { amount: 5000, status: 'pending', completedDate: null, method: 'mobile_money' },
  ];

  const k = computeOwnerKpis(obligations, payments, TODAY);

  it('expected today excludes exempted/cancelled', () => {
    // paid(A) + due(B) + paid(C) = 3 × 5000
    expect(k.expectedToday).toBe(15000);
  });
  it('settled today counts only paid today obligations', () => {
    expect(k.settledToday).toBe(10000); // A + C
  });
  it('outstanding today is the unpaid due-today amount', () => {
    expect(k.outstandingToday).toBe(5000); // B
  });
  it('collected today is completed payments received today (not settled)', () => {
    expect(k.collectedToday).toBe(15000); // 5000 + 10000, pending excluded
  });
  it('collection rate = settled / expected', () => {
    expect(k.collectionRate).toBeCloseTo(10000 / 15000);
  });
  it('total arrears sums overdue unpaid obligations', () => {
    expect(k.totalArrears).toBe(5000);
    expect(k.arrearsCount).toBe(1);
  });
  it('paid vs unpaid riders', () => {
    // A has overdue -> unpaid; B due today -> unpaid; C paid; D excluded-only -> paid
    expect(k.unpaidRiders).toBe(2);
    expect(k.paidRiders).toBe(2);
  });
  it('collection rate is null when nothing expected', () => {
    expect(computeOwnerKpis([], [], TODAY).collectionRate).toBeNull();
  });
});

describe('arrearsAging', () => {
  it('buckets overdue obligations by days late', () => {
    const obs: KpiObligation[] = [
      ob('A', '2026-07-05', 'overdue'), // 1 day
      ob('A', '2026-07-04', 'overdue'), // 2 days
      ob('A', '2026-07-01', 'overdue'), // 5 days
      ob('A', '2026-06-20', 'overdue'), // 16 days
      ob('A', '2026-05-01', 'overdue'), // > 30 days
      ob('A', '2026-07-06', 'due'), // today, not arrears
    ];
    const b = arrearsAging(obs, TODAY);
    expect(b.oneDay).toBe(5000);
    expect(b.twoToThree).toBe(5000);
    expect(b.fourToSeven).toBe(5000);
    expect(b.eightToThirty).toBe(5000);
    expect(b.overThirty).toBe(5000);
  });
});
