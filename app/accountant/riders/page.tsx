import { cookies } from 'next/headers';
import { requireAccountant } from '@/lib/auth/session';
import { listRiderDirectory } from '@/lib/riders/queries';
import { RiderDirectory } from '@/components/riders/RiderDirectory';
import { RIDER_VIEW_COOKIE } from '@/lib/riders/directory';
import type { RiderView } from '@/lib/riders/directory';

export const metadata = { title: 'Riders' };

/**
 * Rider directory for the accountant — the same search/sort/filter/views as the
 * owner's, but read-only (no "Add rider"), and the rider profiles it links to
 * render without the owner-only identity reveal or edit actions.
 */
export default async function AccountantRidersPage() {
  await requireAccountant();
  const [riders, cookieStore] = await Promise.all([listRiderDirectory(), cookies()]);
  const saved = cookieStore.get(RIDER_VIEW_COOKIE)?.value;
  const initialView: RiderView = saved === 'table' ? 'table' : 'card';

  return <RiderDirectory riders={riders} basePath="/accountant/riders" initialView={initialView} />;
}
