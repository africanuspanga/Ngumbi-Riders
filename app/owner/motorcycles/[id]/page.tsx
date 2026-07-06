import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getMotorcycle } from '@/lib/motorcycles/queries';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Motorcycle' };

export default async function MotorcycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const m = await getMotorcycle(id);
  if (!m) notFound();

  const active = m.assignments.find((a) => a.is_active);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/owner/motorcycles" className="text-sm font-medium text-muted">
          ← Motorcycles
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">
            {m.registration_number}
          </h1>
          <p className="text-sm text-muted">
            {m.motorcycle_number}
            {(m.make || m.model) && ` · ${[m.make, m.model].filter(Boolean).join(' ')}`}
          </p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted">
          {m.status}
        </span>
      </header>

      <Section title="Current rider">
        {active ? (
          <Link
            href={`/owner/riders/${active.rider_id}`}
            className="font-medium text-primary-dark underline"
          >
            {active.rider_name} ({active.rider_number})
          </Link>
        ) : (
          <p className="text-sm text-muted">Not assigned.</p>
        )}
      </Section>

      <Section title="Assignment history">
        {m.assignments.length === 0 ? (
          <p className="text-sm text-muted">No assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {m.assignments.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-b border-border pb-2">
                <span className="text-foreground">
                  {a.rider_name} ({a.rider_number})
                </span>
                <span className="text-right text-muted">
                  {a.start_date} → {a.end_date ?? 'active'}
                  {a.transfer_reason && ` · ${a.transfer_reason}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Expenses">
        <p className="text-sm text-muted">
          Recorded expenses: <strong>{formatTZS(m.totalExpenses)}</strong>
        </p>
        <p className="text-xs text-muted">
          Collections and cash operating margin appear once payments land (Phase 5).
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
      <h2 className="font-semibold text-primary-dark">{title}</h2>
      {children}
    </section>
  );
}
