import { requireOwner } from '@/lib/auth/session';
import { listOwnerIncidents } from '@/lib/incidents/queries';
import { INCIDENT_LABELS } from '@/lib/incidents/validation';
import { IncidentStatus } from './IncidentStatus';
import { formatLocalDateTime } from '@/lib/dates/tz';

export const metadata = { title: 'Incidents' };

export default async function OwnerIncidentsPage() {
  await requireOwner();
  const incidents = await listOwnerIncidents();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Incidents</h1>
        <p className="text-sm text-muted-foreground">Breakdowns, accidents, theft, police, maintenance, emergencies.</p>
      </header>

      {incidents.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">No incidents reported.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {incidents.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">
                    {INCIDENT_LABELS[i.category as keyof typeof INCIDENT_LABELS] ?? i.category} · {i.rider_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatLocalDateTime(new Date(i.occurred_at))}{i.location_text ? ` · ${i.location_text}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">{i.status}</span>
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
