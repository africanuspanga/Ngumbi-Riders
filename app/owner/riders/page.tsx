import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listRiders } from '@/lib/riders/queries';

export const metadata = { title: 'Riders' };

const STATUS_TONE: Record<string, string> = {
  onboarding: 'bg-blue-50 text-[color:var(--color-advance)]',
  active: 'bg-surface text-[color:var(--color-paid)]',
  suspended: 'bg-amber-50 text-[color:var(--color-warning)]',
  terminated: 'bg-red-50 text-[color:var(--color-overdue)]',
  inactive: 'bg-surface text-muted',
};

const RISK_TONE: Record<string, string> = {
  low: 'text-[color:var(--color-paid)]',
  medium: 'text-[color:var(--color-warning)]',
  high: 'text-[color:var(--color-overdue)]',
  critical: 'text-[color:var(--color-overdue)]',
};

export default async function RidersPage() {
  await requireOwner();
  const riders = await listRiders();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">Riders</h1>
          <p className="text-sm text-muted">Rider directory and status.</p>
        </div>
        <Link
          href="/owner/riders/new"
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          Add rider
        </Link>
      </header>

      {riders.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted">
          No riders yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {riders.map((r) => (
            <li key={r.id}>
              <Link
                href={`/owner/riders/${r.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground">
                    {r.first_name} {r.last_name}
                  </span>
                  <span className="text-xs text-muted">
                    {r.rider_number} · {r.phone}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold ${RISK_TONE[r.risk_level]}`}>
                    {r.risk_level}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
