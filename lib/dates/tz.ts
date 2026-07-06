/*
 * All business dates are computed in Africa/Dar_es_Salaam and stored as UTC
 * timestamps (spec §6.2, §11.3). This module centralises the timezone so the
 * obligation engine (Phase 4) and reports (Phase 9) stay consistent.
 *
 * Note: Tanzania observes EAT (UTC+3) year-round with no DST, which keeps the
 * conversions simple, but we still route everything through Intl for safety.
 */
export const APP_TIMEZONE = 'Africa/Dar_es_Salaam';

/** YYYY-MM-DD for the given instant in Dar es Salaam local time. */
export function localDateString(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts;
}

/** Human-readable date + time in Dar es Salaam, e.g. "06 Jul 2026, 21:00". */
export function formatLocalDateTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}
