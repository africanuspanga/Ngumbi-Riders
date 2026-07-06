import { describe, it, expect } from 'vitest';
import { formatReceiptNumber, isReceiptNumber } from '@/lib/payments/receipt';

describe('receipt number', () => {
  it('formats with zero-padded sequence', () => {
    expect(formatReceiptNumber(2026, 1)).toBe('NGR-RCPT-2026-000001');
    expect(formatReceiptNumber(2026, 123456)).toBe('NGR-RCPT-2026-123456');
  });
  it('validates format', () => {
    expect(isReceiptNumber('NGR-RCPT-2026-000001')).toBe(true);
    expect(isReceiptNumber('NGR-RCPT-26-1')).toBe(false);
  });
});
