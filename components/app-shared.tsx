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
  UserCogIcon,
  NotebookPenIcon,
  CheckCheckIcon,
  ListIcon,
  ClipboardCheckIcon,
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
      {
        title: 'Payments',
        path: '/owner/payments',
        icon: <BanknoteIcon />,
        subItems: [
          { title: 'Cash approvals', path: '/owner/payments/approvals', icon: <CheckCheckIcon /> },
          { title: 'All transactions', path: '/owner/payments/transactions', icon: <ListIcon /> },
        ],
      },
      { title: 'Purchase requests', path: '/owner/requisitions', icon: <ClipboardCheckIcon /> },
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
  { title: 'Staff', path: '/owner/staff', icon: <UserCogIcon /> },
];

/*
 * Accountant-area navigation (build spec #10). Finance surfaces only — no
 * applications, imports, announcements, system health or audit trail, and no
 * rider/motorcycle/contract editing. Reports carries its own clear icon as the
 * client asked. These links are a convenience: /accountant pages each call
 * requireAccountant() and every action re-checks the permission server-side.
 */
export const accountantNavGroups: SidebarNavGroup[] = [
  {
    items: [{ title: 'Dashboard', path: '/accountant', icon: <LayoutGridIcon /> }],
  },
  {
    label: 'Money',
    items: [
      { title: 'Reports', path: '/accountant/reports', icon: <BarChart3Icon /> },
      { title: 'Payments', path: '/accountant/payments', icon: <BanknoteIcon /> },
      { title: 'Record payment', path: '/accountant/payments/cash', icon: <ReceiptIcon /> },
      { title: 'Awaiting confirmation', path: '/accountant/payments/approvals', icon: <CheckCheckIcon /> },
      { title: 'Outstanding', path: '/accountant/outstanding', icon: <ScaleIcon /> },
      { title: 'Purchase requests', path: '/accountant/requisitions', icon: <ClipboardCheckIcon /> },
    ],
  },
  {
    label: 'Records',
    items: [
      { title: 'Riders', path: '/accountant/riders', icon: <UsersIcon /> },
      { title: 'Motorcycles', path: '/accountant/motorcycles', icon: <BikeIcon /> },
      { title: 'Contracts', path: '/accountant/contracts', icon: <FileTextIcon /> },
      { title: 'Notes', path: '/accountant/notes', icon: <NotebookPenIcon /> },
    ],
  },
];

export const accountantFooterNavLinks: SidebarNavItem[] = [];

const allItems: SidebarNavItem[] = [
  ...[...navGroups, ...accountantNavGroups].flatMap((g) =>
    g.items.flatMap((i) => (i.subItems?.length ? [i, ...i.subItems] : [i])),
  ),
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
