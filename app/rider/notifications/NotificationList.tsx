'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/notifications/actions';
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
        <p className="text-muted">Hakuna arifa.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {notifications.map((n) => {
            const inner = (
              <div className="flex items-start gap-2">
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className="flex flex-col">
                  <span className={`font-semibold ${n.read_at ? 'text-muted' : 'text-foreground'}`}>{n.title}</span>
                  {n.body && <span className="text-sm text-muted">{n.body}</span>}
                  <span className="text-xs text-muted">{n.created_at.slice(0, 16).replace('T', ' ')}</span>
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
