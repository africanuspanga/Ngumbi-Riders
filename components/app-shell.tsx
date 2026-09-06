import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppHeader } from '@/components/app-header';
import { AppSidebar } from '@/components/app-sidebar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { INSTALL_LABELS_EN } from '@/lib/pwa/install-labels';

/**
 * Back-office shell, shared by the owner and accountant areas. `role` selects
 * the navigation only — access itself is enforced by the layouts
 * (requireOwner / requireAccountant), the per-action permission checks and RLS.
 */
export function AppShell({
  ownerName,
  role = 'owner',
  roleLabel,
  children,
}: {
  ownerName: string;
  role?: 'owner' | 'accountant';
  roleLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden">
      <SidebarProvider className="relative h-svh">
        <AppSidebar role={role} />
        <SidebarInset className="md:peer-data-[variant=inset]:ml-0">
          <AppHeader
            ownerName={ownerName}
            roleLabel={roleLabel}
            notifications={<NotificationBell basePath={role === 'accountant' ? '/accountant' : '/owner'} />}
          />
          <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
              <InstallPrompt labels={INSTALL_LABELS_EN} />
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
