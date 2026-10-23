import { describe, it, expect } from 'vitest';
import {
  agingBucket,
  computeRetirementRow,
  summarizeByStaff,
  summarizeRetirements,
  validateRetirementEntry,
  type RetirableRequisition,
  type RetirementEntryInput,
} from '@/lib/requisitions/retirement';

const req = (over: Partial<RetirableRequisition> = {}): RetirableRequisition => ({
  id: 'q1',
  requisitionNumber: 'REQ/2026/10/0001',
  title: 'Tyres',
  requestedById: 'u1',
  requestedByName: 'Eufrasia',
  departmentName: 'Operations',
  requisitionType: 'general',
  paidAmount: 100_000,
  paidDate: '2026-10-01',
  legacyRetirementStatus: 'pending',
  legacyRetiredAmount: null,
  ...over,
});

const entry = (over: Partial<RetirementEntryInput>): RetirementEntryInput => ({
  id: 'e',
  requisitionId: 'q1',
  spentAmount: 0,
  returnedAmount: 0,
  status: 'approved',
  ...over,
});

describe('retirement row', () => {
  it('is unretired with nothing verified, and ages by days since payment', () => {
    const r = computeRetirementRow(req(), [], '2026-10-20');
    expect(r.state).toBe('unretired');
    expect(r.outstanding).toBe(100_000);
    expect(r.daysSincePayment).toBe(19);
    expect(r.aging).toBe('days_15_30');
  });

  it('counts only VERIFIED entries; submitted ones are awaiting, rejected ignored', () => {
    const r = computeRetirementRow(
      req(),
      [
        entry({ id: 'a', spentAmount: 40_000 }),
        entry({ id: 'b', spentAmount: 30_000, status: 'submitted' }),
        entry({ id: 'c', spentAmount: 99_000, status: 'rejected' }),
      ],
      '2026-10-03',
    );
    expect(r.state).toBe('partially_retired');
    expect(r.retiredAmount).toBe(40_000);
    expect(r.pendingAmount).toBe(30_000);
    expect(r.outstanding).toBe(60_000);
    expect(r.retiredPercent).toBe(40);
    expect(r.aging).toBe('within_period');
  });

  it('is fully retired when spent + cash returned covers what was paid', () => {
    const r = computeRetirementRow(
      req(),
      [entry({ id: 'a', spentAmount: 85_000 }), entry({ id: 'b', returnedAmount: 15_000 })],
      '2026-10-30',
    );
    expect(r.state).toBe('fully_retired');
    expect(r.outstanding).toBe(0);
    expect(r.aging).toBeNull();
  });

  it('reports overspend instead of hiding it', () => {
    const r = computeRetirementRow(req(), [entry({ spentAmount: 110_000 })], '2026-10-02');
    expect(r.state).toBe('fully_retired');
    expect(r.overspend).toBe(10_000);
    expect(r.retiredPercent).toBe(100);
  });

  it('treats a request retired the old one-click way as fully retired', () => {
    const r = computeRetirementRow(
      req({ legacyRetirementStatus: 'completed', legacyRetiredAmount: 90_000 }),
      [],
      '2026-10-30',
    );
    expect(r.state).toBe('fully_retired');
    expect(r.spentAmount).toBe(90_000);
    expect(r.outstanding).toBe(0);
  });
});

describe('aging buckets', () => {
  it('splits at the 7-day retirement period, 14 and 30 days', () => {
    expect(agingBucket(0)).toBe('within_period');
    expect(agingBucket(7)).toBe('within_period');
    expect(agingBucket(8)).toBe('days_8_14');
    expect(agingBucket(15)).toBe('days_15_30');
    expect(agingBucket(31)).toBe('days_over_30');
  });
});

describe('board summary', () => {
  it('totals the book and never exceeds 100% because of one overspend', () => {
    const rows = [
      computeRetirementRow(req({ id: 'q1' }), [entry({ requisitionId: 'q1', spentAmount: 150_000 })], '2026-10-10'),
      computeRetirementRow(req({ id: 'q2', requestedById: 'u2', requestedByName: 'Daudi' }), [], '2026-10-10'),
    ];
    const s = summarizeRetirements(rows);
    expect(s.totalPaid).toBe(200_000);
    expect(s.totalRetired).toBe(100_000);
    expect(s.totalOutstanding).toBe(100_000);
    expect(s.overallRetiredPercent).toBe(50);
    expect(s.fullyRetired).toBe(1);
    expect(s.unretired).toBe(1);
    expect(s.aging.days_8_14).toBe(1);

    const people = summarizeByStaff(rows);
    expect(people[0]!.staffName).toBe('Daudi');
    expect(people[0]!.oldestOutstandingDays).toBe(9);
  });
});

describe('entry validation', () => {
  it('refuses returning more cash than is outstanding, allows overspend', () => {
    expect(validateRetirementEntry({ spentAmount: 0, returnedAmount: 60_000, paidAmount: 100_000, alreadyAccounted: 50_000 })).toEqual({ ok: false, error: 'returned_exceeds_outstanding' });
    expect(validateRetirementEntry({ spentAmount: 80_000, returnedAmount: 0, paidAmount: 100_000, alreadyAccounted: 50_000 })).toEqual({ ok: true });
    expect(validateRetirementEntry({ spentAmount: 0, returnedAmount: 0, paidAmount: 100_000, alreadyAccounted: 0 })).toEqual({ ok: false, error: 'nothing_to_retire' });
    expect(validateRetirementEntry({ spentAmount: 1, returnedAmount: 0, paidAmount: 100_000, alreadyAccounted: 100_000 })).toEqual({ ok: false, error: 'already_retired' });
    expect(validateRetirementEntry({ spentAmount: -5, returnedAmount: 0, paidAmount: 100_000, alreadyAccounted: 0 })).toEqual({ ok: false, error: 'invalid_amount' });
  });
});
