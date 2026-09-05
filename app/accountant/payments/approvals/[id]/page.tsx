import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import {
  listCashCandidates,
  listCashRequests,
  listStaffReceivers,
  pendingRequestObligationIds,
} from '@/lib/payments/queries';
import { createAdminClient } from '@/lib/supabase/admin';
import { localDateString } from '@/lib/dates/tz';
import { CashPaymentForm } from '@/app/owner/payments/cash/CashPaymentForm';

export const metadata = { title: 'Edit cash entry' };

/** The accountant corrects their own still-pending entry (wrong amount/days). */
export default async function AccountantEditRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireAccountant();
  const { id } = await params;

  const [requests, candidates, receivers, claimed] = await Promise.all([
    listCashRequests(['pending'], 200),
    listCashCandidates(),
    listStaffReceivers(),
    pendingRequestObligationIds(),
  ]);
  const request = requests.find((r) => r.id === id);
  if (!request) notFound();

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
        <Link href="/accountant/payments/approvals" className="text-sm font-medium text-muted-foreground">
          ← Awaiting confirmation
        </Link>
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Edit cash entry</h1>
        <p className="text-sm text-muted-foreground">
          {request.riderName}. The amount is recomputed from the days you tick. The server refuses
          the edit if the Director has already decided it.
        </p>
      </div>
      <CashPaymentForm
        candidates={candidates}
        today={localDateString()}
        mode="edit"
        receivers={receivers}
        claimedObligationIds={[...claimed]}
        paymentsHref="/accountant/payments/approvals"
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
