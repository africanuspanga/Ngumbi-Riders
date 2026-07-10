import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { AppShell } from '@/components/app-shell';

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/owner');
  if (profile.role !== 'owner') redirect('/rider');

  return <AppShell ownerName={profile.fullName ?? 'Owner'}>{children}</AppShell>;
}
