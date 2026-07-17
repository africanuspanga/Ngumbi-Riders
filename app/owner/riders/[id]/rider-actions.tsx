'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revealRiderSecrets, setRiderStatus, resetRiderPin } from '@/lib/riders/actions';
import {
  assignMotorcycle,
  transferMotorcycle,
  releaseAssignment,
} from '@/lib/assignments/actions';
import { recomputeRiderRisk, setManualRisk } from '@/lib/risk/actions';
import type { RiderStatus, RiskLevel } from '@/lib/supabase/types';

const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export function RiskControls({ id, current, reasons }: { id: string; current: RiskLevel; reasons: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [override, setOverride] = useState<RiskLevel>(current);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-sm">Current: <strong className="capitalize">{current}</strong></span>
        {reasons.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await recomputeRiderRisk(id); router.refresh(); })}
        className="self-start rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
      >
        {pending ? '…' : 'Recompute risk'}
      </button>
      <div className="flex flex-col gap-2 border-t border-border pt-2">
        <span className="text-xs font-semibold text-muted-foreground">Manual override</span>
        <div className="flex flex-wrap gap-2">
          <select className="input max-w-[8rem]" value={override} onChange={(e) => setOverride(e.target.value as RiskLevel)}>
            {RISK_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <input className="input flex-1" placeholder="Reason / note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          type="button"
          disabled={pending || !note.trim()}
          onClick={() => start(async () => { await setManualRisk(id, override, note); router.refresh(); })}
          className="self-start rounded-[--radius-card] bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Apply override
        </button>
      </div>
    </div>
  );
}

export function RiderPinReset({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [tempPin, setTempPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (tempPin) {
    return (
      <div className="flex flex-col gap-2 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3">
        <span className="text-sm font-semibold text-primary-dark">
          New temporary PIN: <span className="font-mono text-lg tracking-[0.3em]">{tempPin}</span>
        </span>
        <p className="text-xs text-muted-foreground">
          Shown only once — hand it to the rider now. Their old PIN no longer
          works, and they must choose a new PIN on their next sign-in.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Rider forgot their PIN? Issue a new temporary one. This signs them out
        of the old PIN immediately.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface"
        >
          Reset PIN…
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await resetRiderPin(id);
                if (res.ok && res.data) setTempPin(res.data.tempPin);
                else setError('Reset failed — try again.');
                setConfirming(false);
              })
            }
            className="rounded-[--radius-card] bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? '…' : 'Confirm reset'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}

type MotoOption = { id: string; registration_number: string | null; motorcycle_number: string };

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
          <span className="text-muted-foreground">NIDA</span>
          <span className="font-mono font-medium">{values.nida ?? '—'}</span>
        </div>
        <div className="flex justify-between border-b border-border py-1">
          <span className="text-muted-foreground">Licence</span>
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
      className="self-start rounded-[--radius-card] border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-surface disabled:opacity-60"
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
            <option key={m.id} value={m.id}>{m.motorcycle_number}{m.registration_number ? ` · ${m.registration_number}` : ''}</option>
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
            <option key={m.id} value={m.id}>{m.motorcycle_number}{m.registration_number ? ` · ${m.registration_number}` : ''}</option>
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
