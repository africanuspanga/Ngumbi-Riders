import { describe, expect, it } from 'vitest';
import { changeOwnPasswordSchema } from '@/lib/staff/validation';

const ok = { currentPassword: 'OldPassw0rd!', newPassword: 'NewPassw0rd2', confirmPassword: 'NewPassw0rd2' };
const firstIssue = (input: object) => {
  const r = changeOwnPasswordSchema.safeParse(input);
  return r.success ? null : { path: r.error.issues[0]?.path[0], message: r.error.issues[0]?.message };
};

describe('changeOwnPasswordSchema', () => {
  it('accepts a strong new password that matches its confirmation', () => {
    expect(changeOwnPasswordSchema.safeParse(ok).success).toBe(true);
  });

  it('requires the current password', () => {
    expect(firstIssue({ ...ok, currentPassword: '' })?.path).toBe('currentPassword');
  });

  it('applies the same strength rules as a new account', () => {
    expect(firstIssue({ ...ok, newPassword: 'Short1', confirmPassword: 'Short1' })?.path).toBe('newPassword');
    expect(firstIssue({ ...ok, newPassword: 'alllowercase1', confirmPassword: 'alllowercase1' })?.path).toBe('newPassword');
    expect(firstIssue({ ...ok, newPassword: 'NoDigitsHere', confirmPassword: 'NoDigitsHere' })?.path).toBe('newPassword');
  });

  it('rejects a confirmation that does not match, on the confirmation field', () => {
    expect(firstIssue({ ...ok, confirmPassword: 'NewPassw0rd3' })).toEqual({
      path: 'confirmPassword',
      message: 'The two new passwords do not match',
    });
  });

  it('rejects reusing the current password', () => {
    expect(firstIssue({ currentPassword: 'SamePassw0rd', newPassword: 'SamePassw0rd', confirmPassword: 'SamePassw0rd' })?.path).toBe('newPassword');
  });
});
