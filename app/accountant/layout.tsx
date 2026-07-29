import { requireAccountant } from '@/lib/auth/session';
import { AppShell } from '@/components/app-shell';
import { ROLE_LABELS } from '@/lib/auth/roles';

/**
 * Accountant area (build spec #10). `requireAccountant` redirects anyone who is
 * not an ACTIVE accountant (the owner is allowed through so they can see what
 * their accountant sees). Each page and action re-checks server-side; RLS is
 * the decisive boundary.
 */
export default async function AccountantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireAccountant();

  return (
    <AppShell
      ownerName={profile.fullName ?? 'Accountant'}
      role="accountant"
      roleLabel={ROLE_LABELS[profile.role]}
    >
      {children}
    </AppShell>
  );
}
