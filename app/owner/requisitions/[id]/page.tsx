import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getRequisition } from '@/lib/requisitions/queries';
import { RequisitionView } from '@/components/requisitions/RequisitionView';
import { DecisionActions } from '@/components/requisitions/DecisionActions';
import {
  StatusBadge,
  PaymentBadge,
  RetirementBadge,
} from '@/components/requisitions/StatusBadge';
import { PaymentActions } from '@/components/requisitions/PaymentActions';
import { RequisitionPdfLink } from '@/components/requisitions/RequisitionPdfLink';
import { awaitsDecision, canSetPaymentStatus } from '@/lib/requisitions/compute';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { listRetirementEntries } from '@/lib/requisitions/retirement-queries';
import { listDepartments } from '@/lib/departments/queries';
import { RetirementPanel } from '@/components/requisitions/RetirementPanel';

export const metadata = { title: 'Purchase request' };

/** One purchase request, with the Director's approve / reject decision. */
export default async function OwnerRequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireOwner();
  const { id } = await params;
  const [requisition, retirement, departments] = await Promise.all([
    getRequisition(id),
    listRetirementEntries(id),
    listDepartments(),
  ]);
  if (!requisition) notFound();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <Link href="/owner/requisitions" className="text-sm font-medium text-muted-foreground">
          ← Purchase requests
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{requisition.title}</h1>
          <StatusBadge status={requisition.status} />
          <PaymentBadge status={requisition.status} paymentStatus={requisition.paymentStatus} />
          <RetirementBadge
            status={requisition.status}
            retirementStatus={requisition.retirementStatus}
          />
          <RequisitionPdfLink requisitionId={requisition.id} />
        </div>
        <p className="text-muted-foreground text-sm">
          {requisition.requisitionNumber} · {formatTZS(requisition.total)} · raised by{' '}
          {requisition.requestedByName} on {formatDate(requisition.requestDate)}
        </p>
      </header>

      {awaitsDecision(requisition.status) && (
        <DecisionActions requisitionId={requisition.id} total={requisition.total} />
      )}

      {/* Payment progress only exists after approval (0029). */}
      {canSetPaymentStatus(requisition.status) && (
        <PaymentActions
          requisitionId={requisition.id}
          paymentStatus={requisition.paymentStatus}
        />
      )}

      {/* Retirement (client request 2026-10-23): verify what finance accounted
          for. Shown once 0036 is live; before that the badge above is all. */}
      {requisition.status === 'approved' && retirement.available && (
        <RetirementPanel
          requisition={requisition}
          entries={retirement.entries}
          viewer={profile}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        />
      )}

      <RequisitionView
        requisition={requisition}
        documentHref={(documentId) => `/api/requisitions/documents/${documentId}`}
      />
    </div>
  );
}
