import { requireAccountant } from '@/lib/auth/session';
import { getStaffProfile } from '@/lib/staff/profile-queries';
import { StaffProfileForm } from '@/components/staff/StaffProfileForm';

export const metadata = { title: 'My staff profile' };

/**
 * An employee's own record (client feedback #9).
 *
 * `canReview` is false: approval, return and employment status belong to the
 * Managing Director. That is cosmetic — the actions themselves require
 * `staff_profiles.review`, which no accountant holds, and `saveStaffProfile`
 * does not accept an employment status at all.
 */
export default async function AccountantProfilePage() {
  const profile = await requireAccountant();
  const record = await getStaffProfile(profile.userId);
  if (!record) {
    return (
      <p className="text-sm text-muted-foreground">
        Your staff record could not be loaded. Reload the page, or ask the Managing Director.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">My staff profile</h1>
        <p className="text-sm text-muted-foreground">
          Fill this in and submit it. The Managing Director reviews and approves it.
        </p>
      </header>
      <StaffProfileForm record={record} canReview={profile.role === 'owner'} />
    </div>
  );
}
