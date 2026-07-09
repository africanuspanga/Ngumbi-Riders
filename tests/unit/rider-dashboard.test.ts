import { describe, it, expect } from 'vitest';
import {
  computeRiderDashboard,
  statusColor,
  riderCalendar,
  type RiderObligation,
} from '@/lib/dashboard/rider';

const TODAY = '2026-07-06';
const ob = (dueDate: string, status: string, amountDue = 5000): RiderObligation => ({ dueDate, amountDue, status });

describe('computeRiderDashboard', () => {
  it('reports overdue state and amount required now when arrears exist', () => {
    const obs = [
      ob('2026-07-04', 'overdue'),
      ob('2026-07-05', 'overdue'),
      ob('2026-07-06', 'due'),
      ob('2026-07-07', 'scheduled'),
      ob('2026-07-03', 'paid'),
    ];
    const d = computeRiderDashboard(obs, TODAY);
    expect(d.state).toBe('overdue');
    expect(d.arrearsCount).toBe(2);
    expect(d.arrearsAmount).toBe(10000);
    expect(d.amountRequiredNow).toBe(15000); // 2 overdue + today
    expect(d.nextDueDate).toBe('2026-07-06');
  });

  it('reports due state when only today is unpaid', () => {
    const d = computeRiderDashboard([ob('2026-07-06', 'due'), ob('2026-07-05', 'paid')], TODAY);
    expect(d.state).toBe('due');
    expect(d.amountRequiredNow).toBe(5000);
  });

  it('reports paid state when nothing is due or overdue', () => {
    const d = computeRiderDashboard([ob('2026-07-05', 'paid'), ob('2026-07-08', 'scheduled')], TODAY);
    expect(d.state).toBe('paid');
    expect(d.amountRequiredNow).toBe(0);
    expect(d.nextDueDate).toBe('2026-07-08');
  });

  it('computes contract progress', () => {
    const obs = [
      ob('2026-07-01', 'paid'),
      ob('2026-07-02', 'paid'),
      ob('2026-07-03', 'paid_in_advance'),
      ob('2026-07-06', 'due'),
      ob('2026-07-07', 'scheduled'),
    ];
    const d = computeRiderDashboard(obs, TODAY);
    expect(d.totalObligations).toBe(5);
    expect(d.paidCount).toBe(3);
    expect(d.remainingCount).toBe(2);
    expect(d.progressPercent).toBe(60);
    expect(d.paidValue).toBe(15000);
    expect(d.remainingValue).toBe(10000);
  });
});

describe('calendar colours (spec §15.1)', () => {
  it('maps each status to the correct colour', () => {
    expect(statusColor('paid')).toBe('green');
    expect(statusColor('paid_in_advance')).toBe('blue');
    expect(statusColor('overdue')).toBe('red');
    expect(statusColor('due')).toBe('amber');
    expect(statusColor('exempted')).toBe('grey');
    expect(statusColor('cancelled')).toBe('grey');
    expect(statusColor('scheduled')).toBe('neutral');
  });

  it('riderCalendar returns date-sorted coloured days', () => {
    const cal = riderCalendar([ob('2026-07-08', 'scheduled'), ob('2026-07-01', 'paid')]);
    expect(cal.map((c) => c.date)).toEqual(['2026-07-01', '2026-07-08']);
    expect(cal[0]!.color).toBe('green');
  });
});

describe('postponed obligations (replaced by a new scheduled row)', () => {
  it('does not double-count a postponed obligation in totals or progress', () => {
    // A postponement keeps the original row as 'postponed' AND inserts a
    // replacement 'scheduled' row — only the replacement may count.
    const obs = [
      ob('2026-07-04', 'paid'),
      ob('2026-07-05', 'postponed'),
      ob('2026-07-12', 'scheduled'), // replacement for 07-05
      ob('2026-07-06', 'due'),
    ];
    const d = computeRiderDashboard(obs, TODAY);
    expect(d.totalObligations).toBe(3);
    expect(d.remainingValue).toBe(10000); // replacement + today, NOT the postponed original
    expect(d.paidCount).toBe(1);
  });
});
