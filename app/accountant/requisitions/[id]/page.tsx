import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getRequisition } from '@/lib/requisitions/queries';
import { RequisitionView } from '@/components/requisitions/RequisitionView';
import { RequesterActions } from '@/components/requisitions/RequesterActions';
import { StatusBadge } from '@/components/requisitions/StatusBadge';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Purchase request' };

/**
 * One purchase request as its author sees it: the full request, plus whatever
 * they can still do to it. An accountant may open only their own — RLS lets
 * them read every row, so the ownership check is made here explicitly rather
 * than assumed.
 */
export default async function AccountantRequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireAccountant();
  const { id } = await params;
  const requisition = await getRequisition(id);
  if (!requisition) notFound();
  if (profile.role !== 'owner' && requisition.requestedById !== profile.userId) notFound();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <Link
          href="/accountant/requisitions"
          className="text-sm font-medium text-muted-foreground"
        >
          ← Purchase requests
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {requisition.title}
          </h1>
          <StatusBadge status={requisition.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {requisition.requisitionNumber} · {formatTZS(requisition.total)}
        </p>
      </header>

      <RequesterActions
        requisitionId={requisition.id}
        status={requisition.status}
        editHref={`/accountant/requisitions/${requisition.id}/edit`}
        listHref="/accountant/requisitions"
      />

      <RequisitionView
        requisition={requisition}
        documentHref={(documentId) => `/api/requisitions/documents/${documentId}`}
      />
    </div>
  );
}
