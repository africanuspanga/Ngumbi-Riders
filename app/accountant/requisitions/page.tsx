import Link from 'next/link';
import { PlusCircleIcon } from 'lucide-react';
import { requireAccountant } from '@/lib/auth/session';
import { listRequisitions } from '@/lib/requisitions/queries';
import { RequisitionTable } from '@/components/requisitions/RequisitionTable';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Purchase requests' };

/**
 * Purchase requests (client feedback 2026-09-05). An accountant raises a
 * request to buy motorcycles, spare parts, fuel or anything else; the
 * Managing Director approves or rejects it.
 *
 * The finance team sees EVERY request, not only its own (client report
 * 2026-10-23: requests raised by one accountant were invisible to the other,
 * and links from the dashboard and reports landed on a 404). Their own come
 * first. A colleague's DRAFT is still private work in progress and is left out.
 */
export default async function AccountantRequisitionsPage() {
  const profile = await requireAccountant();
  const all = await listRequisitions();
  const isMine = (r: (typeof all)[number]) => r.requestedById === profile.userId;
  // Stable sort: own requests first, each group still newest first.
  const requisitions = all
    .filter((r) => isMine(r) || r.status !== 'draft')
    .sort((a, b) => Number(isMine(b)) - Number(isMine(a)));

  const isOpen = (r: (typeof all)[number]) =>
    r.status === 'draft' || r.status === 'submitted' || r.status === 'under_review';
  const open = requisitions.filter(isOpen);
  const closed = requisitions.filter((r) => !isOpen(r));
  const awaiting = open.filter((r) => r.status !== 'draft');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Purchase requests</h1>
          <p className="text-muted-foreground text-sm">
            {awaiting.length === 0
              ? 'Nothing is waiting on the Managing Director.'
              : `${awaiting.length} request${awaiting.length === 1 ? '' : 's'} with the Managing Director · ${formatTZS(
                  awaiting.reduce((sum, r) => sum + r.total, 0),
                )}`}
          </p>
        </div>
        <Link
          href="/accountant/requisitions/new"
          className="inline-flex items-center gap-2 rounded-(--radius-card) bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          <PlusCircleIcon className="size-5" /> New request
        </Link>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-primary-dark">Open</h2>
        <RequisitionTable
          requisitions={open}
          showRequester
          hrefFor={(r) => `/accountant/requisitions/${r.id}`}
          emptyMessage="No open requests. Start one with “New request”."
        />
      </section>

      {closed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Decided</h2>
          <RequisitionTable
            requisitions={closed}
            showRequester
            hrefFor={(r) => `/accountant/requisitions/${r.id}`}
            emptyMessage="Nothing decided yet."
          />
        </section>
      )}
    </div>
  );
}
