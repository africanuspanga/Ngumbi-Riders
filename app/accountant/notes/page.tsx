import { requireAccountant } from '@/lib/auth/session';
import { listFinancialNotes } from '@/lib/notes/actions';
import { formatDateTime } from '@/lib/dates/format';
import { FinancialNoteForm } from './FinancialNoteForm';

export const metadata = { title: 'Financial notes' };

/**
 * Internal financial notes (build spec #10). Append-only: notes are added and
 * read, never edited or deleted — a note about money is a record.
 */
export default async function AccountantNotesPage() {
  await requireAccountant();
  const notes = await listFinancialNotes();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Internal financial notes</h1>
        <p className="text-sm text-muted-foreground">
          Visible to the owner and accountants only. Notes cannot be edited or deleted once added.
        </p>
      </header>

      <FinancialNoteForm />

      {notes.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          No notes yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-[--radius-card] border border-border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-surface px-2 py-0.5 font-semibold capitalize">
                  {n.entityType}
                </span>
                <span>
                  {n.authorName} · {formatDateTime(n.createdAt)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
