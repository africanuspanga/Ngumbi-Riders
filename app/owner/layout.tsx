import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/roles';
import { AppShell } from '@/components/app-shell';

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  // Staff sign in with email + password; /login is the rider phone+PIN page.
  if (!profile) redirect('/login/owner?next=/owner');
  // Send them to THEIR OWN area — never a hardcoded '/rider'. Before the
  // accountant role existed this could assume "not owner ⇒ rider"; an
  // accountant then ping-ponged /owner → /rider → /owner (the rider layout
  // bounces non-riders back here), which the browser reports as
  // ERR_TOO_MANY_REDIRECTS. homePathFor is the single router: every role maps
  // to the one area whose layout accepts it, so no cycle is possible.
  if (profile.role !== 'owner') redirect(homePathFor(profile.role));

  return <AppShell ownerName={profile.fullName ?? 'Owner'}>{children}</AppShell>;
}
