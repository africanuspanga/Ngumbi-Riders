'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SettingsIcon, LogOutIcon } from 'lucide-react';

export function RiderHeader() {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
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
          <Link
            href="/rider/settings/pin"
            aria-label="Mipangilio ya PIN"
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-surface"
          >
            <SettingsIcon className="size-5" />
          </Link>
          <button
            type="button"
            onClick={logout}
            aria-label="Toka"
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-surface"
            style={{ minHeight: 0 }}
          >
            <LogOutIcon className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
