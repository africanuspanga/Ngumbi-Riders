import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/roles';

/*
 * The Android app's start page (2026-10-30). The app opens here every time;
 * a signed-in owner, accountant or rider goes straight to their own area, and
 * anyone else lands on the rider sign-in page (which links to the staff one).
 * The ordinary /login page does not redirect a signed-in user, which is why
 * the app cannot simply open that.
 */
export const dynamic = 'force-dynamic';

export default async function AppEntry() {
  const profile = await getSessionProfile();
  redirect(homePathFor(profile?.role));
}
