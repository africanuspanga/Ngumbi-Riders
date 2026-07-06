import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import {
  listApplications,
  countByStatus,
} from '@/lib/applications/queries';
import {
  PIPELINE_STATUSES,
  STATUS_META,
  isApplicationStatus,
} from '@/lib/applications/status';
import { StatusBadge } from '@/components/applications/StatusBadge';

export const metadata = { title: 'Applications' };

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireOwner();
  const { status } = await searchParams;
  const active = isApplicationStatus(status) ? status : undefined;

  const [applications, counts] = await Promise.all([
    listApplications(active),
    countByStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-primary-dark">Applications</h1>
        <p className="text-sm text-muted">
          Review rider applications, verify documents, and convert approved
          applicants into riders.
        </p>
      </header>

      {/* Status filter tabs */}
      <nav className="flex flex-wrap gap-2">
        <FilterTab href="/owner/applications" label="All" active={!active} />
        {PIPELINE_STATUSES.map((s) => (
          <FilterTab
            key={s}
            href={`/owner/applications?status=${s}`}
            label={`${STATUS_META[s].label}${counts[s] ? ` (${counts[s]})` : ''}`}
            active={active === s}
          />
        ))}
      </nav>

      {applications.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted">
          No applications{active ? ' with this status' : ''} yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {applications.map((a) => (
            <li key={a.id}>
              <Link
                href={`/owner/applications/${a.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground">
                    {a.first_name} {a.last_name}
                    {a.duplicate_flags.length > 0 && (
                      <span
                        title="Possible duplicate"
                        className="ml-2 text-[color:var(--color-warning)]"
                      >
                        ⚠
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {a.reference} · {a.primary_phone}
                  </span>
                </div>
                <StatusBadge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
        active
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-white text-muted hover:bg-surface'
      }`}
    >
      {label}
    </Link>
  );
}
