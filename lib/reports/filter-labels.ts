/*
 * Report-filter vocabulary, in one plain module.
 *
 * Lives in lib/ rather than beside the component because a SERVER page and a
 * CLIENT component may both need it, and only a component may cross that
 * boundary: importing a constant from a 'use client' module gives the server a
 * client REFERENCE, not the value (spec rule 16, enforced by
 * tests/unit/rsc-boundary.test.ts after three production outages).
 */

export const PAYMENT_METHOD_FILTERS = [
  { value: '', label: 'Cash and Snippe' },
  { value: 'mobile_money', label: 'Snippe (mobile money)' },
  { value: 'cash', label: 'Cash only' },
] as const;

/** How an expense reached the ledger — see lib/departments/compute.ts. */
export const EXPENSE_SOURCE_LABELS: Record<'department' | 'motorcycle', string> = {
  department: 'Department',
  motorcycle: 'Motorcycle',
};
