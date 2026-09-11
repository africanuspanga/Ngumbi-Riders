import { formatDateTime } from '@/lib/dates/format';
import { STATUS_LABELS, type CompletionStatus } from '@/lib/completion/machine';
import type { CompletionEventRow } from '@/lib/completion/queries';

/*
 * The stage history of a completion request.
 *
 * Rendered from `contract_completion_events`, which is APPEND-ONLY (0034): the
 * point of this list is to answer "who moved this, when, and what did they say"
 * a year later, and an editable log cannot do that.
 *
 * A SERVER component — no interactivity, and nothing here should ship to a
 * browser bundle that does not need it.
 */
export function CompletionTimeline({ events }: { events: CompletionEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-0">
      {events.map((e, i) => (
        <li key={e.id} className="flex gap-3">
          {/* The rail: a dot per event, joined by a line except after the last. */}
          <div className="flex flex-col items-center">
            <span
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dotTone(e.toStatus)}`}
              aria-hidden
            />
            {i < events.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex flex-col pb-4">
            <span className="text-sm font-semibold text-primary-dark">
              {STATUS_LABELS[e.toStatus] ?? e.toStatus}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(e.createdAt)}
              {e.actorName ? ` · ${e.actorName}` : ''}
              {e.actorRole ? ` (${e.actorRole})` : ''}
            </span>
            {e.note && <span className="mt-0.5 text-sm">{e.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function dotTone(status: CompletionStatus): string {
  if (status === 'completed') return 'bg-[color:var(--color-paid)]';
  if (status === 'rejected') return 'bg-[color:var(--color-overdue)]';
  if (status === 'returned') return 'bg-[color:var(--color-warning)]';
  return 'bg-primary';
}

/** One status chip, used by the queues and the detail headers. */
export function CompletionStatusChip({ status }: { status: CompletionStatus }) {
  const tone =
    status === 'completed'
      ? 'border-[color:var(--color-paid)]/30 bg-[color:var(--color-paid)]/10 text-[color:var(--color-paid)]'
      : status === 'rejected'
        ? 'border-[color:var(--color-overdue)]/30 bg-[color:var(--color-overdue)]/10 text-[color:var(--color-overdue)]'
        : status === 'returned'
          ? 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]'
          : 'border-primary/30 bg-primary/10 text-primary-dark';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
