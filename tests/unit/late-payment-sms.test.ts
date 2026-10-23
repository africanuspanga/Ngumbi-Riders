import { describe, it, expect } from 'vitest';
import {
  daysLate,
  stageFor,
  planLateReminders,
  ownerWarningDigest,
  type LateRiderInput,
} from '@/lib/reminders/late-payment';
import { isGsm7 } from '@/lib/mobishastra/text';

const rider = (oldestDueDate: string, over: Partial<LateRiderInput> = {}): LateRiderInput => ({
  riderId: 'r1',
  profileId: 'p1',
  firstName: 'Juma',
  fullName: 'Juma Ali',
  phone: '+255712000000',
  oldestObligationId: 'ob-1',
  oldestDueDate,
  owedAmount: 20_000,
  owedCount: 2,
  ...over,
});

describe('late-payment SMS reminders', () => {
  it('measures lateness from the oldest unpaid day', () => {
    expect(daysLate('2026-10-21', '2026-10-23')).toBe(2);
    expect(daysLate('2026-10-23', '2026-10-23')).toBe(0);
  });

  it('sends nothing before 48 hours, the 2-day message from 2, the warning from 7', () => {
    expect(stageFor(1)).toBeNull();
    expect(stageFor(2)).toBe('late_2d');
    expect(stageFor(6)).toBe('late_2d');
    expect(stageFor(7)).toBe('warn_7d');
    expect(stageFor(40)).toBe('warn_7d');
  });

  it('uses the owner\'s Swahili wording', () => {
    const [two] = planLateReminders([rider('2026-10-21')], '2026-10-23');
    expect(two!.text).toContain('hujalipa - unadaiwa malipo ya siku 2');
    expect(two!.text).toContain('TZS 20,000');
    const [seven] = planLateReminders([rider('2026-10-16')], '2026-10-23');
    expect(seven!.text).toContain('Kama hujalipa, hii itapelekea kuvunja mkataba');
  });

  it('keys each stage to the oldest unpaid obligation so it is sent once', () => {
    const [r] = planLateReminders([rider('2026-10-16', { oldestObligationId: 'abc' })], '2026-10-23');
    expect(r!.dedupeKey).toBe('late_sms_warn_7d:abc');
  });

  it('stays plain GSM text, so each reminder bills as a single-alphabet SMS', () => {
    for (const r of planLateReminders([rider('2026-10-21'), rider('2026-10-01', { riderId: 'r2' })], '2026-10-23')) {
      expect(isGsm7(r.text)).toBe(true);
    }
  });

  it('skips riders who owe nothing and lists the most overdue first', () => {
    const plan = planLateReminders(
      [
        rider('2026-10-21', { riderId: 'a' }),
        rider('2026-10-01', { riderId: 'b' }),
        rider('2026-10-01', { riderId: 'c', owedAmount: 0 }),
      ],
      '2026-10-23',
    );
    expect(plan.map((r) => r.riderId)).toEqual(['b', 'a']);
  });

  it('summarises today\'s warnings for the owner', () => {
    const plan = planLateReminders([rider('2026-10-01')], '2026-10-23');
    expect(ownerWarningDigest(plan)).toContain('Juma Ali (TZS 20,000)');
    expect(ownerWarningDigest([])).toBeNull();
  });
});
