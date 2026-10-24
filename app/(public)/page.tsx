import Link from 'next/link';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

/*
 * The public front door (design pass 2, 2026-10-24). Its one job: tell a
 * would-be rider what the deal is — lease-to-own, paid daily by phone — and
 * get them into the application.
 *
 * Signature: the payment strip. A row of days that fill in and end in
 * ownership — the same device as the owner's 30-day collection ribbon, seen
 * from the rider's side. Pure CSS: no images or extra fonts, because this page
 * is opened on low-cost Android over mobile data (spec §6.2).
 */
const STRIP_DAYS = 28;
const STRIP_PAID = 19;

export default async function LandingPage() {
  const t = await getTranslations('landing');
  const c = await getTranslations('common');
  const steps = [1, 2, 3, 4] as const;

  return (
    <main className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 pt-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={36}
            height={36}
            priority
            className="rounded-lg"
          />
          <span className="text-base font-semibold tracking-tight text-primary-dark">
            {c('appName')}
          </span>
        </Link>
        <LanguageSwitcher />
      </header>

      <section className="mx-auto grid max-w-5xl gap-10 px-5 pb-12 pt-12 md:grid-cols-[1.15fr_1fr] md:items-center md:pt-20">
        <div className="flex flex-col gap-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {t('eyebrow')}
          </p>
          <h1 className="text-[2.1rem] font-semibold leading-[1.08] tracking-[-0.03em] text-[#0e2316] sm:text-5xl">
            {t('headline')}
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t('lede')}
          </p>
          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <Link
              href="/apply"
              className="btn flex items-center justify-center rounded-(--radius-card) bg-primary px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('apply')}
            </Link>
            <Link
              href="/login"
              className="btn flex items-center justify-center rounded-(--radius-card) border border-border bg-white px-6 py-3 text-base font-semibold text-primary-dark transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('login')}
            </Link>
          </div>
        </div>

        {/* The payment strip. Decorative: the sentence above already says it. */}
        <div
          aria-hidden
          className="rounded-2xl bg-[#0e2316] p-5 text-white shadow-[0_20px_40px_-24px_rgba(14,35,22,0.6)] sm:p-6"
        >
          <div className="grid grid-cols-7 gap-1.5 md:grid-cols-14 md:gap-1">
            {Array.from({ length: STRIP_DAYS }, (_, i) => (
              <span
                key={i}
                className={`aspect-square rounded-[5px] ${
                  i < STRIP_PAID
                    ? 'bg-[#5fd08b]'
                    : i === STRIP_PAID
                      ? 'bg-[#5fd08b]/40 ring-1 ring-[#5fd08b]'
                      : 'bg-white/[0.07]'
                }`}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-white/60">
            <span>{t('stripStart')}</span>
            <span className="flex items-center gap-1.5 font-semibold text-[#5fd08b]">
              <KeyIcon />
              {t('stripEnd')}
            </span>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('stepsTitle')}
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((n) => (
              <li key={n} className="flex flex-col gap-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-surface text-sm font-semibold text-primary-dark tabular-nums">
                  {n}
                </span>
                <h3 className="text-base font-semibold text-[#0e2316]">{t(`step${n}Title`)}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(`step${n}Body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="mx-auto flex max-w-5xl flex-col items-start gap-2 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {t('haveAccount')}{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            {t('login')}
          </Link>
        </span>
        <Link href="/login/owner" className="underline-offset-2 hover:underline">
          {t('staff')}
        </Link>
      </footer>
    </main>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" />
    </svg>
  );
}
