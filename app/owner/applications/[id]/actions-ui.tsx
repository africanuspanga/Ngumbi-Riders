'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setApplicationStatus,
  revealApplicationSecrets,
  getSignedDocumentUrl,
  convertToRider,
} from '@/lib/applications/actions';
import { allowedTransitions, STATUS_META } from '@/lib/applications/status';
import type { ApplicationStatus } from '@/lib/supabase/types';

export function StatusActions({
  id,
  current,
}: {
  id: string;
  current: ApplicationStatus;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 'converted_to_rider' is handled by the dedicated convert flow.
  const targets = allowedTransitions(current).filter(
    (s) => s !== 'converted_to_rider',
  );

  if (targets.length === 0) return null;

  function move(to: ApplicationStatus) {
    setError(null);
    start(async () => {
      const res = await setApplicationStatus(id, to);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted">Move to</h3>
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => move(to)}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            {STATUS_META[to].label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-overdue">{error}</p>}
    </div>
  );
}

export function RevealSecrets({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [values, setValues] = useState<{
    nida: string | null;
    licence: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reveal() {
    setError(null);
    start(async () => {
      const res = await revealApplicationSecrets(id);
      if (res.ok) setValues(res.data ?? { nida: null, licence: null });
      else setError(res.error);
    });
  }

  if (values) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <Row label="NIDA" value={values.nida ?? '—'} />
        <Row label="Licence" value={values.licence ?? '—'} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={reveal}
        disabled={pending}
        className="self-start rounded-[--radius-card] border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-surface disabled:opacity-60"
      >
        {pending ? '…' : 'Reveal NIDA & licence'}
      </button>
      {error && <p className="text-xs text-overdue">{error}</p>}
    </div>
  );
}

export function DocumentLink({
  bucket,
  path,
  label,
}: {
  bucket: string;
  path: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    start(async () => {
      const res = await getSignedDocumentUrl(bucket, path);
      if (res.ok && res.data) window.open(res.data.url, '_blank', 'noopener');
      else setError('Could not open');
    });
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      className="flex items-center gap-2 rounded-[--radius-card] border border-border bg-white px-3 py-2 text-left text-sm hover:bg-surface disabled:opacity-60"
    >
      <span>📄</span>
      <span className="font-medium text-primary-dark">{label}</span>
      {error && <span className="text-xs text-overdue">{error}</span>}
    </button>
  );
}

export function ConvertButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    riderNumber: string;
    tempPin: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function convert() {
    setError(null);
    start(async () => {
      const res = await convertToRider(id);
      if (res.ok && res.data) {
        setResult({ riderNumber: res.data.riderNumber, tempPin: res.data.tempPin });
        router.refresh();
      } else {
        setError(res.ok ? 'unknown' : res.error);
      }
    });
  }

  if (result) {
    return (
      <div className="rounded-[--radius-card] border border-primary bg-surface p-4">
        <p className="text-sm font-semibold text-primary-dark">
          Rider created: {result.riderNumber}
        </p>
        <p className="mt-1 text-sm text-foreground">
          Temporary PIN (share once, then it must be changed on first login):
        </p>
        <p className="mt-1 text-2xl font-bold tracking-[0.3em] text-primary-dark">
          {result.tempPin}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={convert}
        disabled={pending}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? 'Converting…' : 'Convert to rider'}
      </button>
      {error && <p className="text-xs text-overdue">{error}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1">
      <span className="text-muted">{label}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </div>
  );
}
