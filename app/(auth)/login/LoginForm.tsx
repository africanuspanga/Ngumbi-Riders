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
  // Staff second step (D-053): set once the password is accepted and a code
  // has been texted to the phone on the account.
  const [challenge, setChallenge] = useState<{ id: string; maskedPhone: string } | null>(null);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function goHome(redirectTo: string | undefined) {
    // Only follow same-origin relative paths — a crafted ?next=//evil.com
    // link must not redirect a freshly logged-in user off-site.
    const safeNext = next && /^\/(?!\/)/.test(next) && !next.includes('\\') ? next : null;
    router.push(safeNext || redirectTo || '/');
    router.refresh();
  }

  function otpError(error: string | undefined, attemptsLeft?: number): string {
    switch (error) {
      case 'otp_wrong_code':
        return t('otpWrong', { left: attemptsLeft ?? 0 });
      case 'otp_expired':
        return t('otpExpired');
      case 'otp_too_many_attempts':
      case 'otp_consumed':
      case 'otp_not_found':
        return t('otpStartOver');
      case 'otp_cooldown':
        return t('otpCooldown');
      case 'otp_too_many_sends':
      case 'otp_too_many_codes':
        return t('otpTooMany');
      case 'otp_sms_failed':
        return t('otpSmsFailed');
      case 'otp_no_phone':
        return t('otpNoPhone');
      case 'locked':
        return t('locked');
      case 'account_disabled':
        return t('accountDisabled');
      default:
        return t('network');
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/owner-login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.id, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(otpError(data?.error, data?.attemptsLeft));
        if (data?.error === 'otp_too_many_attempts' || data?.error === 'otp_not_found') {
          setChallenge(null);
          setCode('');
        }
        return;
      }
      goHome(data?.redirectTo);
    } catch {
      setError(t('network'));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (!challenge) return;
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/owner-login/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(otpError(data?.error));
      else setNotice(t('otpResent'));
    } catch {
      setError(t('network'));
    } finally {
      setPending(false);
    }
  }

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
        if (data?.error?.startsWith('otp_')) setError(otpError(data.error));
        else if (data?.error === 'locked') setError(t('locked'));
        // A deactivated accountant must be told WHY, not left retrying a
        // password that is in fact correct (spec #10 — the owner can withdraw
        // access at any time).
        else if (data?.error === 'account_disabled') setError(t('accountDisabled'));
        else if (!data) setError(t('network'));
        else setError(t('invalidCredentials'));
        return;
      }
      if (data?.otpRequired) {
        setChallenge({ id: data.challengeId, maskedPhone: data.maskedPhone });
        setCode('');
        setPassword('');
        return;
      }
      goHome(data?.redirectTo);
    } catch {
      setError(t('network'));
    } finally {
      setPending(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('otpSent', { phone: challenge.maskedPhone })}
        </p>
        <Field label={t('otpLabel')}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            className="input tracking-[0.5em]"
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm font-medium text-overdue">
            {error}
          </p>
        )}
        {notice && <p className="text-sm font-medium text-primary">{notice}</p>}

        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className="mt-1 cursor-pointer rounded-(--radius-card) bg-primary px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60"
        >
          {pending ? t('pending') : t('otpSubmit')}
        </button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={resend}
            disabled={pending}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
          >
            {t('otpResend')}
          </button>
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setError(null);
              setNotice(null);
            }}
            className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline"
          >
            {t('otpBack')}
          </button>
        </div>
      </form>
    );
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
        className="mt-1 cursor-pointer rounded-(--radius-card) bg-primary px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60"
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
