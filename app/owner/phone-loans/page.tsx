import { requireOwner } from '@/lib/auth/session';
import { listPhoneLoanRequests, getPhoneLoanPortfolio } from '@/lib/loans/queries';
import { OPEN_REQUEST_STATUSES } from '@/lib/loans/constants';
import { PhoneLoanQueue } from '@/components/loans/PhoneLoanQueue';
import { PhoneLoanPanel } from '@/components/loans/PhoneLoanPanel';

export const metadata = { title: 'Phone loans' };

/**
 * The Managing Director's phone-loan view (client feedback #3, #12).
 *
 * The Director's own decision point is the PURCHASE REQUISITION, not this
 * queue — approving the handset purchase is what authorises the loan, and it
 * happens at /owner/requisitions through the existing approval workflow. This
 * page is where they see the whole book and can refuse a request outright.
 */
export default async function OwnerPhoneLoansPage() {
  await requireOwner();
  const [portfolio, open, closed] = await Promise.all([
    getPhoneLoanPortfolio(),
    listPhoneLoanRequests({ statuses: OPEN_REQUEST_STATUSES }),
    listPhoneLoanRequests({ statuses: ['completed', 'rejected', 'cancelled'], limit: 25 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Phone loans</h1>
        <p className="text-sm text-muted-foreground">
          A rider with an active contract asks; finance prepares and raises the purchase request;
          you approve the purchase. Repayment pauses the motorcycle lease until the loan is cleared.
        </p>
      </header>

      <PhoneLoanPanel portfolio={portfolio} basePath="/owner" />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Requests in progress ({open.length})</h2>
        <PhoneLoanQueue
          requests={open}
          basePath="/owner"
          viewerRole="owner"
          emptyMessage="No phone-loan requests are in progress."
        />
      </section>

      {closed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">Closed</h2>
          <PhoneLoanQueue requests={closed} basePath="/owner" viewerRole="owner" />
        </section>
      )}
    </div>
  );
}
