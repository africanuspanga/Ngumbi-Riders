import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  scheduleSummary,
  addMonths,
  endDateFromDuration,
  contractEndDate,
  dueTimestampUtc,
  ScheduleError,
  type ScheduleInput,
} from '@/lib/obligations/schedule';

const daily = (startDate: string, endDate: string): ScheduleInput => ({
  startDate,
  endDate,
  scheduleType: 'daily',
  deadlineTime: '18:00',
});

describe('generateSchedule — daily', () => {
  it('generates one obligation per calendar day, inclusive', () => {
    const rows = generateSchedule(daily('2026-01-01', '2026-01-31'));
    expect(rows).toHaveLength(31);
    expect(rows[0]!.dueDate).toBe('2026-01-01');
    expect(rows.at(-1)!.dueDate).toBe('2026-01-31');
  });

  it('handles a single-day contract', () => {
    expect(generateSchedule(daily('2026-07-06', '2026-07-06'))).toHaveLength(1);
  });

  it('counts leap-year February correctly (29 days)', () => {
    expect(generateSchedule(daily('2024-02-01', '2024-02-29'))).toHaveLength(29);
  });

  it('counts non-leap February correctly (28 days)', () => {
    expect(generateSchedule(daily('2025-02-01', '2025-02-28'))).toHaveLength(28);
  });

  it('spans a leap day within a range', () => {
    const rows = generateSchedule(daily('2024-02-28', '2024-03-01'));
    expect(rows.map((r) => r.dueDate)).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
  });

  it('crosses a year boundary', () => {
    const rows = generateSchedule(daily('2025-12-30', '2026-01-02'));
    expect(rows.map((r) => r.dueDate)).toEqual([
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
    ]);
  });

  it('rejects an end date before the start', () => {
    expect(() => generateSchedule(daily('2026-02-01', '2026-01-01'))).toThrow(ScheduleError);
  });
});

describe('generateSchedule — selected weekdays', () => {
  it('emits only the selected weekdays', () => {
    // 2026-07-06 is a Monday. Mon/Wed/Fri = 1,3,5.
    const rows = generateSchedule({
      startDate: '2026-07-06',
      endDate: '2026-07-12',
      scheduleType: 'selected_weekdays',
      selectedWeekdays: [1, 3, 5],
      deadlineTime: '18:00',
    });
    expect(rows.map((r) => r.dueDate)).toEqual([
      '2026-07-06', // Mon
      '2026-07-08', // Wed
      '2026-07-10', // Fri
    ]);
    expect(rows.every((r) => [1, 3, 5].includes(r.weekday))).toBe(true);
  });

  it('rejects an empty weekday set', () => {
    expect(() =>
      generateSchedule({
        startDate: '2026-07-06',
        endDate: '2026-07-12',
        scheduleType: 'selected_weekdays',
        selectedWeekdays: [],
        deadlineTime: '18:00',
      }),
    ).toThrow(ScheduleError);
  });
});

describe('generateSchedule — weekly (one obligation per week)', () => {
  const weekly = (startDate: string, endDate: string, weekday: number): ScheduleInput => ({
    startDate,
    endDate,
    scheduleType: 'weekly',
    selectedWeekdays: [weekday],
    deadlineTime: '18:00',
  });

  it('emits one obligation per week on the chosen weekday', () => {
    // 2026-07-06 is a Monday; a ~4-week window.
    const rows = generateSchedule(weekly('2026-07-06', '2026-08-02', 1));
    expect(rows.map((r) => r.dueDate)).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ]);
    expect(rows.every((r) => r.weekday === 1)).toBe(true);
  });

  it('starts on the first occurrence of the weekday at/after the start', () => {
    // Start Wed 2026-07-08, weekly on Monday -> first Monday is 2026-07-13.
    const rows = generateSchedule(weekly('2026-07-08', '2026-07-27', 1));
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-07-13', '2026-07-20', '2026-07-27']);
  });

  it('rejects an empty weekday set', () => {
    expect(() =>
      generateSchedule({
        startDate: '2026-07-06',
        endDate: '2026-08-02',
        scheduleType: 'weekly',
        selectedWeekdays: [],
        deadlineTime: '18:00',
      }),
    ).toThrow(ScheduleError);
  });
});

describe('generateSchedule — monthly (one obligation per month)', () => {
  const monthly = (
    startDate: string,
    dueDayOfMonth: number,
    monthlyCount: number,
  ): ScheduleInput => ({
    startDate,
    endDate: startDate, // ignored for monthly
    scheduleType: 'monthly',
    dueDayOfMonth,
    monthlyCount,
    deadlineTime: '18:00',
  });

  it('emits exactly N obligations, first due-day within the lease (day ahead of start)', () => {
    // Start Jan 15, due day 20 -> Jan 20 has not passed, so it starts that month.
    const rows = generateSchedule(monthly('2026-01-15', 20, 3));
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-01-20', '2026-02-20', '2026-03-20']);
  });

  it('rolls to next month when the due day has already passed on the start date', () => {
    // Start Jan 15, due day 5 -> Jan 5 already passed, first is Feb 5.
    const rows = generateSchedule(monthly('2026-01-15', 5, 3));
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-02-05', '2026-03-05', '2026-04-05']);
  });

  it('includes the start month when the due day equals the start day', () => {
    const rows = generateSchedule(monthly('2026-01-05', 5, 2));
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-01-05', '2026-02-05']);
  });

  it('clamps day 31 to each month length (31 = last day of month)', () => {
    // Start Jan 1, due day 31 -> Jan 31, Feb 28 (2026 non-leap), Mar 31, Apr 30.
    const rows = generateSchedule(monthly('2026-01-01', 31, 4));
    expect(rows.map((r) => r.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('clamps to leap-year February', () => {
    const rows = generateSchedule(monthly('2024-01-15', 31, 2));
    expect(rows.map((r) => r.dueDate)).toEqual(['2024-01-31', '2024-02-29']);
  });

  it('crosses a year boundary', () => {
    const rows = generateSchedule(monthly('2026-11-10', 10, 3));
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
  });

  it('carries the correct EAT-derived UTC deadline instant', () => {
    const [row] = generateSchedule(monthly('2026-01-15', 20, 1));
    expect(row!.dueAtUtc).toBe('2026-01-20T15:00:00.000Z');
  });

  it('rejects an out-of-range due day', () => {
    expect(() => generateSchedule(monthly('2026-01-15', 0, 3))).toThrow(ScheduleError);
    expect(() => generateSchedule(monthly('2026-01-15', 32, 3))).toThrow(ScheduleError);
  });

  it('rejects a non-positive count', () => {
    expect(() => generateSchedule(monthly('2026-01-15', 20, 0))).toThrow(ScheduleError);
  });
});

describe('contractEndDate', () => {
  it('daily/weekday terms end at start + N months − 1 day', () => {
    expect(
      contractEndDate({
        scheduleType: 'daily',
        startDate: '2026-01-01',
        durationMonths: 3,
        deadlineTime: '18:00',
      }),
    ).toBe('2026-03-31');
  });

  it('monthly terms end on the final monthly due date', () => {
    // Start Jan 15, due day 20, 3 months -> last obligation 2026-03-20.
    expect(
      contractEndDate({
        scheduleType: 'monthly',
        startDate: '2026-01-15',
        durationMonths: 3,
        dueDayOfMonth: 20,
        deadlineTime: '18:00',
      }),
    ).toBe('2026-03-20');
  });
});

describe('scheduleSummary — monthly', () => {
  it('counts N monthly obligations at the instalment amount', () => {
    const { count, total } = scheduleSummary(
      {
        startDate: '2026-01-15',
        endDate: '2026-01-15',
        scheduleType: 'monthly',
        dueDayOfMonth: 20,
        monthlyCount: 6,
        deadlineTime: '18:00',
      },
      150_000,
    );
    expect(count).toBe(6);
    expect(total).toBe(900_000);
  });
});

describe('due timestamp — UTC from EAT', () => {
  it('converts an 18:00 EAT deadline to 15:00Z', () => {
    expect(dueTimestampUtc('2026-07-06', '18:00')).toBe('2026-07-06T15:00:00.000Z');
  });

  it('a 01:00 EAT deadline maps to 22:00Z the previous day', () => {
    expect(dueTimestampUtc('2026-07-06', '01:00')).toBe('2026-07-05T22:00:00.000Z');
  });

  it('every generated obligation carries the correct UTC instant', () => {
    const [row] = generateSchedule(daily('2026-07-06', '2026-07-06'));
    expect(row!.dueAtUtc).toBe('2026-07-06T15:00:00.000Z');
  });
});

describe('addMonths / endDateFromDuration', () => {
  it('adds months and clamps to month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); // clamp
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap clamp
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('computes an inclusive end date (start + N months − 1 day)', () => {
    expect(endDateFromDuration('2026-01-01', 1)).toBe('2026-01-31');
    expect(endDateFromDuration('2026-01-01', 12)).toBe('2026-12-31');
    expect(endDateFromDuration('2026-01-31', 1)).toBe('2026-02-27');
  });
});

describe('scheduleSummary', () => {
  it('multiplies obligation count by the installment amount', () => {
    const { count, total } = scheduleSummary(daily('2026-01-01', '2026-01-30'), 5000);
    expect(count).toBe(30);
    expect(total).toBe(150_000);
  });
});
