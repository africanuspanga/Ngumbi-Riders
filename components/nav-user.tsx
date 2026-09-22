'use client';

import Link from 'next/link';
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
import { LogOutIcon, UserRoundIcon } from 'lucide-react';

/*
 * The header avatar and its menu.
 *
 * ⚠ `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, and `Menu.GroupLabel`
 * THROWS when it is not inside a `Menu.Group`:
 *
 *   "Base UI: MenuGroupContext is missing. Menu group parts must be used
 *    within <Menu.Group> or <Menu.RadioGroup>."
 *
 * The popup only mounts when the trigger is clicked, so a label placed outside
 * the group renders fine until somebody clicks the avatar and then takes the
 * whole page down to the error boundary. That is exactly what the client
 * reported ("clicking the JN initials crashes the app"), and it is why the
 * label below sits INSIDE `DropdownMenuGroup`.
 *
 * `tests/unit/menu-structure.test.ts` scans the source for the same mistake so
 * it cannot come back — a rendering test would be the better guard, but vitest
 * here is node-only (no DOM).
 */
export function NavUser({
  name,
  role = 'owner',
  roleLabel,
}: {
  name: string;
  role?: 'owner' | 'accountant';
  roleLabel?: string;
}) {
  const router = useRouter();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'N';

  const profileHref = role === 'accountant' ? '/accountant/profile' : '/owner/staff-profiles';
  const profileLabel = role === 'accountant' ? 'My staff profile' : 'Staff profiles';
  const subtitle = roleLabel ?? (role === 'accountant' ? 'Mhasibu · Accountant' : 'Mmiliki · Owner');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login/owner');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name} — account menu`}
        className="cursor-pointer rounded-full"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span className="font-medium text-foreground">{name}</span>
            <span className="text-xs font-normal text-muted-foreground">{subtitle}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="w-full cursor-pointer"
            render={<Link href={profileHref} />}
            nativeButton={false}
          >
            <UserRoundIcon />
            {profileLabel}
          </DropdownMenuItem>
          <DropdownMenuItem className="w-full cursor-pointer" variant="destructive" onClick={logout}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
