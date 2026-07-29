import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getRiderProfile } from '@/lib/riders/profile';
import { RiderProfileView } from '@/components/riders/RiderProfileView';

export const metadata = { title: 'Rider' };

/**
 * Rider profile for the accountant: the same record the owner sees, minus the
 * identity reveal, PIN reset, risk and status controls. Read-only by
 * construction — this page renders no mutating action at all.
 */
export default async function AccountantRiderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccountant();
  const { id } = await params;
  const profile = await getRiderProfile(id, 'accountant');
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/accountant/riders" className="text-sm font-medium text-muted-foreground">
          ← Riders
        </Link>
      </div>
      <RiderProfileView
        profile={profile}
        audience="accountant"
        motorcycleHref={(mid) => `/accountant/motorcycles/${mid}`}
        contractHref={(cid) => `/accountant/contracts/${cid}`}
      />
    </div>
  );
}
