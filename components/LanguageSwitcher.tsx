'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeCookie } from '@/lib/i18n/config';

// Toggles between Swahili and English by setting the NEXT_LOCALE cookie and
// re-rendering server components. English is optional; Swahili is default.
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations('lang');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const nextLocale = locale === 'sw' ? 'en' : 'sw';
    document.cookie = `${localeCookie}=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className="rounded-full border border-border bg-white px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface disabled:opacity-60"
      aria-label={t('switchTo')}
    >
      {t('switchTo')}
    </button>
  );
}
