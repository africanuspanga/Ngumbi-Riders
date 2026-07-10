'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HomeIcon,
  BanknoteIcon,
  CalendarDaysIcon,
  ReceiptTextIcon,
  BellIcon,
  type LucideIcon,
} from 'lucide-react';

/* Mobile-first bottom tab bar — the rider app's primary navigation (spec §6.2:
 * thumb-reach targets on low-cost Android). Swahili labels only. */
type Tab = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const TABS: Tab[] = [
  { href: '/rider', label: 'Nyumbani', icon: HomeIcon, exact: true },
  { href: '/rider/pay', label: 'Lipa', icon: BanknoteIcon },
  { href: '/rider/calendar', label: 'Kalenda', icon: CalendarDaysIcon },
  { href: '/rider/payments', label: 'Malipo', icon: ReceiptTextIcon },
  { href: '/rider/notifications', label: 'Arifa', icon: BellIcon },
];

export function RiderNav({ unread }: { unread: number }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                {tab.href === '/rider/notifications' && unread > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--color-overdue)] px-1 text-[9px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
