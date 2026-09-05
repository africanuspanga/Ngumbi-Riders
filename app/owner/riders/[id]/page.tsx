import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getRider } from '@/lib/riders/queries';
import { getRiderProfile } from '@/lib/riders/profile';
import { getRiderPaymentHistory, getRiderStatement } from '@/lib/payments/queries';
import { PaymentHistory } from '@/components/payments/PaymentHistory';
import { StatementSummary } from '@/components/payments/StatementView';
import { listAvailableMotorcycles } from '@/lib/motorcycles/queries';
import { RiderProfileView } from '@/components/riders/RiderProfileView';
import { formatDate } from '@/lib/dates/format';
import {
  RiderStatusActions,
  RiderRevealSecrets,
  RiderPinReset,
  AssignmentActions,
  RiskControls,
  RiderDelete,
} from './rider-actions';

export const metadata = { title: 'Rider' };

/**
 * Owner rider profile (build spec #3): the full read-only profile followed by
 * the owner-only management actions (identity reveal, PIN reset, assignment,
 * risk, status) that were already here.
 */
export default async function RiderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const [profile, rider, motorcycles, payments, statement] = await Promise.all([
    getRiderProfile(id, 'owner'),
    getRider(id),
    listAvailableMotorcycles(),
    getRiderPaymentHistory(id),
    getRiderStatement(id),
  ]);
  if (!profile || !rider) notFound();

  const motoOptions = motorcycles.map((m) => ({
    id: m.id,
    registration_number: m.registration_number,
    motorcycle_number: m.motorcycle_number,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/owner/riders" className="text-sm font-medium text-muted-foreground">
          ← Riders
        </Link>
        <Link
          href={`/owner/riders/${id}/edit`}
          className="rounded-[--radius-card] border border-border bg-white px-4 py-2 text-sm font-semibold text-primary-dark hover:bg-surface"
        >
          Edit rider information
        </Link>
      </div>

      {rider.complianceWarnings.length > 0 && (
        <div className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3 text-sm text-[color:var(--color-warning)]">
          ⚠ {rider.complianceWarnings.join(' · ')}
        </div>
      )}

      <RiderProfileView
        profile={profile}
        audience="owner"
        motorcycleHref={(mid) => `/owner/motorcycles/${mid}`}
        contractHref={(cid) => `/owner/contracts/${cid}`}
      />

      {/* Payment history + money position (client feedback 2026-09-05) */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">Payments</h2>
          <Link
            href={`/owner/payments/rider/${id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Full statement →
          </Link>
        </div>
        {statement && <StatementSummary progress={statement.progress} />}
        <PaymentHistory payments={payments.slice(0, 10)} receiptHref={null} />
        {payments.length > 10 && (
          <Link
            href={`/owner/payments/rider/${id}`}
            className="self-start text-sm font-medium text-primary hover:underline"
          >
            Showing the 10 most recent of {payments.length} — see all
          </Link>
        )}
      </section>

      <Section title="Sensitive identifiers">
        <RiderRevealSecrets id={profile.id} />
      </Section>

      <Section title="Sign-in / PIN">
        <RiderPinReset id={profile.id} />
      </Section>

      <Section title="Motorcycle assignment">
        <AssignmentActions
          riderId={profile.id}
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
          <p className="text-sm text-muted-foreground">No assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {rider.assignments.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-b border-border pb-2">
                <Link href={`/owner/motorcycles/${a.motorcycle_id}`} className="text-primary-dark underline">
                  {a.registration}
                </Link>
                <span className="text-right text-muted-foreground">
                  {formatDate(a.start_date)} → {a.end_date ? formatDate(a.end_date) : 'active'}
                  {a.transfer_reason && ` · ${a.transfer_reason}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Risk">
        <RiskControls id={profile.id} current={rider.risk_level} reasons={rider.risk_reasons ?? []} />
      </Section>

      <Section title="Status">
        <RiderStatusActions id={profile.id} current={rider.status} />
      </Section>

      {/* Destructive, so it sits last and apart from everything else. */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-[color:var(--color-overdue)]/40 bg-white p-4">
        <h2 className="font-semibold text-[color:var(--color-overdue)]">Delete rider</h2>
        <RiderDelete id={profile.id} name={`${rider.first_name} ${rider.last_name}`} />
      </section>
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
