import Image from 'next/image';
import Link from 'next/link';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

/*
 * Shared chrome for the rider (/login) and staff (/login/owner) sign-in pages.
 * Same header as the landing page (design pass 2, 2026-10-24), so signing in
 * feels like the next step of one site rather than a different app. The large
 * 480px logo PNG it used to load is gone: the 192px icon is already cached
 * from the landing page and costs a rider on mobile data nothing.
 */
export function LoginShell({
  heading,
  children,
  footer,
}: {
  heading: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/icons/icon-192.png" alt="" width={36} height={36} priority className="rounded-lg" />
          <span className="text-base font-semibold tracking-tight text-primary-dark">Ng&rsquo;umbi Riders</span>
        </Link>
        <LanguageSwitcher />
      </header>

      <div className="flex flex-1 flex-col justify-center px-5 py-10">
        <div className="mx-auto w-full max-w-sm sm:rounded-2xl sm:border sm:border-border sm:bg-white sm:p-8 sm:shadow-[0_1px_2px_rgba(15,31,21,0.04),0_12px_32px_-16px_rgba(15,31,21,0.18)]">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0e2316]">{heading}</h1>
          <div className="mt-6">{children}</div>
        </div>
      </div>

      {footer && <div className="pb-8 text-center text-sm text-muted-foreground">{footer}</div>}
    </main>
  );
}
