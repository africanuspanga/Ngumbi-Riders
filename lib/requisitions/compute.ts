/*
 * Requisition arithmetic and the status machine — PURE, so both the live
 * total the accountant watches while typing and the total the Director
 * approves come from the same function and cannot disagree.
 *
 * Nothing here is stored (D-034 rule 3): a line's amount is quantity x unit
 * price and a requisition's total is the sum of its lines, recomputed every
 * time either is displayed. An approved figure is therefore always exactly
 * the lines that were approved.
 */

import type { RequisitionStatus } from './constants';

export type RequisitionLine = {
  quantity: number;
  unitPrice: number;
};

/**
 * One line's amount in integer TZS. Non-finite or negative inputs collapse to
 * 0 rather than poisoning the total with NaN — a half-typed row in the form
 * must not make the whole request unreadable.
 */
export function lineAmount(line: RequisitionLine): number {
  const qty = Number.isFinite(line.quantity) ? Math.trunc(line.quantity) : 0;
  const price = Number.isFinite(line.unitPrice) ? Math.trunc(line.unitPrice) : 0;
  if (qty <= 0 || price <= 0) return 0;
  return qty * price;
}

/** Grand total of a requisition, in integer TZS. */
export function requisitionTotal(lines: readonly RequisitionLine[]): number {
  return lines.reduce((sum, line) => sum + lineAmount(line), 0);
}

/*
 * Allowed status transitions.
 *
 *   draft     -> submitted            (the accountant sends it up)
 *   draft     -> cancelled            (abandoned before it was ever seen)
 *   submitted -> approved | rejected  (the Director's decision — theirs alone)
 *   submitted -> cancelled            (the accountant withdraws it)
 *
 * approved, rejected and cancelled are terminal: a decided request is a record
 * of what was authorised and is never reopened (spec rule 6). Re-deciding
 * means raising a new request, which leaves both on file.
 */
const TRANSITIONS: Record<RequisitionStatus, readonly RequisitionStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: RequisitionStatus, to: RequisitionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** True while the request is still the accountant's to change. */
export function isEditable(status: RequisitionStatus): boolean {
  return status === 'draft';
}

/** True once the request can no longer change at all. */
export function isClosed(status: RequisitionStatus): boolean {
  return status === 'approved' || status === 'rejected' || status === 'cancelled';
}

/** True when the request is sitting on the Managing Director's desk. */
export function awaitsDecision(status: RequisitionStatus): boolean {
  return status === 'submitted';
}
