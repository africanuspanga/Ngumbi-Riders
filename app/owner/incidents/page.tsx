import { requireOwner } from '@/lib/auth/session';
import { listOwnerIncidents } from '@/lib/incidents/queries';
import { INCIDENT_LABELS } from '@/lib/incidents/validation';
import { IncidentStatus } from './IncidentStatus';

export const metadata = { title: 'Incidents' };

export default async function OwnerIncidentsPage() {
  await requireOwner();
  const incidents = await listOwnerIncidents();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Incidents</h1>
        <p className="text-sm text-muted">Breakdowns, accidents, theft, police, maintenance, emergencies.</p>
      </header>

      {incidents.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted">No incidents reported.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {incidents.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">
                    {INCIDENT_LABELS[i.category as keyof typeof INCIDENT_LABELS] ?? i.category} · {i.rider_name}
                  </p>
                  <p className="text-xs text-muted">
                    {i.occurred_at.slice(0, 16).replace('T', ' ')}{i.location_text ? ` · ${i.location_text}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted">{i.status}</span>
              </div>
              <p className="text-sm text-foreground">{i.description}</p>
              <IncidentStatus id={i.id} status={i.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
