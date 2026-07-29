import { cookies } from 'next/headers';
import { requireOwner } from '@/lib/auth/session';
import { listRiderDirectory } from '@/lib/riders/queries';
import { RiderDirectory, RIDER_VIEW_COOKIE } from '@/components/riders/RiderDirectory';
import type { RiderView } from '@/lib/riders/directory';

export const metadata = { title: 'Riders' };

/**
 * Owner rider register (build spec #2): search, sort, filter and card/table
 * views over the whole fleet, replacing the single flat list. The view
 * preference is read from the cookie here so the first paint is already the
 * layout the owner chose last time.
 */
export default async function RidersPage() {
  await requireOwner();
  const [riders, cookieStore] = await Promise.all([listRiderDirectory(), cookies()]);
  const saved = cookieStore.get(RIDER_VIEW_COOKIE)?.value;
  const initialView: RiderView = saved === 'table' ? 'table' : 'card';

  return (
    <RiderDirectory
      riders={riders}
      basePath="/owner/riders"
      canCreate
      initialView={initialView}
    />
  );
}
