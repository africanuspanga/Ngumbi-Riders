import Link from 'next/link';
import { BellIcon } from 'lucide-react';
import { unreadCount } from '@/lib/notifications/queries';

/*
 * Unread-notification indicator for the back-office header (client feedback
 * 2026-09-06: "when there is a new notification the owner has not read, there
 * should be a notification on the dashboard").
 *
 * A SERVER component that does its own count, so every page in the shell shows
 * a current figure without each page having to fetch it. It sits in the header
 * rather than only on the dashboard because a purchase request approved while
 * the owner is three pages deep should still be visible to them.
 *
 * The count is capped at "99+" in the badge: the exact number stops being
 * useful past a screenful, and an unbounded one breaks the circle.
 */
export async function NotificationBell({ basePath }: { basePath: '/owner' | '/accountant' }) {
  const unread = await unreadCount();

  return (
    <Link
      href={`${basePath}/notifications`}
      aria-label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
      className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
    >
      <BellIcon className="size-5" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-[color:var(--color-overdue)] px-1 text-[10px] leading-4 font-bold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
