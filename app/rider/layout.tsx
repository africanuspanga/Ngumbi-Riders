import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';

// Coarse gate for the rider area. The mandatory temporary-PIN redirect lives on
// the dashboard page (not here) to avoid a redirect loop with the PIN settings
// page, which is itself under /rider.
export default async function RiderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/rider');
  if (profile.role !== 'rider') redirect('/owner');

  return <div className="mx-auto min-h-dvh max-w-md px-4 py-6">{children}</div>;
}
