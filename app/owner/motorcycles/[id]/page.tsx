import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getMotorcycle } from '@/lib/motorcycles/queries';
import { formatTZS } from '@/lib/money/format';
import { RegistrationForm } from './RegistrationForm';

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
        <Link href="/owner/motorcycles" className="text-sm font-medium text-muted-foreground">
          ← Motorcycles
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">
            {m.motorcycle_number}
          </h1>
          <p className="text-sm text-muted-foreground">
            {m.registration_number ?? 'Registration pending'}
            {(m.make || m.model) && ` · ${[m.make, m.model].filter(Boolean).join(' ')}`}
          </p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          {m.status}
        </span>
      </header>

      <Section title="Details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Detail label="Code" value={m.motorcycle_number} />
          <Detail label="Registration" value={m.registration_number ?? '—'} />
          <Detail label="Chassis number" value={m.chassis_number ?? '—'} />
          <Detail label="Engine number" value={m.engine_number ?? '—'} />
          <Detail label="Colour" value={m.colour ?? '—'} />
          <Detail label="Make / model" value={[m.make, m.model].filter(Boolean).join(' ') || '—'} />
          <Detail label="Region" value={m.region ?? '—'} />
          <Detail label="District" value={m.district ?? '—'} />
        </dl>
        <div className="mt-1">
          <p className="mb-1 text-xs text-muted-foreground">
            {m.registration_number ? 'Correct registration number' : 'Add registration number (issued after purchase)'}
          </p>
          <RegistrationForm id={m.id} current={m.registration_number} />
        </div>
      </Section>

      <Section title="Current rider">
        {active ? (
          <Link
            href={`/owner/riders/${active.rider_id}`}
            className="font-medium text-primary-dark underline"
          >
            {active.rider_name} ({active.rider_number})
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">Not assigned.</p>
        )}
      </Section>

      <Section title="Assignment history">
        {m.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {m.assignments.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-b border-border pb-2">
                <span className="text-foreground">
                  {a.rider_name} ({a.rider_number})
                </span>
                <span className="text-right text-muted-foreground">
                  {a.start_date} → {a.end_date ?? 'active'}
                  {a.transfer_reason && ` · ${a.transfer_reason}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Financials">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Collected</p>
            <p className="font-semibold text-[color:var(--color-paid)]">{formatTZS(m.collected)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expenses</p>
            <p className="font-semibold">{formatTZS(m.totalExpenses)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cash operating margin</p>
            <p className={`font-semibold ${m.cashOperatingMargin >= 0 ? 'text-[color:var(--color-paid)]' : 'text-overdue'}`}>
              {formatTZS(m.cashOperatingMargin)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Margin = collected contract revenue − recorded expenses (not full accounting profit).
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
