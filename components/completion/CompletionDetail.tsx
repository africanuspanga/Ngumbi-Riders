import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import {
  STATUS_LABELS,
  NEXT_ACTOR,
  NEXT_ACTION,
  progressOf,
  hasCertificate as statusHasCertificate,
  hasTransferDocument as statusHasTransfer,
} from '@/lib/completion/machine';
import type { CompletionEventRow, CompletionRequestRow } from '@/lib/completion/queries';
import { CompletionTimeline, CompletionStatusChip } from './CompletionTimeline';
import { CompletionActions } from './CompletionActions';

/*
 * One completion request in full, for both back-office roles.
 *
 * A SERVER component. `basePath` and `viewerRole` are plain strings; the
 * interactive part is the CompletionActions client component imported here,
 * which is the only shape that crosses the boundary safely (spec rule 16).
 *
 * The panel that matters most is the money one. Finance's snapshot and the LIVE
 * balance are shown side by side and labelled as what they are, because the
 * whole failure mode this chain guards against is approving a completion
 * against a figure that was true last week.
 */
export function CompletionDetail({
  request,
  events,
  basePath,
  viewerRole,
}: {
  request: CompletionRequestRow;
  events: CompletionEventRow[];
  basePath: string;
  viewerRole: 'owner' | 'accountant';
}) {
  const r = request;
  const pct = Math.round(progressOf(r.status) * 100);
  const actor = NEXT_ACTOR[r.status];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {r.riderName}{' '}
            <span className="font-normal text-muted-foreground">{r.riderNumber}</span>
          </h1>
          <CompletionStatusChip status={r.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {r.requestNumber} · contract{' '}
          <Link href={`${basePath}/contracts/${r.contractId}`} className="underline">
            {r.contractNumber}
          </Link>{' '}
          · motorcycle {r.motorcycleRegistration ?? r.motorcycleNumber}
        </p>

        <div className="flex items-center gap-2">
          <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${
                r.status === 'rejected'
                  ? 'bg-[color:var(--color-overdue)]'
                  : r.status === 'completed'
                    ? 'bg-[color:var(--color-paid)]'
                    : 'bg-primary'
              }`}
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{pct}%</span>
        </div>

        {NEXT_ACTION[r.status] && (
          <p className="text-sm font-medium text-muted-foreground">
            Next: {NEXT_ACTION[r.status]} (
            {actor === 'owner' ? 'Managing Director' : actor === 'nobody' ? '—' : actor})
          </p>
        )}
      </header>

      {/* --- the money ---------------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Outstanding now"
          value={formatTZS(r.outstandingNow)}
          hint="recomputed from the ledger on this page load"
          tone={
            r.outstandingNow > 0
              ? 'text-[color:var(--color-overdue)]'
              : 'text-[color:var(--color-paid)]'
          }
        />
        <Stat
          label="Balance finance saw"
          value={
            r.financeOutstandingSnapshot === null
              ? 'Not reviewed yet'
              : formatTZS(r.financeOutstandingSnapshot)
          }
          hint={
            r.financeReviewedAt
              ? `${r.financeReviewedByName ?? 'Finance'} · ${formatDateTime(r.financeReviewedAt)}`
              : 'evidence of what was decided, not the current figure'
          }
        />
        <Stat
          label="Days still ahead"
          value={String(r.futureObligations)}
          hint={
            r.futureObligations > 0
              ? 'the term has not fully run out'
              : 'the whole calendar has fallen due'
          }
        />
      </section>

      {r.outstandingNow > 0 && (
        <p className="rounded-[--radius-card] border border-[color:var(--color-overdue)]/40 bg-red-50 px-3 py-2 text-sm text-red-900">
          This rider still owes {formatTZS(r.outstandingNow)}. Completion cannot be approved or
          signed off until that is settled — the database refuses it, whatever this screen says.
        </p>
      )}

      {/* --- the contract ------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Contract</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Contract" value={r.contractNumber} />
          <Detail label="Start" value={r.contractStartDate ? formatDate(r.contractStartDate) : '—'} />
          <Detail label="End" value={r.contractEndDate ? formatDate(r.contractEndDate) : '—'} />
          <Detail label="Motorcycle" value={r.motorcycleNumber} />
          <Detail label="Registration" value={r.motorcycleRegistration ?? 'Not recorded'} />
          <Detail
            label="Ownership"
            value={r.ownershipTransfers ? 'Transfers to the rider' : 'Retained by the company'}
          />
        </dl>
        {r.riderNote && (
          <p className="rounded-[--radius-card] border border-border bg-surface px-3 py-2 text-sm">
            <span className="font-semibold">Rider&rsquo;s note: </span>
            {r.riderNote}
          </p>
        )}
      </section>

      {/* --- decisions ---------------------------------------------------- */}
      {(r.financeNote || r.directorNote || r.transferNote || r.signoffNote || r.rejectionReason) && (
        <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
          <h2 className="font-semibold text-primary-dark">Decisions</h2>
          <dl className="flex flex-col gap-3">
            {r.financeNote && (
              <NoteRow
                label={`Finance${r.financeReviewedByName ? ` · ${r.financeReviewedByName}` : ''}`}
                value={r.financeNote}
              />
            )}
            {r.directorNote && (
              <NoteRow
                label={`Managing Director${r.directorDecidedByName ? ` · ${r.directorDecidedByName}` : ''}`}
                value={r.directorNote}
              />
            )}
            {r.transferNote && (
              <NoteRow
                label={`Transfer${r.transferHandledByName ? ` · ${r.transferHandledByName}` : ''}`}
                value={r.transferNote}
              />
            )}
            {r.signoffNote && (
              <NoteRow
                label={`Sign-off${r.signedOffByName ? ` · ${r.signedOffByName}` : ''}`}
                value={r.signoffNote}
              />
            )}
            {r.rejectionReason && (
              <NoteRow
                label={`Rejected${r.rejectedByName ? ` · ${r.rejectedByName}` : ''}`}
                value={r.rejectionReason}
              />
            )}
          </dl>
        </section>
      )}

      {/* --- certificate -------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Certificate of accomplishment</h2>
        {r.certificate ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-semibold">{r.certificate.certificateNumber}</p>
              <p className="text-xs text-muted-foreground">
                Version {r.certificate.version} · issued {formatDateTime(r.certificate.issuedAt)}
                {r.certificate.issuedByName ? ` by ${r.certificate.issuedByName}` : ''}
              </p>
            </div>
            <a
              href={`/api/completions/certificates/${r.certificate.id}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-[--radius-card] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Download PDF
            </a>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {statusHasCertificate(r.status)
              ? 'The certificate should exist but could not be found — reissue it.'
              : 'Generated automatically when the Managing Director approves completion.'}
          </p>
        )}
      </section>

      {/* --- transfer documents ------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Ownership-transfer documents</h2>
        {r.transferDocuments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {statusHasTransfer(r.status)
              ? 'None on file.'
              : 'Uploaded by finance once the transfer is under way.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
            {r.transferDocuments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.fileName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.docType.replace(/_/g, ' ')} · {Math.round(d.sizeBytes / 1024)} KB ·{' '}
                    {formatDateTime(d.createdAt)}
                    {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                  </span>
                  {d.note && <span className="block text-xs">{d.note}</span>}
                </span>
                <a
                  href={`/api/completions/transfer-documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs font-semibold text-primary underline"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- actions ------------------------------------------------------ */}
      <CompletionActions
        requestId={r.id}
        status={r.status}
        viewerRole={viewerRole}
        outstandingNow={r.outstandingNow}
        hasCertificate={Boolean(r.certificate)}
        hasTransferDocument={r.transferDocuments.length > 0}
      />

      {/* --- history ------------------------------------------------------ */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">History</h2>
        <CompletionTimeline events={events} />
      </section>
    </div>
  );
}

/** The queue row: one card per request, saying whose move it is. */
export function CompletionQueue({
  requests,
  basePath,
  viewerRole,
  emptyMessage = 'No completion requests.',
}: {
  requests: CompletionRequestRow[];
  basePath: string;
  viewerRole: 'owner' | 'accountant';
  emptyMessage?: string;
}) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => {
        const actor = NEXT_ACTOR[r.status];
        const mine = actor === viewerRole;
        return (
          <li
            key={r.id}
            className={`flex flex-col gap-2 rounded-[--radius-card] border bg-white p-4 ${
              mine ? 'border-[color:var(--color-warning)]/50' : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-primary-dark">
                  <Link href={`${basePath}/completions/${r.id}`} className="hover:underline">
                    {r.riderName}
                  </Link>{' '}
                  <span className="font-normal text-muted-foreground">{r.riderNumber}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {r.requestNumber} · {r.contractNumber} ·{' '}
                  {r.motorcycleRegistration ?? r.motorcycleNumber} · requested{' '}
                  {formatDate(r.requestedAt)}
                </p>
              </div>
              <CompletionStatusChip status={r.status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span>
                <span className="text-muted-foreground">Outstanding: </span>
                <strong
                  className={
                    r.outstandingNow > 0
                      ? 'font-semibold text-overdue'
                      : 'font-semibold text-[color:var(--color-paid)]'
                  }
                >
                  {formatTZS(r.outstandingNow)}
                </strong>
              </span>
              {r.certificate && (
                <span className="text-muted-foreground">
                  Certificate {r.certificate.certificateNumber}
                </span>
              )}
              {r.transferDocuments.length > 0 && (
                <span className="text-muted-foreground">
                  {r.transferDocuments.length} transfer document
                  {r.transferDocuments.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {NEXT_ACTION[r.status] && (
              <p className="text-xs font-medium text-muted-foreground">
                Next: {NEXT_ACTION[r.status]} (
                {actor === 'owner' ? 'Managing Director' : actor === 'nobody' ? '—' : actor})
              </p>
            )}

            <Link
              href={`${basePath}/completions/${r.id}`}
              className="self-start text-sm font-semibold text-primary-dark underline"
            >
              Open request
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`break-words text-lg font-bold tabular-nums ${tone ?? 'text-primary-dark'}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function NoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/** Re-exported so a page can label a status without importing the machine. */
export { STATUS_LABELS as COMPLETION_STATUS_LABELS };
