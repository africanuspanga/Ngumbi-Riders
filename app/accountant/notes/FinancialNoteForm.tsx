'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addFinancialNote } from '@/lib/notes/actions';

const SCOPES = [
  { value: 'general', label: 'General' },
  { value: 'rider', label: 'Rider' },
  { value: 'contract', label: 'Contract' },
  { value: 'payment', label: 'Payment' },
  { value: 'motorcycle', label: 'Motorcycle' },
] as const;

/** Add an internal financial note. Errors are always surfaced, never swallowed. */
export function FinancialNoteForm() {
  const router = useRouter();
  const [entityType, setEntityType] = useState<string>('general');
  const [entityId, setEntityId] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    try {
      const res = await addFinancialNote({ entityType, entityId, body });
      if (!res.ok) {
        setError(
          res.error === 'forbidden'
            ? 'You are not allowed to add notes.'
            : res.error === 'entity_required'
              ? 'Paste the record ID this note is about, or choose General.'
              : res.error === 'insert_failed'
                ? 'Could not save the note. Try again.'
                : res.error,
        );
        return;
      }
      setBody('');
      setEntityId('');
      setDone(true);
      startTransition(() => router.refresh());
    } catch {
      setError('Network error — the note was not saved.');
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Note is about</span>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="input"
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {entityType !== 'general' && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">Record ID</span>
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="Paste the ID from the record's URL"
              className="input"
            />
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Note</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          required
          className="input"
          placeholder="e.g. Rider paid 50,000 in cash at the office; receipt handed over."
        />
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}
      {done && <p className="text-sm font-medium text-[color:var(--color-paid)]">Note saved.</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Add note'}
      </button>
    </form>
  );
}
