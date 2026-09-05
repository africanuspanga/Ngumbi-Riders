import { requireOwner } from '@/lib/auth/session';
import { listRequisitions } from '@/lib/requisitions/queries';
import { RequisitionTable } from '@/components/requisitions/RequisitionTable';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Purchase requests' };

/**
 * The Managing Director's approval queue (client feedback 2026-09-05). The
 * accountant asks to buy motorcycles and everything else here; nothing is
 * authorised until Mr. Ng'umbi approves it.
 */
export default async function OwnerRequisitionsPage() {
  await requireOwner();
  const all = await listRequisitions();

  const pending = all.filter((r) => r.status === 'submitted');
  const decided = all.filter((r) => r.status === 'approved' || r.status === 'rejected');
  const other = all.filter((r) => r.status === 'draft' || r.status === 'cancelled');
  const pendingTotal = pending.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Purchase requests</h1>
        <p className="text-muted-foreground text-sm">
          {pending.length === 0
            ? 'Nothing waiting for your approval.'
            : `${pending.length} request${pending.length === 1 ? '' : 's'} awaiting your approval · ${formatTZS(pendingTotal)}. Nothing is bought until you approve it.`}
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-primary-dark">Awaiting your approval</h2>
        <RequisitionTable
          requisitions={pending}
          hrefFor={(r) => `/owner/requisitions/${r.id}`}
          showRequester
          emptyMessage="Nothing waiting for approval. ✓"
        />
      </section>

      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Decided</h2>
          <RequisitionTable
            requisitions={decided}
            hrefFor={(r) => `/owner/requisitions/${r.id}`}
            showRequester
            emptyMessage="Nothing decided yet."
          />
        </section>
      )}

      {other.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Drafts and withdrawn</h2>
          <RequisitionTable
            requisitions={other}
            hrefFor={(r) => `/owner/requisitions/${r.id}`}
            showRequester
            emptyMessage="None."
          />
        </section>
      )}
    </div>
  );
}
