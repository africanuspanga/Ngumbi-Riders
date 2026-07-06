import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('apply');
  return { title: t('success.title') };
}

export default async function ApplySuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const t = await getTranslations('apply');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-3xl">
        ✓
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-primary-dark">{t('success.title')}</h1>
        <p className="text-muted">{t('success.message')}</p>
      </div>
      {ref && (
        <div className="w-full rounded-[--radius-card] border border-border bg-white p-4">
          <p className="text-xs text-muted">{t('success.refLabel')}</p>
          <p className="text-lg font-bold tracking-wide text-primary-dark">{ref}</p>
        </div>
      )}
      <Link
        href="/"
        className="rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover"
      >
        {t('success.home')}
      </Link>
    </main>
  );
}
