import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { getRiderCompletionState } from '@/lib/completion/queries';
import {
  STATUS_LABELS_SW,
  STATUS_HELP_SW,
  BLOCK_REASONS_SW,
  WARNINGS_SW,
  progressOf,
} from '@/lib/completion/machine';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import { RequestCompletionForm } from './RequestCompletionForm';

export const metadata = { title: 'Kumaliza mkataba' };

/**
 * The rider's end-of-contract page (client feedback #6, #7).
 *
 * Two jobs: let them ASK, and show them exactly where the request has got to —
 * including their certificate, which is theirs to download the moment the
 * Director approves.
 */
export default async function RiderCompletionPage() {
  const profile = await requireRider();
  const state = await getRiderCompletionState(profile.riderId!);
  const r = state.openRequest;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/rider" className="text-sm font-medium text-muted-foreground">
          ← Mwanzo
        </Link>
        <h1 className="mt-1 text-xl font-bold text-primary-dark">Kumaliza mkataba</h1>
      </div>

      {/* Where they stand on money — the thing finance will check. */}
      {state.contract && (
        <div className="rounded-[--radius-card] border border-border bg-white p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="Mkataba" value={state.contract.number} />
            <Row
              label="Unadaiwa"
              value={formatTZS(state.outstandingNow)}
              tone={
                state.outstandingNow > 0
                  ? 'text-overdue'
                  : 'text-[color:var(--color-paid)]'
              }
            />
            <Row
              label="Ulianza"
              value={state.contract.startDate ? formatDate(state.contract.startDate) : '—'}
            />
            <Row
              label="Unaisha"
              value={state.contract.endDate ? formatDate(state.contract.endDate) : '—'}
            />
            <Row label="Siku zilizosalia" value={String(state.futureObligations)} />
            <Row
              label="Umiliki"
              value={
                state.contract.ownershipTransfers
                  ? 'Pikipiki inakuwa yako'
                  : 'Pikipiki inabaki ya kampuni'
              }
            />
          </dl>
        </div>
      )}

      {/* An open request, with its stage. */}
      {r && (
        <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-semibold text-primary-dark">Ombi lako</h2>
            <span className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold">
              {STATUS_LABELS_SW[r.status]}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(Math.round(progressOf(r.status) * 100), 4)}%` }}
            />
          </div>
          <p className="text-sm">{STATUS_HELP_SW[r.status]}</p>
          <p className="text-xs text-muted-foreground">
            {r.requestNumber} · {formatDateTime(r.requestedAt)}
          </p>
          {r.financeNote && (
            <p className="rounded-[--radius-card] border border-border bg-surface px-3 py-2 text-sm">
              {r.financeNote}
            </p>
          )}
          {r.directorNote && (
            <p className="rounded-[--radius-card] border border-border bg-surface px-3 py-2 text-sm">
              {r.directorNote}
            </p>
          )}

          {r.certificate && (
            <a
              href={`/api/completions/certificates/${r.certificate.id}`}
              target="_blank"
              rel="noreferrer"
              className="min-h-12 rounded-[--radius-card] bg-primary px-4 py-3 text-center font-semibold text-white hover:bg-primary-hover"
            >
              Pakua cheti chako
            </a>
          )}
        </section>
      )}

      {/* The form, or why it is not available. */}
      {state.eligibility.ok ? (
        <RequestCompletionForm
          warning={
            state.eligibility.warning ? (WARNINGS_SW[state.eligibility.warning] ?? null) : null
          }
        />
      ) : (
        !r && (
          <p className="rounded-[--radius-card] border border-border bg-surface p-4 text-sm">
            {BLOCK_REASONS_SW[state.eligibility.reason]}
          </p>
        )
      )}

      {/* Past requests, including completed ones and their certificates. */}
      {state.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Maombi yaliyopita</h2>
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
            {state.history.map((h) => (
              <li key={h.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{h.requestNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABELS_SW[h.status]}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(h.requestedAt)} · {h.contractNumber}
                </span>
                {h.rejectionReason && <span className="text-xs">{h.rejectionReason}</span>}
                {h.certificate && (
                  <a
                    href={`/api/completions/certificates/${h.certificate.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-primary underline"
                  >
                    Pakua cheti
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}
