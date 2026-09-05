import { describe, it, expect } from 'vitest';
import { formatLongDate, formatDate } from '@/lib/dates/format';

describe('formatLongDate', () => {
  it('renders the full form the owner asked for', () => {
    expect(formatLongDate('2030-06-25')).toBe('Tuesday, 25 June 2030');
  });

  it('keeps the calendar day exactly — no timezone shift', () => {
    expect(formatLongDate('2026-01-01')).toBe('Thursday, 1 January 2026');
    expect(formatLongDate('2026-12-31')).toBe('Thursday, 31 December 2026');
  });

  it('renders an instant on its Dar es Salaam day', () => {
    // 21:30 UTC = 00:30 the NEXT day in EAT.
    expect(formatLongDate('2026-03-10T21:30:00.000Z')).toBe('Wednesday, 11 March 2026');
  });

  it('falls back rather than printing Invalid Date', () => {
    expect(formatLongDate(null)).toBe('—');
    expect(formatLongDate('')).toBe('—');
    expect(formatLongDate('not-a-date')).toBe('—');
  });

  it('leaves DD/MM/YYYY as the house format everywhere else', () => {
    expect(formatDate('2030-06-25')).toBe('25/06/2030');
  });
});
