import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { listCashCandidates } from '@/lib/payments/queries';
import { localDateString } from '@/lib/dates/tz';
import { CashPaymentForm } from '@/app/owner/payments/cash/CashPaymentForm';

export const metadata = { title: 'Record payment' };

/**
 * The accountant's authorised manual-payment entry (build spec #10). It reuses
 * the owner's form and the same `recordCashPayment` action, which re-checks the
 * `payments.record` permission server-side and settles through
 * record_completed_payment — identical money guarantees, whoever records it.
 */
export default async function AccountantCashPaymentPage() {
  await requireAccountant();
  const candidates = await listCashCandidates();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/accountant/payments" className="text-sm font-medium text-muted-foreground">
          ← Payments
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Record payment</h1>
        <p className="text-sm text-muted-foreground">
          The amount is computed from the selected whole obligations, oldest
          first. Every entry is recorded against your account in the audit trail.
        </p>
      </div>
      <CashPaymentForm candidates={candidates} today={localDateString()} />
    </div>
  );
}
