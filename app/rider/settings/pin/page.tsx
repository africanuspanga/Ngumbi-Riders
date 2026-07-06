import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { ChangePinForm } from './ChangePinForm';

export default async function ChangePinPage({
  searchParams,
}: {
  searchParams: Promise<{ forced?: string }>;
}) {
  const { forced } = await searchParams;
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/rider/settings/pin');
  if (profile.role !== 'rider') redirect('/owner');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-primary-dark">Badilisha PIN</h1>
      <ChangePinForm forced={forced === '1'} />
    </div>
  );
}
