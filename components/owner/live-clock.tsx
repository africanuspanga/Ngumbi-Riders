'use client';

import { useSyncExternalStore } from 'react';
import { formatClockDate, formatClockTime } from '@/lib/dates/clock';

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
 *
 * The formatters live in lib/dates/clock.ts, NOT here: the owner dashboard is a
 * Server Component and must call them for the first paint. Exports of a
 * 'use client' module are client references on the server, so calling one from
 * there throws and crashes the page.
 */
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
