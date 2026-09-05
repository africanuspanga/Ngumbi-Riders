'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SendIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import {
  submitRequisition,
  cancelRequisition,
  deleteDraftRequisition,
} from '@/lib/requisitions/actions';
import type { RequisitionStatus } from '@/lib/requisitions/constants';

/*
 * What the accountant can still do to their own request: send a draft up,
 * withdraw one the Director has not decided yet, or delete a draft outright.
 * A decided request offers nothing — it is a record, not a document (rule 6).
 */
const ERRORS: Record<string, string> = {
  forbidden: 'You can only act on requests you raised.',
  not_found: 'That request no longer exists — go back to the list.',
  not_draft: 'That request is no longer a draft — reload the page.',
  not_open: 'That request has already been decided — reload the page.',
  no_items: 'Add at least one item before submitting.',
  server_error: 'A server error occurred. Reload the list and check before trying again.',
};

export function RequesterActions({
  requisitionId,
  status,
  editHref,
  listHref,
}: {
  requisitionId: string;
  status: RequisitionStatus;
  editHref: string;
  listHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (status !== 'draft' && status !== 'submitted') return null;

  async function run(
    kind: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    after: 'refresh' | 'list',
  ) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fn();
      if (res.ok) {
        if (after === 'list') router.push(listHref);
        router.refresh();
      } else {
        setError(ERRORS[res.error ?? ''] ?? 'That could not be completed. Reload and try again.');
      }
    } catch {
      setError('Network error — reload the requests list to check before retrying.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
      <h2 className="font-semibold text-primary-dark">Actions</h2>
      {error && (
        <p
          role="alert"
          className="rounded-[--radius-card] border border-[color:var(--color-overdue)]/30 bg-[color:var(--color-overdue)]/10 px-3 py-2 text-sm font-medium text-[color:var(--color-overdue)]"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {status === 'draft' && (
          <>
            <a
              href={editHref}
              className="rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold hover:bg-surface"
            >
              Edit request
            </a>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('submit', () => submitRequisition(requisitionId), 'refresh')}
              className="inline-flex items-center gap-2 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              <SendIcon className="size-4" />
              {busy === 'submit' ? 'Submitting…' : 'Submit to Managing Director'}
            </button>
          </>
        )}

        {status === 'submitted' && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('cancel', () => cancelRequisition(requisitionId), 'refresh')}
            className="inline-flex items-center gap-2 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold hover:bg-surface disabled:opacity-60"
          >
            <Undo2Icon className="size-4" />
            {busy === 'cancel' ? 'Withdrawing…' : 'Withdraw request'}
          </button>
        )}

        {status === 'draft' &&
          (confirmDelete ? (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run('delete', () => deleteDraftRequisition(requisitionId), 'list')
                }
                className="inline-flex items-center gap-2 rounded-[--radius-card] bg-[color:var(--color-overdue)] px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                <Trash2Icon className="size-4" />
                {busy === 'delete' ? 'Deleting…' : 'Yes, delete this draft'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold hover:bg-surface"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold text-[color:var(--color-overdue)] hover:bg-[color:var(--color-overdue)]/10"
            >
              <Trash2Icon className="size-4" /> Delete draft
            </button>
          ))}
      </div>
    </section>
  );
}
