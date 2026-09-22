/*
 * Correcting the price of a LIVE contract (client feedback 2026-09-22).
 *
 * THE REPORT
 *
 * "Alfred Francis Msangi is currently unable to make his payment because there
 *  was a mistake when his contract was created. His payment schedule is
 *  weekly, daily repayment TZS 10,000, so the weekly payment should be
 *  TZS 70,000. It was mistakenly entered as TZS 10,000 per week."
 *
 * The pricing rule itself was already right — `pricing.ts` has been turning a
 * daily rate into 10,000 × 7 since 2026-09-05. What was missing is that
 * `updateContract` refuses ANY price edit once a contract is active, so a
 * mis-priced live contract could not be corrected at all: the owner's only
 * options were to terminate and re-issue (throwing away the rider's payment
 * history to fix a typo), or to leave it wrong.
 *
 * WHY THIS IS NOT SIMPLY "UPDATE THE AMOUNT"
 *
 * Once a contract is active the obligations ARE the money record (spec rule 6:
 * financial records are immutable; corrections are new events, never
 * overwrites). So a reprice splits exactly where immutability actually bites:
 *
 *   • UNSETTLED days (scheduled / due / overdue) are a forecast of what the
 *     rider will owe. Re-pricing them restates nothing — it corrects a figure
 *     nobody has acted on. Due dates are untouched, so arrears keep their
 *     clock: an overdue day stays overdue from the same date, at the corrected
 *     price.
 *
 *   • SETTLED days (paid / paid_in_advance) are history and are never touched.
 *     But when the price was too low, the business under-collected on every
 *     one of them, and that money does not disappear because the figure was
 *     corrected afterwards.
 *
 * That under-collection is what `shortfall` measures, and the owner's chosen
 * remedy (2026-09-22) is to ADD payment days at the corrected price rather
 * than restate the settled ones — the rider still owes the full lease value,
 * history stays true, and the arithmetic is visible on screen before anyone
 * commits to it.
 *
 * Exempted, postponed and cancelled days are excluded from BOTH halves on
 * purpose. An exemption is money the owner chose not to collect, a
 * postponement has already moved its money to a replacement obligation, and a
 * cancelled day is not owed. Pricing any of them into the shortfall would bill
 * the rider for a day the business had already decided to forgive.
 *
 * SPLIT IN TWO ON PURPOSE. `computeRepriceMath` works from four totals, so the
 * owner's screen can preview the correction live as they type without shipping
 * a thousand obligation rows to the browser; `planReprice` adds the ids the
 * server needs to write. Both call the same arithmetic, so the preview cannot
 * disagree with what is saved — the same reason `term.ts` exists.
 *
 * Pure and dependency-free so every rule above is unit tested. Integer TZS.
 */

import type { ObligationStatus, ScheduleType } from '@/lib/supabase/types';

/** Days still owed: a forecast, safe to re-price. */
export const REPRICEABLE_STATUSES: readonly ObligationStatus[] = ['scheduled', 'due', 'overdue'];

/** Days whose money already moved: history, never re-priced. */
export const SETTLED_STATUSES: readonly ObligationStatus[] = ['paid', 'paid_in_advance'];

export type RepriceObligation = {
  id: string;
  dueDate: string;
  amountDue: number;
  status: ObligationStatus;
};

/** The four totals the arithmetic needs — small enough to cross to a browser. */
export type RepriceSummary = {
  unsettledCount: number;
  unsettledTotalBefore: number;
  settledCount: number;
  settledTotal: number;
};

export type RepriceMath = RepriceSummary & {
  /** The corrected per-payment amount. */
  newInstalment: number;
  unsettledTotalAfter: number;
  /** What the settled days would have brought in at the corrected price. */
  settledTotalAtNewPrice: number;
  /**
   * Under-collection on days already settled: positive when the contract was
   * priced too LOW, negative when it was priced too HIGH (the rider overpaid).
   */
  shortfall: number;
  /** Whole extra payment days needed to recover a positive shortfall. */
  extraPaymentDays: number;
  /**
   * Shortfall left over after those whole days — the schedule only bills whole
   * obligations, so this is reported rather than quietly rounded away.
   */
  unrecovered: number;
  /** True when the rider has already paid MORE than the corrected price. */
  overpaid: boolean;
  /** Contract value once the plan is applied, including any added days. */
  contractTotalAfter: number;
};

export type RepricePlan = RepriceMath & {
  /** Ids to re-price, oldest due date first. */
  repriceIds: string[];
  /** Ids already carrying the corrected amount — updating them is wasteful. */
  alreadyCorrectIds: string[];
};

export class RepriceError extends Error {}

/** Bucket a contract's calendar into the four totals the arithmetic needs. */
export function summariseForReprice(obligations: readonly RepriceObligation[]): RepriceSummary {
  const repriceable = new Set<string>(REPRICEABLE_STATUSES);
  const settled = new Set<string>(SETTLED_STATUSES);
  const summary: RepriceSummary = {
    unsettledCount: 0,
    unsettledTotalBefore: 0,
    settledCount: 0,
    settledTotal: 0,
  };
  for (const o of obligations) {
    if (repriceable.has(o.status)) {
      summary.unsettledCount += 1;
      summary.unsettledTotalBefore += o.amountDue;
    } else if (settled.has(o.status)) {
      summary.settledCount += 1;
      summary.settledTotal += o.amountDue;
    }
  }
  return summary;
}

/**
 * The whole arithmetic of a correction, from four totals.
 *
 * `extraPaymentDays` is deliberately a WHOLE number of days. The ledger bills
 * whole obligations — partial payment is rejected everywhere else in this
 * system — so recovering a shortfall means adding days, and any remainder too
 * small for one more day is surfaced as `unrecovered` instead of being hidden
 * in a rounding.
 */
export function computeRepriceMath(summary: RepriceSummary, newInstalment: number): RepriceMath {
  const instalment = Math.round(Number(newInstalment));
  if (!Number.isFinite(instalment) || instalment <= 0) {
    throw new RepriceError('The corrected instalment must be greater than 0');
  }

  const settledTotalAtNewPrice = summary.settledCount * instalment;
  const shortfall = settledTotalAtNewPrice - summary.settledTotal;

  // A negative shortfall means the rider ALREADY paid more than the corrected
  // price. No days are added: there is deliberately no rider credit balance in
  // this system (it would be a second source of truth for what a rider owes),
  // so an overpayment is reported to the owner to settle deliberately.
  const extraPaymentDays = shortfall > 0 ? Math.floor(shortfall / instalment) : 0;
  const unrecovered = shortfall > 0 ? shortfall - extraPaymentDays * instalment : 0;
  const unsettledTotalAfter = summary.unsettledCount * instalment;

  return {
    ...summary,
    newInstalment: instalment,
    unsettledTotalAfter,
    settledTotalAtNewPrice,
    shortfall,
    extraPaymentDays,
    unrecovered,
    overpaid: shortfall < 0,
    contractTotalAfter:
      summary.settledTotal + unsettledTotalAfter + extraPaymentDays * instalment,
  };
}

/** The correction plus the ids the server writes to. */
export function planReprice(
  obligations: readonly RepriceObligation[],
  newInstalment: number,
): RepricePlan {
  const math = computeRepriceMath(summariseForReprice(obligations), newInstalment);
  const repriceable = new Set<string>(REPRICEABLE_STATUSES);
  const unsettled = obligations
    .filter((o) => repriceable.has(o.status))
    .slice()
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  return {
    ...math,
    repriceIds: unsettled.filter((o) => o.amountDue !== math.newInstalment).map((o) => o.id),
    alreadyCorrectIds: unsettled
      .filter((o) => o.amountDue === math.newInstalment)
      .map((o) => o.id),
  };
}

/**
 * One paragraph the owner reads before committing, in their own numbers.
 *
 * Written here rather than in the component so the confirmation text and the
 * arithmetic can never drift apart, and so it is unit tested like the rest.
 */
export function describeReprice(math: RepriceMath, recoverShortfall: boolean): string {
  const n = (v: number) => `TZS ${Math.abs(v).toLocaleString('en-US')}`;
  const parts: string[] = [];

  parts.push(
    math.unsettledCount === 0
      ? 'No unpaid payment days remain, so nothing will be re-priced.'
      : `${math.unsettledCount} unpaid payment day(s) go from ${n(math.unsettledTotalBefore)} to ` +
          `${n(math.unsettledTotalAfter)} (${n(math.newInstalment)} each).`,
  );

  if (math.settledCount > 0) {
    parts.push(
      `${math.settledCount} already-settled day(s) worth ${n(math.settledTotal)} are NOT changed.`,
    );
  }

  if (math.overpaid) {
    parts.push(
      `Those settled days brought in ${n(-math.shortfall)} MORE than the corrected price — ` +
        'no days are added. Decide with the rider how to return or apply it.',
    );
  } else if (math.shortfall > 0) {
    parts.push(
      recoverShortfall
        ? `${n(math.shortfall)} was under-collected on them; ${math.extraPaymentDays} extra ` +
            'payment day(s) will be added at the corrected price to recover it.'
        : `${n(math.shortfall)} was under-collected on them and will NOT be recovered.`,
    );
    if (recoverShortfall && math.unrecovered > 0) {
      parts.push(
        `${n(math.unrecovered)} cannot be recovered in whole payment days and is written off.`,
      );
    }
  }

  return parts.join(' ');
}

/* ------------------------------------------------------------------ *
 * Extending the term to recover the shortfall
 * ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar-date arithmetic in UTC, so a timezone can never shift a due date. */
export function addDaysIso(dateStr: string, days: number): string {
  if (!DATE_RE.test(dateStr)) throw new RepriceError(`Invalid date: ${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) + days * 86_400_000;
  const out = new Date(ms);
  return [
    out.getUTCFullYear(),
    String(out.getUTCMonth() + 1).padStart(2, '0'),
    String(out.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * A generous end date to generate the extension within, then slice to N.
 *
 * The schedule generator works from a date RANGE, but what is wanted here is
 * "the next N payment days" — which is a different question for every cadence
 * (a custom weekday schedule might pay once a week, or six times). Rather than
 * re-deriving each cadence's spacing, the range is over-shot and the result is
 * sliced, which is correct for all of them by construction. The multipliers
 * are the worst case for each cadence, plus slack for a partial first week.
 */
export function extensionHorizon(from: string, scheduleType: ScheduleType, days: number): string {
  if (days <= 0) throw new RepriceError('Nothing to extend');
  switch (scheduleType) {
    case 'daily':
      return addDaysIso(from, days + 7);
    case 'weekly':
    case 'selected_weekdays':
      // One payment day a week is the sparsest either can be.
      return addDaysIso(from, days * 7 + 14);
    case 'monthly':
      // Monthly is driven by monthlyCount, not this range, but the generator
      // still wants an end date it will not trip over.
      return addDaysIso(from, days * 31 + 62);
  }
}
