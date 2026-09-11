import { describe, it, expect } from 'vitest';
import {
  COMPLETION_STATUSES,
  OPEN_COMPLETION_STATUSES,
  STATUS_LABELS,
  STATUS_LABELS_SW,
  STATUS_HELP_SW,
  NEXT_ACTOR,
  NEXT_ACTION,
  canTransition,
  allowedTransitions,
  isClosed,
  isOpen,
  hasCertificate,
  hasTransferDocument,
  progressOf,
  canRequestCompletion,
  type CompletionStatus,
} from '@/lib/completion/machine';

/**
 * Walk the chain from a starting status by applying transitions in order,
 * asserting each one is legal. Returns the status reached.
 */
function walk(from: CompletionStatus, path: CompletionStatus[]): CompletionStatus {
  let at = from;
  for (const next of path) {
    expect(canTransition(at, next)).toBe(true);
    at = next;
  }
  return at;
}

describe('the happy path', () => {
  it('runs rider → finance → director → certificate → transfer → sign-off', () => {
    const end = walk('requested', [
      'finance_review',
      'finance_cleared',
      'director_review',
      'director_approved',
      'certificate_issued',
      'transfer_in_progress',
      'transfer_uploaded',
      'final_review',
      'completed',
    ]);
    expect(end).toBe('completed');
  });
});

describe('the two rules the client asked for', () => {
  it('CANNOT skip finance clearance on the way to the Director', () => {
    // Nothing reaches director_review except finance_cleared.
    const reachDirectorReview = COMPLETION_STATUSES.filter((s) =>
      canTransition(s, 'director_review'),
    );
    expect(reachDirectorReview).toEqual(['finance_cleared']);

    // And nothing reaches the approval except director_review.
    const reachApproval = COMPLETION_STATUSES.filter((s) => canTransition(s, 'director_approved'));
    expect(reachApproval).toEqual(['director_review']);
  });

  it('CANNOT skip the Director’s sign-off on the way to completed', () => {
    const reachCompleted = COMPLETION_STATUSES.filter((s) => canTransition(s, 'completed'));
    expect(reachCompleted).toEqual(['final_review']);
  });

  it('refuses every direct jump from the rider’s request to completion', () => {
    expect(canTransition('requested', 'completed')).toBe(false);
    expect(canTransition('requested', 'director_approved')).toBe(false);
    expect(canTransition('finance_review', 'director_approved')).toBe(false);
    expect(canTransition('finance_cleared', 'completed')).toBe(false);
    expect(canTransition('certificate_issued', 'completed')).toBe(false);
  });
});

describe('rejection and return', () => {
  it('can reject from every open stage', () => {
    for (const s of OPEN_COMPLETION_STATUSES) {
      expect(canTransition(s, 'rejected')).toBe(true);
    }
  });

  it('makes rejected and completed terminal', () => {
    expect(allowedTransitions('rejected')).toEqual([]);
    expect(allowedTransitions('completed')).toEqual([]);
    expect(isClosed('rejected')).toBe(true);
    expect(isClosed('completed')).toBe(true);
    expect(isOpen('final_review')).toBe(true);
  });

  it('re-enters a returned request at FINANCE REVIEW, never further along', () => {
    // The thing that was wrong has to be re-checked by the person who checks.
    expect(allowedTransitions('returned')).toEqual(['finance_review', 'rejected']);
    expect(canTransition('returned', 'director_review')).toBe(false);
    expect(canTransition('returned', 'completed')).toBe(false);
  });

  it('does not allow a return once the certificate exists', () => {
    // A certificate has been issued and may be in the rider's hands; the only
    // way back from there is an outright rejection.
    expect(canTransition('director_approved', 'returned')).toBe(false);
    expect(canTransition('certificate_issued', 'returned')).toBe(false);
  });
});

describe('completeness of the tables', () => {
  it('labels, help text and next-actor cover every status', () => {
    for (const s of COMPLETION_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_LABELS_SW[s]).toBeTruthy();
      expect(STATUS_HELP_SW[s]).toBeTruthy();
      expect(NEXT_ACTOR[s]).toBeTruthy();
      expect(NEXT_ACTION).toHaveProperty(s);
    }
  });

  it('assigns no next actor to a closed request', () => {
    expect(NEXT_ACTOR.completed).toBe('nobody');
    expect(NEXT_ACTOR.rejected).toBe('nobody');
  });

  it('puts every decision stage on the Director’s desk', () => {
    expect(NEXT_ACTOR.director_review).toBe('owner');
    expect(NEXT_ACTOR.final_review).toBe('owner');
    // …and every preparation stage on finance's.
    expect(NEXT_ACTOR.requested).toBe('accountant');
    expect(NEXT_ACTOR.finance_review).toBe('accountant');
    expect(NEXT_ACTOR.certificate_issued).toBe('accountant');
    expect(NEXT_ACTOR.transfer_in_progress).toBe('accountant');
  });
});

describe('document availability', () => {
  it('reports a certificate from the moment it is issued onwards', () => {
    expect(hasCertificate('director_approved')).toBe(false);
    expect(hasCertificate('certificate_issued')).toBe(true);
    expect(hasCertificate('final_review')).toBe(true);
    expect(hasCertificate('completed')).toBe(true);
  });

  it('reports a transfer document only after it is uploaded', () => {
    expect(hasTransferDocument('transfer_in_progress')).toBe(false);
    expect(hasTransferDocument('transfer_uploaded')).toBe(true);
    expect(hasTransferDocument('completed')).toBe(true);
  });
});

describe('progressOf', () => {
  it('increases monotonically along the chain', () => {
    const chain: CompletionStatus[] = [
      'requested',
      'finance_review',
      'finance_cleared',
      'director_review',
      'director_approved',
      'certificate_issued',
      'transfer_in_progress',
      'transfer_uploaded',
      'final_review',
      'completed',
    ];
    for (let i = 1; i < chain.length; i++) {
      expect(progressOf(chain[i]!)).toBeGreaterThan(progressOf(chain[i - 1]!));
    }
  });

  it('shows a REJECTED request as no progress, not partial progress', () => {
    // Drawing a refused request as 60% complete is actively misleading.
    expect(progressOf('rejected')).toBe(0);
  });

  it('caps at 1 for completed', () => {
    expect(progressOf('completed')).toBe(1);
  });
});

describe('canRequestCompletion', () => {
  const base = {
    contractStatus: 'active',
    outstanding: 0,
    futureObligations: 0,
    hasOpenRequest: false,
    contractEndDate: '2026-09-01',
    today: '2026-09-11',
  };

  it('allows a rider who has finished paying', () => {
    const r = canRequestCompletion(base);
    expect(r.ok).toBe(true);
    expect(r.ok && r.warning).toBeNull();
  });

  it('ALLOWS a request with money outstanding, but warns', () => {
    // Blocking it would leave a rider with arrears no way to start the
    // conversation. What cannot happen is APPROVAL with money owing.
    const r = canRequestCompletion({ ...base, outstanding: 20_000 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.warning).toBe('outstanding_balance');
  });

  it('warns when the term still has days left', () => {
    const r = canRequestCompletion({ ...base, futureObligations: 12 });
    expect(r.ok && r.warning).toBe('term_not_finished');
  });

  it('refuses a second request while one is open', () => {
    const r = canRequestCompletion({ ...base, hasOpenRequest: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('already_requested');
  });

  it('refuses a contract that is already completed', () => {
    expect(canRequestCompletion({ ...base, contractStatus: 'completed' }).ok).toBe(false);
    expect(canRequestCompletion({ ...base, contractStatus: 'completed_early' }).ok).toBe(false);
  });

  it('allows a PAUSED contract — the owner suspended it, the rider still finished', () => {
    expect(canRequestCompletion({ ...base, contractStatus: 'paused' }).ok).toBe(true);
  });

  it('refuses a terminated or draft contract', () => {
    expect(canRequestCompletion({ ...base, contractStatus: 'terminated' }).ok).toBe(false);
    expect(canRequestCompletion({ ...base, contractStatus: 'draft' }).ok).toBe(false);
  });
});
