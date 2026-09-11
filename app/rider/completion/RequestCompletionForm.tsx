'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestContractCompletion } from '@/lib/completion/actions';

/*
 * The rider asks to complete their contract (client feedback #6).
 *
 * Deliberately NOT blocked when money is still outstanding — the warning is
 * shown and the button still works. A rider whose term has ended but who owes
 * two days needs to be able to START this conversation; refusing the request
 * would leave them with no way to do so. What cannot happen is the request
 * being APPROVED with money owing, and that is enforced at approval, at
 * sign-off, and in the database (0034 rule 2b).
 *
 * Swahili: this is a rider surface (spec rule 11).
 */

const ERRORS: Record<string, string> = {
  no_contract: 'Hauna mkataba unaoendelea.',
  already_requested: 'Una ombi linaendelea tayari.',
  forbidden: 'Hauruhusiwi kufanya hili.',
  server_error: 'Hitilafu ya mfumo. Jaribu tena baadaye.',
};

export function RequestCompletionForm({ warning }: { warning: string | null }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await requestContractCompletion({ note });
      if (res.ok) {
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'Ombi halikutumwa. Jaribu tena.');
      }
    } catch {
      // May or may not have reached the server. Say so rather than inviting a
      // second request the unique index would reject.
      setError('Hitilafu ya mtandao. Angalia ukurasa huu tena kabla ya kutuma upya.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
      <div>
        <h2 className="font-semibold text-primary-dark">Omba kumaliza mkataba</h2>
        <p className="text-sm text-muted-foreground">
          Ombi lako litapitia uhasibu na Mkurugenzi. Ukikubaliwa, utapata cheti cha kumaliza
          mkataba.
        </p>
      </div>

      {warning && (
        <p className="rounded-[--radius-card] border border-[color:var(--color-warning)]/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warning}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Ujumbe (si lazima)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="min-h-12 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Inatuma…' : 'Ndiyo, tuma ombi'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="min-h-12 rounded-[--radius-card] border border-border bg-white px-4 py-3 font-semibold"
          >
            Hapana
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-12 self-start rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover"
        >
          Tuma ombi
        </button>
      )}
    </div>
  );
}
