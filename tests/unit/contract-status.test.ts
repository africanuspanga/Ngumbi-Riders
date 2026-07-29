import { describe, it, expect } from 'vitest';
import {
  deriveContractDisplayStatus,
  shouldAutoComplete,
  CONTRACT_STATUS_LABELS,
} from '@/lib/contracts/status';

const TODAY = '2026-07-29';

const derive = (over: Partial<Parameters<typeof deriveContractDisplayStatus>[0]>) =>
  deriveContractDisplayStatus({
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    today: TODAY,
    ...over,
  });

describe('contract status derivation (spec #8)', () => {
  it('shows an in-term contract as active', () => {
    expect(derive({})).toBe('active');
  });

  it('shows a contract whose term has not started as upcoming', () => {
    expect(derive({ startDate: '2026-08-01', endDate: '2026-12-31' })).toBe('upcoming');
    expect(derive({ status: 'scheduled' })).toBe('upcoming');
  });

  it('shows a past-end contract as completed even before the nightly job runs', () => {
    // Daud's case: the term finished, nothing is owed, but the row is still
    // `active` because the job has not fired yet.
    expect(derive({ endDate: '2026-07-28', outstandingCount: 0 })).toBe('completed');
    expect(CONTRACT_STATUS_LABELS.completed).toBe('Contract Completed');
  });

  it('flags a finished contract that still has unpaid obligations', () => {
    expect(derive({ endDate: '2026-07-28', outstandingCount: 3 })).toBe('ended_outstanding');
    expect(derive({ status: 'completed', outstandingCount: 3 })).toBe('ended_outstanding');
    expect(CONTRACT_STATUS_LABELS.ended_outstanding).toBe('Contract Ended — Outstanding Balance');
  });

  it('never shows a contract with arrears as fully settled', () => {
    for (const status of ['active', 'completed', 'completed_early'] as const) {
      expect(derive({ status, endDate: '2026-07-01', outstandingCount: 1 })).not.toBe('completed');
    }
  });

  it('maps the remaining lifecycle states', () => {
    expect(derive({ status: 'paused' })).toBe('suspended');
    expect(derive({ status: 'terminated' })).toBe('terminated');
    expect(derive({ status: 'cancelled' })).toBe('cancelled');
    expect(derive({ status: 'draft' })).toBe('draft');
    expect(derive({ status: 'awaiting_signatures' })).toBe('awaiting_signatures');
    expect(derive({ status: 'completed_early', outstandingCount: 0 })).toBe('completed');
  });

  it('treats a terminated contract as terminated even with arrears', () => {
    expect(derive({ status: 'terminated', outstandingCount: 5 })).toBe('terminated');
  });

  it('stays active when the end date is today (the term is inclusive)', () => {
    expect(derive({ endDate: TODAY })).toBe('active');
  });

  it('tolerates a missing end date', () => {
    expect(derive({ endDate: null })).toBe('active');
  });

  describe('shouldAutoComplete', () => {
    it('completes an active contract whose end date has passed', () => {
      expect(shouldAutoComplete({ status: 'active', endDate: '2026-07-28', today: TODAY })).toBe(true);
    });

    it('does not complete on the final day of the term', () => {
      expect(shouldAutoComplete({ status: 'active', endDate: TODAY, today: TODAY })).toBe(false);
    });

    it('leaves paused, draft and already-ended contracts alone', () => {
      for (const status of ['paused', 'draft', 'completed', 'terminated', 'cancelled', 'scheduled'] as const) {
        expect(shouldAutoComplete({ status, endDate: '2020-01-01', today: TODAY })).toBe(false);
      }
    });

    it('ignores a contract with no end date', () => {
      expect(shouldAutoComplete({ status: 'active', endDate: null, today: TODAY })).toBe(false);
    });
  });
});
