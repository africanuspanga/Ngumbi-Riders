import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { LogoutButton } from '@/components/auth/LogoutButton';

// Phase 1 placeholder owner home. Full KPI dashboard is Phase 6; the
// applications pipeline (Phase 2) is linked below.
export default async function OwnerHome() {
  const profile = await requireOwner();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-dark">
          Karibu{profile.fullName ? `, ${profile.fullName}` : ''}
        </h1>
        <LogoutButton />
      </header>

      <nav className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/owner/applications"
          className="rounded-[--radius-card] border border-border bg-white p-4 hover:bg-surface"
        >
          <span className="font-semibold text-primary-dark">Applications</span>
          <p className="text-sm text-muted">
            Review applicants, verify documents, convert to riders.
          </p>
        </Link>
      </nav>

      <p className="text-sm text-muted">
        Owner dashboard KPIs and reports arrive in Phase 6.
      </p>
    </div>
  );
}
