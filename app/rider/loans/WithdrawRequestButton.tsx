'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withdrawPhoneLoanRequest } from '@/lib/loans/requests';

/*
 * Two-step withdrawal: the first tap asks, the second acts. No browser
 * confirm() — a modal dialog blocks the page and, on the low-cost Android
 * handsets this app targets, is easy to dismiss by accident.
 *
 * The result is always checked and always shown. An action button whose
 * failure is invisible was one of the findings of the 2026-07-11 silent-failure
 * sweep, and this one can fail for a real reason: finance may have picked the
 * request up between the page render and the tap.
 */
export function WithdrawRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const res = await withdrawPhoneLoanRequest(requestId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(
          res.error === 'too_late'
            ? 'Ombi lako limeanza kufanyiwa kazi, hauwezi kuliondoa sasa.'
            : 'Haikuwezekana kuondoa ombi. Jaribu tena.',
        );
      }
    } catch {
      setError('Hitilafu ya mtandao. Jaribu tena.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={withdraw}
            className="min-h-11 rounded-[--radius-card] bg-[color:var(--color-overdue)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Inaondoa…' : 'Ndiyo, ondoa ombi'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold"
          >
            Hapana
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 self-start rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-overdue"
        >
          Ondoa ombi
        </button>
      )}
    </div>
  );
}
