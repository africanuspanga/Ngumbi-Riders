import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getRequisition } from '@/lib/requisitions/queries';
import { RequisitionView } from '@/components/requisitions/RequisitionView';
import { RequesterActions } from '@/components/requisitions/RequesterActions';
import {
  StatusBadge,
  PaymentBadge,
  RetirementBadge,
} from '@/components/requisitions/StatusBadge';
import { RequisitionPdfLink } from '@/components/requisitions/RequisitionPdfLink';
import { RetirementActions } from '@/components/requisitions/RetirementActions';
import { listDepartments } from '@/lib/departments/queries';
import { formatTZS } from '@/lib/money/format';
import { listRetirementEntries } from '@/lib/requisitions/retirement-queries';
import { RetirementPanel } from '@/components/requisitions/RetirementPanel';

export const metadata = { title: 'Purchase request' };

/**
 * One purchase request. Every back-office user may OPEN any request — staff
 * hold SELECT on all of them under RLS, and the dashboards, department pages
 * and reports list every request with a link here. Refusing a request the
 * viewer did not write turned every one of those links into a 404 (client
 * report 2026-10-23), so the page now always renders and only the ACTIONS are
 * scoped: drafting, submitting and withdrawing stay with the author, and the
 * server actions re-check that regardless of what this page shows.
 */
export default async function AccountantRequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireAccountant();
  const { id } = await params;
  const [requisition, departments, retirement] = await Promise.all([
    getRequisition(id),
    listDepartments(),
    listRetirementEntries(id),
  ]);
  if (!requisition) notFound();
  const isAuthor = profile.role === 'owner' || requisition.requestedById === profile.userId;

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
          <PaymentBadge status={requisition.status} paymentStatus={requisition.paymentStatus} />
          <RetirementBadge
            status={requisition.status}
            retirementStatus={requisition.retirementStatus}
          />
          <RequisitionPdfLink requisitionId={requisition.id} />
        </div>
        <p className="text-muted-foreground text-sm">
          {requisition.requisitionNumber} · {formatTZS(requisition.total)} · raised by{' '}
          {requisition.requestedByName}
        </p>
      </header>

      {isAuthor ? (
        <RequesterActions
          requisitionId={requisition.id}
          status={requisition.status}
          editHref={`/accountant/requisitions/${requisition.id}/edit`}
          listHref="/accountant/requisitions"
        />
      ) : (
        <p className="rounded-[--radius-card] border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          You are viewing a request raised by {requisition.requestedByName}. Only they can edit,
          submit or withdraw it.
        </p>
      )}

      <RequisitionView
        requisition={requisition}
        documentHref={(documentId) => `/api/requisitions/documents/${documentId}`}
      />

      {/* Retirement (client request 2026-10-23): itemised entries the
          Director verifies. Until migration 0036 is live the original
          single-step retirement keeps working. */}
      {requisition.status === 'approved' &&
        (retirement.available ? (
          <RetirementPanel
            requisition={requisition}
            entries={retirement.entries}
            viewer={profile}
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          />
        ) : (
          <RetirementActions
            requisitionId={requisition.id}
            approvedTotal={requisition.total}
            paymentStatus={requisition.paymentStatus}
            retirementStatus={requisition.retirementStatus}
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            defaultDepartmentId={requisition.departmentId}
          />
        ))}
    </div>
  );
}
