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

export type ScheduleType = 'daily' | 'selected_weekdays';

export type ScheduleInput = {
  startDate: string; // YYYY-MM-DD (local Dar es Salaam calendar date)
  endDate: string; // YYYY-MM-DD, inclusive
  scheduleType: ScheduleType;
  selectedWeekdays?: number[]; // 0=Sun .. 6=Sat (required for selected_weekdays)
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

export function generateSchedule(input: ScheduleInput): GeneratedObligation[] {
  if (!DATE_RE.test(input.startDate) || !DATE_RE.test(input.endDate)) {
    throw new ScheduleError('Invalid date format');
  }
  if (!TIME_RE.test(input.deadlineTime)) {
    throw new ScheduleError('Invalid deadline time');
  }

  const startMs = toUtcMidnight(input.startDate);
  const endMs = toUtcMidnight(input.endDate);
  if (endMs < startMs) throw new ScheduleError('End date is before start date');

  const weekdays =
    input.scheduleType === 'selected_weekdays'
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

/** Preview: obligation count and total contract value for an amount. */
export function scheduleSummary(
  input: ScheduleInput,
  installmentAmount: number,
): { count: number; total: number } {
  const count = generateSchedule(input).length;
  return { count, total: count * Math.round(installmentAmount) };
}
