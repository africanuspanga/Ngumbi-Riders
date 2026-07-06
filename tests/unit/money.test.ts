import { describe, it, expect } from 'vitest';
import { formatTZS, sumTZS } from '@/lib/money/format';

describe('formatTZS', () => {
  it('formats whole shillings with thousands separators and no decimals', () => {
    expect(formatTZS(5000)).toBe('TZS 5,000');
    expect(formatTZS(0)).toBe('TZS 0');
    expect(formatTZS(1234567)).toBe('TZS 1,234,567');
  });

  it('rounds fractional inputs (money should never be fractional)', () => {
    expect(formatTZS(4999.6)).toBe('TZS 5,000');
  });

  it('guards against non-finite input', () => {
    expect(formatTZS(Number.NaN)).toBe('TZS 0');
  });
});

describe('sumTZS', () => {
  it('adds obligation amounts as integers', () => {
    expect(sumTZS([5000, 5000, 5000])).toBe(15000);
    expect(sumTZS([])).toBe(0);
  });
});
