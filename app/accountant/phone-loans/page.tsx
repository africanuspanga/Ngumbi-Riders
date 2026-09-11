import { requireAccountant } from '@/lib/auth/session';
import { listPhoneLoanRequests, getPhoneLoanPortfolio } from '@/lib/loans/queries';
import { OPEN_REQUEST_STATUSES, NEXT_ACTOR } from '@/lib/loans/constants';
import { PhoneLoanQueue } from '@/components/loans/PhoneLoanQueue';
import { PhoneLoanPanel } from '@/components/loans/PhoneLoanPanel';

export const metadata = { title: 'Phone loans' };

/**
 * Finance's phone-loan worklist (client feedback #12).
 *
 * Split into "yours now" and "waiting on someone else" so the accountant is
 * never scanning a mixed list to find their own work. The split is computed
 * from NEXT_ACTOR, the same table the queue rows print, so the heading and the
 * per-row "Next:" line can never disagree.
 */
export default async function AccountantPhoneLoansPage() {
  await requireAccountant();
  const [portfolio, open, closed] = await Promise.all([
    getPhoneLoanPortfolio(),
    listPhoneLoanRequests({ statuses: OPEN_REQUEST_STATUSES }),
    listPhoneLoanRequests({ statuses: ['completed', 'rejected', 'cancelled'], limit: 25 }),
  ]);

  const mine = open.filter((r) => NEXT_ACTOR[r.status] === 'accountant');
  const elsewhere = open.filter((r) => NEXT_ACTOR[r.status] !== 'accountant');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Phone loans</h1>
        <p className="text-sm text-muted-foreground">
          Review the request, get the invoice, raise the purchase requisition for the Director, then
          activate the loan once the handset is bought.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Needs your action ({mine.length})</h2>
        <PhoneLoanQueue
          requests={mine}
          basePath="/accountant"
          viewerRole="accountant"
          emptyMessage="Nothing is waiting on finance."
        />
      </section>

      {elsewhere.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">Waiting on someone else</h2>
          <PhoneLoanQueue requests={elsewhere} basePath="/accountant" viewerRole="accountant" />
        </section>
      )}

      <PhoneLoanPanel portfolio={portfolio} basePath="/accountant" />

      {closed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">Closed</h2>
          <PhoneLoanQueue requests={closed} basePath="/accountant" viewerRole="accountant" />
        </section>
      )}
    </div>
  );
}
