'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelPendingPayment } from '@/lib/payments/actions';

/*
 * Owner escape hatch for a permanently-stuck pending payment. Its active
 * reservations block cash-recording the same obligations (the DB refuses,
 * correctly), and previously the ONLY release path was the rider's own cancel
 * button. cancelPendingPayment already authorizes the owner role, releases the
 * reservations, and is settlement-safe: if Snippe later reports the intent
 * completed, record_completed_payment refuses a cancelled payment and the
 * webhook flags it to the owner — never a silent double-charge.
 */
export function CancelStuckButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm('Cancel this stuck payment and release its reserved days for cash recording?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cancelPendingPayment(paymentId);
      if (res.ok) router.refresh();
      else setError(res.error === 'not_pending' ? 'Already resolved — refresh.' : 'Could not cancel. Try again.');
    } catch {
      setError('Network error — refresh and check the payment status before retrying.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs font-medium text-overdue">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={cancel}
        className="rounded-[--radius-card] border border-border px-2.5 py-1 text-xs font-semibold text-overdue hover:bg-surface disabled:opacity-60"
      >
        {busy ? 'Cancelling…' : 'Cancel'}
      </button>
    </span>
  );
}
