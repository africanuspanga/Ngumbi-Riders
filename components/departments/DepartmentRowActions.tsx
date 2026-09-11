'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteBudget, deleteDepartmentExpense } from '@/lib/departments/actions';

/*
 * The two destructive row controls on a department page.
 *
 * Both are TWO-STEP — the first click asks, the second acts — and neither uses
 * a browser confirm(): a modal dialog blocks every subsequent event on the page
 * and is trivially dismissed by accident on a phone.
 *
 * Failures are always shown. The server can refuse for real reasons (an
 * accountant reaching an owner-only action, a row somebody else already
 * removed), and a delete button that silently does nothing is worse than one
 * that says why it did not.
 */

function useConfirmAction(fn: () => Promise<{ ok: boolean; error?: string }>) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act() {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.ok) {
        router.refresh();
      } else {
        setError(
          res.error === 'forbidden'
            ? 'Only the Managing Director can do that.'
            : res.error === 'not_found'
              ? 'It has already been removed.'
              : 'That did not work. Reload the page.',
        );
      }
    } catch {
      setError('Network error — reload the page.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return { confirming, setConfirming, busy, error, act };
}

function Control({
  confirming,
  setConfirming,
  busy,
  error,
  act,
  askLabel,
  confirmLabel,
}: {
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  act: () => void;
  askLabel: string;
  confirmLabel: string;
}) {
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {error && (
        <span role="alert" className="text-xs font-medium text-overdue">
          {error}
        </span>
      )}
      {confirming ? (
        <span className="inline-flex gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={act}
            className="rounded-[--radius-card] bg-[color:var(--color-overdue)] px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
          >
            {busy ? '…' : confirmLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded-[--radius-card] border border-border px-2 py-1 text-xs font-semibold"
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs font-semibold text-overdue underline"
        >
          {askLabel}
        </button>
      )}
    </span>
  );
}

export function DeleteBudgetButton({ budgetId, label }: { budgetId: string; label: string }) {
  const c = useConfirmAction(() => deleteBudget(budgetId));
  return (
    <Control
      {...c}
      askLabel="Remove"
      confirmLabel={`Remove “${label.slice(0, 18)}”`}
    />
  );
}

export function DeleteExpenseButton({ expenseId, label }: { expenseId: string; label: string }) {
  const c = useConfirmAction(() => deleteDepartmentExpense(expenseId));
  return (
    <Control {...c} askLabel="Delete" confirmLabel={`Delete “${label.slice(0, 18)}”`} />
  );
}
