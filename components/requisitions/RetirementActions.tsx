'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { retireRequisition, uploadRequisitionDocument } from '@/lib/requisitions/actions';
import {
  POST_DECISION_DOC_TYPES,
  DOC_TYPE_LABELS,
  REQUISITION_DOC_ACCEPT,
  MAX_REQUISITION_DOC_BYTES,
  type RequisitionDocType,
} from '@/lib/requisitions/constants';

/*
 * Retirement, from the accountant's side (client feedback #14).
 *
 * Two things happen here, in this order, because the order is the control:
 *
 *   1. UPLOAD the evidence — proof of payment, the receipt, any retirement
 *      paperwork. One file per request, like every other uploader in this
 *      codebase (D-030): Vercel rejects a body over ~4.5 MB with an opaque 413,
 *      so batching would fail in a way nobody could diagnose.
 *   2. RETIRE, stating what was actually spent. The approved total is offered
 *      as the default because it is usually right, but it is EDITABLE, and the
 *      variance is what the Director actually wants to see. The approved figure
 *      itself is never touched (spec rule 6).
 *
 * Every result is checked. Retirement can legitimately fail — the request may
 * not be marked paid yet, or a colleague may have retired it a moment ago — and
 * a button that silently does nothing is the failure mode the 2026-07-11 sweep
 * was called to remove.
 */

const ERRORS: Record<string, string> = {
  not_approved: 'Only an approved purchase can be retired.',
  not_paid: 'This purchase has not been marked paid yet, so there is nothing to account for.',
  already_retired: 'It has already been retired — reload the page.',
  invalid_amount: 'Enter a valid amount.',
  not_found: 'That request no longer exists — reload the page.',
  forbidden: 'You do not have permission to retire a purchase request.',
  not_draft: 'That kind of document can only be attached while the request is a draft.',
  too_large: `Each file must be ${Math.round(MAX_REQUISITION_DOC_BYTES / (1024 * 1024))} MiB or smaller.`,
  too_many: 'There are already ten documents of that kind on this request.',
  invalid_type: 'That file is not a PDF, JPG, PNG or WebP.',
  upload_failed: 'The upload failed. Try again.',
  insert_failed: 'The file uploaded but could not be recorded. Try again.',
  no_file: 'Choose a file first.',
  server_error: 'A server error occurred. Reload the page before retrying.',
};

function tzs(n: number) {
  return `TZS ${Math.round(n).toLocaleString('en-US')}`;
}

export function RetirementActions({
  requisitionId,
  approvedTotal,
  paymentStatus,
  retirementStatus,
  departments,
  defaultDepartmentId,
}: {
  requisitionId: string;
  approvedTotal: number;
  paymentStatus: string;
  retirementStatus: string;
  departments: { id: string; name: string }[];
  defaultDepartmentId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [docType, setDocType] = useState<RequisitionDocType>('receipt');
  const [actual, setActual] = useState(String(approvedTotal));
  const [note, setNote] = useState('');
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? '');

  const alreadyRetired = retirementStatus === 'completed';
  const paid = paymentStatus === 'paid';
  const actualNumber = Number(actual);
  const variance = Number.isFinite(actualNumber) ? actualNumber - approvedTotal : 0;

  async function upload(formData: FormData) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      formData.set('requisitionId', requisitionId);
      formData.set('docType', docType);
      const res = await uploadRequisitionDocument(formData);
      if (res.ok) {
        setNotice(`${res.data?.fileName ?? 'File'} attached.`);
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'The upload failed. Try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether the file arrived.');
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await retireRequisition(requisitionId, {
        actualAmount: Number.isFinite(actualNumber) ? actualNumber : undefined,
        note,
        departmentId: departmentId || undefined,
      });
      if (res.ok) {
        setNotice(
          res.data?.expenseId
            ? 'Retired, and the spend was recorded as a department expense.'
            : 'Retired.',
        );
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'Retirement failed. Reload the page and try again.');
      }
    } catch {
      setError('Network error — reload the page before retrying.');
    } finally {
      setBusy(false);
    }
  }

  if (!paid) {
    return (
      <p className="rounded-[--radius-card] border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
        Retirement opens once the Managing Director marks this purchase paid. Approving a purchase
        and releasing the money are separate acts, and only the Director does the second.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
      <h2 className="font-semibold text-primary-dark">
        {alreadyRetired ? 'Retirement evidence' : 'Retire this purchase'}
      </h2>

      {notice && (
        <p role="status" className="text-sm font-medium text-[color:var(--color-paid)]">
          ✓ {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      {/* 1. Evidence. Still available after retirement: a receipt may arrive
             later, and refusing it would push it into a drawer. */}
      <form action={upload} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Attach a document</span>
          <select
            className="input bg-white"
            value={docType}
            onChange={(e) => setDocType(e.target.value as RequisitionDocType)}
          >
            {POST_DECISION_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <input
          type="file"
          name="file"
          accept={REQUISITION_DOC_ACCEPT}
          className="input bg-white"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 self-start rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
        >
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {/* 2. The accounting itself. */}
      {!alreadyRetired && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">What was actually spent (TZS)</span>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              step={500}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Approved: {tzs(approvedTotal)}.
              {variance !== 0 && Number.isFinite(actualNumber) && (
                <>
                  {' '}
                  <strong
                    className={
                      variance > 0
                        ? 'font-semibold text-overdue'
                        : 'font-semibold text-[color:var(--color-paid)]'
                    }
                  >
                    {variance > 0 ? 'Over' : 'Under'} by {tzs(Math.abs(variance))}.
                  </strong>{' '}
                  The approved figure is not changed — the variance is reported.
                </>
              )}
            </span>
          </label>

          {departments.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Record the spend under</span>
              <select
                className="input bg-white"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">Do not create an expense</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                This is where an approved purchase becomes a real cost in the reports.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <button
            type="button"
            disabled={busy || !Number.isFinite(actualNumber) || actualNumber < 0}
            onClick={retire}
            className="min-h-12 self-start rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {busy ? 'Retiring…' : 'Retire purchase request'}
          </button>
        </div>
      )}
    </div>
  );
}
