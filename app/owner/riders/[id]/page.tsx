import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getRider } from '@/lib/riders/queries';
import { listAvailableMotorcycles } from '@/lib/motorcycles/queries';
import {
  RiderStatusActions,
  RiderRevealSecrets,
  RiderPinReset,
  AssignmentActions,
  RiskControls,
} from './rider-actions';

export const metadata = { title: 'Rider' };

export default async function RiderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const [rider, motorcycles] = await Promise.all([
    getRider(id),
    listAvailableMotorcycles(),
  ]);
  if (!rider) notFound();

  const motoOptions = motorcycles.map((m) => ({
    id: m.id,
    registration_number: m.registration_number,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/owner/riders" className="text-sm font-medium text-muted">
          ← Riders
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">
            {rider.first_name} {rider.middle_name ? `${rider.middle_name} ` : ''}
            {rider.last_name}
          </h1>
          <p className="text-sm text-muted">
            {rider.rider_number} · {rider.phone}
          </p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted">
          {rider.status}
        </span>
      </header>

      {rider.complianceWarnings.length > 0 && (
        <div className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3 text-sm text-[color:var(--color-warning)]">
          ⚠ {rider.complianceWarnings.join(' · ')}
        </div>
      )}

      <Section title="Profile">
        <Grid>
          <Info label="Email" value={rider.email} />
          <Info label="Date of birth" value={rider.date_of_birth} />
          <Info label="Gender" value={rider.gender} />
          <Info label="Region" value={rider.region} />
          <Info label="District" value={rider.district} />
          <Info label="Ward" value={rider.ward} />
        </Grid>
        <Info label="Address" value={rider.full_address} />
      </Section>

      <Section title="Sensitive identifiers">
        <RiderRevealSecrets id={rider.id} />
      </Section>

      <Section title="Sign-in / PIN">
        <RiderPinReset id={rider.id} />
      </Section>

      <Section title="Motorcycle">
        <AssignmentActions
          riderId={rider.id}
          current={
            rider.currentMotorcycle
              ? {
                  motorcycleId: rider.currentMotorcycle.motorcycleId,
                  registration: rider.currentMotorcycle.registration,
                }
              : null
          }
          motorcycles={motoOptions}
        />
      </Section>

      <Section title="Assignment history">
        {rider.assignments.length === 0 ? (
          <p className="text-sm text-muted">No assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {rider.assignments.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-b border-border pb-2">
                <Link href={`/owner/motorcycles/${a.motorcycle_id}`} className="text-primary-dark underline">
                  {a.registration}
                </Link>
                <span className="text-right text-muted">
                  {a.start_date} → {a.end_date ?? 'active'}
                  {a.transfer_reason && ` · ${a.transfer_reason}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Risk">
        <RiskControls id={rider.id} current={rider.risk_level} reasons={rider.risk_reasons ?? []} />
      </Section>

      <Section title="Status">
        <RiderStatusActions id={rider.id} current={rider.status} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
      <h2 className="font-semibold text-primary-dark">{title}</h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>;
}
function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}
