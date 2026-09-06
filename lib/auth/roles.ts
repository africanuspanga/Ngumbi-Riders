/*
 * Role → permission model (build spec #10). The accountant is a finance-only
 * staff role the owner creates and can deactivate at any time.
 *
 * This module is PURE (no imports from the DB or Next) so the whole matrix is
 * unit tested and can be imported from both server and client code. It is a
 * convenience layer for routing and UI, NOT the security boundary:
 *
 *   1. Every server action / route handler calls `requirePermission()` from
 *      lib/auth/session.ts before doing anything.
 *   2. RLS is decisive. Migration 0025 gives the accountant SELECT-only
 *      policies on the financial tables and nothing at all on rider private
 *      data, guarantors, applications, payment_events, audit logs or imports.
 *   3. Money still mutates only through the SECURITY DEFINER functions +
 *      service role (migration 0016 revokes direct writes), so "record a
 *      payment" is the same server-validated path the owner uses.
 *
 * Hiding a button is never sufficient — see requirePermission's callers.
 */

import type { UserRole } from '@/lib/supabase/types';

export type Permission =
  // --- read surfaces -----------------------------------------------------
  | 'riders.read'
  | 'motorcycles.read'
  | 'contracts.read'
  | 'obligations.read'
  | 'payments.read'
  | 'receipts.read'
  | 'expenses.read'
  | 'reports.read'
  | 'reports.export'
  | 'notes.read'
  | 'requisitions.read'
  | 'applications.read'
  | 'incidents.read'
  | 'exemptions.read'
  | 'system.read'
  | 'audit.read'
  // --- write surfaces ----------------------------------------------------
  | 'riders.write'
  | 'riders.photo.write'
  | 'motorcycles.write'
  | 'contracts.write'
  | 'payments.record'
  | 'notes.write'
  | 'requisitions.write'
  | 'requisitions.decide'
  // Recording that money for an APPROVED purchase has been released. Separate
  // from 'decide' on purpose: approving a purchase and paying for it are two
  // different acts, and only the owner holds the second.
  | 'requisitions.pay'
  | 'expenses.write'
  | 'applications.write'
  | 'incidents.write'
  | 'exemptions.decide'
  | 'announcements.write'
  | 'imports.write'
  // --- privileged --------------------------------------------------------
  | 'pii.reveal'
  | 'staff.manage'
  | 'settings.write';

/**
 * What an accountant may do. Everything NOT listed is denied — including
 * changing roles, editing contracts, revealing NIDA/licence numbers, touching
 * system settings, reading provider credentials/payloads, running imports and
 * deleting anything. Deletion has no permission at all: financial records are
 * corrected by reversal events, never removed (spec rule 6).
 */
const ACCOUNTANT_PERMISSIONS: readonly Permission[] = [
  // Everything the accountant needs to read to do the books.
  'riders.read',
  'motorcycles.read',
  'contracts.read',
  'obligations.read',
  'payments.read',
  'receipts.read',
  'expenses.read',
  'reports.read',
  'reports.export',
  'notes.read',
  'requisitions.read',
  'exemptions.read',
  // The three things they may change: record an authorised manual payment, add
  // an internal financial note (append-only), and raise a purchase requisition
  // for the Managing Director to decide. Note what is NOT here:
  // 'requisitions.decide' — an accountant may ask to buy motorcycles, never
  // approve the purchase, not even their own request. Nor
  // 'requisitions.pay': they see whether a request was paid, they do not get
  // to declare it paid.
  'payments.record',
  'notes.write',
  'requisitions.write',
] as const;

const RIDER_PERMISSIONS: readonly Permission[] = [] as const;

/** True when `role` holds `permission`. The owner holds everything. */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (role === 'owner') return true;
  if (role === 'accountant') return ACCOUNTANT_PERMISSIONS.includes(permission);
  if (role === 'rider') return RIDER_PERMISSIONS.includes(permission);
  return false;
}

/** Permissions held by a role — for tests and for rendering nav. */
export function permissionsOf(role: UserRole | null | undefined): readonly Permission[] {
  if (role === 'accountant') return ACCOUNTANT_PERMISSIONS;
  if (role === 'rider') return RIDER_PERMISSIONS;
  return [];
}

/** Owner or accountant — the two back-office roles. */
export function isStaffRole(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'accountant';
}

/** Where a signed-in user belongs after login. */
export function homePathFor(role: UserRole | null | undefined): string {
  if (role === 'owner') return '/owner';
  if (role === 'accountant') return '/accountant';
  if (role === 'rider') return '/rider';
  return '/login';
}

/**
 * Accountant-reachable route prefixes. The accountant area lives at
 * /accountant/*; the owner area is closed to them entirely, so an accountant
 * who types /owner/settings is redirected rather than shown a broken page.
 * Matching is prefix-based on the pathname.
 */
export const ACCOUNTANT_ROUTE_PREFIXES: readonly string[] = [
  '/accountant',
] as const;

export function canAccessPath(role: UserRole | null | undefined, pathname: string): boolean {
  if (role === 'owner') return pathname.startsWith('/owner') || pathname.startsWith('/accountant');
  if (role === 'accountant') {
    return ACCOUNTANT_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  if (role === 'rider') return pathname.startsWith('/rider');
  return false;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  accountant: 'Accountant',
  rider: 'Rider',
};
