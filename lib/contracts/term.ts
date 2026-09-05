/*
 * The single resolver for "what dates does this contract actually run, and what
 * does the rider pay on each of them?" (client feedback 2026-09-05).
 *
 * It exists because three things used to be worked out separately — the term,
 * the phone loan, and the custom-weekday extension — and the contract builder's
 * PREVIEW has to agree with the server to the day. One pure function, called by
 * both, makes disagreement impossible.
 *
 * Three rules it encodes:
 *
 *  1. PHONE LOAN FIRST. When a rider takes the motorcycle together with a
 *     phone, the loan instalments are collected before the lease starts. The
 *     lease therefore begins the day after the last loan instalment, and the
 *     contract runs that many months longer than a motorcycle-only lease.
 *
 *  2. PAYMENT DAYS, NOT CALENDAR DAYS. A rider who pays on 6 days a week still
 *     owes the full number of payment days the term was sold for, so the end
 *     date is pushed out until they have all fallen.
 *
 *  3. AN EXACT END DATE ALWAYS WINS. When the owner types one, no arithmetic
 *     overrides it.
 *
 * Pure and dependency-free (imports are pure too) so every rule is unit tested.
 */

import {
  contractEndDateFor,
  endDateFromDuration,
  normalizeDuration,
  DurationError,
  type ContractDuration,
} from './duration';
import {
  computePhoneLoan,
  leaseStartAfterPhoneLoan,
  phoneLoanSchedule,
  PhoneLoanError,
  type PhoneLoanInstalment,
  type PhoneLoanTerms,
} from '@/lib/loans/phone';
import {
  countPaymentDays,
  endDateForPaymentDays,
  extendTermForPaymentDays,
  PaymentDaysError,
  type PaymentDayExtension,
} from '@/lib/obligations/payment-days';
import type { ScheduleType } from '@/lib/supabase/types';

export class TermError extends Error {}

export type EndDateMode = 'duration' | 'exact' | 'payment_days';

export type TermInput = {
  startDate: string;
  duration: ContractDuration;
  endDateMode: EndDateMode;
  exactEndDate?: string | null;
  /** Explicit payment-day count when endDateMode = 'payment_days'. */
  paymentDaysTarget?: number | null;
  scheduleType: ScheduleType;
  /** Chosen weekdays for a custom schedule (or the single weekly weekday). */
  selectedWeekdays: number[];
  /**
   * Extend the term so every payment day is collected. Only meaningful for a
   * custom-weekday schedule; defaults to ON, which is what the owner asked for.
   */
  extendForPaymentDays?: boolean;
  phoneLoan?: { principal: number; termMonths: number; interestBps?: number } | null;
};

export type ResolvedTerm = {
  /** Contract/possession start — unchanged by the phone loan. */
  startDate: string;
  /** First LEASE obligation date (later than startDate when a phone is financed). */
  leaseStartDate: string;
  /** Inclusive contract end date to store. */
  endDate: string;
  /** What the end date would have been without the payment-day extension. */
  baseEndDate: string;
  phoneLoan: PhoneLoanTerms | null;
  phoneInstalments: PhoneLoanInstalment[];
  /** Extra months the phone loan adds versus taking the motorcycle alone. */
  phoneLoanExtraMonths: number;
  paymentDays: PaymentDayExtension | null;
};

/** Weekdays that actually filter the calendar for this schedule type. */
function filterWeekdays(scheduleType: ScheduleType, selectedWeekdays: number[]): number[] | null {
  if (scheduleType === 'selected_weekdays') return selectedWeekdays;
  return null; // daily = every day; weekly/monthly are not day-counted
}

export function resolveContractTerm(input: TermInput): ResolvedTerm {
  const duration = normalizeDuration(input.duration);

  // 1. Phone loan → when do lease instalments start?
  let phoneLoan: PhoneLoanTerms | null = null;
  let phoneInstalments: PhoneLoanInstalment[] = [];
  let leaseStartDate = input.startDate;
  if (input.phoneLoan && input.phoneLoan.principal > 0) {
    try {
      phoneLoan = computePhoneLoan(input.phoneLoan);
    } catch (e) {
      throw new TermError(e instanceof PhoneLoanError ? e.message : 'Invalid phone loan');
    }
    phoneInstalments = phoneLoanSchedule(phoneLoan, input.startDate);
    leaseStartDate = leaseStartAfterPhoneLoan(input.startDate, phoneLoan.termMonths);
  }

  // 2. Base lease end date.
  let baseEndDate: string;
  try {
    if (input.endDateMode === 'exact') {
      if (!input.exactEndDate) throw new TermError('Enter the contract end date');
      if (input.exactEndDate < leaseStartDate) {
        throw new TermError('The end date is before the lease can start');
      }
      baseEndDate = input.exactEndDate;
    } else if (input.endDateMode === 'payment_days') {
      const target = Math.round(Number(input.paymentDaysTarget));
      if (!Number.isInteger(target) || target < 1) {
        throw new TermError('Enter the number of payment days');
      }
      baseEndDate = endDateForPaymentDays(
        leaseStartDate,
        target,
        filterWeekdays(input.scheduleType, input.selectedWeekdays),
      );
    } else {
      baseEndDate = endDateFromDuration(leaseStartDate, duration);
    }
  } catch (e) {
    if (e instanceof TermError) throw e;
    throw new TermError(
      e instanceof DurationError || e instanceof PaymentDaysError
        ? e.message
        : 'That term could not be turned into an end date',
    );
  }

  // 3. Custom weekdays: extend until every payment day has fallen.
  let paymentDays: PaymentDayExtension | null = null;
  let endDate = baseEndDate;
  const extend = input.extendForPaymentDays ?? true;
  if (input.scheduleType === 'selected_weekdays' && input.selectedWeekdays.length > 0) {
    if (input.endDateMode === 'payment_days') {
      // Already exact: the base end date IS the Nth payment day.
      paymentDays = {
        targetDays: Math.round(Number(input.paymentDaysTarget)),
        daysInBaseTerm: Math.round(Number(input.paymentDaysTarget)),
        endDate: baseEndDate,
        extraCalendarDays: 0,
      };
    } else if (extend) {
      try {
        paymentDays = extendTermForPaymentDays({
          startDate: leaseStartDate,
          baseEndDate,
          weekdays: input.selectedWeekdays,
        });
        endDate = paymentDays.endDate;
      } catch (e) {
        throw new TermError(
          e instanceof PaymentDaysError ? e.message : 'Could not extend the term for the chosen payment days',
        );
      }
    } else {
      paymentDays = {
        targetDays: countPaymentDays(leaseStartDate, baseEndDate, null),
        daysInBaseTerm: countPaymentDays(leaseStartDate, baseEndDate, input.selectedWeekdays),
        endDate: baseEndDate,
        extraCalendarDays: 0,
      };
    }
  }

  // The owner's exact end date is never overridden — re-assert it after the
  // extension logic so a mis-ordered edit cannot quietly move it.
  if (input.endDateMode === 'exact' && input.exactEndDate) {
    endDate = input.exactEndDate;
  }

  if (endDate < leaseStartDate) {
    throw new TermError('The end date is before the lease can start');
  }

  return {
    startDate: input.startDate,
    leaseStartDate,
    endDate,
    baseEndDate,
    phoneLoan,
    phoneInstalments,
    phoneLoanExtraMonths: phoneLoan?.termMonths ?? 0,
    paymentDays,
  };
}

/**
 * The end date a motorcycle-only version of the same lease would have had —
 * so the builder can say "the phone loan adds 3 months (ends 04/07/2027
 * instead of 04/04/2027)".
 */
export function endDateWithoutPhoneLoan(input: TermInput): string | null {
  try {
    return resolveContractTerm({ ...input, phoneLoan: null }).endDate;
  } catch {
    return null;
  }
}

/** Convenience for callers that only need the stored end date. */
export function contractEndDateForInput(input: TermInput): string {
  return resolveContractTerm(input).endDate;
}

export { contractEndDateFor };
