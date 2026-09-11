/*
 * Where a postponed lease day goes (client feedback 2026-09-11 #13).
 *
 * While a phone loan is being repaid, a lease day that reaches its due date is
 * not collected — it is POSTPONED to the end of the contract's calendar. This
 * module answers the only question that requires judgement: which date.
 *
 * PURE and dependency-free, so the rule is unit tested and the nightly job
 * simply applies it. The atomic half — retiring the original obligation and
 * creating its replacement together — is `postpone_lease_day_for_loan` in
 * migration 0031.
 *
 * THE RULE: the replacement lands on the next date AFTER the contract's last
 * existing obligation that the contract's own cadence would have collected on.
 * A Monday-to-Saturday rider's postponed day therefore never lands on a Sunday,
 * and a monthly contract's postponed instalment lands a month later rather than
 * a day later. Reusing the contract's cadence is what keeps the calendar
 * something the rider recognises: it looks exactly as if the lease had simply
 * run longer, which is precisely what happened.
 *
 * Nothing is forgiven and nothing is invented: one day out, one day in, same
 * amount, so the contract's total is untouched and every derived figure
 * (outstanding, remaining, projected completion) follows on its own.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export class LeasePauseError extends Error {}

function toUtcMidnight(dateStr: string): number {
  if (!DATE_RE.test(dateStr)) throw new LeasePauseError(`Invalid date: ${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const daysInMonth = (year: number, monthIdx0: number): number =>
  new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();

/** Add calendar months, clamping the day to the target month's length. */
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = m! - 1 + months;
  const year = y! + Math.floor(total / 12);
  const monthIdx = ((total % 12) + 12) % 12;
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(Math.min(d!, daysInMonth(year, monthIdx))).padStart(2, '0')}`;
}

export type LeaseCadence = {
  /** 'daily' | 'selected_weekdays' | 'weekly' | 'monthly' */
  scheduleType: string;
  /** 0=Sunday … 6=Saturday. Empty means every day. */
  selectedWeekdays?: number[] | null;
};

/** Safety cap while walking forward for the next eligible weekday. */
const MAX_SCAN_DAYS = 400;

/**
 * The date a postponed lease day should be re-scheduled to.
 *
 * @param lastObligationDate the latest due_date the contract already has
 * @param taken              dates already used by this contract, so a
 *                           replacement never collides with an existing
 *                           obligation (0007 has one obligation per
 *                           contract+date, and the DB would refuse)
 */
export function nextLeaseDate(
  lastObligationDate: string,
  cadence: LeaseCadence,
  taken: ReadonlySet<string> = new Set(),
): string {
  let candidate = advanceOnce(lastObligationDate, cadence);
  let guard = 0;
  while (taken.has(candidate)) {
    candidate = advanceOnce(candidate, cadence);
    if (++guard > MAX_SCAN_DAYS) {
      throw new LeasePauseError('Could not find a free date to postpone this lease day to');
    }
  }
  return candidate;
}

function advanceOnce(from: string, cadence: LeaseCadence): string {
  switch (cadence.scheduleType) {
    case 'monthly':
      return addMonths(from, 1);
    case 'weekly':
      return formatUtcDate(toUtcMidnight(from) + 7 * DAY_MS);
    case 'selected_weekdays': {
      const keep = new Set(
        (cadence.selectedWeekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      );
      // No selection means every day — the same as 'daily'. Falling through to
      // an infinite scan on an empty set would hang the nightly job.
      if (keep.size === 0) return formatUtcDate(toUtcMidnight(from) + DAY_MS);
      let ms = toUtcMidnight(from);
      for (let i = 0; i < MAX_SCAN_DAYS; i++) {
        ms += DAY_MS;
        if (keep.has(new Date(ms).getUTCDay())) return formatUtcDate(ms);
      }
      throw new LeasePauseError('No eligible weekday found within a year');
    }
    case 'daily':
    default:
      return formatUtcDate(toUtcMidnight(from) + DAY_MS);
  }
}

/**
 * Plan a whole batch of postponements in one pass.
 *
 * Each replacement is placed after the previous one, so postponing three days
 * on the same night yields three consecutive dates rather than three copies of
 * the same one (which the database would reject, leaving two days uncollected
 * and unexplained).
 */
export function planPostponements(
  obligationIds: string[],
  lastObligationDate: string,
  cadence: LeaseCadence,
  taken: ReadonlySet<string> = new Set(),
): { obligationId: string; newDate: string }[] {
  const used = new Set(taken);
  let cursor = lastObligationDate;
  const out: { obligationId: string; newDate: string }[] = [];

  for (const obligationId of obligationIds) {
    const newDate = nextLeaseDate(cursor, cadence, used);
    used.add(newDate);
    cursor = newDate;
    out.push({ obligationId, newDate });
  }
  return out;
}
