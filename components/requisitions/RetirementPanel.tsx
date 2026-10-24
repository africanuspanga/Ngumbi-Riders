import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import { localDateString } from '@/lib/dates/tz';
import {
  computeRetirementRow,
  STATE_LABELS,
  type RetirementState,
} from '@/lib/requisitions/retirement';
import type { RetirementEntry } from '@/lib/requisitions/retirement-queries';
import {
  RetirementDecision,
  RetirementEntryForm,
  WithdrawRetirementButton,
} from './RetirementControls';

/*
 * Retirement on one requisition (client request 2026-10-23): the running
 * account of what has been verified, what is awaiting the Director, and what
 * is still outstanding — plus the controls the viewer is allowed to use.
 */

const STATE_TONE: Record<RetirementState, string> = {
  unretired: 'bg-overdue/10 text-overdue',
  partially_retired: 'bg-warning/15 text-warning',
  fully_retired: 'bg-paid/15 text-paid',
};

const ENTRY_TONE: Record<RetirementEntry['status'], string> = {
  submitted: 'bg-warning/15 text-warning',
  approved: 'bg-paid/15 text-paid',
  rejected: 'bg-overdue/10 text-overdue',
};

const ENTRY_LABEL: Record<RetirementEntry['status'], string> = {
  submitted: 'Awaiting verification',
  approved: 'Verified',
  rejected: 'Rejected',
};

export function RetirementPanel({
  requisition,
  entries,
  viewer,
  departments,
}: {
  requisition: {
    id: string;
    requisitionNumber: string;
    title: string;
    total: number;
    paymentStatus: string;
    paymentMarkedAt: string | null;
    retirementStatus: string;
    retiredAmount: number | null;
    departmentId: string | null;
    requestedById: string;
    requestedByName: string;
  };
  entries: RetirementEntry[];
  viewer: { userId: string; role: string };
  departments: { id: string; name: string }[];
}) {
  const today = localDateString();
  if (requisition.paymentStatus !== 'paid') {
    return (
      <section className="rounded-(--radius-card) border border-border bg-white p-4 text-sm text-muted-foreground">
        <h2 className="mb-1 font-semibold text-primary-dark">Retirement</h2>
        Retirement opens once the Managing Director marks this purchase <strong>paid</strong>.
      </section>
    );
  }

  const row = computeRetirementRow(
    {
      id: requisition.id,
      requisitionNumber: requisition.requisitionNumber,
      title: requisition.title,
      requestedById: requisition.requestedById,
      requestedByName: requisition.requestedByName,
      departmentName: '',
      requisitionType: '',
      paidAmount: requisition.total,
      paidDate: requisition.paymentMarkedAt ? localDateString(new Date(requisition.paymentMarkedAt)) : null,
      legacyRetirementStatus: requisition.retirementStatus,
      legacyRetiredAmount: requisition.retiredAmount,
    },
    entries,
    today,
  );
  const isOwner = viewer.role === 'owner';
  const canSubmit = row.state !== 'fully_retired' && row.outstanding - row.pendingAmount > 0;

  return (
    <section className="flex flex-col gap-4 rounded-(--radius-card) border border-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-primary-dark">Retirement</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_TONE[row.state]}`}>
          {STATE_LABELS[row.state]} · {row.retiredPercent.toFixed(1)}%
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-paid" style={{ width: `${row.retiredPercent}%` }} />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div><dt className="text-muted-foreground">Paid out</dt><dd className="font-semibold tabular-nums">{formatTZS(row.paidAmount)}</dd></div>
        <div><dt className="text-muted-foreground">Verified spent</dt><dd className="font-semibold tabular-nums">{formatTZS(row.spentAmount)}</dd></div>
        <div><dt className="text-muted-foreground">Cash returned</dt><dd className="font-semibold tabular-nums">{formatTZS(row.returnedAmount)}</dd></div>
        <div><dt className="text-muted-foreground">Awaiting verification</dt><dd className="font-semibold tabular-nums">{formatTZS(row.pendingAmount)}</dd></div>
        <div>
          <dt className="text-muted-foreground">Outstanding</dt>
          <dd className={`font-semibold tabular-nums ${row.outstanding > 0 ? 'text-overdue' : 'text-paid'}`}>{formatTZS(row.outstanding)}</dd>
        </div>
      </dl>
      {row.daysSincePayment !== null && row.outstanding > 0 && (
        <p className="text-sm text-muted-foreground">
          Paid {formatDate(row.paidDate)} · {row.daysSincePayment} day{row.daysSincePayment === 1 ? '' : 's'} ago.
        </p>
      )}
      {row.overspend > 0 && (
        <p className="text-sm font-medium text-warning">
          Spent {formatTZS(row.overspend)} more than was paid out (staff out of pocket).
        </p>
      )}
      {entries.length === 0 && requisition.retirementStatus === 'completed' && (
        <p className="text-sm text-muted-foreground">Retired before itemised retirement was introduced.</p>
      )}

      {entries.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-(--radius-card) border border-border">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold tabular-nums">
                  {formatTZS(e.spentAmount)} spent
                  {e.returnedAmount > 0 ? ` · ${formatTZS(e.returnedAmount)} returned` : ''}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ENTRY_TONE[e.status]}`}>{ENTRY_LABEL[e.status]}</span>
              </div>
              <p>{e.description}</p>
              <p className="text-xs text-muted-foreground">
                Spent {formatDate(e.spentOn)} · submitted by {e.submittedByName} {formatDateTime(e.submittedAt)}
                {e.decidedAt ? ` · ${e.status === 'approved' ? 'verified' : 'rejected'} by ${e.decidedByName ?? 'the Director'} ${formatDateTime(e.decidedAt)}` : ''}
              </p>
              {e.decisionNote && <p className="text-xs italic">“{e.decisionNote}”</p>}
              {e.documents.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {e.documents.map((d) => (
                    <a key={d.id} href={`/api/requisitions/documents/${d.id}`} target="_blank" rel="noopener" className="text-xs font-semibold text-primary underline">
                      {d.fileName}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-warning">No receipt attached.</p>
              )}
              {e.status === 'submitted' && isOwner && <RetirementDecision retirementId={e.id} />}
              {e.status === 'submitted' && !isOwner && e.submittedById === viewer.userId && (
                <WithdrawRetirementButton retirementId={e.id} />
              )}
            </li>
          ))}
        </ul>
      )}

      {canSubmit && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Retire {row.retiredAmount > 0 || row.pendingAmount > 0 ? 'more of ' : ''}this purchase</h3>
          <RetirementEntryForm
            requisitionId={requisition.id}
            outstanding={row.outstanding - row.pendingAmount}
            departments={departments}
            defaultDepartmentId={requisition.departmentId}
            today={today}
          />
        </div>
      )}
    </section>
  );
}
