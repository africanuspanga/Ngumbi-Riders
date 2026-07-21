'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/notifications/actions';
import { formatLocalDateTime } from '@/lib/dates/tz';
import type { NotificationRow } from '@/lib/notifications/queries';

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasUnread = notifications.some((n) => !n.read_at);

  // Mark-read must complete BEFORE we navigate on a deep link — otherwise the
  // <Link> unmounts this list mid-request and the notification stays unread.
  function open(n: NotificationRow) {
    setError(null);
    start(async () => {
      try {
        if (!n.read_at) {
          const res = await markNotificationRead(n.id);
          if (!res.ok) setError('Haikuweza kuweka alama ya kusomwa. Jaribu tena.');
        }
        if (n.deep_link) router.push(n.deep_link);
        else router.refresh();
      } catch {
        setError('Hitilafu ya mtandao. Jaribu tena.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {hasUnread && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            setError(null);
            try {
              const res = await markAllNotificationsRead();
              if (res.ok) router.refresh();
              else setError('Haikuweza kuweka alama ya kusomwa. Jaribu tena.');
            } catch {
              setError('Hitilafu ya mtandao. Jaribu tena.');
            }
          })}
          className="self-end text-sm font-medium text-primary underline"
        >
          Soma zote
        </button>
      )}
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      {notifications.length === 0 ? (
        <p className="text-muted-foreground">Hakuna arifa.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`px-4 py-3 ${n.deep_link || !n.read_at ? 'cursor-pointer' : ''}`}
              role={n.deep_link ? 'link' : undefined}
              onClick={() => (n.deep_link || !n.read_at ? open(n) : undefined)}
            >
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
