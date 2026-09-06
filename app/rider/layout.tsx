import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/roles';
import { createServerSupabase } from '@/lib/supabase/server';
import { RiderHeader } from '@/components/rider/rider-header';
import { RiderNav } from '@/components/rider/rider-nav';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { INSTALL_LABELS_SW } from '@/lib/pwa/install-labels';

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
  // Their own area, via homePathFor — a hardcoded '/owner' sent an accountant
  // into an infinite /owner ↔ /rider bounce (see app/owner/layout.tsx).
  if (profile.role !== 'rider') redirect(homePathFor(profile.role));

  const supabase = await createServerSupabase();

  // Status gate: a rider the owner disabled (inactive/suspended/terminated)
  // loses access on their NEXT navigation, not just at the next login — the
  // login-route check alone would leave an existing session working until it
  // expires.
  const { data: riderRow } = await supabase
    .from('riders')
    .select('status')
    .eq('profile_id', profile.userId)
    .maybeSingle();
  const riderStatus = (riderRow as { status: string } | null)?.status ?? null;
  if (riderStatus !== 'active' && riderStatus !== 'onboarding') {
    redirect('/login');
  }

  // Unread badge for the bottom nav (RLS scopes to the rider's own rows).
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  return (
    <div className="min-h-dvh">
      <RiderHeader />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-4 pb-24">
        <InstallPrompt labels={INSTALL_LABELS_SW} />
        {children}
      </main>
      <RiderNav unread={count ?? 0} />
    </div>
  );
}
