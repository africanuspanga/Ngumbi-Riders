import { requireRider } from '@/lib/auth/session';
import { listRiderExemptions, listRiderOutstandingForExemption } from '@/lib/exemptions/queries';
import { EXEMPTION_STATUS_LABELS } from '@/lib/exemptions/validation';
import { ExemptionRequestForm } from './ExemptionRequestForm';

export const metadata = { title: 'Misamaha' };

export default async function RiderExemptionsPage() {
  await requireRider();
  const [requests, obligations] = await Promise.all([
    listRiderExemptions(),
    listRiderOutstandingForExemption(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-primary-dark">Misamaha</h1>

      <ExemptionRequestForm obligations={obligations} />

      {requests.length === 0 ? (
        <p className="text-muted-foreground">Hakuna maombi ya msamaha.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex justify-between">
                <span className="font-semibold">{r.due_date ?? '—'}</span>
                <span className="text-xs text-muted-foreground">{EXEMPTION_STATUS_LABELS[r.status] ?? r.status}</span>
              </div>
              <p className="text-sm text-foreground">{r.reason}</p>
              {r.postponed_to_date && <p className="text-xs text-advance">Imeahirishwa hadi {r.postponed_to_date}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
