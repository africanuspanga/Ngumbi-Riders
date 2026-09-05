'use client';

import { useSyncExternalStore } from 'react';
import { APP_TIMEZONE } from '@/lib/dates/tz';

/*
 * Date and time in the top-right corner of the dashboard (client feedback
 * 2026-09-05).
 *
 * It is a CLIENT component that ticks every second, because a server-rendered
 * timestamp freezes at the moment the page was rendered — an owner who leaves
 * the dashboard open would read a stale time and trust it.
 *
 * Hydration safety: the server renders the `initial` strings it computed and
 * the client takes over after mount, via `useSyncExternalStore` — the clock is
 * an external system (a ticking interval), not derived state, so this is the
 * idiomatic subscription rather than a setState-in-effect cascade.
 */
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

export function formatClockDate(at: Date): string {
  return dateFmt.format(at);
}
export function formatClockTime(at: Date): string {
  return timeFmt.format(at);
}

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

/**
 * The snapshot is a single string so React's identity comparison works without
 * allocating a new object every tick (which would re-render forever).
 */
function getSnapshot(): string {
  const now = new Date();
  return `${formatClockDate(now)}|${formatClockTime(now)}`;
}

export function LiveClock({
  initialDate,
  initialTime,
}: {
  initialDate: string;
  initialTime: string;
}) {
  const serverSnapshot = `${initialDate}|${initialTime}`;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
  const [date, time] = snapshot.split('|');

  return (
    <div className="text-right leading-tight">
      <p className="text-muted-foreground text-xs sm:text-sm">{date}</p>
      <p className="text-base font-semibold tabular-nums sm:text-lg" suppressHydrationWarning>
        {time}
      </p>
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">Dar es Salaam</p>
    </div>
  );
}
