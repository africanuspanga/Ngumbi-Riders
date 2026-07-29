'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createAccountant,
  removeAccountantAccess,
  resetAccountantPassword,
  setAccountantActive,
} from '@/lib/staff/actions';

type Row = {
  id: string;
  fullName: string | null;
  email: string | null;
  isActive: boolean;
  createdLabel: string;
};

const ERRORS: Record<string, string> = {
  email_taken: 'That email address already has an account.',
  create_failed: 'Could not create the account. Try again.',
  update_failed: 'Could not save the change. Try again.',
  not_found: 'That account no longer exists — reload the page.',
  forbidden: 'Only the owner can manage staff accounts.',
};

/**
 * Owner-side accountant management. Every button here calls a server action
 * that re-checks `role === 'owner'` — the UI is convenience, not the boundary.
 */
export function StaffManager({ accountants }: { accountants: Row[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const [rowError, setRowError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreated(false);
    try {
      const res = await createAccountant({ fullName, email, password });
      if (!res.ok) {
        setCreateError(ERRORS[res.error] ?? res.error);
        return;
      }
      setFullName('');
      setEmail('');
      setPassword('');
      setCreated(true);
      startTransition(() => router.refresh());
    } catch {
      setCreateError('Network error — the account was not created.');
    }
  }

  async function toggle(id: string, active: boolean) {
    setRowError(null);
    try {
      const res = await setAccountantActive(id, active);
      if (!res.ok) {
        setRowError(ERRORS[res.error] ?? res.error);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setRowError('Network error — nothing was changed.');
    }
  }

  async function remove(id: string, name: string) {
    setRowError(null);
    if (
      !window.confirm(
        `Withdraw ${name}'s access?\n\nThey will be signed out and can no longer log in. Their history stays in the audit trail, and you can re-activate them later with a new password.`,
      )
    ) {
      return;
    }
    try {
      const res = await removeAccountantAccess(id);
      if (!res.ok) {
        setRowError(ERRORS[res.error] ?? res.error);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setRowError('Network error — access was not changed.');
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setRowError(null);
    setResetDone(false);
    if (!resetFor) return;
    try {
      const res = await resetAccountantPassword({ profileId: resetFor, password: newPassword });
      if (!res.ok) {
        setRowError(ERRORS[res.error] ?? res.error);
        return;
      }
      setNewPassword('');
      setResetFor(null);
      setResetDone(true);
      startTransition(() => router.refresh());
    } catch {
      setRowError('Network error — the password was not changed.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Add an accountant</h2>
        <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-3">
          <Labelled label="Full name">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="input" />
          </Labelled>
          <Labelled label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
              className="input"
            />
          </Labelled>
          <Labelled label="Initial password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="input"
            />
          </Labelled>
          <div className="md:col-span-3 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              At least 10 characters with an uppercase letter, a lowercase letter
              and a number. Share it with them directly and change it if it leaks.
            </p>
            {createError && (
              <p role="alert" className="text-sm font-medium text-overdue">
                {createError}
              </p>
            )}
            {created && (
              <p className="text-sm font-medium text-[color:var(--color-paid)]">
                Accountant created. They sign in at /login/owner with that email.
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-fit rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create accountant'}
            </button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Accountants</h2>
        {rowError && (
          <p role="alert" className="text-sm font-medium text-overdue">
            {rowError}
          </p>
        )}
        {resetDone && (
          <p className="text-sm font-medium text-[color:var(--color-paid)]">Password updated.</p>
        )}

        {accountants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accountant accounts yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {accountants.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{a.fullName ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.email ?? '—'} · added {a.createdLabel}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      a.isActive
                        ? 'bg-surface text-[color:var(--color-paid)]'
                        : 'bg-red-50 text-[color:var(--color-overdue)]'
                    }`}
                  >
                    {a.isActive ? 'Active' : 'Deactivated'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(a.id, !a.isActive)}
                    disabled={busy}
                    className="rounded-[--radius-card] border border-border px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
                  >
                    {a.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetFor(resetFor === a.id ? null : a.id);
                      setResetDone(false);
                    }}
                    disabled={busy}
                    className="rounded-[--radius-card] border border-border px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(a.id, a.fullName ?? 'this accountant')}
                    disabled={busy}
                    className="rounded-[--radius-card] border border-border px-3 py-1.5 text-xs font-semibold text-[color:var(--color-overdue)] hover:bg-red-50 disabled:opacity-60"
                  >
                    Remove access
                  </button>
                </div>

                {resetFor === a.id && (
                  <form onSubmit={submitReset} className="flex w-full flex-wrap items-end gap-2">
                    <Labelled label={`New password for ${a.fullName ?? a.email ?? 'this account'}`}>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className="input"
                      />
                    </Labelled>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-[--radius-card] bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                      Save password
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
