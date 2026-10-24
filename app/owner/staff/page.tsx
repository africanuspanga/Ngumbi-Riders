import { requireOwner } from '@/lib/auth/session';
import { listAccountants } from '@/lib/staff/actions';
import { formatDate } from '@/lib/dates/format';
import { isStaffOtpRequired, staffPhone } from '@/lib/auth/staff-otp';
import { StaffManager } from './StaffManager';

export const metadata = { title: 'Staff' };

/**
 * Accountant account management (build spec #10). Owner-only: create an
 * accountant, activate/deactivate them, reset their password, or withdraw
 * access entirely.
 */
export default async function StaffPage() {
  const owner = await requireOwner();
  const [accountants, otpOn, ownerPhone] = await Promise.all([
    listAccountants(),
    isStaffOtpRequired(),
    staffPhone(owner.userId),
  ]);
  const missing = accountants.filter((a) => a.isActive && !a.phone).length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Staff</h1>
        <p className="text-sm text-muted-foreground">
          Accountants can view the books, record authorised payments and generate
          reports. They cannot change contracts, reveal identity numbers, manage
          system settings or alter anyone&rsquo;s role.
        </p>
      </header>

      <section className="rounded-(--radius-card) border border-border bg-white p-4 text-sm">
        <h2 className="font-semibold text-primary-dark">SMS sign-in codes</h2>
        <p className="mt-1 text-muted-foreground">
          {otpOn
            ? 'ON — after the password, every staff sign-in needs a 6-digit code sent by SMS.'
            : 'OFF — staff sign in with the password only. Add every accountant’s phone below before codes are switched on.'}{' '}
          Your codes go to <span className="font-medium text-foreground">{ownerPhone ?? 'no phone on file'}</span>.
        </p>
        {missing > 0 && (
          <p className="mt-1 font-semibold text-[color:var(--color-overdue)]">
            {missing} active accountant{missing === 1 ? ' has' : 's have'} no phone and{' '}
            {otpOn ? 'cannot sign in' : 'will not be able to sign in once codes are on'}.
          </p>
        )}
      </section>

      <StaffManager
        accountants={accountants.map((a) => ({ ...a, createdLabel: formatDate(a.createdAt) }))}
      />
    </div>
  );
}
