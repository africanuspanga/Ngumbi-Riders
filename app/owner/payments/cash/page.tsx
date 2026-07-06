import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listCashCandidates } from '@/lib/payments/queries';
import { localDateString } from '@/lib/dates/tz';
import { CashPaymentForm } from './CashPaymentForm';

export const metadata = { title: 'Record cash payment' };

export default async function CashPaymentPage() {
  await requireOwner();
  const candidates = await listCashCandidates();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/owner/payments" className="text-sm font-medium text-muted">← Payments</Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Record cash payment</h1>
        <p className="text-sm text-muted">
          Only the owner can record cash. The amount is computed from the selected
          whole obligations.
        </p>
      </div>
      <CashPaymentForm candidates={candidates} today={localDateString()} />
    </div>
  );
}
