import { describe, it, expect } from 'vitest';
import { toMsisdn } from '@/lib/mobishastra/client';

describe('Mobishastra msisdn normalization', () => {
  it('strips the leading + and non-digits, keeping the country code', () => {
    expect(toMsisdn('+255781600077')).toBe('255781600077');
    expect(toMsisdn('+255 781 600 077')).toBe('255781600077');
    expect(toMsisdn('255-781-600-077')).toBe('255781600077');
  });

  it('drops everything non-numeric', () => {
    expect(toMsisdn('n/a')).toBe('');
  });
});
