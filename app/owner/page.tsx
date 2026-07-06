import { requireOwner } from '@/lib/auth/session';
import { LogoutButton } from '@/components/auth/LogoutButton';

// Phase 1 placeholder owner home. KPI dashboard is Phase 6.
export default async function OwnerHome() {
  const profile = await requireOwner();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-dark">
          Karibu{profile.fullName ? `, ${profile.fullName}` : ''}
        </h1>
        <LogoutButton />
      </header>
      <p className="text-muted">
        Owner dashboard and reports arrive in Phase 6. You are signed in as the
        owner.
      </p>
    </div>
  );
}
