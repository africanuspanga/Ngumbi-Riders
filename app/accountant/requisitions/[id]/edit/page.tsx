import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getRequisition, listApprovers } from '@/lib/requisitions/queries';
import { RequisitionForm } from '@/components/requisitions/RequisitionForm';
import { localDateString } from '@/lib/dates/tz';

export const metadata = { title: 'Edit purchase request' };

/**
 * Edit a DRAFT. Once submitted the request belongs to the approval record and
 * is withdrawn rather than edited — enforced by the server action and by a
 * trigger in migration 0028, so this redirect is convenience, not security.
 */
export default async function EditRequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireAccountant();
  const { id } = await params;
  const [requisition, approvers] = await Promise.all([getRequisition(id), listApprovers()]);
  if (!requisition) notFound();
  if (profile.role !== 'owner' && requisition.requestedById !== profile.userId) notFound();
  if (requisition.status !== 'draft') redirect(`/accountant/requisitions/${id}`);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href={`/accountant/requisitions/${id}`}
          className="text-sm font-medium text-muted-foreground"
        >
          ← Back to the request
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-primary-dark sm:text-3xl">
          Edit request
        </h1>
        <p className="text-muted-foreground text-sm">
          {requisition.requisitionNumber} · still a draft, so nothing has reached the
          Managing Director yet.
        </p>
      </div>

      <RequisitionForm
        approvers={approvers}
        today={localDateString()}
        requisitionNumber={requisition.requisitionNumber}
        existingDocuments={requisition.documents}
        defaults={{
          id: requisition.id,
          title: requisition.title,
          description: requisition.description ?? '',
          department: requisition.department,
          requestDate: requisition.requestDate,
          paymentInformation: requisition.paymentInformation ?? '',
          approverId: requisition.approverId ?? undefined,
          items: requisition.items.map((item) => ({
            description: item.description,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            budgetCover: item.budgetCover,
          })),
        }}
        backHref={`/accountant/requisitions/${id}`}
        listHref={`/accountant/requisitions/${id}`}
      />
    </div>
  );
}
