'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function LogoutButton() {
  const t = useTranslations('common');
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      className="rounded-[--radius-card] border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface"
    >
      {t('signOut')}
    </button>
  );
}
