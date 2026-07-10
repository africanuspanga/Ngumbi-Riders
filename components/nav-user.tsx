'use client';

import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOutIcon } from 'lucide-react';

export function NavUser({ name }: { name: string }) {
  const router = useRouter();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login/owner');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-pointer rounded-full">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
            {initials || 'N'}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="font-medium text-foreground">{name}</span>
          <span className="text-muted-foreground text-xs font-normal">Mmiliki · Owner</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="w-full cursor-pointer" variant="destructive" onClick={logout}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
