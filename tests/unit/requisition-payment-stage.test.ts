/*
 * The payment stage that follows approval (0029, client feedback 2026-09-06).
 *
 * These rules decide whether the business believes it has paid a supplier, so
 * they are tested rather than trusted to the UI: the buttons are only ever a
 * rendering of `nextPaymentStatuses`.
 */

import { describe, it, expect } from 'vitest';
import {
  canChangePaymentStatus,
  canSetPaymentStatus,
  isPaid,
  nextPaymentStatuses,
} from '@/lib/requisitions/compute';
import {
  PAYMENT_STATUS_LABELS,
  REQUISITION_PAYMENT_STATUSES,
  requisitionStageLabel,
} from '@/lib/requisitions/constants';

describe('canSetPaymentStatus', () => {
  it('allows payment only against an approved purchase', () => {
    expect(canSetPaymentStatus('approved')).toBe(true);
  });

  it('refuses every other state', () => {
    // A rejected request was never authorised; marking it paid would assert
    // money left the business against a decision nobody made.
    for (const status of ['draft', 'submitted', 'rejected', 'cancelled'] as const) {
      expect(canSetPaymentStatus(status)).toBe(false);
    }
  });
});

describe('nextPaymentStatuses', () => {
  it('offers the forward ladder from unpaid', () => {
    expect(nextPaymentStatuses('unpaid')).toEqual(['processing', 'paid']);
  });

  it('lets processing finish or be corrected back', () => {
    expect(nextPaymentStatuses('processing')).toEqual(['paid', 'unpaid']);
  });

  it('lets paid step back only as far as processing', () => {
    // Never straight to unpaid: that would erase the fact that a payment was
    // ever recorded, rather than correcting it.
    expect(nextPaymentStatuses('paid')).toEqual(['processing']);
    expect(canChangePaymentStatus('paid', 'unpaid')).toBe(false);
  });

  it('never offers the stage it is already on', () => {
    for (const status of REQUISITION_PAYMENT_STATUSES) {
      expect(nextPaymentStatuses(status)).not.toContain(status);
    }
  });

  it('only ever offers real stages', () => {
    for (const status of REQUISITION_PAYMENT_STATUSES) {
      for (const next of nextPaymentStatuses(status)) {
        expect(REQUISITION_PAYMENT_STATUSES).toContain(next);
      }
    }
  });
});

describe('canChangePaymentStatus', () => {
  it('agrees with nextPaymentStatuses in every direction', () => {
    for (const from of REQUISITION_PAYMENT_STATUSES) {
      for (const to of REQUISITION_PAYMENT_STATUSES) {
        expect(canChangePaymentStatus(from, to)).toBe(nextPaymentStatuses(from).includes(to));
      }
    }
  });
});

describe('isPaid', () => {
  it('is true only for paid', () => {
    expect(isPaid('paid')).toBe(true);
    expect(isPaid('processing')).toBe(false);
    expect(isPaid('unpaid')).toBe(false);
  });
});

describe('requisitionStageLabel', () => {
  it('shows decision and money together once approved', () => {
    expect(requisitionStageLabel('approved', 'paid')).toBe('Approved · Paid');
    expect(requisitionStageLabel('approved', 'unpaid')).toBe('Approved · Not paid');
    expect(requisitionStageLabel('approved', 'processing')).toBe(
      'Approved · Payment processing',
    );
  });

  it('never mentions payment for a request that was not approved', () => {
    // The printed PDF uses this string. "Rejected · Not paid" would read as a
    // purchase still waiting for money rather than one that was refused.
    for (const status of ['draft', 'submitted', 'rejected', 'cancelled'] as const) {
      for (const payment of REQUISITION_PAYMENT_STATUSES) {
        const label = requisitionStageLabel(status, payment);
        expect(label).not.toContain('·');
        expect(label).not.toContain(PAYMENT_STATUS_LABELS[payment]);
      }
    }
  });
});
