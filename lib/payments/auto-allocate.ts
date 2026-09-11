/*
 * Automatic cash allocation (client feedback 2026-09-11 #5).
 *
 * "The owner enters the amount received, and the system automatically clears
 *  the correct number of unpaid days or obligations based on the amount.
 *  TZS 30,000 with a 10,000 daily obligation clears three days."
 *
 * PURE and dependency-free, so every rule below is unit tested and the preview
 * the owner confirms is produced by the same function the server re-runs.
 *
 * THE RULES, IN THE ORDER THEY MATTER
 *
 *   1. OLDEST FIRST, ALWAYS. Money fills the oldest outstanding obligation
 *      first, then the next. This is not a preference — `record_completed_payment`
 *      refuses a selection that skips an older day (0018), so any other order
 *      would be computed here and then rejected at settlement.
 *
 *   2. WHOLE OBLIGATIONS ONLY, NEVER OVER-CLEAR. An obligation is cleared only
 *      if the money covers it completely. A day is never partly paid (spec
 *      §3.1), and a day is never cleared with money that was not there.
 *
 *   3. THE REMAINDER IS REPORTED, NOT ABSORBED. Whatever is left after the last
 *      whole obligation is handed back to the caller as `remainder`, with a
 *      warning. It is NOT quietly added to the payment, because a payment whose
 *      amount exceeds the days it settles is exactly the kind of unexplainable
 *      row this ledger has been bitten by before.
 *
 *   4. TOO LITTLE IS A REFUSAL, NOT A PARTIAL PAYMENT. If the money does not
 *      even cover the oldest day, nothing is cleared and `shortfall` says how
 *      much is missing. Recording it as "something" would create a payment that
 *      settles no obligation at all.
 *
 * WHY THERE IS NO RIDER CREDIT BALANCE
 *
 * The brief offers a choice: "any excess amount should either remain as rider
 * credit or require owner confirmation." This implements the second. A credit
 * balance is a new kind of money — it would have to appear in the statement,
 * the outstanding figures, the completion check and the end-of-contract
 * clearance, and every one of those is currently DERIVED from obligations and
 * payments alone. Introducing a second source of truth for what a rider owes,
 * to solve "the change from a cash payment", is a poor trade. The excess is
 * therefore surfaced to the owner, who says what happened to it, and the note
 * travels with the payment.
 */

import { outstanding, type SelectableObligation } from './selection';

export type AutoAllocation = {
  /** The obligations this amount clears, oldest first. */
  obligations: SelectableObligation[];
  /** Sum of those obligations — the amount that will actually be recorded. */
  allocated: number;
  /** The amount the owner typed. */
  offered: number;
  /**
   * offered − allocated. Money the rider handed over that settles no day.
   * Zero on an exact payment.
   */
  remainder: number;
  /** True when the money covers whole obligations exactly. */
  exact: boolean;
  /** True when nothing at all could be cleared. */
  none: boolean;
  /**
   * When nothing could be cleared, how much more is needed to clear the oldest
   * day. Zero when there is nothing outstanding at all.
   */
  shortfall: number;
  /** True when this clears every outstanding obligation on the contract. */
  coversAll: boolean;
  /** Total still outstanding after this payment. */
  remainingAfter: number;
};

/**
 * Clear as many whole obligations as `amount` covers, oldest first.
 *
 * `amount` is trusted only as an intention: the money that gets recorded is
 * always `allocated`, recomputed from the obligations chosen.
 */
export function autoAllocate(
  obligations: SelectableObligation[],
  amount: number,
): AutoAllocation {
  const list = outstanding(obligations);
  const offered = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  const totalOutstanding = list.reduce((s, o) => s + o.amountDue, 0);

  const chosen: SelectableObligation[] = [];
  let allocated = 0;
  for (const o of list) {
    // Rule 2: only take the day if the money covers ALL of it.
    if (allocated + o.amountDue > offered) break;
    chosen.push(o);
    allocated += o.amountDue;
  }

  const remainder = Math.max(0, offered - allocated);
  const none = chosen.length === 0;

  return {
    obligations: chosen,
    allocated,
    offered,
    remainder,
    exact: offered > 0 && remainder === 0 && !none,
    none,
    // Only meaningful when nothing cleared AND there was something to clear.
    shortfall: none && list.length > 0 ? Math.max(0, (list[0]?.amountDue ?? 0) - offered) : 0,
    coversAll: list.length > 0 && chosen.length === list.length,
    remainingAfter: totalOutstanding - allocated,
  };
}

export type AllocationWarning = {
  level: 'error' | 'warning' | 'info';
  message: string;
};

/**
 * The sentences the owner should read before confirming, in the order they
 * should read them. Returned as data rather than rendered here so the same
 * wording can be shown in the form and repeated in the confirmation.
 */
export function allocationWarnings(a: AutoAllocation): AllocationWarning[] {
  const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString('en-US')}`;
  const out: AllocationWarning[] = [];

  if (a.offered <= 0) {
    out.push({ level: 'error', message: 'Enter the amount of cash you received.' });
    return out;
  }

  if (a.none) {
    if (a.shortfall > 0) {
      out.push({
        level: 'error',
        message: `${tzs(a.offered)} is not enough to clear even the oldest unpaid day — ${tzs(a.shortfall)} short. A day cannot be part-paid, so nothing would be recorded.`,
      });
    } else {
      out.push({
        level: 'error',
        message: 'This rider has nothing outstanding, so there is nothing to clear.',
      });
    }
    return out;
  }

  out.push({
    level: 'info',
    message: `${tzs(a.allocated)} will be recorded, clearing ${a.obligations.length} day${a.obligations.length === 1 ? '' : 's'}, oldest first.`,
  });

  if (a.remainder > 0) {
    out.push({
      level: 'warning',
      message: `${tzs(a.remainder)} is left over and will NOT be recorded as a payment — a day cannot be part-paid. Give the change back to the rider, or hold it until they can pay a full day, and say which in the note.`,
    });
  }

  if (a.coversAll) {
    out.push({
      level: 'info',
      message: 'This clears everything the rider currently owes.',
    });
  } else if (a.remainingAfter > 0) {
    out.push({
      level: 'info',
      message: `${tzs(a.remainingAfter)} will still be outstanding after this payment.`,
    });
  }

  return out;
}

/**
 * The suggested note text for an inexact payment, so the record of what
 * happened to the change is written down at the moment it is decided rather
 * than remembered later.
 */
export function remainderNote(a: AutoAllocation): string {
  if (a.remainder <= 0) return '';
  const tzs = `TZS ${Math.round(a.remainder).toLocaleString('en-US')}`;
  return `Received ${`TZS ${a.offered.toLocaleString('en-US')}`}; ${tzs} change not applied to any day.`;
}
