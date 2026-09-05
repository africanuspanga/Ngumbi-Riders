/*
 * Phone loans (client feedback, 2026-09-05).
 *
 * A rider may take the motorcycle together with a phone so they can actually
 * use the system. The commercial terms are fixed by the Director:
 *
 *   • flat interest of 50% on the principal (NOT compounding, NOT per-annum),
 *   • repaid in at most 3 monthly instalments,
 *   • collected BEFORE the motorcycle lease instalments start.
 *
 * Worked example from the brief:
 *   principal 600,000 → interest 300,000 → total 900,000 → 3 × 300,000.
 *
 * Pure and dependency-free so every rule is unit tested. Money is integer TZS,
 * so the schedule is built by integer division with the REMAINDER PUSHED INTO
 * THE FINAL instalment: the instalments must sum to the total exactly, and it
 * is the last payment that flexes, never the loan's value.
 */

import { addMonths } from '@/lib/obligations/schedule';

/** 50%, expressed in basis points so all arithmetic stays integer. */
export const DEFAULT_PHONE_INTEREST_BPS = 5000;

/** The Director's cap: a phone loan is never longer than three months. */
export const MAX_PHONE_LOAN_MONTHS = 3;

export class PhoneLoanError extends Error {}

export type PhoneLoanTerms = {
  principal: number;
  interestBps: number;
  interestAmount: number;
  totalAmount: number;
  termMonths: number;
  /** One integer TZS amount per month, summing exactly to `totalAmount`. */
  instalments: number[];
};

/**
 * Turn a principal + term into the agreed loan figures. Throws rather than
 * clamping on bad input: a silently-adjusted loan amount is a wrong contract.
 */
export function computePhoneLoan(input: {
  principal: number;
  termMonths?: number;
  interestBps?: number;
}): PhoneLoanTerms {
  const principal = Math.round(Number(input.principal));
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new PhoneLoanError('Loan amount must be greater than 0');
  }
  const termMonths = Math.round(Number(input.termMonths ?? MAX_PHONE_LOAN_MONTHS));
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > MAX_PHONE_LOAN_MONTHS) {
    throw new PhoneLoanError(`Repayment period must be 1–${MAX_PHONE_LOAN_MONTHS} months`);
  }
  const interestBps = Math.round(Number(input.interestBps ?? DEFAULT_PHONE_INTEREST_BPS));
  if (!Number.isInteger(interestBps) || interestBps < 0 || interestBps > 20000) {
    throw new PhoneLoanError('Invalid interest rate');
  }

  const interestAmount = Math.round((principal * interestBps) / 10000);
  const totalAmount = principal + interestAmount;

  // Integer split: equal instalments, remainder onto the last one so the
  // schedule sums to the total to the shilling.
  const base = Math.floor(totalAmount / termMonths);
  const instalments = Array.from({ length: termMonths }, () => base);
  instalments[termMonths - 1] = totalAmount - base * (termMonths - 1);

  return { principal, interestBps, interestAmount, totalAmount, termMonths, instalments };
}

export type PhoneLoanInstalment = { dueDate: string; amount: number; index: number };

/**
 * The loan's repayment dates. The first instalment falls one calendar month
 * after the contract starts (the rider gets the phone on day one and pays for
 * it a month later), the rest one month apart, clamped per month so a loan
 * taken on the 31st is due on the 30th/28th where that month is shorter.
 */
export function phoneLoanSchedule(
  terms: PhoneLoanTerms,
  contractStartDate: string,
): PhoneLoanInstalment[] {
  return terms.instalments.map((amount, i) => ({
    index: i + 1,
    amount,
    dueDate: addMonths(contractStartDate, i + 1),
  }));
}

/**
 * The first day the MOTORCYCLE lease may start: the day after the final phone
 * instalment. Returning a date (not just a month count) keeps the caller from
 * re-deriving the clamping rules, and guarantees the lease calendar can never
 * collide with the loan calendar (obligations are unique per contract+date).
 */
export function leaseStartAfterPhoneLoan(
  contractStartDate: string,
  termMonths: number,
): string {
  const last = addMonths(contractStartDate, termMonths);
  const [y, m, d] = last.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d!) + 86_400_000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** "600,000 + 50% (300,000) = 900,000 over 3 months — 300,000/month". */
export function describePhoneLoan(terms: PhoneLoanTerms): string {
  const n = (v: number) => v.toLocaleString('en-US');
  const equal = terms.instalments.every((a) => a === terms.instalments[0]);
  const per = equal
    ? `${n(terms.instalments[0]!)}/month`
    : terms.instalments.map(n).join(' + ');
  return `TZS ${n(terms.principal)} + ${terms.interestBps / 100}% (${n(terms.interestAmount)}) = TZS ${n(terms.totalAmount)} over ${terms.termMonths} month${terms.termMonths === 1 ? '' : 's'} — ${per}`;
}

/**
 * Split an already-agreed loan total into its monthly instalments. Used when
 * the loan is read back from the database, where only the agreed totals are
 * stored — the split must be reproduced identically (remainder on the last
 * instalment) so activation generates the same schedule the owner approved.
 */
export function splitLoanTotal(totalAmount: number, termMonths: number): number[] {
  const total = Math.round(Number(totalAmount));
  const term = Math.round(Number(termMonths));
  if (!Number.isFinite(total) || total <= 0) throw new PhoneLoanError('Invalid loan total');
  if (!Number.isInteger(term) || term < 1 || term > MAX_PHONE_LOAN_MONTHS) {
    throw new PhoneLoanError('Invalid repayment period');
  }
  const base = Math.floor(total / term);
  const out = Array.from({ length: term }, () => base);
  out[term - 1] = total - base * (term - 1);
  return out;
}
