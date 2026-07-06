import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './LoginForm';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export const metadata: Metadata = { title: 'Ingia' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations('login');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <h1 className="text-center text-2xl font-bold text-primary-dark">
        {t('title')}
      </h1>
      <LoginForm next={next} />
    </main>
  );
}
