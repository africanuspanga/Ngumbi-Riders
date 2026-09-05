import { describe, it, expect } from 'vitest';
import {
  instalmentFromDailyRate,
  dailyRateFromInstalment,
  explainInstalment,
  DAYS_PER_PAYMENT,
} from '@/lib/contracts/pricing';

describe('instalmentFromDailyRate', () => {
  it('multiplies the daily rate by 7 for a weekly contract', () => {
    expect(instalmentFromDailyRate(10_000, 'weekly')).toBe(70_000);
  });

  it('multiplies by 30 for a monthly contract', () => {
    expect(instalmentFromDailyRate(10_000, 'monthly')).toBe(300_000);
  });

  it('is the daily rate itself for daily and custom-weekday contracts', () => {
    expect(instalmentFromDailyRate(10_000, 'daily')).toBe(10_000);
    expect(instalmentFromDailyRate(10_000, 'selected_weekdays')).toBe(10_000);
  });

  it('returns 0 for a missing or invalid rate rather than guessing', () => {
    expect(instalmentFromDailyRate(null, 'weekly')).toBe(0);
    expect(instalmentFromDailyRate(0, 'weekly')).toBe(0);
    expect(instalmentFromDailyRate(-5, 'weekly')).toBe(0);
  });
});

describe('dailyRateFromInstalment', () => {
  it('inverts the calculation for existing contracts', () => {
    expect(dailyRateFromInstalment(70_000, 'weekly')).toBe(10_000);
    expect(dailyRateFromInstalment(300_000, 'monthly')).toBe(10_000);
  });

  it('returns null rather than inventing a fractional rate', () => {
    expect(dailyRateFromInstalment(65_000, 'weekly')).toBeNull();
    expect(dailyRateFromInstalment(0, 'weekly')).toBeNull();
  });
});

describe('explainInstalment', () => {
  it('shows the owner the arithmetic', () => {
    expect(explainInstalment(10_000, 'weekly')).toBe(
      'TZS 10,000 × 7 days = TZS 70,000 per week.',
    );
    expect(explainInstalment(10_000, 'monthly')).toContain('per month');
    expect(explainInstalment(null, 'weekly')).toBeNull();
  });
});

describe('DAYS_PER_PAYMENT', () => {
  it('treats a month as a flat 30 days for PRICING only', () => {
    expect(DAYS_PER_PAYMENT.monthly).toBe(30);
    expect(DAYS_PER_PAYMENT.weekly).toBe(7);
  });
});
