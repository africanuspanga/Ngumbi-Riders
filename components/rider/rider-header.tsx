'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SettingsIcon, LogOutIcon, UserIcon } from 'lucide-react';

export function RiderHeader() {
  const router = useRouter();

  async function logout() {
    // Best-effort: if the network is down the session can't be cleared, but we
    // must still move the rider off the gated area rather than no-op silently.
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // offline — fall through to navigation anyway
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href="/rider" className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={28} height={28} className="size-7 rounded" />
          <span className="font-semibold text-primary-dark">Ng&rsquo;umbi Riders</span>
        </Link>
        <div className="flex items-center gap-1">
          {/* The rider's own profile (build spec #3). Kept in the header rather
              than the 5-tab bottom bar, which is already at its thumb-reach
              limit on a low-cost Android screen. */}
          <Link
            href="/rider/profile"
            aria-label="Wasifu wangu"
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-surface"
          >
            <UserIcon className="size-5" />
          </Link>
          <Link
            href="/rider/settings/pin"
            aria-label="Mipangilio ya PIN"
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-surface"
          >
            <SettingsIcon className="size-5" />
          </Link>
          <button
            type="button"
            onClick={logout}
            aria-label="Toka"
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-surface"
          >
            <LogOutIcon className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
