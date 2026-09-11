import { requireOwner } from '@/lib/auth/session';
import { listCompletionRequests } from '@/lib/completion/queries';
import { OPEN_COMPLETION_STATUSES, NEXT_ACTOR } from '@/lib/completion/machine';
import { CompletionQueue } from '@/components/completion/CompletionDetail';

export const metadata = { title: 'Contract completions' };

/**
 * The Director's completion queue (client feedback #6).
 *
 * Split into "needs you" and "with finance" from NEXT_ACTOR — the same table
 * every row prints — so the heading and the per-row "Next:" line can never
 * disagree about whose move it is.
 */
export default async function OwnerCompletionsPage() {
  await requireOwner();
  const [open, closed] = await Promise.all([
    listCompletionRequests({ statuses: OPEN_COMPLETION_STATUSES }),
    listCompletionRequests({ statuses: ['completed', 'rejected'], limit: 25 }),
  ]);

  const mine = open.filter((r) => NEXT_ACTOR[r.status] === 'owner');
  const elsewhere = open.filter((r) => NEXT_ACTOR[r.status] !== 'owner');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Contract completions</h1>
        <p className="text-sm text-muted-foreground">
          A rider asks; finance confirms they owe nothing; you approve, which generates their
          certificate; finance handles the ownership transfer; you sign off. Nothing completes a
          contract except your sign-off.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Needs your decision ({mine.length})</h2>
        <CompletionQueue
          requests={mine}
          basePath="/owner"
          viewerRole="owner"
          emptyMessage="Nothing is waiting on you."
        />
      </section>

      {elsewhere.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">With finance</h2>
          <CompletionQueue requests={elsewhere} basePath="/owner" viewerRole="owner" />
        </section>
      )}

      {closed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">Closed</h2>
          <CompletionQueue requests={closed} basePath="/owner" viewerRole="owner" />
        </section>
      )}
    </div>
  );
}
