import { describe, it, expect } from 'vitest';
import {
  GROUP_ORDER,
  groupOf,
  groupPayments,
  type GroupedPaymentStatus,
} from '@/lib/payments/grouping';

const p = (status: string, amount: number) => ({ status, amount });

describe('groupOf', () => {
  it('maps every payment_status in the enum', () => {
    // Mirrors 0001_enums.sql. A status with no mapping must not silently
    // vanish from a page the owner reconciles money against.
    const statuses = [
      'created',
      'pending',
      'completed',
      'failed',
      'expired',
      'cancelled',
      'reversed',
    ];
    for (const s of statuses) {
      expect(GROUP_ORDER).toContain(groupOf(s));
    }
  });

  it('treats only completed as money received', () => {
    expect(groupOf('completed')).toBe('successful');
    expect(groupOf('pending')).not.toBe('successful');
    expect(groupOf('reversed')).not.toBe('successful');
  });

  it('shows the two in-flight statuses as one group', () => {
    expect(groupOf('created')).toBe('in_progress');
    expect(groupOf('pending')).toBe('in_progress');
  });

  it('does not drop an unrecognised status', () => {
    expect(GROUP_ORDER).toContain(groupOf('something_new'));
  });
});

describe('groupPayments', () => {
  it('puts successful money first', () => {
    const groups = groupPayments([p('failed', 1), p('completed', 2)]);
    expect(groups[0]?.group).toBe('successful');
  });

  it('totals each group independently', () => {
    const groups = groupPayments([
      p('completed', 10_000),
      p('completed', 5_000),
      p('failed', 7_000),
      p('expired', 3_000),
    ]);
    const total = (g: GroupedPaymentStatus) => groups.find((x) => x.group === g)?.total;
    expect(total('successful')).toBe(15_000);
    expect(total('failed')).toBe(7_000);
    expect(total('expired')).toBe(3_000);
  });

  it('omits empty groups rather than listing zeroes', () => {
    const groups = groupPayments([p('completed', 1)]);
    expect(groups).toHaveLength(1);
    expect(groups.map((g) => g.group)).toEqual(['successful']);
  });

  it('loses no payment', () => {
    const input = [
      p('completed', 1),
      p('pending', 2),
      p('failed', 3),
      p('expired', 4),
      p('cancelled', 5),
      p('reversed', 6),
      p('created', 7),
    ];
    const groups = groupPayments(input);
    expect(groups.reduce((n, g) => n + g.payments.length, 0)).toBe(input.length);
    expect(groups.reduce((n, g) => n + g.total, 0)).toBe(28);
  });

  it('preserves the incoming order inside a group', () => {
    const groups = groupPayments([p('completed', 3), p('failed', 9), p('completed', 1)]);
    expect(groups[0]?.payments.map((x) => x.amount)).toEqual([3, 1]);
  });

  it('handles an empty ledger', () => {
    expect(groupPayments([])).toEqual([]);
  });

  it('ignores a non-finite amount instead of poisoning the total with NaN', () => {
    const groups = groupPayments([p('completed', 1_000), p('completed', Number.NaN)]);
    expect(groups[0]?.total).toBe(1_000);
  });
});
