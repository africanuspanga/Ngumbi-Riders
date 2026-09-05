import { describe, it, expect } from 'vitest';
import { buildStatement, methodLabel } from '@/lib/payments/statement';

const charges = [
  { date: '2026-01-01', amount: 10_000, status: 'paid' },
  { date: '2026-01-02', amount: 10_000, status: 'paid' },
  { date: '2026-01-03', amount: 10_000, status: 'overdue' },
  { date: '2026-01-04', amount: 10_000, status: 'cancelled' }, // never billed
];

const credits = [
  { date: '2026-01-02', amount: 20_000, method: 'cash', paymentId: 'p1', receivedByName: 'Asha' },
];

describe('buildStatement', () => {
  it('runs a balance down the page, charges before credits on the same day', () => {
    const s = buildStatement(charges, credits);
    expect(s.lines.map((l) => `${l.date}:${l.type}`)).toEqual([
      '2026-01-01:charge',
      '2026-01-02:charge',
      '2026-01-02:credit',
      '2026-01-03:charge',
    ]);
    expect(s.lines.map((l) => l.balance)).toEqual([10_000, 20_000, 0, 10_000]);
    expect(s.closingBalance).toBe(10_000);
  });

  it('ignores obligations that were never billed', () => {
    const s = buildStatement(charges, credits);
    expect(s.totalCharged).toBe(30_000);
  });

  it('names the person who received cash', () => {
    const s = buildStatement(charges, credits);
    const credit = s.lines.find((l) => l.type === 'credit')!;
    expect(credit.description).toContain('Asha');
    expect(credit.description).toContain('Cash');
  });

  it('folds earlier activity into the opening balance for a ranged statement', () => {
    const s = buildStatement(charges, credits, { from: '2026-01-03', to: '2026-01-31' });
    // 20,000 charged and 20,000 received before the window → opens at 0.
    expect(s.openingBalance).toBe(0);
    expect(s.lines).toHaveLength(1);
    expect(s.closingBalance).toBe(10_000);
  });

  it('labels a phone-loan instalment differently from a lease day', () => {
    const s = buildStatement(
      [{ date: '2026-01-01', amount: 300_000, status: 'due', kind: 'phone_loan' }],
      [],
    );
    expect(s.lines[0]!.description).toContain('Phone loan');
  });
});

describe('methodLabel', () => {
  it('renders provider methods in plain English', () => {
    expect(methodLabel('cash')).toBe('Cash');
    expect(methodLabel('mobile_money')).toBe('Mobile money');
    expect(methodLabel('something_else')).toBe('something_else');
  });
});
