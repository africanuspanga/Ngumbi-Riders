import { requireRider } from '@/lib/auth/session';
import { listNotifications } from '@/lib/notifications/queries';
import { NotificationList } from './NotificationList';
import { PushToggle } from '@/components/pwa/PushToggle';

export const metadata = { title: 'Arifa' };

export default async function RiderNotificationsPage() {
  await requireRider();
  const notifications = await listNotifications();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary-dark">Arifa</h1>
        <PushToggle />
      </div>
      <NotificationList notifications={notifications} />
    </div>
  );
}
