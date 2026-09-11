import { describe, it, expect } from 'vitest';
import {
  PHONE_LOAN_REQUEST_STATUSES,
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_LABELS_SW,
  REQUEST_STATUS_HELP_SW,
  NEXT_ACTOR,
  NEXT_ACTION,
  canTransitionRequest,
  isWithdrawable,
  isOpenRequest,
  type PhoneLoanRequestStatus,
} from '@/lib/loans/constants';
import {
  nextLeaseDate,
  planPostponements,
  LeasePauseError,
} from '@/lib/loans/lease-pause';
import {
  phoneLoanPortfolio,
  loanPosition,
  repaymentFocus,
  type LoanObligation,
  type PortfolioLoan,
} from '@/lib/loans/portfolio';

/* ======================================================================== *
 * The request workflow
 * ======================================================================== */

describe('phone-loan request transitions', () => {
  it('runs the full chain the brief describes', () => {
    const chain: PhoneLoanRequestStatus[] = [
      'submitted',
      'under_review',
      'requisition_raised',
      'requisition_approved',
      'purchased',
      'active',
      'completed',
    ];
    for (let i = 1; i < chain.length; i++) {
      expect(canTransitionRequest(chain[i - 1]!, chain[i]!)).toBe(true);
    }
  });

  it('CANNOT skip the Director’s approval of the purchase', () => {
    // Nothing reaches 'active' except 'purchased', and nothing reaches
    // 'purchased' except an approved requisition. That chain is the control:
    // an accountant must not be able to grant a loan on their own say-so.
    const reachActive = PHONE_LOAN_REQUEST_STATUSES.filter((s) =>
      canTransitionRequest(s, 'active'),
    );
    expect(reachActive).toEqual(['purchased']);

    const reachPurchased = PHONE_LOAN_REQUEST_STATUSES.filter((s) =>
      canTransitionRequest(s, 'purchased'),
    );
    expect(reachPurchased).toEqual(['requisition_approved']);

    expect(canTransitionRequest('submitted', 'active')).toBe(false);
    expect(canTransitionRequest('under_review', 'purchased')).toBe(false);
  });

  it('makes completed, rejected and cancelled terminal', () => {
    for (const s of ['completed', 'rejected', 'cancelled'] as PhoneLoanRequestStatus[]) {
      for (const to of PHONE_LOAN_REQUEST_STATUSES) {
        expect(canTransitionRequest(s, to)).toBe(false);
      }
    }
  });

  it('lets an ACTIVE loan only complete — never be cancelled out from under the rider', () => {
    expect(canTransitionRequest('active', 'completed')).toBe(true);
    expect(canTransitionRequest('active', 'cancelled')).toBe(false);
    expect(canTransitionRequest('active', 'rejected')).toBe(false);
  });

  it('allows withdrawal only before money is committed', () => {
    expect(isWithdrawable('submitted')).toBe(true);
    expect(isWithdrawable('under_review')).toBe(true);
    // Once a purchase requisition exists, money is being committed on the
    // rider's behalf and withdrawing is no longer a private decision.
    expect(isWithdrawable('requisition_raised')).toBe(false);
    expect(isWithdrawable('active')).toBe(false);
  });

  it('treats every in-flight status as open, and only those', () => {
    for (const s of PHONE_LOAN_REQUEST_STATUSES) {
      expect(isOpenRequest(s)).toBe(OPEN_REQUEST_STATUSES.includes(s));
    }
    expect(isOpenRequest('completed')).toBe(false);
    expect(isOpenRequest('rejected')).toBe(false);
  });

  it('labels every status in both languages and names an actor', () => {
    for (const s of PHONE_LOAN_REQUEST_STATUSES) {
      expect(REQUEST_STATUS_LABELS[s]).toBeTruthy();
      expect(REQUEST_STATUS_LABELS_SW[s]).toBeTruthy();
      expect(REQUEST_STATUS_HELP_SW[s]).toBeTruthy();
      expect(NEXT_ACTOR[s]).toBeTruthy();
      expect(NEXT_ACTION).toHaveProperty(s);
    }
    expect(NEXT_ACTOR.requisition_raised).toBe('owner');
    expect(NEXT_ACTOR.purchased).toBe('accountant');
    expect(NEXT_ACTOR.completed).toBe('nobody');
  });
});

/* ======================================================================== *
 * Where a postponed lease day goes
 * ======================================================================== */

describe('nextLeaseDate', () => {
  it('moves a daily contract one day on', () => {
    expect(nextLeaseDate('2026-09-30', { scheduleType: 'daily' })).toBe('2026-10-01');
  });

  it('moves a weekly contract seven days on', () => {
    expect(nextLeaseDate('2026-09-30', { scheduleType: 'weekly' })).toBe('2026-10-07');
  });

  it('moves a monthly contract one calendar month on, clamping short months', () => {
    expect(nextLeaseDate('2026-09-30', { scheduleType: 'monthly' })).toBe('2026-10-30');
    expect(nextLeaseDate('2026-01-31', { scheduleType: 'monthly' })).toBe('2026-02-28');
  });

  it('honours the contract’s own weekdays', () => {
    // Mon–Sat, no Sunday (0 = Sunday). 2026-09-12 is a Saturday, so the next
    // payment day is Monday the 14th, NOT Sunday the 13th.
    const cadence = { scheduleType: 'selected_weekdays', selectedWeekdays: [1, 2, 3, 4, 5, 6] };
    expect(nextLeaseDate('2026-09-12', cadence)).toBe('2026-09-14');
  });

  it('treats an EMPTY weekday selection as every day rather than hanging', () => {
    // An empty set with a naive scan would loop forever inside the nightly job.
    expect(
      nextLeaseDate('2026-09-30', { scheduleType: 'selected_weekdays', selectedWeekdays: [] }),
    ).toBe('2026-10-01');
  });

  it('skips over dates the contract already uses', () => {
    const taken = new Set(['2026-10-01', '2026-10-02']);
    expect(nextLeaseDate('2026-09-30', { scheduleType: 'daily' }, taken)).toBe('2026-10-03');
  });

  it('refuses an invalid date instead of producing a wrong one', () => {
    expect(() => nextLeaseDate('30/09/2026', { scheduleType: 'daily' })).toThrow(LeasePauseError);
  });
});

describe('planPostponements', () => {
  it('gives each postponed day its OWN new date', () => {
    // Three days postponed on one night must not all land on the same date —
    // the contract allows one obligation per date, so two would be rejected and
    // silently left uncollected.
    const plan = planPostponements(['a', 'b', 'c'], '2026-09-30', { scheduleType: 'daily' });
    expect(plan.map((p) => p.newDate)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(new Set(plan.map((p) => p.newDate)).size).toBe(3);
  });

  it('respects dates already taken by the existing calendar', () => {
    const plan = planPostponements(
      ['a', 'b'],
      '2026-09-30',
      { scheduleType: 'daily' },
      new Set(['2026-10-01']),
    );
    expect(plan.map((p) => p.newDate)).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('keeps a custom-weekday contract off its non-payment days', () => {
    // Mon–Fri only.
    const plan = planPostponements(
      ['a', 'b', 'c'],
      '2026-09-10', // a Thursday
      { scheduleType: 'selected_weekdays', selectedWeekdays: [1, 2, 3, 4, 5] },
    );
    expect(plan.map((p) => p.newDate)).toEqual(['2026-09-11', '2026-09-14', '2026-09-15']);
  });

  it('returns nothing for an empty list', () => {
    expect(planPostponements([], '2026-09-30', { scheduleType: 'daily' })).toEqual([]);
  });
});

/* ======================================================================== *
 * The dashboard portfolio
 * ======================================================================== */

const loan = (over: Partial<PortfolioLoan> = {}): PortfolioLoan => ({
  id: 'l1',
  riderId: 'r1',
  riderName: 'Rider One',
  contractId: 'c1',
  principal: 200_000,
  interestAmount: 100_000,
  totalAmount: 300_000,
  termMonths: 3,
  status: 'active',
  activatedAt: '2026-09-01T00:00:00Z',
  completedAt: null,
  pausingLease: true,
  ...over,
});

const inst = (
  phoneLoanId: string,
  amountDue: number,
  status: string,
  dueDate: string,
): LoanObligation => ({
  id: `${phoneLoanId}-${dueDate}`,
  phoneLoanId,
  amountDue,
  status,
  dueDate,
});

describe('loanPosition', () => {
  it('derives repaid and outstanding from the OBLIGATIONS, not a balance column', () => {
    const p = loanPosition(
      loan(),
      [
        inst('l1', 100_000, 'paid', '2026-10-01'),
        inst('l1', 100_000, 'overdue', '2026-11-01'),
        inst('l1', 100_000, 'scheduled', '2026-12-01'),
      ],
      '2026-11-15',
    );
    expect(p.issued).toBe(300_000);
    expect(p.repaid).toBe(100_000);
    expect(p.outstanding).toBe(200_000);
    expect(p.instalmentsPaid).toBe(1);
    expect(p.instalments).toBe(3);
    expect(p.nextDueDate).toBe('2026-11-01');
    expect(p.overdueCount).toBe(1);
  });

  it('counts paid_in_advance as repaid', () => {
    const p = loanPosition(loan(), [inst('l1', 300_000, 'paid_in_advance', '2026-10-01')], '2026-09-15');
    expect(p.repaid).toBe(300_000);
    expect(p.outstanding).toBe(0);
    expect(p.nextDueDate).toBeNull();
  });

  it('ignores another loan’s instalments', () => {
    const p = loanPosition(loan(), [inst('OTHER', 999_999, 'paid', '2026-10-01')], '2026-09-15');
    expect(p.repaid).toBe(0);
    expect(p.instalments).toBe(0);
  });
});

describe('phoneLoanPortfolio', () => {
  it('reports every figure the Director asked for', () => {
    const p = phoneLoanPortfolio(
      [
        loan({ id: 'a', riderName: 'Asha', status: 'active', pausingLease: true }),
        loan({
          id: 'b',
          riderName: 'Baraka',
          status: 'completed',
          pausingLease: false,
          completedAt: '2026-08-01T00:00:00Z',
        }),
        loan({ id: 'c', riderName: 'Chausiku', status: 'pending', pausingLease: false }),
      ],
      [
        inst('a', 100_000, 'paid', '2026-10-01'),
        inst('a', 200_000, 'overdue', '2026-11-01'),
        inst('b', 300_000, 'paid', '2026-07-01'),
      ],
      '2026-11-15',
    );

    expect(p.activeCount).toBe(1);
    expect(p.completedCount).toBe(1);
    expect(p.pendingCount).toBe(1);
    // Issued counts what reached a rider — active and completed, not pending.
    expect(p.totalIssued).toBe(600_000);
    expect(p.totalRepaid).toBe(400_000);
    // Outstanding is ACTIVE loans only.
    expect(p.totalOutstanding).toBe(200_000);
    expect(p.pausedRiders.map((x) => x.loan.riderName)).toEqual(['Asha']);
    expect(p.inArrears.map((x) => x.loan.riderName)).toEqual(['Asha']);
    expect(p.completed.map((x) => x.loan.riderName)).toEqual(['Baraka']);
  });

  it('does NOT assume issued − repaid equals outstanding', () => {
    // A cancelled instalment reduces what is owed without anybody paying it.
    const p = phoneLoanPortfolio(
      [loan({ id: 'a' })],
      [
        inst('a', 100_000, 'paid', '2026-10-01'),
        inst('a', 100_000, 'cancelled', '2026-11-01'),
        inst('a', 100_000, 'scheduled', '2026-12-01'),
      ],
      '2026-11-15',
    );
    expect(p.totalIssued).toBe(300_000);
    expect(p.totalRepaid).toBe(100_000);
    expect(p.totalOutstanding).toBe(100_000); // not 200,000
  });

  it('is all zeroes with no loans at all', () => {
    const p = phoneLoanPortfolio([], [], '2026-09-11');
    expect(p.activeCount).toBe(0);
    expect(p.totalIssued).toBe(0);
    expect(p.totalOutstanding).toBe(0);
  });
});

describe('repaymentFocus', () => {
  it('says phone loan while one is being repaid and the lease is paused', () => {
    expect(
      repaymentFocus({
        hasActivePhoneLoan: true,
        leasePaused: true,
        hasOutstandingLeaseDays: true, // arrears from before the pause
        hasOutstandingPhoneInstalments: true,
      }),
    ).toBe('phone_loan');
  });

  it('says BOTH when a loan is active and the lease was deliberately not paused', () => {
    expect(
      repaymentFocus({
        hasActivePhoneLoan: true,
        leasePaused: false,
        hasOutstandingLeaseDays: true,
        hasOutstandingPhoneInstalments: true,
      }),
    ).toBe('both');
  });

  it('returns to the motorcycle once the loan is repaid', () => {
    expect(
      repaymentFocus({
        hasActivePhoneLoan: true,
        leasePaused: false,
        hasOutstandingLeaseDays: true,
        hasOutstandingPhoneInstalments: false,
      }),
    ).toBe('motorcycle');
  });

  it('says nothing is owed when nothing is', () => {
    expect(
      repaymentFocus({
        hasActivePhoneLoan: false,
        leasePaused: false,
        hasOutstandingLeaseDays: false,
        hasOutstandingPhoneInstalments: false,
      }),
    ).toBe('nothing');
  });
});
