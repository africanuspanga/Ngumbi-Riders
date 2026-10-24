import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApplicationForm } from './ApplicationForm';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('apply');
  return { title: t('header.title'), description: t('header.subtitle') };
}

export default async function ApplyPage() {
  const t = await getTranslations('apply');
  // Same header as the landing and sign-in pages (design pass 2): the
  // application is the next step of one site, not a separate tool.
  return (
    <main className="min-h-dvh bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-5">
        <Link href="/" className="flex items-center gap-2.5" aria-label={t('header.back')}>
          <Image src="/icons/icon-192.png" alt="" width={36} height={36} priority className="rounded-lg" />
          <span className="text-base font-semibold tracking-tight text-primary-dark">Ng&rsquo;umbi Riders</span>
        </Link>
        <LanguageSwitcher />
      </header>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-12 pt-8 sm:max-w-lg">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#0e2316]">{t('header.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('header.subtitle')}</p>
        </div>
        <div className="sm:rounded-2xl sm:border sm:border-border sm:bg-white sm:p-7 sm:shadow-[0_1px_2px_rgba(15,31,21,0.04)]">
          <ApplicationForm />
        </div>
      </div>
    </main>
  );
}
