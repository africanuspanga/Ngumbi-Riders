import { describe, it, expect } from 'vitest';
import { formatRiderNumber, parseRiderNumberSeq } from '@/lib/riders/numbering';

describe('rider numbering (max-based, not count-based)', () => {
  it('formats with the NGR-R- prefix zero-padded to 4 digits', () => {
    expect(formatRiderNumber(1)).toBe('NGR-R-0001');
    expect(formatRiderNumber(13)).toBe('NGR-R-0013');
    expect(formatRiderNumber(9999)).toBe('NGR-R-9999');
  });

  it('round-trips format → parse', () => {
    for (const seq of [1, 42, 13, 9999]) {
      expect(parseRiderNumberSeq(formatRiderNumber(seq))).toBe(seq);
    }
  });

  it('parses the numeric suffix regardless of padding', () => {
    expect(parseRiderNumberSeq('NGR-R-0013')).toBe(13);
    expect(parseRiderNumberSeq('NGR-R-10001')).toBe(10001);
  });

  it('returns 0 for unrecognised values (next seq becomes 1)', () => {
    expect(parseRiderNumberSeq('')).toBe(0);
    expect(parseRiderNumberSeq('NGR-R-')).toBe(0);
    expect(parseRiderNumberSeq('garbage')).toBe(0);
  });

  it('regression: next number after deletions follows the MAX, not the count', () => {
    // Live incident 2026-07-20: riders 0001–0004 deleted, 0005–0013 remain.
    // count(*)+1 = 0010 → collided with the existing NGR-R-0010 and every
    // manual creation failed as a bogus "phone already exists".
    const remaining = [5, 6, 7, 8, 9, 10, 11, 12, 13].map(formatRiderNumber);
    const maxSeq = Math.max(...remaining.map(parseRiderNumberSeq));
    expect(formatRiderNumber(maxSeq + 1)).toBe('NGR-R-0014');
    expect(remaining).not.toContain(formatRiderNumber(maxSeq + 1));
  });
});
