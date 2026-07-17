/*
 * Obligation schedule engine (spec §11) — the accounting source of truth for
 * what a rider owes on each date. Pure and dependency-free so every rule is
 * unit tested: daily vs selected-weekday generation, leap years, month
 * boundaries, and UTC due-timestamps computed from Africa/Dar_es_Salaam.
 *
 * Tanzania observes EAT (UTC+3) year-round with NO daylight saving, so a local
 * wall-clock time maps to UTC by a fixed -3h offset. We encode that with an
 * explicit "+03:00" offset when building the due timestamp, which is exact and
 * immune to the host machine's timezone.
 */

export type ScheduleType = 'daily' | 'selected_weekdays' | 'weekly' | 'monthly';

export type ScheduleInput = {
  startDate: string; // YYYY-MM-DD (local Dar es Salaam calendar date)
  endDate: string; // YYYY-MM-DD, inclusive (ignored for monthly — see monthlyCount)
  scheduleType: ScheduleType;
  // 0=Sun .. 6=Sat. Required for selected_weekdays (1..N days) and for weekly
  // (exactly ONE day — one obligation per week on that weekday).
  selectedWeekdays?: number[];
  // Monthly only: the owner-set day-of-month the instalment is due (1..31; 31 =
  // last day of month, clamped per month) and how many monthly obligations to
  // emit (= the contract's duration in months).
  dueDayOfMonth?: number;
  monthlyCount?: number;
  deadlineTime: string; // HH:MM local (24h)
};

export type GeneratedObligation = {
  dueDate: string; // YYYY-MM-DD
  dueAtUtc: string; // ISO 8601 UTC
  localDueTime: string; // HH:MM
  weekday: number; // 0=Sun .. 6=Sat
};

// Safety cap: refuse absurd ranges (≈5 years of daily obligations).
const MAX_OBLIGATIONS = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toUtcMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The UTC instant of `dateStr` at `deadlineTime` in EAT (+03:00). */
export function dueTimestampUtc(dateStr: string, deadlineTime: string): string {
  return new Date(`${dateStr}T${deadlineTime}:00+03:00`).toISOString();
}

const daysInMonth = (year: number, monthIdx0: number): number =>
  new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();

/** Add `months` calendar months, clamping the day to the target month length. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m! - 1) + months;
  const targetYear = y! + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const day = Math.min(d!, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Inclusive end date for an N-month contract: start + N months − 1 day. */
export function endDateFromDuration(startDate: string, months: number): string {
  const exclusive = addMonths(startDate, months);
  return formatUtcDate(toUtcMidnight(exclusive) - 86_400_000);
}

export class ScheduleError extends Error {}

const weekdayOf = (dateStr: string): number =>
  new Date(toUtcMidnight(dateStr)).getUTCDay();

/**
 * Monthly schedule (spec #8/#13, owner decision 2026-07-17): exactly `count`
 * obligations, one per month, each due on `dueDay` (clamped to the month's
 * length, so 31 = last day of month). The FIRST obligation falls on the first
 * occurrence of the due day within the lease — i.e. this month if the due day
 * has not already passed on the start date, otherwise next month — and the rest
 * follow one calendar month apart. This guarantees N obligations for an N-month
 * contract regardless of the exact start/due days.
 */
function generateMonthly(input: ScheduleInput): GeneratedObligation[] {
  const dueDay = input.dueDayOfMonth;
  const count = input.monthlyCount;
  if (!dueDay || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new ScheduleError('Invalid monthly due day');
  }
  if (!count || !Number.isInteger(count) || count < 1) {
    throw new ScheduleError('Invalid monthly count');
  }
  if (count > MAX_OBLIGATIONS) {
    throw new ScheduleError('Schedule exceeds the maximum obligation count');
  }

  const [sy, sm, sd] = input.startDate.split('-').map(Number);
  const startMonthIdx0 = sm! - 1;
  // Does the (clamped) due day still lie on/after the start day this month?
  const startMonthDueDay = Math.min(dueDay, daysInMonth(sy!, startMonthIdx0));
  const firstOffset = startMonthDueDay >= sd! ? 0 : 1;

  const out: GeneratedObligation[] = [];
  for (let i = 0; i < count; i++) {
    const total = startMonthIdx0 + firstOffset + i;
    const y = sy! + Math.floor(total / 12);
    const mIdx = ((total % 12) + 12) % 12;
    const day = Math.min(dueDay, daysInMonth(y, mIdx));
    const dueDate = `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    out.push({
      dueDate,
      dueAtUtc: dueTimestampUtc(dueDate, input.deadlineTime),
      localDueTime: input.deadlineTime,
      weekday: weekdayOf(dueDate),
    });
  }
  return out;
}

export function generateSchedule(input: ScheduleInput): GeneratedObligation[] {
  if (!DATE_RE.test(input.startDate)) {
    throw new ScheduleError('Invalid date format');
  }
  if (!TIME_RE.test(input.deadlineTime)) {
    throw new ScheduleError('Invalid deadline time');
  }

  // Monthly is count-driven, not range-driven: it ignores endDate entirely.
  if (input.scheduleType === 'monthly') {
    return generateMonthly(input);
  }

  if (!DATE_RE.test(input.endDate)) {
    throw new ScheduleError('Invalid date format');
  }
  const startMs = toUtcMidnight(input.startDate);
  const endMs = toUtcMidnight(input.endDate);
  if (endMs < startMs) throw new ScheduleError('End date is before start date');

  // Weekly = one obligation per week on a single chosen weekday; it reuses the
  // same weekday-filter loop as selected_weekdays (the difference is enforced at
  // validation: weekly carries exactly one weekday).
  const weekdays =
    input.scheduleType === 'selected_weekdays' || input.scheduleType === 'weekly'
      ? new Set(input.selectedWeekdays ?? [])
      : null;
  if (weekdays && weekdays.size === 0) {
    throw new ScheduleError('No weekdays selected');
  }

  const out: GeneratedObligation[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const weekday = new Date(ms).getUTCDay();
    if (weekdays && !weekdays.has(weekday)) continue;
    const dueDate = formatUtcDate(ms);
    out.push({
      dueDate,
      dueAtUtc: dueTimestampUtc(dueDate, input.deadlineTime),
      localDueTime: input.deadlineTime,
      weekday,
    });
    if (out.length > MAX_OBLIGATIONS) {
      throw new ScheduleError('Schedule exceeds the maximum obligation count');
    }
  }
  return out;
}

/**
 * The inclusive end date to STORE on the contract: start + N months − 1 day for
 * every schedule type. For monthly this is deliberately the POSSESSION end of
 * the lease, NOT the last instalment's due date — a "12-month" contract signed
 * Jan 1 with due day 1 must read "Jan 1 → Dec 31" on the legal PDF, not
 * "Jan 1 → Dec 1" (and a 1-month contract starting Jan 15 with due day 20 must
 * not read as a 5-day lease). Monthly obligation GENERATION ignores the end
 * date entirely (it is count-driven), so this affects only the stored term.
 */
export function contractEndDate(opts: {
  scheduleType: ScheduleType;
  startDate: string;
  durationMonths: number;
  dueDayOfMonth?: number;
  deadlineTime: string;
}): string {
  return endDateFromDuration(opts.startDate, opts.durationMonths);
}

/** Preview: obligation count and total contract value for an amount. */
export function scheduleSummary(
  input: ScheduleInput,
  installmentAmount: number,
): { count: number; total: number } {
  const count = generateSchedule(input).length;
  return { count, total: count * Math.round(installmentAmount) };
}
