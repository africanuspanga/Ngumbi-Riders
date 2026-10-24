'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  submitRetirementEntry,
  uploadRetirementReceipt,
  withdrawRetirementEntry,
  decideRetirementEntry,
} from '@/lib/requisitions/retirement-actions';
import { REQUISITION_DOC_ACCEPT, MAX_REQUISITION_DOC_BYTES } from '@/lib/requisitions/constants';

/*
 * The interactive half of the retirement flow (client request 2026-10-23).
 * Every result is checked and shown — a button that silently does nothing is
 * the failure mode the 2026-07-11 sweep removed.
 */

const ERRORS: Record<string, string> = {
  forbidden: 'You do not have permission to do that.',
  not_found: 'That record no longer exists — reload the page.',
  not_approved: 'Only an approved request can be retired.',
  not_paid: 'This request has not been marked paid yet, so there is nothing to retire.',
  already_retired: 'This request is already fully retired — reload the page.',
  already_decided: 'That entry has already been decided — reload the page.',
  invalid_amount: 'Enter valid amounts (whole shillings, not negative).',
  nothing_to_retire: 'Enter the amount spent, the cash returned, or both.',
  returned_exceeds_outstanding: 'Cash returned cannot be more than what is still outstanding.',
  description_required: 'Describe what the money was spent on.',
  invalid_date: 'Choose the date the money was spent.',
  future_date: 'The spend date cannot be in the future.',
  reason_required: 'Give a reason so the accountant knows what to fix.',
  too_large: `Each file must be ${Math.round(MAX_REQUISITION_DOC_BYTES / (1024 * 1024))} MiB or smaller.`,
  too_many: 'This request already has ten receipts attached.',
  invalid_type: 'Receipts must be PDF, JPG, PNG or WebP (iPhone HEIC photos are not accepted — send a screenshot or a JPG instead).',
  upload_failed: 'A receipt failed to upload. Try attaching it again.',
  server_error: 'A server error occurred. Reload the page before retrying.',
};

const message = (code: string | undefined) => ERRORS[code ?? ''] ?? 'That could not be completed. Reload and try again.';

function tzs(n: number) {
  return `TZS ${Math.round(n).toLocaleString('en-US')}`;
}

export function RetirementEntryForm({
  requisitionId,
  outstanding,
  departments,
  defaultDepartmentId,
  today,
}: {
  requisitionId: string;
  outstanding: number;
  departments: { id: string; name: string }[];
  defaultDepartmentId: string | null;
  today: string;
}) {
  const router = useRouter();
  const [spent, setSpent] = useState(String(outstanding));
  const [returned, setReturned] = useState('0');
  const [spentOn, setSpentOn] = useState(today);
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const total = (Number(spent) || 0) + (Number(returned) || 0);
  const remainder = outstanding - total;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await submitRetirementEntry({
        requisitionId,
        spentAmount: Number(spent),
        returnedAmount: Number(returned) || 0,
        spentOn,
        description,
        departmentId: departmentId || null,
      });
      if (!res.ok || !res.data) {
        setError(message(res.ok ? undefined : res.error));
        return;
      }
      // One receipt per request (D-030). The entry exists already, so a failed
      // upload is reported and can be retried without re-submitting.
      const failed: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.set('retirementId', res.data.id);
        fd.set('file', file);
        const up = await uploadRetirementReceipt(fd);
        if (!up.ok) failed.push(`${file.name}: ${message(up.error)}`);
      }
      setNotice(
        failed.length === 0
          ? 'Submitted. The Managing Director has been notified to verify it.'
          : `Submitted, but some receipts did not upload — ${failed.join(' ')}`,
      );
      setDescription('');
      setFiles([]);
      router.refresh();
    } catch {
      setError('Network error — check the list below before submitting again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Amount spent (TZS)</span>
          <input type="number" min={0} step={1} required value={spent} onChange={(e) => setSpent(e.target.value)} className="min-h-10 rounded-(--radius-card) border border-border px-3 tabular-nums" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Cash returned (TZS)</span>
          <input type="number" min={0} step={1} value={returned} onChange={(e) => setReturned(e.target.value)} className="min-h-10 rounded-(--radius-card) border border-border px-3 tabular-nums" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Date spent</span>
          <input type="date" required max={today} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className="min-h-10 rounded-(--radius-card) border border-border px-3" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">What was bought / paid</span>
        <textarea required minLength={3} maxLength={2000} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-(--radius-card) border border-border px-3 py-2" placeholder="e.g. 2 tyres and labour at Kariakoo, receipt no. 4471" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">File the spend under</span>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="min-h-10 rounded-(--radius-card) border border-border px-3">
            <option value="">— No department (not filed as an expense) —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Receipts</span>
          <input type="file" multiple accept={REQUISITION_DOC_ACCEPT} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="text-sm" />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        This entry accounts for <strong>{tzs(total)}</strong> of the {tzs(outstanding)} outstanding.{' '}
        {remainder > 0
          ? `${tzs(remainder)} will remain to retire.`
          : remainder < 0
            ? `That is ${tzs(-remainder)} more than outstanding — it will be recorded as overspend.`
            : 'Once verified, the request is fully retired.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="min-h-10 rounded-(--radius-card) bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
          {busy ? 'Submitting…' : 'Submit for verification'}
        </button>
        {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
        {notice && <p role="status" className="text-sm font-medium text-paid">{notice}</p>}
      </div>
    </form>
  );
}

export function WithdrawRetirementButton({ retirementId }: { retirementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await withdrawRetirementEntry(retirementId);
            if (!res.ok) setError(message(res.error));
            else router.refresh();
          } catch {
            setError('Network error.');
          } finally {
            setBusy(false);
          }
        }}
        className="text-sm font-semibold text-overdue underline disabled:opacity-60"
      >
        {busy ? 'Withdrawing…' : 'Withdraw'}
      </button>
      {error && <span className="text-xs text-overdue">{error}</span>}
    </span>
  );
}

export function RetirementDecision({ retirementId }: { retirementId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      const res = await decideRetirementEntry(retirementId, decision, note);
      if (!res.ok) setError(message(res.error));
      else router.refresh();
    } catch {
      setError('Network error — reload before trying again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide('approve')} className="min-h-9 rounded-(--radius-card) bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? 'Saving…' : 'Verify'}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode('rejecting')} className="min-h-9 rounded-(--radius-card) border border-border bg-white px-3 text-sm font-semibold">
            Reject
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason — e.g. receipt missing for the second tyre" className="rounded-(--radius-card) border border-border px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => decide('reject')} className="min-h-9 rounded-(--radius-card) bg-overdue px-3 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Reject entry'}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode('idle')} className="min-h-9 rounded-(--radius-card) border border-border bg-white px-3 text-sm font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-overdue">{error}</p>}
    </div>
  );
}
