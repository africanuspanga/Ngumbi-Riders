import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './LoginForm';
import { LoginShell } from './LoginShell';

export const metadata: Metadata = { title: 'Ingia' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations('login');

  return (
    <LoginShell
      heading={t('heading')}
      footer={
        <Link
          href="/login/owner"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('ownerLink')}
        </Link>
      }
    >
      <LoginForm mode="rider" next={next} />
      <p className="mt-4 text-sm text-muted">{t('forgotPin')}</p>
    </LoginShell>
  );
}
