import { requireAccountant } from '@/lib/auth/session';
import { listCompletionRequests } from '@/lib/completion/queries';
import { OPEN_COMPLETION_STATUSES, NEXT_ACTOR } from '@/lib/completion/machine';
import { CompletionQueue } from '@/components/completion/CompletionDetail';

export const metadata = { title: 'Contract completions' };

/**
 * Finance's completion worklist (client feedback #6, #8).
 *
 * Finance owns two steps: confirming the rider owes nothing, and handling the
 * ownership transfer. It cannot approve completion or sign it off —
 * `completion.decide` is a permission no accountant holds.
 */
export default async function AccountantCompletionsPage() {
  await requireAccountant();
  const [open, closed] = await Promise.all([
    listCompletionRequests({ statuses: OPEN_COMPLETION_STATUSES }),
    listCompletionRequests({ statuses: ['completed', 'rejected'], limit: 25 }),
  ]);

  const mine = open.filter((r) => NEXT_ACTOR[r.status] === 'accountant');
  const elsewhere = open.filter((r) => NEXT_ACTOR[r.status] !== 'accountant');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Contract completions</h1>
        <p className="text-sm text-muted-foreground">
          Check whether the rider still owes anything, then handle the ownership transfer once the
          Director has approved. Approval and final sign-off are the Director&rsquo;s.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Needs your action ({mine.length})</h2>
        <CompletionQueue
          requests={mine}
          basePath="/accountant"
          viewerRole="accountant"
          emptyMessage="Nothing is waiting on finance."
        />
      </section>

      {elsewhere.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">With the Managing Director</h2>
          <CompletionQueue requests={elsewhere} basePath="/accountant" viewerRole="accountant" />
        </section>
      )}

      {closed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-primary-dark">Closed</h2>
          <CompletionQueue requests={closed} basePath="/accountant" viewerRole="accountant" />
        </section>
      )}
    </div>
  );
}
