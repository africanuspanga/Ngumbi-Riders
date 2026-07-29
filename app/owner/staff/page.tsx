import { requireOwner } from '@/lib/auth/session';
import { listAccountants } from '@/lib/staff/actions';
import { formatDate } from '@/lib/dates/format';
import { StaffManager } from './StaffManager';

export const metadata = { title: 'Staff' };

/**
 * Accountant account management (build spec #10). Owner-only: create an
 * accountant, activate/deactivate them, reset their password, or withdraw
 * access entirely.
 */
export default async function StaffPage() {
  await requireOwner();
  const accountants = await listAccountants();

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

      <StaffManager
        accountants={accountants.map((a) => ({ ...a, createdLabel: formatDate(a.createdAt) }))}
      />
    </div>
  );
}
