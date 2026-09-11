import { describe, it, expect } from 'vitest';
import {
  summariseCollections,
  totalsBetween,
  shiftDays,
  reconciliationSnapshot,
  balanceExplanation,
  type CollectionPayment,
} from '@/lib/dashboard/collections';

const pay = (
  date: string,
  method: 'cash' | 'mobile_money',
  amount: number,
  id = `${date}-${method}-${amount}`,
): CollectionPayment => ({ paymentId: id, date, method, amount });

describe('shiftDays', () => {
  it('moves whole days without touching the calendar value', () => {
    expect(shiftDays('2026-09-11', -6)).toBe('2026-09-05');
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDays('2028-03-01', -1)).toBe('2028-02-29'); // leap year
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('totalsBetween', () => {
  const payments = [
    pay('2026-09-01', 'cash', 10_000),
    pay('2026-09-05', 'mobile_money', 20_000),
    pay('2026-09-11', 'cash', 30_000),
  ];

  it('includes both bounds', () => {
    expect(totalsBetween(payments, '2026-09-01', '2026-09-11').total).toBe(60_000);
    expect(totalsBetween(payments, '2026-09-05', '2026-09-05').total).toBe(20_000);
  });

  it('splits cash from Snippe so the two are never conflated', () => {
    const t = totalsBetween(payments, '2026-09-01', '2026-09-11');
    expect(t.cash).toBe(40_000);
    expect(t.mobile).toBe(20_000);
    expect(t.cash + t.mobile).toBe(t.total);
    expect(t.payments).toBe(3);
  });
});

describe('summariseCollections', () => {
  const today = '2026-09-11';
  const payments = [
    pay('2026-08-31', 'cash', 5_000), // previous month
    pay('2026-09-01', 'mobile_money', 7_000), // this month, outside 7 days
    pay('2026-09-05', 'cash', 11_000), // exactly 6 days back — inside the window
    pay('2026-09-11', 'mobile_money', 13_000), // today
  ];

  it('scopes each period correctly', () => {
    const s = summariseCollections(payments, today);
    expect(s.today.total).toBe(13_000);
    // Rolling 7 days = today and the six days before it.
    expect(s.week.total).toBe(24_000);
    expect(s.month.total).toBe(31_000);
    expect(s.allTime.total).toBe(36_000);
  });

  it('reports the window it used so the UI cannot mislabel it', () => {
    const s = summariseCollections(payments, today);
    expect(s.periods).toEqual({
      today: '2026-09-11',
      weekFrom: '2026-09-05',
      weekTo: '2026-09-11',
      monthFrom: '2026-09-01',
      monthTo: '2026-09-11',
    });
  });

  it('is all zeroes, not NaN, with no payments at all', () => {
    const s = summariseCollections([], today);
    expect(s.allTime).toEqual({ mobile: 0, cash: 0, total: 0, payments: 0 });
    expect(s.today.total).toBe(0);
  });

  it('treats any non-cash method as provider money', () => {
    // The enum is ('mobile_money','cash'); anything added later must not be
    // silently counted as cash, which would overstate what a human received.
    const s = summariseCollections([pay('2026-09-11', 'mobile_money', 100)], today);
    expect(s.today.mobile).toBe(100);
    expect(s.today.cash).toBe(0);
  });
});

describe('reconciliationSnapshot', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  const item = (status: string, amount: number, ageHours: number) => ({
    paymentId: `${status}-${ageHours}`,
    status,
    amount,
    createdAt: new Date(now - ageHours * 3_600_000).toISOString(),
    riderId: 'r1',
    riderName: 'Rider One',
  });

  it('counts pending and failed separately', () => {
    const s = reconciliationSnapshot(
      [item('pending', 10_000, 0.5), item('failed', 20_000, 3), item('expired', 5_000, 9)],
      now,
    );
    expect(s.pending).toEqual({ count: 1, amount: 10_000 });
    expect(s.failed).toEqual({ count: 2, amount: 25_000 });
  });

  it("counts 'created' as pending — it still holds its days reserved", () => {
    const s = reconciliationSnapshot([item('created', 10_000, 0.1)], now);
    expect(s.pending.count).toBe(1);
  });

  it('flags only pendings older than the stale cutoff', () => {
    const s = reconciliationSnapshot(
      [item('pending', 1, 0.5), item('pending', 2, 2), item('failed', 3, 48)],
      now,
    );
    expect(s.stale).toHaveLength(1);
    expect(s.stale[0]!.amount).toBe(2);
  });
});

describe('balanceExplanation', () => {
  it('says nothing when the balance is live', () => {
    expect(
      balanceExplanation({ state: 'ok', available: 1, balance: 1, currency: 'TZS' }),
    ).toBeNull();
  });

  it('names the exact fix for a key without collection:read', () => {
    const msg = balanceExplanation({ state: 'forbidden' })!;
    expect(msg).toContain('collection:read');
  });

  it('reassures that the ledger figures still stand when Snippe is down', () => {
    const msg = balanceExplanation({ state: 'unavailable', reason: 'network_error' })!;
    expect(msg).toContain('network_error');
    expect(msg).toContain('unaffected');
  });
});
