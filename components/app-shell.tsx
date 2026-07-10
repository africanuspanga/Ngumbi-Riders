import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppHeader } from '@/components/app-header';
import { AppSidebar } from '@/components/app-sidebar';

export function AppShell({
  ownerName,
  children,
}: {
  ownerName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden">
      <SidebarProvider className="relative h-svh">
        <AppSidebar />
        <SidebarInset className="md:peer-data-[variant=inset]:ml-0">
          <AppHeader ownerName={ownerName} />
          <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">{children}</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
