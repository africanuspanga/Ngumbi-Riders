import { describe, it, expect } from 'vitest';
import {
  REQUISITION_TYPES,
  REQUISITION_TYPE_LABELS,
  RETIREMENT_STATUSES,
  RETIREMENT_STATUS_LABELS,
  RETIREMENT_STATUS_DESCRIPTIONS,
  REQUISITION_DOC_TYPES,
  DOC_TYPE_LABELS,
  PRE_DECISION_DOC_TYPES,
  POST_DECISION_DOC_TYPES,
  REQUISITION_STATUS_LABELS,
  requisitionFullStageLabel,
  requisitionStageLabel,
  nextRequisitionAction,
  type RequisitionStatus,
} from '@/lib/requisitions/constants';
import { canTransition, awaitsDecision, isClosed } from '@/lib/requisitions/compute';
import {
  formatRequestNumber,
  formatCertificateNumber,
  parseSeq,
  yearOf,
} from '@/lib/completion/numbering';

describe('requisition vocabulary', () => {
  it('labels every type, retirement status and document kind', () => {
    for (const t of REQUISITION_TYPES) expect(REQUISITION_TYPE_LABELS[t]).toBeTruthy();
    for (const s of RETIREMENT_STATUSES) {
      expect(RETIREMENT_STATUS_LABELS[s]).toBeTruthy();
      expect(RETIREMENT_STATUS_DESCRIPTIONS[s]).toBeTruthy();
    }
    for (const d of REQUISITION_DOC_TYPES) expect(DOC_TYPE_LABELS[d]).toBeTruthy();
  });

  it('splits document kinds into exactly the two windows the trigger enforces', () => {
    // Every kind belongs to one window and no kind belongs to both — otherwise
    // the 0033 trigger and this list would disagree about when a file may be
    // attached, and the UI would offer an upload the database refuses.
    const all = [...PRE_DECISION_DOC_TYPES, ...POST_DECISION_DOC_TYPES];
    expect(new Set(all).size).toBe(REQUISITION_DOC_TYPES.length);
    for (const d of REQUISITION_DOC_TYPES) expect(all).toContain(d);
    for (const d of PRE_DECISION_DOC_TYPES) expect(POST_DECISION_DOC_TYPES).not.toContain(d);
  });

  it('labels the new under_review status', () => {
    expect(REQUISITION_STATUS_LABELS.under_review).toBeTruthy();
  });
});

describe('under_review as an optional waypoint', () => {
  it('lets the Director look before deciding', () => {
    expect(canTransition('submitted', 'under_review')).toBe(true);
    expect(canTransition('under_review', 'approved')).toBe(true);
    expect(canTransition('under_review', 'rejected')).toBe(true);
  });

  it('does NOT make it a required step — a straight approval still works', () => {
    // A Director who wants to approve immediately must still be able to, or
    // every request grows an extra click for the common case.
    expect(canTransition('submitted', 'approved')).toBe(true);
  });

  it('counts as awaiting a decision, and is not closed', () => {
    expect(awaitsDecision('under_review')).toBe(true);
    expect(isClosed('under_review')).toBe(false);
  });

  it('keeps decided statuses terminal', () => {
    for (const s of ['approved', 'rejected', 'cancelled'] as RequisitionStatus[]) {
      expect(canTransition(s, 'approved')).toBe(false);
      expect(isClosed(s)).toBe(true);
    }
  });
});

describe('requisitionFullStageLabel', () => {
  it('adds the retirement half only to an approved request that has one', () => {
    expect(requisitionFullStageLabel('approved', 'paid', 'completed')).toContain('Retired');
    expect(requisitionFullStageLabel('approved', 'paid', 'pending')).toContain('Retirement pending');
  });

  it('says nothing about retirement before there is anything to account for', () => {
    const label = requisitionFullStageLabel('approved', 'unpaid', 'not_started');
    expect(label).toBe(requisitionStageLabel('approved', 'unpaid'));
  });

  it('never mentions payment or retirement on a rejected request', () => {
    // A refused purchase is not "awaiting payment" — implying so would suggest
    // the money is merely late rather than never authorised.
    const label = requisitionFullStageLabel('rejected', 'unpaid', 'not_started');
    expect(label).toBe(REQUISITION_STATUS_LABELS.rejected);
    expect(label).not.toContain('paid');
  });
});

describe('nextRequisitionAction', () => {
  it('walks the whole lifecycle, naming who acts at each point', () => {
    expect(nextRequisitionAction('draft', 'unpaid', 'not_started')).toEqual({
      actor: 'accountant',
      action: 'Submit the request',
    });
    expect(nextRequisitionAction('submitted', 'unpaid', 'not_started')?.actor).toBe('owner');
    expect(nextRequisitionAction('under_review', 'unpaid', 'not_started')?.actor).toBe('owner');
    // Approved but unpaid: releasing money is the Director's act.
    expect(nextRequisitionAction('approved', 'unpaid', 'not_started')?.actor).toBe('owner');
    // Paid but not accounted for: retirement is the accountant's.
    expect(nextRequisitionAction('approved', 'paid', 'pending')?.actor).toBe('accountant');
  });

  it('returns null when nothing is waiting on anybody', () => {
    expect(nextRequisitionAction('approved', 'paid', 'completed')).toBeNull();
    expect(nextRequisitionAction('rejected', 'unpaid', 'not_started')).toBeNull();
    expect(nextRequisitionAction('cancelled', 'unpaid', 'not_started')).toBeNull();
  });
});

describe('completion numbering', () => {
  it('zero-pads so lexicographic max equals numeric max', () => {
    expect(formatRequestNumber(2026, 1)).toBe('NGR-CC-2026-0001');
    expect(formatCertificateNumber(2026, 42)).toBe('NGR-CERT-2026-0042');
    // The property the max-based allocator depends on.
    const numbers = [1, 2, 9, 10, 99, 100, 1000].map((n) => formatRequestNumber(2026, n));
    expect([...numbers].sort()).toEqual(numbers);
  });

  it('round-trips through parseSeq', () => {
    expect(parseSeq(formatRequestNumber(2026, 137))).toBe(137);
    expect(parseSeq(formatCertificateNumber(2030, 7))).toBe(7);
  });

  it('returns 0 for an unrecognised number rather than NaN', () => {
    // NaN + 1 is NaN, which would produce "NGR-CC-2026-NaN" and collide forever.
    expect(parseSeq('nonsense')).toBe(0);
    expect(parseSeq('')).toBe(0);
  });

  it('reads the year TEXTUALLY, so 1 January cannot slip a year', () => {
    expect(yearOf('2026-01-01')).toBe(2026);
    expect(yearOf('2026-12-31')).toBe(2026);
  });
});
