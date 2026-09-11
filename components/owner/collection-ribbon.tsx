import { formatTZS } from '@/lib/money/format';
import type { CollectionsPoint } from '@/lib/dashboard/queries';

/*
 * THE COLLECTION RIBBON — one bar per billing day.
 *
 * This business bills EVERY DAY. Not monthly, not per invoice: every rider owes
 * a fixed amount today, and either it arrived or it did not. Thirty bars are
 * therefore thirty complete billing cycles, which is why this reads as the
 * company's pulse here and would be meaningless on a dashboard for a business
 * that invoices monthly.
 *
 * It replaces the 14-day area chart. Two views of "collections over time" on
 * one screen is one view too many, and this one covers twice the period, needs
 * no axis furniture, and survives being 4px wide per day on a phone.
 *
 * WHAT IT DOES NOT CLAIM. Bar height is collected against the window's own
 * spread (see the scaling note below), NOT collected ÷ expected. Per-day
 * expectation is not in this query, and implying it would put a number on
 * screen that no row supports (D-034 rule 3). The honest baseline is the
 * window's average, drawn as a dashed line, which answers the question the
 * owner actually asks: is today a normal day?
 *
 * A SERVER component with no JavaScript at all — the per-bar readout is a
 * native `title`, so hovering works before hydration and costs nothing.
 */
export function CollectionRibbon({
  data,
  today,
}: {
  data: CollectionsPoint[];
  /** YYYY-MM-DD in EAT, so the current day can be picked out. */
  today: string;
}) {
  const max = Math.max(...data.map((d) => d.collected), 1);
  const total = data.reduce((s, d) => s + d.collected, 0);
  // A zero day is a real day. It stays in the average — dropping it would
  // flatter the figure — even though it is excluded from "best day".
  const average = data.length > 0 ? total / data.length : 0;

  /*
   * SCALING TO THE 90TH PERCENTILE, NOT THE MAXIMUM.
   *
   * One rider settling a whole contract produces a day ten times any other —
   * in the live data, a 5,280,000 day against a 439,000 average. Scaling to
   * that maximum squashes the other twenty-nine days to a pixel each and the
   * ribbon stops carrying information exactly when you look at it.
   *
   * So the ceiling is the 90th percentile: ordinary days use the full height,
   * and the handful above it clip at 100% and are marked with a lighter cap so
   * the clipping is visible rather than silently misleading. The exact figure
   * for every day is on its tooltip, and the best day is printed below, so
   * nothing is hidden — only rescaled.
   */
  const sorted = [...data.map((d) => d.collected)].sort((a, b) => a - b);
  const p90 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)]! : 0;
  const ceiling = Math.max(p90, 1);
  const averagePct = Math.min((average / ceiling) * 100, 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-[color:var(--color-signal)]/70">
          Last {data.length} days
        </span>
        <span className="font-display text-xs text-white/45">
          {formatTZS(Math.round(average))}/day average
        </span>
      </div>

      <div className="relative h-16">
        {/* The average line sits behind the bars: it is a reference, not data. */}
        <div
          className="absolute inset-x-0 border-t border-dashed border-white/25"
          style={{ bottom: `${Math.min(averagePct, 100)}%` }}
          aria-hidden
        />
        <div className="flex h-full items-end gap-[2px]">
          {data.map((d) => {
            const isToday = d.date === today;
            const raw = (d.collected / ceiling) * 100;
            const clipped = raw > 100;
            const pct = Math.min(raw, 100);
            return (
              <div
                key={d.date}
                title={`${d.date}: ${formatTZS(d.collected)}`}
                className="group relative flex h-full flex-1 items-end"
              >
                {/* A track behind every bar, so a zero day still reads as a day
                    that happened rather than as missing data. */}
                <div className="absolute inset-x-0 bottom-0 h-full rounded-[2px] bg-white/[0.06]" />
                <div
                  className={`relative w-full rounded-[2px] ${
                    isToday
                      ? 'bg-[color:var(--color-signal)]'
                      : 'bg-[color:var(--color-signal)]/50 group-hover:bg-[color:var(--color-signal)]/80'
                  }`}
                  style={{
                    // A collected day is never invisible: the 4% floor keeps a
                    // small payment distinguishable from a day nobody paid.
                    height: d.collected > 0 ? `${Math.max(pct, 4)}%` : '0%',
                  }}
                >
                  {/* A day that ran off the top says so. */}
                  {clipped && (
                    <span
                      className="absolute inset-x-0 top-0 h-[3px] rounded-t-[2px] bg-white"
                      aria-hidden
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px] text-white/40">
        <span>
          <span className="font-display text-white/70">{formatTZS(total)}</span> collected
        </span>
        <span className="font-display">
          Best day {formatTZS(max)}
          {max > ceiling && <span className="text-white/30"> · tall days are capped</span>}
        </span>
      </div>
    </div>
  );
}
