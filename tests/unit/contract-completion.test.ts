import { describe, it, expect } from 'vitest';
import { computeContractProgress, type ProgressObligation } from '@/lib/contracts/completion';

/** N consecutive daily obligations from `start`, the first `paid` of them settled. */
function ledger(start: string, count: number, paid: number, amount = 10_000): ProgressObligation[] {
  const out: ProgressObligation[] = [];
  const base = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ dueDate: d, amountDue: amount, status: i < paid ? 'paid' : 'scheduled' });
  }
  return out;
}

describe('computeContractProgress — the green and red figures', () => {
  it('splits what is owed NOW from the whole remaining balance', () => {
    const rows = ledger('2026-01-01', 30, 10);
    const p = computeContractProgress(rows, '2026-01-15');
    // Days 11–15 are due and unpaid: 5 x 10,000 (green).
    expect(p.outstandingNow).toBe(50_000);
    expect(p.outstandingCount).toBe(5);
    // Everything unpaid, future included: 20 x 10,000 (red).
    expect(p.totalRemaining).toBe(200_000);
    expect(p.remainingCount).toBe(20);
    expect(p.paidAmount).toBe(100_000);
    expect(p.progressPercent).toBe(33);
  });

  it('never counts a future day as already owed', () => {
    const p = computeContractProgress(ledger('2026-06-01', 30, 0), '2026-05-01');
    expect(p.outstandingNow).toBe(0);
    expect(p.totalRemaining).toBe(300_000);
  });

  it('excludes cancelled, exempted and postponed rows from the totals', () => {
    const rows: ProgressObligation[] = [
      { dueDate: '2026-01-01', amountDue: 10_000, status: 'paid' },
      { dueDate: '2026-01-02', amountDue: 10_000, status: 'cancelled' },
      { dueDate: '2026-01-03', amountDue: 10_000, status: 'exempted' },
      { dueDate: '2026-01-04', amountDue: 10_000, status: 'postponed' },
      { dueDate: '2026-01-05', amountDue: 10_000, status: 'overdue' },
    ];
    const p = computeContractProgress(rows, '2026-01-10');
    expect(p.totalCount).toBe(2);
    expect(p.totalRemaining).toBe(10_000);
  });
});

describe('computeContractProgress — expected completion date', () => {
  it('matches the schedule for a rider who has paid every day', () => {
    // 15 days elapsed, 15 paid → pace 1/day, 15 left → 15 more days.
    const p = computeContractProgress(ledger('2026-01-01', 30, 15), '2026-01-15');
    expect(p.projectionBasis).toBe('pace');
    expect(p.scheduledEndDate).toBe('2026-01-30');
    expect(p.projectedEndDate).toBe('2026-01-30');
    expect(p.daysBehindSchedule).toBe(0);
  });

  it('pushes the date out for a rider who keeps missing days', () => {
    // 20 days elapsed, only 10 paid → pace 0.5/day, 20 left → 40 more days.
    // 20 Jan + 40 days = 1 March (2026 is not a leap year).
    const p = computeContractProgress(ledger('2026-01-01', 30, 10), '2026-01-20');
    expect(p.projectedEndDate).toBe('2026-03-01');
    expect(p.daysBehindSchedule).toBeGreaterThan(0);
  });

  it('reports completion on the last settled day once nothing is owed', () => {
    const rows = ledger('2026-01-01', 5, 5).map((o) => ({ ...o, settledDate: o.dueDate }));
    const p = computeContractProgress(rows, '2026-02-01');
    expect(p.projectionBasis).toBe('complete');
    expect(p.projectedEndDate).toBe('2026-01-05');
    expect(p.totalRemaining).toBe(0);
  });

  it('falls back to the schedule before the lease has started billing', () => {
    const p = computeContractProgress(ledger('2026-06-01', 30, 0), '2026-05-01');
    expect(p.projectionBasis).toBe('schedule');
    expect(p.projectedEndDate).toBe('2026-06-30');
  });

  it('declines to print an absurd date for a rider who has paid almost nothing', () => {
    const rows = ledger('2026-01-01', 2000, 1);
    const p = computeContractProgress(rows, '2026-06-01');
    expect(p.projectionBasis).toBe('unknown');
    expect(p.projectedEndDate).toBeNull();
  });

  it('handles an empty ledger without throwing', () => {
    const p = computeContractProgress([], '2026-01-01');
    expect(p.totalCount).toBe(0);
    expect(p.scheduledEndDate).toBeNull();
  });
});
