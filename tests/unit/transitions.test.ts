import { describe, it, expect } from 'vitest';
import {
  computeObligationTransitions,
  type TransitionObligation,
} from '@/lib/obligations/transitions';

const TODAY = '2026-07-06';
// Deadline today at 18:00 EAT = 15:00Z.
const DEADLINE = Date.parse('2026-07-06T15:00:00Z');
const ob = (id: string, dueDate: string, dueAtUtcMs: number, status: string): TransitionObligation => ({ id, dueDate, dueAtUtcMs, status });

describe('computeObligationTransitions', () => {
  it("flips today's scheduled obligation to due before the deadline", () => {
    const now = DEADLINE - 3_600_000; // 1h before deadline
    const r = computeObligationTransitions([ob('a', TODAY, DEADLINE, 'scheduled')], now, TODAY);
    expect(r.toDue).toEqual(['a']);
    expect(r.toOverdue).toEqual([]);
  });

  it('flips unpaid obligations to overdue after the deadline', () => {
    const now = DEADLINE + 60_000; // 1 min after deadline
    const r = computeObligationTransitions(
      [ob('a', TODAY, DEADLINE, 'due'), ob('b', TODAY, DEADLINE, 'scheduled')],
      now,
      TODAY,
    );
    expect(r.toOverdue.sort()).toEqual(['a', 'b']);
    expect(r.toDue).toEqual([]);
  });

  it('leaves future scheduled obligations untouched', () => {
    const future = Date.parse('2026-07-10T15:00:00Z');
    const now = DEADLINE - 3_600_000;
    const r = computeObligationTransitions([ob('x', '2026-07-10', future, 'scheduled')], now, TODAY);
    expect(r.toDue).toEqual([]);
    expect(r.toOverdue).toEqual([]);
  });

  it('never touches settled / exempted / cancelled obligations', () => {
    const now = DEADLINE + 60_000;
    const r = computeObligationTransitions(
      [
        ob('paid', TODAY, DEADLINE, 'paid'),
        ob('exempt', TODAY, DEADLINE, 'exempted'),
        ob('cancelled', TODAY, DEADLINE, 'cancelled'),
        ob('advance', TODAY, DEADLINE, 'paid_in_advance'),
      ],
      now,
      TODAY,
    );
    expect(r.toDue).toEqual([]);
    expect(r.toOverdue).toEqual([]);
  });

  it('does not re-flag already-overdue obligations', () => {
    const now = DEADLINE + 86_400_000;
    const r = computeObligationTransitions([ob('a', '2026-07-05', DEADLINE - 86_400_000, 'overdue')], now, TODAY);
    expect(r.toOverdue).toEqual([]);
  });
});
