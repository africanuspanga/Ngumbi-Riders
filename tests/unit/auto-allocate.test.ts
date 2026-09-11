import { describe, it, expect } from 'vitest';
import {
  autoAllocate,
  allocationWarnings,
  remainderNote,
} from '@/lib/payments/auto-allocate';
import type { SelectableObligation } from '@/lib/payments/selection';

const day = (
  id: string,
  dueDate: string,
  amountDue = 10_000,
  status = 'overdue',
): SelectableObligation => ({ id, dueDate, amountDue, status });

// Three unpaid 10,000 days, deliberately supplied OUT of date order so the
// oldest-first rule is actually being tested rather than the input order.
const threeDays = [
  day('c', '2026-09-03'),
  day('a', '2026-09-01'),
  day('b', '2026-09-02'),
];

describe('autoAllocate — the worked example from the brief', () => {
  it('clears three days for 30,000 when the daily obligation is 10,000', () => {
    const a = autoAllocate(threeDays, 30_000);
    expect(a.obligations.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(a.allocated).toBe(30_000);
    expect(a.remainder).toBe(0);
    expect(a.exact).toBe(true);
    expect(a.coversAll).toBe(true);
  });
});

describe('autoAllocate — oldest first', () => {
  it('always takes the oldest day first, whatever order the rows arrive in', () => {
    const a = autoAllocate(threeDays, 10_000);
    expect(a.obligations.map((o) => o.id)).toEqual(['a']);
  });

  it('never skips an older day to fit a cheaper newer one', () => {
    // 5,000 would exactly clear the second day, but the oldest is 10,000 and
    // settlement refuses a selection that skips it (migration 0018).
    const a = autoAllocate([day('a', '2026-09-01', 10_000), day('b', '2026-09-02', 5_000)], 5_000);
    expect(a.obligations).toHaveLength(0);
    expect(a.none).toBe(true);
  });
});

describe('autoAllocate — never over-clears', () => {
  it('leaves a day unpaid when the money does not cover all of it', () => {
    const a = autoAllocate(threeDays, 25_000);
    expect(a.obligations.map((o) => o.id)).toEqual(['a', 'b']);
    expect(a.allocated).toBe(20_000);
    expect(a.remainder).toBe(5_000);
    expect(a.exact).toBe(false);
  });

  it('stops at what is outstanding and reports the rest as remainder', () => {
    const a = autoAllocate(threeDays, 100_000);
    expect(a.allocated).toBe(30_000);
    expect(a.remainder).toBe(70_000);
    expect(a.coversAll).toBe(true);
    expect(a.remainingAfter).toBe(0);
  });

  it('handles obligations of different sizes (a monthly + a phone instalment)', () => {
    const a = autoAllocate(
      [day('a', '2026-09-01', 300_000), day('b', '2026-10-01', 300_000)],
      450_000,
    );
    expect(a.obligations.map((o) => o.id)).toEqual(['a']);
    expect(a.allocated).toBe(300_000);
    expect(a.remainder).toBe(150_000);
    expect(a.remainingAfter).toBe(300_000);
  });
});

describe('autoAllocate — too little', () => {
  it('clears nothing and says how much is short', () => {
    const a = autoAllocate(threeDays, 4_000);
    expect(a.none).toBe(true);
    expect(a.allocated).toBe(0);
    expect(a.shortfall).toBe(6_000);
  });

  it('reports no shortfall when there was nothing to clear', () => {
    const a = autoAllocate([], 10_000);
    expect(a.none).toBe(true);
    expect(a.shortfall).toBe(0);
    expect(a.coversAll).toBe(false);
  });

  it('treats a zero or negative amount as clearing nothing', () => {
    expect(autoAllocate(threeDays, 0).none).toBe(true);
    expect(autoAllocate(threeDays, -5_000).allocated).toBe(0);
  });
});

describe('autoAllocate — only outstanding days are eligible', () => {
  it('ignores paid, exempted, postponed and cancelled obligations', () => {
    const a = autoAllocate(
      [
        day('paid', '2026-08-01', 10_000, 'paid'),
        day('exempt', '2026-08-02', 10_000, 'exempted'),
        day('postponed', '2026-08-03', 10_000, 'postponed'),
        day('cancelled', '2026-08-04', 10_000, 'cancelled'),
        day('due', '2026-09-01', 10_000, 'due'),
      ],
      30_000,
    );
    expect(a.obligations.map((o) => o.id)).toEqual(['due']);
    expect(a.allocated).toBe(10_000);
    expect(a.remainder).toBe(20_000);
  });
});

describe('allocationWarnings', () => {
  it('refuses an empty amount before anything else', () => {
    const w = allocationWarnings(autoAllocate(threeDays, 0));
    expect(w[0]!.level).toBe('error');
  });

  it('warns loudly about change that will not be recorded', () => {
    const w = allocationWarnings(autoAllocate(threeDays, 25_000));
    const warn = w.find((x) => x.level === 'warning')!;
    expect(warn.message).toContain('5,000');
    expect(warn.message).toContain('NOT be recorded');
  });

  it('says nothing about change on an exact payment', () => {
    const w = allocationWarnings(autoAllocate(threeDays, 30_000));
    expect(w.some((x) => x.level === 'warning')).toBe(false);
  });

  it('explains a shortfall in shillings rather than just refusing', () => {
    const w = allocationWarnings(autoAllocate(threeDays, 4_000));
    expect(w[0]!.message).toContain('6,000');
  });

  it('states what will still be outstanding afterwards', () => {
    const w = allocationWarnings(autoAllocate(threeDays, 10_000));
    expect(w.some((x) => x.message.includes('20,000'))).toBe(true);
  });
});

describe('remainderNote', () => {
  it('writes the change into the payment note', () => {
    const note = remainderNote(autoAllocate(threeDays, 25_000));
    expect(note).toContain('25,000');
    expect(note).toContain('5,000');
  });

  it('is empty on an exact payment', () => {
    expect(remainderNote(autoAllocate(threeDays, 30_000))).toBe('');
  });
});
