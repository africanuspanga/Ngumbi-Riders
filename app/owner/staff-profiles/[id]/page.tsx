import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getStaffProfile } from '@/lib/staff/profile-queries';
import { StaffProfileForm } from '@/components/staff/StaffProfileForm';

export const metadata = { title: 'Staff profile' };

export default async function OwnerStaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const record = await getStaffProfile(id);
  if (!record) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/owner/staff-profiles" className="text-sm font-medium text-muted-foreground">
        ← Staff profiles
      </Link>
      <StaffProfileForm record={record} canReview />
    </div>
  );
}
