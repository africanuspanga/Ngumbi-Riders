import { requireOwner } from '@/lib/auth/session';
import { listOwnerExemptions } from '@/lib/exemptions/queries';
import { EXEMPTION_STATUS_LABELS } from '@/lib/exemptions/validation';
import { ExemptionDecision } from './ExemptionDecision';

export const metadata = { title: 'Exemptions' };

export default async function OwnerExemptionsPage() {
  await requireOwner();
  const exemptions = await listOwnerExemptions();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Exemption requests</h1>
        <p className="text-sm text-muted-foreground">
          Waive an obligation or postpone it. Decisions preserve the original due
          date in history.
        </p>
      </header>

      {exemptions.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">No exemption requests.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {exemptions.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{e.rider_name}</p>
                  <p className="text-xs text-muted-foreground">Obligation: {e.due_date ?? '—'}</p>
                </div>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {EXEMPTION_STATUS_LABELS[e.status] ?? e.status}
                </span>
              </div>
              <p className="text-sm text-foreground">{e.reason}</p>
              {e.postponed_to_date && <p className="text-xs text-advance">Postponed to {e.postponed_to_date}</p>}
              <ExemptionDecision id={e.id} status={e.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
