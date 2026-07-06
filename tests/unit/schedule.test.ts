import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  scheduleSummary,
  addMonths,
  endDateFromDuration,
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
