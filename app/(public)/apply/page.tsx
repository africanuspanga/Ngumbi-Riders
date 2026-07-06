import type { Metadata } from 'next';
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
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm font-medium text-muted">
            {t('header.back')}
          </Link>
          <LanguageSwitcher />
        </div>
        <h1 className="text-2xl font-bold text-primary-dark">{t('header.title')}</h1>
        <p className="text-sm text-muted">{t('header.subtitle')}</p>
      </header>
      <ApplicationForm />
    </main>
  );
}
