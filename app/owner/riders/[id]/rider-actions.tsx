'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revealRiderSecrets, setRiderStatus } from '@/lib/riders/actions';
import {
  assignMotorcycle,
  transferMotorcycle,
  releaseAssignment,
} from '@/lib/assignments/actions';
import type { RiderStatus } from '@/lib/supabase/types';

type MotoOption = { id: string; registration_number: string };

const STATUSES: RiderStatus[] = ['active', 'suspended', 'terminated', 'inactive'];

export function RiderStatusActions({ id, current }: { id: string; current: RiderStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {STATUSES.filter((s) => s !== current).map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            await setRiderStatus(id, s);
            router.refresh();
          })}
          className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function RiderRevealSecrets({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [values, setValues] = useState<{ nida: string | null; licence: string | null } | null>(null);

  if (values) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between border-b border-border py-1">
          <span className="text-muted">NIDA</span>
          <span className="font-mono font-medium">{values.nida ?? '—'}</span>
        </div>
        <div className="flex justify-between border-b border-border py-1">
          <span className="text-muted">Licence</span>
          <span className="font-mono font-medium">{values.licence ?? '—'}</span>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await revealRiderSecrets(id);
        if (res.ok) setValues(res.data ?? { nida: null, licence: null });
      })}
      className="self-start rounded-[--radius-card] border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-surface disabled:opacity-60"
    >
      {pending ? '…' : 'Reveal NIDA & licence'}
    </button>
  );
}

export function AssignmentActions({
  riderId,
  current,
  motorcycles,
}: {
  riderId: string;
  current: { motorcycleId: string; registration: string } | null;
  motorcycles: MotoOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [motoId, setMotoId] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? 'failed');
    });
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-3">
        <select className="input bg-white" value={motoId} onChange={(e) => setMotoId(e.target.value)}>
          <option value="">Select motorcycle…</option>
          {motorcycles.map((m) => (
            <option key={m.id} value={m.id}>{m.registration_number}</option>
          ))}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          disabled={pending || !motoId || !date}
          onClick={() => run(() => assignMotorcycle(riderId, motoId, date))}
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Assign motorcycle
        </button>
        {error && <p className="text-xs text-overdue">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Current: <strong>{current.registration}</strong>
      </p>
      <input className="input" placeholder="Reason (for transfer/release)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="flex flex-col gap-2">
        <select className="input bg-white" value={motoId} onChange={(e) => setMotoId(e.target.value)}>
          <option value="">Transfer to…</option>
          {motorcycles.map((m) => (
            <option key={m.id} value={m.id}>{m.registration_number}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || !motoId || !date || !reason.trim()}
            onClick={() => run(() => transferMotorcycle(riderId, motoId, reason, date))}
            className="flex-1 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Transfer
          </button>
          <button
            type="button"
            disabled={pending || !date}
            onClick={() => run(() => releaseAssignment(riderId, date, reason || undefined))}
            className="flex-1 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            Release
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-overdue">{error}</p>}
    </div>
  );
}
