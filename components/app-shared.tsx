import type { ReactNode } from 'react';
import {
  LayoutGridIcon,
  UsersIcon,
  BikeIcon,
  FileTextIcon,
  ClipboardListIcon,
  BanknoteIcon,
  ScaleIcon,
  ReceiptIcon,
  BarChart3Icon,
  TriangleAlertIcon,
  CalendarOffIcon,
  MegaphoneIcon,
  UploadIcon,
  ActivityIcon,
  ScrollTextIcon,
} from 'lucide-react';

export type SidebarNavItem = {
  title: string;
  path?: string;
  icon?: ReactNode;
  subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
  label?: string;
  items: SidebarNavItem[];
};

/* Owner-area navigation (docs/ROUTE_MAP.md). Active state is computed from the
 * pathname in NavGroup — never hardcoded here. */
export const navGroups: SidebarNavGroup[] = [
  {
    items: [
      { title: 'Dashboard', path: '/owner', icon: <LayoutGridIcon /> },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { title: 'Riders', path: '/owner/riders', icon: <UsersIcon /> },
      { title: 'Motorcycles', path: '/owner/motorcycles', icon: <BikeIcon /> },
      { title: 'Contracts', path: '/owner/contracts', icon: <FileTextIcon /> },
      { title: 'Applications', path: '/owner/applications', icon: <ClipboardListIcon /> },
    ],
  },
  {
    label: 'Money',
    items: [
      { title: 'Payments', path: '/owner/payments', icon: <BanknoteIcon /> },
      { title: 'Reconciliation', path: '/owner/reconciliation', icon: <ScaleIcon /> },
      { title: 'Expenses', path: '/owner/expenses', icon: <ReceiptIcon /> },
      { title: 'Reports', path: '/owner/reports', icon: <BarChart3Icon /> },
    ],
  },
  {
    label: 'Operations',
    items: [
      { title: 'Incidents', path: '/owner/incidents', icon: <TriangleAlertIcon /> },
      { title: 'Exemptions', path: '/owner/exemptions', icon: <CalendarOffIcon /> },
      { title: 'Announcements', path: '/owner/announcements', icon: <MegaphoneIcon /> },
      { title: 'Imports', path: '/owner/imports', icon: <UploadIcon /> },
    ],
  },
];

export const footerNavLinks: SidebarNavItem[] = [
  { title: 'System health', path: '/owner/system', icon: <ActivityIcon /> },
  { title: 'Audit trail', path: '/owner/audit', icon: <ScrollTextIcon /> },
];

const allItems: SidebarNavItem[] = [
  ...navGroups.flatMap((g) => g.items.flatMap((i) => (i.subItems?.length ? [i, ...i.subItems] : [i]))),
  ...footerNavLinks,
];

/** True when the nav item's path matches the current pathname (exact for the
 * dashboard root, prefix for sections so detail pages keep their section lit). */
export function isNavItemActive(path: string | undefined, pathname: string): boolean {
  if (!path) return false;
  if (path === '/owner') return pathname === '/owner';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Longest-prefix nav match for the breadcrumb/header title. */
export function findActiveNavItem(pathname: string): SidebarNavItem | undefined {
  return allItems
    .filter((i) => isNavItemActive(i.path, pathname))
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
}
