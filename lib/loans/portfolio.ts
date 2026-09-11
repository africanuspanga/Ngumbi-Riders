/*
 * Phone-loan portfolio — the dashboard section (client feedback 2026-09-11 #3).
 *
 * The Director asked for seven figures:
 *   active loans · total issued · total repaid · outstanding balance ·
 *   who is repaying · who has finished · whose motorcycle repayment is paused.
 *
 * PURE and dependency-free, so the arithmetic is unit tested once and the
 * dashboard, the reports and any future export all agree.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE EACH FIGURE COMES FROM, AND WHY IT IS NOT THE OBVIOUS PLACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ISSUED is read from the loan: `total_amount`, the principal plus the agreed
 * interest, which is what the rider actually owes. NOT the principal — the
 * principal is what the phone cost, and reporting it as "issued" would
 * understate the book by a third on every loan.
 *
 * REPAID and OUTSTANDING are derived from the loan's OBLIGATIONS, never from a
 * balance column, because there is no balance column and there must not be
 * (D-034 rule 3). A phone instalment is an ordinary obligation carrying
 * kind='phone_loan' (0026), so "repaid" is simply the settled ones and
 * "outstanding" is the rest — the same ledger, the same settlement function,
 * the same receipts as a lease day. That is precisely what stops a phone loan
 * from corrupting a motorcycle contract balance: there is nothing separate to
 * corrupt.
 *
 * A consequence worth stating: issued − repaid does NOT always equal
 * outstanding. A cancelled instalment reduces what is outstanding without
 * anybody paying it. Both figures are reported; neither is inferred from the
 * other.
 */

export type LoanObligation = {
  id: string;
  phoneLoanId: string;
  amountDue: number;
  status: string;
  dueDate: string;
};

export type PortfolioLoan = {
  id: string;
  riderId: string;
  riderName: string;
  /** Non-null when the loan is attached to a motorcycle contract. */
  contractId: string | null;
  principal: number;
  interestAmount: number;
  totalAmount: number;
  termMonths: number;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  /** True when this loan is currently pausing its contract's lease. */
  pausingLease: boolean;
};

const SETTLED = new Set(['paid', 'paid_in_advance']);
const OUTSTANDING = new Set(['scheduled', 'due', 'overdue']);

export type LoanPosition = {
  loan: PortfolioLoan;
  issued: number;
  repaid: number;
  outstanding: number;
  instalments: number;
  instalmentsPaid: number;
  /** Oldest unpaid instalment date, or null when nothing is outstanding. */
  nextDueDate: string | null;
  /** Unpaid instalments already past their due date. */
  overdueCount: number;
};

export function loanPosition(
  loan: PortfolioLoan,
  obligations: LoanObligation[],
  today: string,
): LoanPosition {
  const own = obligations.filter((o) => o.phoneLoanId === loan.id);
  const settled = own.filter((o) => SETTLED.has(o.status));
  const unpaid = own
    .filter((o) => OUTSTANDING.has(o.status))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  return {
    loan,
    issued: loan.totalAmount,
    repaid: settled.reduce((s, o) => s + o.amountDue, 0),
    outstanding: unpaid.reduce((s, o) => s + o.amountDue, 0),
    instalments: own.length,
    instalmentsPaid: settled.length,
    nextDueDate: unpaid[0]?.dueDate ?? null,
    overdueCount: unpaid.filter((o) => o.dueDate < today).length,
  };
}

export type PhoneLoanPortfolio = {
  activeCount: number;
  completedCount: number;
  pendingCount: number;
  /** Total agreed value of every loan ever activated (principal + interest). */
  totalIssued: number;
  /** Settled phone instalments across every loan. */
  totalRepaid: number;
  /** Unsettled phone instalments across every ACTIVE loan. */
  totalOutstanding: number;
  /** Loans still being repaid, most outstanding first. */
  repaying: LoanPosition[];
  /** Loans finished, most recently completed first. */
  completed: LoanPosition[];
  /** Riders whose motorcycle repayment is paused because of a phone loan. */
  pausedRiders: LoanPosition[];
  /** Active loans with at least one instalment past its due date. */
  inArrears: LoanPosition[];
};

export function phoneLoanPortfolio(
  loans: PortfolioLoan[],
  obligations: LoanObligation[],
  today: string,
): PhoneLoanPortfolio {
  const positions = loans.map((l) => loanPosition(l, obligations, today));

  const active = positions.filter((p) => p.loan.status === 'active');
  const done = positions.filter((p) => p.loan.status === 'completed');
  const pending = positions.filter((p) => p.loan.status === 'pending');

  return {
    activeCount: active.length,
    completedCount: done.length,
    pendingCount: pending.length,
    // Issued counts everything that reached a rider: active and completed.
    // A 'pending' loan is agreed but not yet generating instalments, and a
    // 'cancelled' one never happened at all.
    totalIssued: [...active, ...done].reduce((s, p) => s + p.issued, 0),
    totalRepaid: positions.reduce((s, p) => s + p.repaid, 0),
    totalOutstanding: active.reduce((s, p) => s + p.outstanding, 0),
    repaying: [...active].sort((a, b) => b.outstanding - a.outstanding),
    completed: [...done].sort((a, b) =>
      (b.loan.completedAt ?? '') > (a.loan.completedAt ?? '') ? 1 : -1,
    ),
    pausedRiders: active.filter((p) => p.loan.pausingLease),
    inArrears: active.filter((p) => p.overdueCount > 0),
  };
}

/**
 * WHAT THE RIDER IS CURRENTLY PAYING. The brief asks the rider dashboard to
 * say this plainly, and it is the single thing most likely to confuse someone
 * whose motorcycle days have stopped appearing.
 *
 * 'both' is reachable and deliberately supported: the Director may one day
 * choose not to pause the lease, and this build already lets them
 * (activate_phone_loan takes p_pause_lease). Until then the workflow always
 * pauses, and this returns 'phone_loan'.
 */
export type RepaymentFocus = 'phone_loan' | 'motorcycle' | 'both' | 'nothing';

export function repaymentFocus(input: {
  hasActivePhoneLoan: boolean;
  leasePaused: boolean;
  hasOutstandingLeaseDays: boolean;
  hasOutstandingPhoneInstalments: boolean;
}): RepaymentFocus {
  const phone = input.hasActivePhoneLoan && input.hasOutstandingPhoneInstalments;
  // A paused lease can still have ARREARS outstanding — days that were already
  // overdue when the loan activated are never postponed (0031). So "paused"
  // does not imply "owes no lease money", and the rider must be told the truth.
  const motorcycle = input.hasOutstandingLeaseDays;

  if (phone && motorcycle && !input.leasePaused) return 'both';
  if (phone) return 'phone_loan';
  if (motorcycle) return 'motorcycle';
  return 'nothing';
}

export const FOCUS_LABELS_SW: Record<RepaymentFocus, string> = {
  phone_loan: 'Kwa sasa unalipa mkopo wa simu',
  motorcycle: 'Kwa sasa unalipa pikipiki',
  both: 'Kwa sasa unalipa simu na pikipiki',
  nothing: 'Huna deni kwa sasa',
};

export const FOCUS_LABELS: Record<RepaymentFocus, string> = {
  phone_loan: 'Repaying the phone loan',
  motorcycle: 'Repaying the motorcycle',
  both: 'Repaying both the phone loan and the motorcycle',
  nothing: 'Nothing outstanding',
};
