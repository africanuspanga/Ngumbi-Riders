import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { listApprovers } from '@/lib/requisitions/queries';
import { RequisitionForm } from '@/components/requisitions/RequisitionForm';
import { localDateString } from '@/lib/dates/tz';

export const metadata = { title: 'New purchase request' };

/** Raise a new purchase request for the Managing Director to approve. */
export default async function NewRequisitionPage() {
  await requireAccountant();
  const approvers = await listApprovers();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/accountant/requisitions"
          className="text-sm font-medium text-muted-foreground"
        >
          ← Purchase requests
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-primary-dark sm:text-3xl">
          New request
        </h1>
        <p className="text-muted-foreground text-sm">
          Ask the Managing Director to approve a purchase — motorcycles, spare parts,
          fuel or anything else the business needs. Nothing is bought until they
          approve it.
        </p>
      </div>

      <RequisitionForm
        approvers={approvers}
        today={localDateString()}
        backHref="/accountant/requisitions"
        listHref="/accountant/requisitions"
      />
    </div>
  );
}
