'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Mode = 'rider' | 'owner';

export function LoginForm({ mode, next }: { mode: Mode; next?: string }) {
  const t = useTranslations('login');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Rider fields
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  // Owner fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const endpoint =
        mode === 'rider' ? '/api/auth/rider-login' : '/api/auth/owner-login';
      const payload =
        mode === 'rider' ? { phone, pin } : { email, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // A platform error page (413/429/5xx) is not JSON — don't let a server
      // problem read as "wrong credentials" and burn lockout attempts.
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (data?.error === 'locked') setError(t('locked'));
        else if (!data) setError(t('network'));
        else setError(t('invalidCredentials'));
        return;
      }
      // Only follow same-origin relative paths — a crafted ?next=//evil.com
      // link must not redirect a freshly logged-in user off-site.
      const safeNext = next && /^\/(?!\/)/.test(next) && !next.includes('\\') ? next : null;
      router.push(safeNext || data.redirectTo || '/');
      router.refresh();
    } catch {
      setError(t('network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode === 'rider' ? (
        <>
          <Field label={t('phone')}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
              className="input"
            />
          </Field>
          <Field label={t('pin')}>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
              }
              placeholder="••••"
              className="input tracking-[0.5em]"
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={t('email')}>
            <input
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@ngumbi.co.tz / 0753 522 155"
              className="input"
            />
          </Field>
          <Field label={t('password')}>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </Field>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 cursor-pointer rounded-[--radius-card] bg-primary px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60"
      >
        {pending ? t('pending') : t('submit')}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
