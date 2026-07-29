import { notFound } from 'next/navigation';
import { requireRider } from '@/lib/auth/session';
import { getRiderProfile } from '@/lib/riders/profile';
import { RiderProfileView } from '@/components/riders/RiderProfileView';

export const metadata = { title: 'Wasifu wangu' };

/**
 * The rider's own profile (build spec #3). `requireRider` establishes WHO is
 * signed in and the profile is loaded for THAT rider id only — a rider can
 * never address someone else's record from here, because the id is never taken
 * from the URL.
 */
export default async function RiderProfilePage() {
  const session = await requireRider();
  if (!session.riderId) notFound();

  const profile = await getRiderProfile(session.riderId, 'rider');
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold text-primary-dark">Wasifu wangu</h1>
        <p className="text-sm text-muted-foreground">Taarifa zako, pikipiki na mkataba wako.</p>
      </header>
      <RiderProfileView profile={profile} audience="rider" />
    </div>
  );
}
