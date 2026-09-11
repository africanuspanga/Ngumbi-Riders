'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  unlockContractForAmendment,
  unlockMotorcycleForAmendment,
} from '@/lib/contracts/lock';
import { LockIcon } from 'lucide-react';

/*
 * "This record is locked" (client feedback 2026-09-11 #10).
 *
 * Shown wherever a completed contract or a transferred motorcycle would
 * otherwise offer an edit. It does two things:
 *
 *   1. EXPLAINS why the fields are frozen, in the owner's terms, rather than
 *      letting them discover it by getting a database error after typing.
 *   2. OFFERS THE AMENDMENT, which is the thing that makes this a locked
 *      record rather than an unreachable one. Unlocking demands a reason and
 *      writes an audit row first, so an amendment always leaves a trace —
 *      which is the entire difference between amending a completed contract
 *      and quietly editing one.
 *
 * Owner-only, and the actions re-check that server-side; the database refuses
 * the write regardless (migration 0034).
 */

const ERRORS: Record<string, string> = {
  forbidden: 'Only the Managing Director can amend a completed record.',
  reason_required: 'Give a reason for the amendment — it goes on the record.',
  not_locked: 'This record is not locked — reload the page.',
  not_found: 'That record no longer exists — reload the page.',
  server_error: 'The amendment could not be recorded. Reload the page and try again.',
};

export function LockNotice({
  entity,
  entityId,
  lockedAt,
  lockReason,
  canAmend,
}: {
  entity: 'contract' | 'motorcycle';
  entityId: string;
  /** ISO instant the record was locked. */
  lockedAt: string;
  lockReason?: string | null;
  /** True for the Managing Director. */
  canAmend: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noun = entity === 'contract' ? 'contract' : 'motorcycle';

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const res =
        entity === 'contract'
          ? await unlockContractForAmendment(entityId, reason)
          : await unlockMotorcycleForAmendment(entityId, reason);
      if (res.ok) {
        setOpen(false);
        setReason('');
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'That did not work. Reload the page and try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether it went through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-4 text-amber-900">
      <p className="flex items-start gap-2 text-sm">
        <LockIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="font-semibold">
            This {noun} was completed and locked on {lockedAt.slice(0, 10).split('-').reverse().join('/')}.
          </strong>{' '}
          {entity === 'contract'
            ? 'Its terms are the record of what was agreed and signed off, so they can no longer be edited.'
            : 'Ownership has transferred, so its registration details can no longer be edited.'}{' '}
          A correction needs an amendment, which is recorded.
          {lockReason ? ` (${lockReason})` : ''}
        </span>
      </p>

      {canAmend &&
        (open ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                Why is this being amended? This is written to the audit trail.
              </span>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Plate number was mistyped on the transfer form"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm font-medium text-overdue">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || reason.trim().length < 3}
                onClick={unlock}
                className="min-h-11 rounded-[--radius-card] bg-[color:var(--color-warning)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Recording…' : 'Unlock for amendment'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-[--radius-card] border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 self-start rounded-[--radius-card] border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            Amend this {noun}
          </button>
        ))}
    </div>
  );
}
