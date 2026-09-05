import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import {
  listCashCandidates,
  listCashRequests,
  listStaffReceivers,
  pendingRequestObligationIds,
} from '@/lib/payments/queries';
import { createAdminClient } from '@/lib/supabase/admin';
import { localDateString } from '@/lib/dates/tz';
import { CashPaymentForm } from '@/app/owner/payments/cash/CashPaymentForm';

export const metadata = { title: 'Edit cash request' };

/**
 * "There should also be an option to edit the payment in case the wrong amount
 *  was entered." Because the amount is derived from whole obligations, editing
 * the amount means editing which days the cash covers — the same form the
 * accountant filled in, re-opened on the pending request.
 */
export default async function EditCashRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireOwner();
  const { id } = await params;

  const [requests, candidates, receivers, claimed] = await Promise.all([
    listCashRequests(['pending'], 200),
    listCashCandidates(),
    listStaffReceivers(),
    pendingRequestObligationIds(),
  ]);
  const request = requests.find((r) => r.id === id);
  if (!request) notFound();

  // received_by is not on the list row; read it for the form's default.
  const admin = createAdminClient();
  const { data } = await admin
    .from('cash_payment_requests')
    .select('received_by')
    .eq('id', id)
    .maybeSingle();
  const receivedById = (data as { received_by: string } | null)?.received_by ?? profile.userId;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/owner/payments/approvals" className="text-sm font-medium text-muted-foreground">
          ← Cash approvals
        </Link>
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Edit cash request</h1>
        <p className="text-sm text-muted-foreground">
          {request.riderName} · raised by {request.requestedByName}. Changing the days changes the
          amount — the total is always recomputed from the days you tick.
        </p>
      </div>
      <CashPaymentForm
        candidates={candidates}
        today={localDateString()}
        mode="edit"
        receivers={receivers}
        claimedObligationIds={[...claimed]}
        paymentsHref="/owner/payments/approvals"
        editRequest={{
          id: request.id,
          riderId: request.riderId,
          obligationIds: request.obligationIds,
          paymentDate: request.paymentDate,
          note: request.note,
          receivedById,
        }}
      />
    </div>
  );
}
