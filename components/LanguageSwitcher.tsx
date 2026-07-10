'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeCookie } from '@/lib/i18n/config';

/*
 * Swahili/English segmented toggle with TZ/UK flags. Sets the NEXT_LOCALE
 * cookie and re-renders server components. Swahili is the default locale.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(nextLocale: 'sw' | 'en') {
    if (nextLocale === locale) return;
    document.cookie = `${localeCookie}=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label="Lugha / Language"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-white p-0.5 shadow-sm"
    >
      <LangOption
        active={locale === 'sw'}
        disabled={pending}
        onClick={() => setLocale('sw')}
        label="Kiswahili"
        short="SW"
        flag={<TanzaniaFlag />}
      />
      <LangOption
        active={locale === 'en'}
        disabled={pending}
        onClick={() => setLocale('en')}
        label="English"
        short="EN"
        flag={<UkFlag />}
      />
    </div>
  );
}

function LangOption({
  active,
  disabled,
  onClick,
  label,
  short,
  flag,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  short: string;
  flag: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${
        active
          ? 'bg-primary text-white shadow-sm'
          : 'text-muted-foreground hover:bg-surface'
      }`}
    >
      {flag}
      {short}
    </button>
  );
}

/* Compact flag marks (inline SVG — no extra requests on slow connections). */

function TanzaniaFlag() {
  return (
    <svg
      viewBox="0 0 30 20"
      className="h-3.5 w-5 shrink-0 rounded-[2px]"
      aria-hidden="true"
    >
      <path d="M0 0h30L0 20z" fill="#1eb53a" />
      <path d="M30 0v20H0z" fill="#00a3dd" />
      <path d="M0 20 30 0" stroke="#fcd116" strokeWidth="7" />
      <path d="M0 20 30 0" stroke="#000" strokeWidth="4.5" />
    </svg>
  );
}

function UkFlag() {
  return (
    <svg
      viewBox="0 0 30 20"
      className="h-3.5 w-5 shrink-0 rounded-[2px]"
      aria-hidden="true"
    >
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" strokeWidth="2" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6.5" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="4" />
    </svg>
  );
}
