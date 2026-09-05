import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import {
  listCashCandidates,
  listStaffReceivers,
  pendingRequestObligationIds,
} from '@/lib/payments/queries';
import { localDateString } from '@/lib/dates/tz';
import { CashPaymentForm } from '@/app/owner/payments/cash/CashPaymentForm';

export const metadata = { title: 'Record payment' };

/**
 * The accountant's cash entry (build spec #10, client feedback 2026-09-05).
 * It no longer settles: it raises a request the Director confirms, which is
 * what makes the money real. The same server action re-checks the permission
 * and re-validates the selection at confirmation time.
 */
export default async function AccountantCashPaymentPage() {
  const profile = await requireAccountant();
  const [candidates, receivers, claimed] = await Promise.all([
    listCashCandidates(),
    listStaffReceivers(),
    pendingRequestObligationIds(),
  ]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/accountant/payments" className="text-sm font-medium text-muted-foreground">
          ← Payments
        </Link>
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Record cash received</h1>
        <p className="text-sm text-muted-foreground">
          The amount is computed from the days you tick, oldest first. This is sent
          to the Director for confirmation — nothing is settled and the rider is
          not notified until they confirm it.
        </p>
      </div>
      <CashPaymentForm
        candidates={candidates}
        today={localDateString()}
        mode="request"
        receivers={receivers}
        defaultReceiverId={profile.userId}
        claimedObligationIds={[...claimed]}
        paymentsHref="/accountant/payments/approvals"
      />
    </div>
  );
}
