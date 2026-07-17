'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/notifications/actions';
import { formatLocalDateTime } from '@/lib/dates/tz';
import type { NotificationRow } from '@/lib/notifications/queries';

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const hasUnread = notifications.some((n) => !n.read_at);

  return (
    <div className="flex flex-col gap-3">
      {hasUnread && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await markAllNotificationsRead(); router.refresh(); })}
          className="self-end text-sm font-medium text-primary underline"
        >
          Soma zote
        </button>
      )}
      {notifications.length === 0 ? (
        <p className="text-muted-foreground">Hakuna arifa.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {notifications.map((n) => {
            const inner = (
              <div className="flex items-start gap-2">
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className="flex flex-col">
                  <span className={`font-semibold ${n.read_at ? 'text-muted-foreground' : 'text-foreground'}`}>{n.title}</span>
                  {n.body && <span className="text-sm text-muted-foreground">{n.body}</span>}
                  {/* EAT wall-clock, not a UTC slice: the nightly cron writes
                      these 21:00–24:00 UTC, which is already the NEXT EAT day. */}
                  <span className="text-xs text-muted-foreground">{formatLocalDateTime(new Date(n.created_at))}</span>
                </div>
              </div>
            );
            return (
              <li
                key={n.id}
                className="px-4 py-3"
                onClick={() => !n.read_at && start(async () => { await markNotificationRead(n.id); router.refresh(); })}
              >
                {n.deep_link ? <Link href={n.deep_link}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
