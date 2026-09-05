import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import {
  listCashCandidates,
  listStaffReceivers,
  pendingRequestObligationIds,
} from '@/lib/payments/queries';
import { localDateString } from '@/lib/dates/tz';
import { CashPaymentForm } from './CashPaymentForm';

export const metadata = { title: 'Record cash payment' };

export default async function CashPaymentPage() {
  const profile = await requireOwner();
  const [candidates, receivers, claimed] = await Promise.all([
    listCashCandidates(),
    listStaffReceivers(),
    pendingRequestObligationIds(),
  ]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/owner/payments" className="text-sm font-medium text-muted-foreground">← Payments</Link>
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Record cash payment</h1>
        <p className="text-sm text-muted-foreground">
          The amount is computed from the selected whole obligations. Cash you
          record yourself settles immediately; an accountant&rsquo;s entry waits
          for your confirmation.
        </p>
      </div>
      <CashPaymentForm
        candidates={candidates}
        today={localDateString()}
        mode="settle"
        receivers={receivers}
        defaultReceiverId={profile.userId}
        claimedObligationIds={[...claimed]}
        paymentsHref="/owner/payments"
      />
    </div>
  );
}
