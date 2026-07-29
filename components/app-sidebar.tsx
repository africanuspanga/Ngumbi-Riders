'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { NavGroup } from '@/components/nav-group';
import {
  accountantFooterNavLinks,
  accountantNavGroups,
  footerNavLinks,
  navGroups,
  isNavItemActive,
} from '@/components/app-shared';
import { BanknoteIcon } from 'lucide-react';

/**
 * Back-office sidebar. The accountant (build spec #10) gets a finance-only nav
 * and lands on /accountant; the owner keeps the full fleet nav.
 */
export function AppSidebar({ role = 'owner' }: { role?: 'owner' | 'accountant' }) {
  const pathname = usePathname();
  const isAccountant = role === 'accountant';
  const groups = isAccountant ? accountantNavGroups : navGroups;
  const footer = isAccountant ? accountantFooterNavLinks : footerNavLinks;
  const home = isAccountant ? '/accountant' : '/owner';
  const quickAction = isAccountant
    ? { label: 'Record payment', href: '/accountant/payments/cash' }
    : { label: 'Record cash payment', href: '/owner/payments' };

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenuButton render={<Link href={home} />}>
          <Image
            src="/logo.png"
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0 rounded"
          />
          <span className="font-semibold">Ng&rsquo;umbi Riders</span>
        </SidebarMenuButton>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              tooltip={quickAction.label}
              render={<Link href={quickAction.href} />}
            >
              <BanknoteIcon />
              <span>{quickAction.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarGroup>
        {groups.map((group, index) => (
          <NavGroup key={`sidebar-group-${index}`} {...group} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {footer.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                className="text-sidebar-foreground/70"
                isActive={isNavItemActive(item.path, pathname)}
                size="sm"
                render={<Link href={item.path ?? '#'} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
