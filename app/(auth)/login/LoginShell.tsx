import Image from 'next/image';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

/*
 * Shared mobile-first chrome for the rider (/login) and owner (/login/owner)
 * sign-in pages: language toggle on top, brand logo, left-aligned heading,
 * then the form and footer link.
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-6 pt-4">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>

      <div className="flex flex-1 flex-col justify-center py-8">
        <Image
          src="/logo.png"
          alt="Ng’umbi Riders"
          width={480}
          height={334}
          priority
          className="mx-auto h-auto w-48 sm:w-56"
        />

        <h1 className="mt-10 text-xl font-bold text-foreground sm:text-2xl">
          {heading}
        </h1>

        <div className="mt-5">{children}</div>
      </div>

      {footer && (
        <div className="pb-2 text-center text-sm text-muted">{footer}</div>
      )}
    </main>
  );
}
