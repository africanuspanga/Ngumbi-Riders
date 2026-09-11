import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { LiveClock } from './live-clock';
import { CollectionRibbon } from './collection-ribbon';
import { ArrowRightIcon } from 'lucide-react';
import type { CollectionsPoint } from '@/lib/dashboard/queries';

/*
 * THE TODAY BAND — the dashboard's thesis.
 *
 * Mr. Ng'umbi's entire working day is one question: will every rider pay before
 * the deadline? So the largest thing on this page is deliberately not a total —
 * it is a RATIO, today's collections against today's expectation, with the
 * deadline and the number of riders still to pay sitting under it.
 *
 * Everything else on the dashboard is a quiet white card. This is the one place
 * that spends any boldness: a deep forest ground, the display face at full size,
 * and the collection ribbon. One accessory, worn once.
 *
 * A SERVER component. The only client code inside it is <LiveClock>, which has
 * to tick — a server-rendered time freezes at render and an owner who leaves
 * this open all afternoon would read a stale clock and trust it.
 */
export function TodayBand({
  collectedToday,
  expectedToday,
  outstandingToday,
  unpaidRiders,
  paidRiders,
  deadline,
  series,
  today,
  nowDate,
  nowTime,
}: {
  collectedToday: number;
  expectedToday: number;
  outstandingToday: number;
  unpaidRiders: number;
  paidRiders: number;
  /** Payment deadline as HH:MM, from app settings. */
  deadline: string;
  series: CollectionsPoint[];
  today: string;
  nowDate: string;
  nowTime: string;
}) {
  /*
   * The meter is collected ÷ expected, capped at 100% for WIDTH only. Paying in
   * advance legitimately pushes collections past the day's expectation, and a
   * bar overflowing its track would read as a rendering bug rather than as good
   * news — so the overshoot is stated in words instead.
   */
  const ratio = expectedToday > 0 ? collectedToday / expectedToday : null;
  const pct = ratio === null ? 0 : Math.min(ratio * 100, 100);
  const ahead = ratio !== null && ratio > 1;
  const settled = expectedToday > 0 && outstandingToday <= 0;

  return (
    <section className="relative overflow-hidden rounded-[--radius-card] bg-[color:var(--color-band)] text-white">
      {/* A single soft light from the top-left. Enough to stop the ground
          reading as flat black-green; not enough to become a "gradient card". */}
      <div
        className="pointer-events-none absolute -left-24 -top-32 size-[28rem] rounded-full bg-[color:var(--color-signal)]/[0.07] blur-3xl"
        aria-hidden
      />

      <div className="relative flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-stretch lg:gap-10">
        {/* ---------------------------------------------------- the ratio --- */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-5">
          <div className="flex items-start justify-between gap-4">
            <span className="eyebrow text-[color:var(--color-signal)]/70">
              Collected today
            </span>
            {/* The clock belongs up here with the date, not floating over the
                page: it is context for the figure below it. */}
            <div className="shrink-0 text-right leading-tight">
              <p className="font-display text-xs text-white/50">{nowDate}</p>
              <LiveClock initialDate={nowDate} initialTime={nowTime} variant="band" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="font-display text-[clamp(2.25rem,7vw,3.75rem)] font-bold leading-[0.95] text-white">
              {formatTZS(collectedToday)}
            </p>
            <p className="text-sm text-white/60">
              of <span className="font-display text-white/90">{formatTZS(expectedToday)}</span>{' '}
              expected from {paidRiders + unpaidRiders} rider
              {paidRiders + unpaidRiders === 1 ? '' : 's'} today
            </p>

            <div className="flex flex-col gap-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.14]">
                <div
                  className={`h-full rounded-full ${
                    settled
                      ? 'bg-[color:var(--color-signal)]'
                      : 'bg-[color:var(--color-signal)]/80'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                <span className="text-white/55">
                  {expectedToday === 0 ? (
                    'Nothing is due today.'
                  ) : settled ? (
                    <span className="text-[color:var(--color-signal)]">
                      Everyone has paid today.
                    </span>
                  ) : (
                    <>
                      <span className="font-display text-white">
                        {formatTZS(outstandingToday)}
                      </span>{' '}
                      still to come from{' '}
                      <span className="font-display text-white">{unpaidRiders}</span> rider
                      {unpaidRiders === 1 ? '' : 's'}
                    </>
                  )}
                </span>
                <span className="font-display text-white/45">
                  {ahead ? `${Math.round(ratio * 100)}% · paid in advance` : `Deadline ${deadline}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/owner/payments/cash"
              className="inline-flex min-h-10 items-center rounded-[--radius-card] bg-[color:var(--color-signal)] px-4 text-sm font-semibold text-[color:var(--color-band)] transition-colors hover:bg-white"
            >
              Record cash payment
            </Link>
            {unpaidRiders > 0 && (
              <Link
                href="/owner/riders"
                className="inline-flex min-h-10 items-center gap-1 rounded-[--radius-card] border border-white/20 px-4 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
              >
                See who hasn&rsquo;t paid <ArrowRightIcon className="size-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* -------------------------------------------------- the ribbon --- */}
        <div className="flex min-w-0 flex-1 flex-col justify-center border-t border-white/10 pt-5 lg:max-w-md lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <CollectionRibbon data={series} today={today} />
        </div>
      </div>
    </section>
  );
}
