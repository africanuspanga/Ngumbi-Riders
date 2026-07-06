import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listMotorcycles } from '@/lib/motorcycles/queries';

export const metadata = { title: 'Motorcycles' };

const STATUS_TONE: Record<string, string> = {
  available: 'bg-surface text-[color:var(--color-paid)]',
  assigned: 'bg-blue-50 text-[color:var(--color-advance)]',
  inactive: 'bg-surface text-muted',
};

export default async function MotorcyclesPage() {
  await requireOwner();
  const motorcycles = await listMotorcycles();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">Motorcycles</h1>
          <p className="text-sm text-muted">Fleet register and assignment status.</p>
        </div>
        <Link
          href="/owner/motorcycles/new"
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          Add motorcycle
        </Link>
      </header>

      {motorcycles.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted">
          No motorcycles yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {motorcycles.map((m) => (
            <li key={m.id}>
              <Link
                href={`/owner/motorcycles/${m.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground">
                    {m.registration_number}
                  </span>
                  <span className="text-xs text-muted">
                    {m.motorcycle_number}
                    {(m.make || m.model) && ` · ${[m.make, m.model].filter(Boolean).join(' ')}`}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[m.status]}`}
                >
                  {m.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
