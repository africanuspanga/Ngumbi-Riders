'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Tab = 'rider' | 'owner';

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations('login');
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('rider');
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
        tab === 'rider' ? '/api/auth/rider-login' : '/api/auth/owner-login';
      const payload =
        tab === 'rider' ? { phone, pin } : { email, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'locked') setError(t('locked'));
        else setError(t('invalidCredentials'));
        return;
      }
      router.push(next || data.redirectTo || '/');
      router.refresh();
    } catch {
      setError(t('invalidCredentials'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 rounded-[--radius-card] bg-surface p-1">
        <TabButton active={tab === 'rider'} onClick={() => setTab('rider')}>
          {t('riderTab')}
        </TabButton>
        <TabButton active={tab === 'owner'} onClick={() => setTab('owner')}>
          {t('ownerTab')}
        </TabButton>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {tab === 'rider' ? (
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
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
          className="rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? '…' : t('submit')}
        </button>
      </form>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[calc(var(--radius-card)-0.25rem)] px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-white text-primary-dark shadow-sm' : 'text-muted'
      }`}
    >
      {children}
    </button>
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
