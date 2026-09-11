import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import {
  REQUEST_STATUS_LABELS,
  NEXT_ACTOR,
  NEXT_ACTION,
  type PhoneLoanRequestStatus,
} from '@/lib/loans/constants';
import type { PhoneLoanRequestRow } from '@/lib/loans/queries';
import { PhoneLoanActions } from './PhoneLoanActions';

/*
 * The staff-facing phone-loan queue (client feedback 2026-09-11 #12).
 *
 * A SERVER component shared by the Director's and the accountant's pages, taking
 * `basePath` and `viewerRole` as plain STRINGS — never a callback, because only
 * a component crosses the client/server boundary (spec rule 16, and three
 * production outages).
 *
 * Every row states WHOSE MOVE IT IS, from lib/loans/constants.ts. The two
 * queues previously built in this codebase (cash approvals, requisitions) both
 * needed a human to work that out from the status name, and the answer is
 * knowable, so it is printed.
 */
export function PhoneLoanQueue({
  requests,
  basePath,
  viewerRole,
  emptyMessage = 'No phone-loan requests.',
}: {
  requests: PhoneLoanRequestRow[];
  /** '/owner' or '/accountant'. */
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
        const action = NEXT_ACTION[r.status];
        const mine = actor === viewerRole;

        return (
          <li
            key={r.id}
            className={`flex flex-col gap-3 rounded-[--radius-card] border bg-white p-4 ${
              mine ? 'border-[color:var(--color-warning)]/50' : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-primary-dark">
                  <Link href={`${basePath}/riders/${r.riderId}`} className="hover:underline">
                    {r.riderName}
                  </Link>{' '}
                  <span className="font-normal text-muted-foreground">{r.riderNumber}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatTZS(r.principal)} over {r.termMonths} month
                  {r.termMonths === 1 ? '' : 's'} · {formatTZS(r.totalAmount)} to repay ·{' '}
                  {r.instalments.map((a) => formatTZS(a)).join(' + ')}
                </p>
                {r.deviceDescription && (
                  <p className="text-sm">Handset: {r.deviceDescription}</p>
                )}
                {r.reason && <p className="text-sm text-muted-foreground">“{r.reason}”</p>}
              </div>
              <StatusChip status={r.status} />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <Meta label="Requested" value={formatDate(r.createdAt)} />
              {r.contractNumber && <Meta label="Contract" value={r.contractNumber} />}
              {r.requisitionNumber && (
                <Meta
                  label="Purchase request"
                  value={r.requisitionNumber}
                  href={r.requisitionId ? `${basePath}/requisitions/${r.requisitionId}` : undefined}
                />
              )}
              {r.reviewedByName && (
                <Meta
                  label="Reviewed by"
                  value={`${r.reviewedByName}${r.reviewedAt ? ` · ${formatDateTime(r.reviewedAt)}` : ''}`}
                />
              )}
              {r.decidedByName && (
                <Meta
                  label="Decided by"
                  value={`${r.decidedByName}${r.decidedAt ? ` · ${formatDateTime(r.decidedAt)}` : ''}`}
                />
              )}
            </dl>

            {(r.reviewNote || r.decisionNote) && (
              <p className="rounded-[--radius-card] border border-border bg-surface px-3 py-2 text-sm">
                {r.decisionNote ?? r.reviewNote}
              </p>
            )}

            {action && (
              <p className="text-xs font-medium text-muted-foreground">
                Next: {action} ({actor === 'owner' ? 'Managing Director' : actor})
              </p>
            )}

            <PhoneLoanActions
              requestId={r.id}
              status={r.status}
              viewerRole={viewerRole}
              requisitionsHref={`${basePath}/requisitions`}
            />
          </li>
        );
      })}
    </ul>
  );
}

function StatusChip({ status }: { status: PhoneLoanRequestStatus }) {
  const tone =
    status === 'completed'
      ? 'border-[color:var(--color-paid)]/30 bg-[color:var(--color-paid)]/10 text-[color:var(--color-paid)]'
      : status === 'rejected' || status === 'cancelled'
        ? 'border-border bg-muted text-muted-foreground'
        : status === 'active'
          ? 'border-primary/30 bg-primary/10 text-primary-dark'
          : 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}
    >
      {REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

function Meta({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">
        {href ? (
          <Link href={href} className="text-primary-dark underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
