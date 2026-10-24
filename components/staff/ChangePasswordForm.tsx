'use client';

import { useState } from 'react';
import { changeOwnPassword } from '@/lib/staff/password-actions';

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';

const ERRORS: Record<string, string> = {
  wrong_current: 'Your current password is not correct.',
  locked: 'Too many wrong attempts. Wait 30 minutes and try again.',
  update_failed: 'The password could not be changed. Try again.',
  forbidden: 'You are not allowed to do this. Sign in again.',
};

/** Change-your-own-password form for owner and accountants. */
export function ChangePasswordForm() {
  const [values, setValues] = useState<Record<Field, string>>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<{ field?: Field; message: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  function set(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (error?.field === field) setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await changeOwnPassword(values);
      if (!res.ok) {
        setError({
          field: res.field,
          message: res.message ?? ERRORS[res.error] ?? 'The password could not be changed.',
        });
        return;
      }
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setDone(true);
    } catch {
      setError({ message: 'Network error — your password was not changed.' });
    } finally {
      setBusy(false);
    }
  }

  const fields: { name: Field; label: string; autoComplete: string; hint?: string }[] = [
    { name: 'currentPassword', label: 'Current password', autoComplete: 'current-password' },
    {
      name: 'newPassword',
      label: 'New password',
      autoComplete: 'new-password',
      hint: 'At least 10 characters, with an uppercase letter, a lowercase letter and a number.',
    },
    { name: 'confirmPassword', label: 'Repeat the new password', autoComplete: 'new-password' },
  ];

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">{f.label}</span>
          <input
            type="password"
            required
            autoComplete={f.autoComplete}
            value={values[f.name]}
            onChange={(e) => set(f.name, e.target.value)}
            aria-invalid={error?.field === f.name}
            className={`input ${error?.field === f.name ? 'border-[color:var(--color-overdue)]' : ''}`}
          />
          {error?.field === f.name ? (
            <span role="alert" className="text-xs font-medium text-[color:var(--color-overdue)]">
              {error.message}
            </span>
          ) : (
            f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>
          )}
        </label>
      ))}

      {error && !error.field && (
        <p role="alert" className="text-sm font-medium text-[color:var(--color-overdue)]">
          {error.message}
        </p>
      )}
      {done && (
        <p className="rounded-(--radius-card) bg-surface px-3 py-2 text-sm font-medium text-[color:var(--color-paid)]">
          Password changed. Your other devices have been signed out, and an SMS confirming the
          change has been sent to your phone.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-10 self-start rounded-(--radius-card) bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
