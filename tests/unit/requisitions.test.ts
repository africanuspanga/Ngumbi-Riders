import { describe, it, expect } from 'vitest';
import {
  lineAmount,
  requisitionTotal,
  canTransition,
  isEditable,
  isClosed,
  awaitsDecision,
} from '@/lib/requisitions/compute';
import {
  formatRequisitionNumber,
  monthPrefix,
  parseRequisitionSeq,
  yearMonthOf,
} from '@/lib/requisitions/numbering';
import { yearOf } from '@/lib/requisitions/constants';
import { requisitionSchema, requisitionItemSchema } from '@/lib/requisitions/validation';

/*
 * Purchase requisitions (client feedback 2026-09-05). The arithmetic and the
 * status machine are the business rules the Managing Director's approval rests
 * on, so they are pure and tested here.
 */

describe('line amounts', () => {
  it('multiplies quantity by unit price', () => {
    expect(lineAmount({ quantity: 5, unitPrice: 3_200_000 })).toBe(16_000_000);
  });

  it('treats a half-typed row as zero rather than NaN', () => {
    expect(lineAmount({ quantity: 1, unitPrice: Number.NaN })).toBe(0);
    expect(lineAmount({ quantity: Number.NaN, unitPrice: 1000 })).toBe(0);
    expect(lineAmount({ quantity: 0, unitPrice: 1000 })).toBe(0);
    expect(lineAmount({ quantity: -3, unitPrice: 1000 })).toBe(0);
    expect(lineAmount({ quantity: 2, unitPrice: -1 })).toBe(0);
  });

  it('keeps amounts integer TZS', () => {
    // A fractional quantity cannot produce a fractional shilling.
    expect(lineAmount({ quantity: 2.9, unitPrice: 1000 })).toBe(2000);
  });
});

describe('requisition total', () => {
  it('sums the lines', () => {
    expect(
      requisitionTotal([
        { quantity: 5, unitPrice: 3_200_000 },
        { quantity: 10, unitPrice: 45_000 },
        { quantity: 1, unitPrice: 120_000 },
      ]),
    ).toBe(16_570_000);
  });

  it('is zero for an empty request', () => {
    expect(requisitionTotal([])).toBe(0);
  });

  it('ignores incomplete rows instead of poisoning the total', () => {
    expect(
      requisitionTotal([
        { quantity: 2, unitPrice: 50_000 },
        { quantity: 1, unitPrice: Number.NaN },
      ]),
    ).toBe(100_000);
  });
});

describe('status machine', () => {
  it('allows the intended path', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'approved')).toBe(true);
    expect(canTransition('submitted', 'rejected')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('submitted', 'cancelled')).toBe(true);
  });

  it('refuses to approve a draft that was never submitted', () => {
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('draft', 'rejected')).toBe(false);
  });

  it('treats a decided request as final', () => {
    for (const from of ['approved', 'rejected', 'cancelled'] as const) {
      for (const to of ['draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('classifies the statuses consistently', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('submitted')).toBe(false);
    expect(awaitsDecision('submitted')).toBe(true);
    expect(awaitsDecision('draft')).toBe(false);
    expect(isClosed('approved')).toBe(true);
    expect(isClosed('rejected')).toBe(true);
    expect(isClosed('cancelled')).toBe(true);
    expect(isClosed('draft')).toBe(false);
    expect(isClosed('submitted')).toBe(false);
  });
});

describe('requisition numbering', () => {
  it('formats REQ/YYYY/MM/NNNN', () => {
    expect(formatRequisitionNumber(2026, 9, 30)).toBe('REQ/2026/09/0030');
    expect(formatRequisitionNumber(2026, 12, 1)).toBe('REQ/2026/12/0001');
  });

  it('round-trips the sequence', () => {
    expect(parseRequisitionSeq('REQ/2026/09/0030')).toBe(30);
    expect(parseRequisitionSeq('REQ/2026/09/9999')).toBe(9999);
    expect(parseRequisitionSeq('nonsense')).toBe(0);
  });

  it('sorts lexicographically in numeric order within a month', () => {
    const numbers = [1, 2, 9, 10, 99, 100, 1000].map((n) =>
      formatRequisitionNumber(2026, 9, n),
    );
    expect([...numbers].sort()).toEqual(numbers);
  });

  it('shares one prefix per month', () => {
    expect(monthPrefix(2026, 9)).toBe('REQ/2026/09/');
    expect(formatRequisitionNumber(2026, 9, 30).startsWith(monthPrefix(2026, 9))).toBe(true);
    expect(formatRequisitionNumber(2026, 10, 1).startsWith(monthPrefix(2026, 9))).toBe(false);
  });

  it('reads the month textually, so no timezone can shift it', () => {
    expect(yearMonthOf('2026-01-01')).toEqual({ year: 2026, month: 1 });
    expect(yearMonthOf('2026-12-31')).toEqual({ year: 2026, month: 12 });
    expect(yearOf('2026-01-01')).toBe(2026);
  });
});

describe('validation', () => {
  const validItem = {
    description: 'Boxer BM 150',
    category: 'motorcycle',
    quantity: '5',
    unit: 'unit',
    unitPrice: '3200000',
    budgetCover: 'collections',
  };

  it('coerces the numeric inputs the form sends as strings', () => {
    const parsed = requisitionItemSchema.parse(validItem);
    expect(parsed.quantity).toBe(5);
    expect(parsed.unitPrice).toBe(3_200_000);
  });

  it('rejects a line with no price', () => {
    expect(requisitionItemSchema.safeParse({ ...validItem, unitPrice: '0' }).success).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(requisitionItemSchema.safeParse({ ...validItem, quantity: '1.5' }).success).toBe(false);
  });

  it('rejects a category that is not one of ours', () => {
    expect(
      requisitionItemSchema.safeParse({ ...validItem, category: 'helicopter' }).success,
    ).toBe(false);
  });

  it('requires at least one item', () => {
    const base = {
      title: 'Purchase of 5 new motorcycles',
      department: 'fleet',
      requestDate: '2026-09-05',
      approverId: '00000000-0000-4000-8000-000000000000',
    };
    expect(requisitionSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(requisitionSchema.safeParse({ ...base, items: [validItem] }).success).toBe(true);
  });

  it('rejects a malformed request date', () => {
    expect(
      requisitionSchema.safeParse({
        title: 'Fuel for the week',
        department: 'operations',
        requestDate: '05/09/2026',
        approverId: '00000000-0000-4000-8000-000000000000',
        items: [validItem],
      }).success,
    ).toBe(false);
  });
});
