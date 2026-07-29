/*
 * The single date-formatting utility for every user-facing surface (build spec
 * #5). House format is **DD/MM/YYYY** — the format the owner and riders read in
 * Tanzania — e.g. 29/07/2026.
 *
 * Storage is untouched: Postgres `date` columns stay ISO `YYYY-MM-DD` and
 * `timestamptz` columns stay UTC. Only DISPLAY changes. `<input type="date">`
 * still needs ISO, so use `toIsoDate` / `toDateInputValue` there — never a
 * formatted string.
 *
 * Two kinds of value flow through here and they must NOT be treated alike:
 *
 *   • Calendar dates (`due_date`, `start_date`, `expense_date`, …) are plain
 *     `YYYY-MM-DD` with no time or zone. Formatting them through a timezone
 *     conversion shifts them by a day, so they are split textually instead.
 *   • Instants (`created_at`, `completed_at`, …) are UTC timestamps and MUST be
 *     rendered in Africa/Dar_es_Salaam, which is what `Intl` does here.
 *
 * This module is deliberately dependency-free and safe in client components.
 */

import { APP_TIMEZONE } from './tz';

/** What we print when a date is absent. */
export const EMPTY_DATE = '—';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateInput = string | number | Date | null | undefined;

/** True for a bare `YYYY-MM-DD` calendar date (no time component). */
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function toDate(value: Exclude<DateInput, null | undefined>): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parts of an instant as they read on the wall clock in Dar es Salaam. */
function eatParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

/**
 * DD/MM/YYYY. Accepts a `YYYY-MM-DD` calendar date (formatted verbatim) or an
 * instant/ISO timestamp (converted to Dar es Salaam first). Returns `—` for
 * null/undefined/empty/unparseable input so a missing date never renders as
 * "Invalid Date" or "NaN/NaN/NaN".
 */
export function formatDate(value: DateInput, fallback = EMPTY_DATE): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (isIsoDate(value)) {
    const [, y, m, d] = ISO_DATE_RE.exec(value)!;
    return `${d}/${m}/${y}`;
  }
  const date = toDate(value);
  if (!date) return fallback;
  const p = eatParts(date);
  return `${p.day}/${p.month}/${p.year}`;
}

/** DD/MM/YYYY HH:MM in Dar es Salaam (24h), e.g. "29/07/2026 18:00". */
export function formatDateTime(value: DateInput, fallback = EMPTY_DATE): string {
  if (value === null || value === undefined || value === '') return fallback;
  // A bare calendar date has no time — don't invent 00:00 from a UTC parse.
  if (isIsoDate(value)) return formatDate(value, fallback);
  const date = toDate(value);
  if (!date) return fallback;
  const p = eatParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** HH:MM in Dar es Salaam, for time-only display next to a date. */
export function formatTime(value: DateInput, fallback = EMPTY_DATE): string {
  if (value === null || value === undefined || value === '') return fallback;
  const date = toDate(value);
  if (!date) return fallback;
  const p = eatParts(date);
  return `${p.hour}:${p.minute}`;
}

/**
 * "29/07/2026 – 30/09/2026" for a report/filter range. Either end may be
 * missing (open-ended range).
 */
export function formatDateRange(from: DateInput, to: DateInput): string {
  const a = formatDate(from, '');
  const b = formatDate(to, '');
  if (a && b) return `${a} – ${b}`;
  if (a) return `From ${a}`;
  if (b) return `Until ${b}`;
  return EMPTY_DATE;
}

/**
 * ISO `YYYY-MM-DD` for storage, `<input type="date">` values and query strings.
 * Calendar dates pass through unchanged; instants are reduced to their Dar es
 * Salaam calendar day (never the UTC day, which is a day behind after 21:00).
 */
export function toIsoDate(value: DateInput): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (isIsoDate(value)) return value;
  const date = toDate(value);
  if (!date) return null;
  const p = eatParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Alias that reads better at `<input type="date" value={…}>` call sites. */
export const toDateInputValue = (value: DateInput): string => toIsoDate(value) ?? '';

/**
 * Parse a user-typed DD/MM/YYYY into ISO `YYYY-MM-DD`, or null when it is not a
 * real calendar date. Rejects 31/02/2026 rather than rolling it into March.
 */
export function parseDdMmYyyy(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Swahili + English weekday/month labels for the rider calendar headers. */
export const WEEKDAY_SHORT_SW = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];

/**
 * "Monday 29/07/2026" — used where the weekday genuinely helps (payment
 * calendars, schedule previews).
 */
export function formatDateWithWeekday(value: DateInput, fallback = EMPTY_DATE): string {
  const iso = toIsoDate(value);
  if (!iso) return fallback;
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return `${weekday} ${formatDate(iso)}`;
}
