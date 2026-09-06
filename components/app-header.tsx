'use client';

import { usePathname } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { CustomSidebarTrigger } from '@/components/custom-sidebar-trigger';
import { findActiveNavItem } from '@/components/app-shared';
import { NavUser } from '@/components/nav-user';

export function AppHeader({
  ownerName,
  roleLabel,
  notifications,
}: {
  ownerName: string;
  roleLabel?: string;
  /*
   * The unread-notification bell, rendered by the SERVER and handed down as an
   * element. This header is a Client Component, so it cannot call the database
   * itself; an already-rendered element crosses the boundary happily where a
   * fetch function would not.
   */
  notifications?: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeItem = findActiveNavItem(pathname);

  return (
    <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-3">
        <CustomSidebarTrigger />
        <Separator
          className="mr-2 h-4 data-[orientation=vertical]:self-center"
          orientation="vertical"
        />
        <AppBreadcrumbs page={activeItem} />
      </div>
      <div className="flex items-center gap-3">
        {notifications}
        {roleLabel && (
          <span className="hidden rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted-foreground sm:inline">
            {roleLabel}
          </span>
        )}
        <NavUser name={ownerName} />
      </div>
    </header>
  );
}
