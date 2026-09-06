import { requireOwner } from '@/lib/auth/session';
import { listNotifications } from '@/lib/notifications/queries';
import { NotificationList } from '@/components/notifications/NotificationList';
import { NOTIFICATION_LABELS_EN } from '@/lib/notifications/labels';
import { PushToggle } from '@/components/pwa/PushToggle';

export const metadata = { title: 'Notifications' };

/*
 * The owner's inbox (client feedback 2026-09-06).
 *
 * notifyOwner() has been writing here since Phase 8 — new applications, cash
 * awaiting confirmation, purchase requests, payment problems, job failures —
 * but no page ever displayed them, so the owner had 884 unread and no way to
 * read one. This is that page.
 */
export default async function OwnerNotificationsPage() {
  await requireOwner();
  const notifications = await listNotifications();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Notifications</h1>
          <p className="text-muted-foreground text-sm">
            Most recent 100. Tap one to open what it refers to.
          </p>
        </div>
        <PushToggle />
      </header>
      <NotificationList notifications={notifications} labels={NOTIFICATION_LABELS_EN} />
    </div>
  );
}
