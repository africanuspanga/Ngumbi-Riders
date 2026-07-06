import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/owner');
  if (profile.role !== 'owner') redirect('/rider');

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 py-6 md:px-8">
      {children}
    </div>
  );
}
