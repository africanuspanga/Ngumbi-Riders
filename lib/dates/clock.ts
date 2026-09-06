/*
 * Formatters for the live date/time readout in the dashboard corner (client
 * feedback 2026-09-05).
 *
 * They live in `lib/` rather than beside the `<LiveClock>` component because
 * BOTH sides need them: the server computes the first paint, the client
 * recomputes every second. A `'use client'` module's exports become client
 * references on the server, so calling one from a Server Component throws
 * ("Attempted to call formatClockDate() from the server") and takes the whole
 * page down — which is exactly what happened to /owner. Only components may
 * cross that boundary; shared plain functions belong here.
 *
 * Dependency-free apart from the timezone constant, so it is safe in either
 * environment (same contract as lib/dates/format.ts).
 */

import { APP_TIMEZONE } from './tz';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** e.g. "Sun, 06 Sep 2026" in Dar es Salaam. */
export function formatClockDate(at: Date): string {
  return dateFmt.format(at);
}

/** e.g. "13:41:07" in Dar es Salaam, 24-hour. */
export function formatClockTime(at: Date): string {
  return timeFmt.format(at);
}
