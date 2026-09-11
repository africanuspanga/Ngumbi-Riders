'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startFinanceReview,
  recordFinanceClearance,
  sendCompletionToDirector,
  approveCompletion,
  issueCertificate,
  startOwnershipTransfer,
  uploadTransferDocument,
  sendTransferForFinalReview,
  signOffCompletion,
  rejectCompletion,
  returnCompletion,
} from '@/lib/completion/actions';
import { NEXT_ACTOR, type CompletionStatus } from '@/lib/completion/machine';

/*
 * The controls that move a completion request along (client feedback #6–#8, #10).
 *
 * WHICH CONTROLS APPEAR comes from the status and the viewer's role. That is
 * convenience only: every action re-checks its own permission server-side, and
 * the two rules the client actually asked for — no approval without finance
 * clearance, no completion without the Director's sign-off — are enforced a
 * third time by migration 0034's trigger. Hiding a button is not access control
 * (spec rule 12).
 *
 * Every result is inspected and failures are shown, because these fail for
 * ordinary reasons: a day fell due since finance looked, a colleague advanced
 * the request a moment ago, the rider still owes money. A silent no-op would
 * leave the Director clicking a dead button at the most consequential moment in
 * the whole system.
 */

const ERRORS: Record<string, string> = {
  invalid_transition: 'This request has already moved on — reload the page.',
  not_found: 'That request no longer exists — reload the page.',
  forbidden: 'You do not have permission to do that.',
  owner_only: 'Only the Managing Director can do that once completion has been approved.',
  not_finance_cleared:
    'Finance has not confirmed the rider is clear. That step cannot be skipped.',
  not_approved: 'The Managing Director has not approved completion yet.',
  no_signoff: 'This needs the Director’s final sign-off.',
  still_outstanding:
    'The rider still owes money, so this cannot go ahead. Take the payment first, then try again.',
  balance_read_failed:
    'The outstanding balance could not be read, so nothing was changed. Try again.',
  reason_required: 'Give a short reason.',
  closed: 'This request is closed and cannot be reopened.',
  certificate_failed:
    'The approval was recorded but the certificate could not be generated. Use “Issue certificate” to retry.',
  not_in_transfer: 'The transfer has not been started yet.',
  too_large: 'Each file must be 4 MiB or smaller.',
  invalid_type: 'That file is not a PDF, JPG, PNG or WebP.',
  upload_failed: 'The upload failed. Try again.',
  insert_failed: 'The file uploaded but could not be recorded. Try again.',
  no_file: 'Choose a file first.',
  server_error: 'A server error occurred. Reload the page before retrying.',
};

const TRANSFER_DOC_LABELS: Record<string, string> = {
  transfer_form: 'Transfer form',
  registration_card: 'Registration card',
  tra_receipt: 'TRA receipt',
  other: 'Other document',
};

export function CompletionActions({
  requestId,
  status,
  viewerRole,
  outstandingNow,
  hasCertificate,
  hasTransferDocument,
}: {
  requestId: string;
  status: CompletionStatus;
  viewerRole: 'owner' | 'accountant';
  outstandingNow: number;
  hasCertificate: boolean;
  hasTransferDocument: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'none' | 'reject' | 'return' | 'upload'>('none');
  const [docType, setDocType] = useState('transfer_form');

  const closed = status === 'completed' || status === 'rejected';
  const mine = viewerRole === 'owner' || NEXT_ACTOR[status] === 'accountant';

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successNotice?: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (res.ok) {
        if (successNotice) setNotice(successNotice);
        setMode('none');
        setNote('');
        router.refresh();
      } else {
        setError(ERRORS[res.error ?? ''] ?? 'That did not work. Reload the page and try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether it went through.');
    } finally {
      setBusy(false);
    }
  }

  async function upload(formData: FormData) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      formData.set('requestId', requestId);
      formData.set('docType', docType);
      formData.set('note', note);
      const res = await uploadTransferDocument(formData);
      if (res.ok) {
        setNotice(`${res.data?.fileName ?? 'File'} attached.`);
        setMode('none');
        setNote('');
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

  if (closed) {
    return notice || error ? (
      <Messages notice={notice} error={error} />
    ) : null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
      <Messages notice={notice} error={error} />

      {/* --- finance: confirm whether the rider owes anything -------------- */}
      {mine && (status === 'requested' || status === 'finance_review') && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {outstandingNow > 0 ? (
              <>
                The rider still owes{' '}
                <strong className="font-semibold text-overdue">
                  TZS {outstandingNow.toLocaleString('en-US')}
                </strong>
                . They cannot be cleared until that is settled.
              </>
            ) : (
              <>
                Nothing is outstanding on this contract right now. Clearing it records that, along
                with the balance you saw.
              </>
            )}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Finance note (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {status === 'requested' && (
              <Secondary busy={busy} onClick={() => run(() => startFinanceReview(requestId))}>
                Start finance review
              </Secondary>
            )}
            <Primary
              busy={busy}
              disabled={outstandingNow > 0}
              onClick={() =>
                run(
                  () => recordFinanceClearance(requestId, { cleared: true, note }),
                  'Finance clearance recorded.',
                )
              }
            >
              Confirm the rider is clear
            </Primary>
            <Secondary busy={busy} onClick={() => setMode('return')}>
              Return for correction
            </Secondary>
          </div>
        </div>
      )}

      {/* --- finance: send it up ------------------------------------------ */}
      {mine && status === 'finance_cleared' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note for the Director (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Primary busy={busy} onClick={() => run(() => sendCompletionToDirector(requestId, note))}>
            Send to the Managing Director
          </Primary>
        </div>
      )}

      {/* --- Director: approve completion --------------------------------- */}
      {viewerRole === 'owner' && status === 'director_review' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Approving records that this rider has completed their contract and{' '}
            <strong className="font-semibold">generates their certificate automatically</strong>.
            The ownership transfer then goes back to finance.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Primary
              busy={busy}
              disabled={outstandingNow > 0}
              onClick={() =>
                run(() => approveCompletion(requestId, note), 'Approved and certificate issued.')
              }
            >
              Approve completion
            </Primary>
            <Secondary busy={busy} onClick={() => setMode('return')}>
              Return for correction
            </Secondary>
          </div>
        </div>
      )}

      {/* --- Director: the certificate did not generate -------------------- */}
      {viewerRole === 'owner' && status === 'director_approved' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Completion is approved. The certificate has not been generated yet — issue it to move
            the request on to the ownership transfer.
          </p>
          <Primary busy={busy} onClick={() => run(() => issueCertificate(requestId), 'Certificate issued.')}>
            Issue certificate
          </Primary>
        </div>
      )}

      {/* --- finance: the transfer ---------------------------------------- */}
      {mine && status === 'certificate_issued' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            The certificate is issued. Begin the ownership transfer, then upload the signed
            document.
          </p>
          <Primary busy={busy} onClick={() => run(() => startOwnershipTransfer(requestId, note))}>
            Begin ownership transfer
          </Primary>
        </div>
      )}

      {mine && (status === 'transfer_in_progress' || status === 'transfer_uploaded') && (
        <div className="flex flex-col gap-3">
          <form action={upload} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Document type</span>
              <select
                className="input bg-white"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {Object.entries(TRANSFER_DOC_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Note (optional)</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <input
              type="file"
              name="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="input bg-white"
              required
            />
            <Secondary busy={busy} onClick={() => {}} submit>
              {busy ? 'Uploading…' : 'Upload transfer document'}
            </Secondary>
          </form>

          {status === 'transfer_uploaded' && hasTransferDocument && (
            <Primary
              busy={busy}
              onClick={() => run(() => sendTransferForFinalReview(requestId, note))}
            >
              Send to the Director for final review
            </Primary>
          )}
        </div>
      )}

      {/* --- Director: final sign-off ------------------------------------- */}
      {viewerRole === 'owner' && status === 'final_review' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Signing off completes the contract and <strong className="font-semibold">locks it</strong>
            : after this, the contract terms and the motorcycle&rsquo;s registration details can only
            be changed through a recorded amendment, not an ordinary edit.
          </p>
          {!hasTransferDocument && (
            <p className="text-sm font-medium text-[color:var(--color-warning)]">
              No transfer document is on file yet.
            </p>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Sign-off note (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Primary
              busy={busy}
              disabled={outstandingNow > 0}
              onClick={() => run(() => signOffCompletion(requestId, note), 'Completion signed off.')}
            >
              Confirm transfer &amp; sign off
            </Primary>
            <Secondary busy={busy} onClick={() => setMode('return')}>
              Return for correction
            </Secondary>
          </div>
        </div>
      )}

      {/* --- reject / return --------------------------------------------- */}
      {mode === 'none' && !closed && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('reject')}
          className="self-start text-sm font-semibold text-overdue underline disabled:opacity-60"
        >
          Reject this request
        </button>
      )}

      {(mode === 'reject' || mode === 'return') && (
        <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              {mode === 'reject'
                ? 'Reason for rejection (the rider will see this)'
                : 'What needs correcting (the rider will see this)'}
            </span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || note.trim().length < 3}
              onClick={() =>
                run(() =>
                  mode === 'reject'
                    ? rejectCompletion(requestId, note)
                    : returnCompletion(requestId, note),
                )
              }
              className={`min-h-11 rounded-[--radius-card] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${
                mode === 'reject'
                  ? 'bg-[color:var(--color-overdue)]'
                  : 'bg-[color:var(--color-warning)]'
              }`}
            >
              {busy ? 'Saving…' : mode === 'reject' ? 'Confirm rejection' : 'Return for correction'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('none')}
              className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!mine && NEXT_ACTOR[status] !== 'nobody' && (
        <p className="text-sm text-muted-foreground">
          This step belongs to{' '}
          {NEXT_ACTOR[status] === 'owner' ? 'the Managing Director' : NEXT_ACTOR[status]}.
        </p>
      )}
      {hasCertificate && (
        <p className="text-xs text-muted-foreground">
          The certificate is on file and downloadable from this page and the contract.
        </p>
      )}
    </div>
  );
}

function Messages({ notice, error }: { notice: string | null; error: string | null }) {
  return (
    <>
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
    </>
  );
}

function Primary({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

function Secondary({
  busy,
  onClick,
  children,
  submit = false,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
  submit?: boolean;
}) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      disabled={busy}
      onClick={submit ? undefined : onClick}
      className="min-h-11 self-start rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
    >
      {children}
    </button>
  );
}
