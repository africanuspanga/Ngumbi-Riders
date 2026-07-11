'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function ChangePinForm({ forced }: { forced: boolean }) {
  const t = useTranslations('pin');
  const router = useRouter();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 4);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPin !== confirmPin) {
      setError(t('mismatch'));
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin, confirmPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'weak_pin') setError(t('weak'));
        else if (data.error === 'mismatch') setError(t('mismatch'));
        else setError(t('weak'));
        return;
      }
      router.push(data.redirectTo || '/rider');
      router.refresh();
    } catch {
      // Network failure or a non-JSON error body (e.g. a platform 5xx page).
      setError(t('network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {forced && (
        <p className="rounded-[--radius-card] bg-surface p-3 text-sm text-primary-dark">
          {t('mustChange')}
        </p>
      )}
      <PinField label={t('current')} value={currentPin} onChange={(v) => setCurrentPin(clean(v))} />
      <PinField label={t('new')} value={newPin} onChange={(v) => setNewPin(clean(v))} />
      <PinField label={t('confirm')} value={confirmPin} onChange={(v) => setConfirmPin(clean(v))} />

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
        {pending ? '…' : t('changeTitle')}
      </button>
    </form>
  );
}

function PinField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••"
        className="input tracking-[0.5em]"
      />
    </label>
  );
}
