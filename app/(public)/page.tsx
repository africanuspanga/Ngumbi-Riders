import Link from 'next/link';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';

export default async function LandingPage() {
  const t = await getTranslations('landing');
  const c = await getTranslations('common');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <div className="flex flex-col items-center gap-4">
        <Image
          src="/icons/logo.png"
          alt={c('appName')}
          width={96}
          height={96}
          priority
          className="rounded-2xl"
        />
        <h1 className="text-2xl font-bold text-primary-dark">{c('appName')}</h1>
        <p className="text-muted">{t('tagline')}</p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Link
          href="/apply"
          className="btn flex items-center justify-center rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover"
        >
          {t('apply')}
        </Link>
        <Link
          href="/login"
          className="btn flex items-center justify-center rounded-[--radius-card] border border-border bg-white px-6 py-3 font-semibold text-primary-dark hover:bg-surface"
        >
          {t('login')}
        </Link>
      </div>
    </main>
  );
}
