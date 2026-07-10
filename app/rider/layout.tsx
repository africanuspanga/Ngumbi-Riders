import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { RiderHeader } from '@/components/rider/rider-header';
import { RiderNav } from '@/components/rider/rider-nav';

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

  // Unread badge for the bottom nav (RLS scopes to the rider's own rows).
  const supabase = await createServerSupabase();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  return (
    <div className="min-h-dvh">
      <RiderHeader />
      <main className="mx-auto max-w-md px-4 pb-24 pt-4">{children}</main>
      <RiderNav unread={count ?? 0} />
    </div>
  );
}
