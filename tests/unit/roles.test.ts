import { describe, it, expect } from 'vitest';
import {
  can,
  canAccessPath,
  homePathFor,
  isStaffRole,
  permissionsOf,
  type Permission,
} from '@/lib/auth/roles';

/** Every permission the accountant must NOT hold (build spec #10 restrictions). */
const FORBIDDEN_FOR_ACCOUNTANT: Permission[] = [
  'staff.manage', // cannot change other users' roles or delete the owner
  'settings.write', // cannot manage sensitive system configuration
  'pii.reveal', // cannot reveal NIDA / licence numbers
  'contracts.write', // cannot modify contracts
  'riders.write',
  'riders.photo.write',
  'motorcycles.write',
  'applications.read',
  'applications.write',
  'announcements.write',
  'imports.write',
  'incidents.write',
  'exemptions.decide',
  'audit.read',
  'system.read',
  'expenses.write',
];

describe('role permission matrix (spec #10)', () => {
  it('gives the owner every permission', () => {
    for (const p of [...FORBIDDEN_FOR_ACCOUNTANT, 'payments.record', 'reports.export'] as Permission[]) {
      expect(can('owner', p), p).toBe(true);
    }
  });

  it('lets the accountant do the finance work they were hired for', () => {
    const allowed: Permission[] = [
      'riders.read',
      'motorcycles.read',
      'contracts.read',
      'obligations.read',
      'payments.read',
      'payments.record',
      'receipts.read',
      'expenses.read',
      'reports.read',
      'reports.export',
      'notes.read',
      'notes.write',
      'exemptions.read',
    ];
    for (const p of allowed) expect(can('accountant', p), p).toBe(true);
  });

  it('denies the accountant every restricted permission', () => {
    for (const p of FORBIDDEN_FOR_ACCOUNTANT) {
      expect(can('accountant', p), p).toBe(false);
    }
  });

  it('gives riders no back-office permission at all', () => {
    expect(permissionsOf('rider')).toHaveLength(0);
    for (const p of ['payments.read', 'reports.read', 'riders.read'] as Permission[]) {
      expect(can('rider', p), p).toBe(false);
    }
  });

  it('denies everything for a missing role', () => {
    expect(can(null, 'payments.read')).toBe(false);
    expect(can(undefined, 'reports.read')).toBe(false);
  });

  it('routes each role to its own home', () => {
    expect(homePathFor('owner')).toBe('/owner');
    expect(homePathFor('accountant')).toBe('/accountant');
    expect(homePathFor('rider')).toBe('/rider');
    expect(homePathFor(null)).toBe('/login');
  });

  it('keeps the accountant out of the owner area', () => {
    expect(canAccessPath('accountant', '/accountant')).toBe(true);
    expect(canAccessPath('accountant', '/accountant/payments')).toBe(true);
    expect(canAccessPath('accountant', '/owner')).toBe(false);
    expect(canAccessPath('accountant', '/owner/system')).toBe(false);
    expect(canAccessPath('accountant', '/rider')).toBe(false);
    // A prefix that merely starts with the same letters must not pass.
    expect(canAccessPath('accountant', '/accountants-only')).toBe(false);
  });

  it('lets the owner into both back-office areas but not the rider area', () => {
    expect(canAccessPath('owner', '/owner/riders')).toBe(true);
    expect(canAccessPath('owner', '/accountant')).toBe(true);
    expect(canAccessPath('owner', '/rider')).toBe(false);
  });

  it('identifies the back-office roles', () => {
    expect(isStaffRole('owner')).toBe(true);
    expect(isStaffRole('accountant')).toBe(true);
    expect(isStaffRole('rider')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});
