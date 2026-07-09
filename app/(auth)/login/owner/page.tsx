import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '../LoginForm';
import { LoginShell } from '../LoginShell';

export const metadata: Metadata = { title: 'Ingia — Mmiliki' };

export default async function OwnerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations('login');

  return (
    <LoginShell
      heading={t('ownerHeading')}
      footer={
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {t('riderLink')}
        </Link>
      }
    >
      <LoginForm mode="owner" next={next} />
    </LoginShell>
  );
}
