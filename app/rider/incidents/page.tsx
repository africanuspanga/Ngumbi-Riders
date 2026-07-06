import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { listRiderIncidents } from '@/lib/incidents/queries';
import { INCIDENT_LABELS } from '@/lib/incidents/validation';

export const metadata = { title: 'Matukio' };

export default async function RiderIncidentsPage() {
  await requireRider();
  const incidents = await listRiderIncidents();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary-dark">Matukio</h1>
        <Link href="/rider/incidents/new" className="rounded-[--radius-card] bg-primary px-4 py-2 text-sm font-semibold text-white">
          Ripoti tukio
        </Link>
      </header>
      {incidents.length === 0 ? (
        <p className="text-muted">Hakuna matukio.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {incidents.map((i) => (
            <li key={i.id} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex justify-between">
                <span className="font-semibold">{INCIDENT_LABELS[i.category as keyof typeof INCIDENT_LABELS] ?? i.category}</span>
                <span className="text-xs text-muted">{i.status}</span>
              </div>
              <span className="text-xs text-muted">{i.occurred_at.slice(0, 16).replace('T', ' ')}</span>
              <p className="text-sm text-foreground">{i.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
