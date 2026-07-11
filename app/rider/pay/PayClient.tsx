'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { resendUssdPush } from '@/lib/payments/actions';

type Option = { key: string; label: string; count: number; amount: number };

function tzs(n: number) {
  return `TZS ${Math.round(n).toLocaleString('en-US')}`;
}

export function PayClient({
  options,
  phone,
  initialPendingId,
}: {
  options: Option[];
  phone: string;
  initialPendingId: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Option | null>(null);
  const [payerPhone, setPayerPhone] = useState(phone);
  const [paymentId, setPaymentId] = useState<string | null>(initialPendingId);
  const [status, setStatus] = useState<string>(initialPendingId ? 'pending' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function resend(id: string) {
    setResendNote(null);
    try {
      const res = await resendUssdPush(id);
      setResendNote(res.ok ? 'Ombi limetumwa tena. Angalia simu yako.' : 'Imeshindikana kutuma tena. Jaribu tena.');
    } catch {
      setResendNote('Imeshindikana kutuma tena. Angalia mtandao kisha jaribu tena.');
    }
  }

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/payments/${id}/status`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setStatus(data.status);
        if (data.status === 'completed' && data.receiptId) {
          router.push(`/rider/payments/${id}`);
        }
      }
    } catch {
      /* keep polling */
    }
  }, [router]);

  // Conservative polling — payment state is never optimistic (spec §6.2, §12.2).
  useEffect(() => {
    if (!paymentId || !['pending', 'created'].includes(status)) return;
    const kick = setTimeout(() => poll(paymentId), 0);
    const t = setInterval(() => poll(paymentId), 5000);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
    };
  }, [paymentId, status, poll]);

  async function initiate() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/payments/snippe/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: selected.count, payerPhone }),
      });
      const data = await res.json();
      if (!res.ok) {
        const map: Record<string, string> = {
          pending_exists: 'Una malipo yanayosubiri tayari.',
          below_minimum: 'Kiasi ni kidogo mno.',
          invalid_phone: 'Namba ya simu si sahihi.',
          not_configured: 'Malipo bado hayajawashwa. Jaribu tena baadaye.',
          no_active_contract: 'Huna mkataba unaoendelea.',
          obligation_reserved: 'Siku ulizochagua zina malipo mengine yanayosubiri. Jaribu tena baadaye.',
        };
        setError(map[data.error] ?? 'Imeshindikana kuanzisha malipo.');
        return;
      }
      setPaymentId(data.paymentId);
      setStatus('pending');
    } catch {
      setError('Hitilafu ya mtandao.');
    } finally {
      setBusy(false);
    }
  }

  if (paymentId && ['pending', 'created'].includes(status)) {
    return (
      <div className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-5 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-surface border-t-primary" />
        <p className="font-semibold text-primary-dark">Inasubiri uthibitisho…</p>
        <p className="text-sm text-muted-foreground">
          Angalia simu yako ({payerPhone}) na weka PIN ya pesa za simu kuthibitisha.
        </p>
        <button
          type="button"
          onClick={() => resend(paymentId)}
          className="text-sm font-medium text-primary underline"
        >
          Tuma tena ombi la USSD
        </button>
        {resendNote && <p className="text-xs text-muted-foreground">{resendNote}</p>}
      </div>
    );
  }

  if (status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'reversed') {
    return (
      <div className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-5 text-center">
        <p className="font-semibold text-overdue">Malipo hayakukamilika</p>
        <button
          type="button"
          onClick={() => { setPaymentId(null); setStatus('idle'); setSelected(null); }}
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white"
        >
          Jaribu tena
        </button>
      </div>
    );
  }

  if (options.length === 0) {
    return <p className="text-muted-foreground">Huna malipo yanayohitajika kwa sasa. ✓</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setSelected(o)}
            className={`flex items-center justify-between rounded-[--radius-card] border px-4 py-3 text-left ${
              selected?.key === o.key ? 'border-primary bg-surface' : 'border-border bg-white'
            }`}
          >
            <span className="font-medium text-foreground">{o.label}</span>
            <span className="font-bold text-primary-dark">{tzs(o.amount)}</span>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Namba ya kulipia</span>
        <input
          className="input"
          type="tel"
          inputMode="tel"
          value={payerPhone}
          onChange={(e) => setPayerPhone(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">Unaweza kutumia namba ya mtu mwingine.</span>
      </label>

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}

      <button
        type="button"
        disabled={!selected || busy}
        onClick={initiate}
        className="rounded-[--radius-card] bg-primary px-6 py-4 text-lg font-bold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Inaanzisha…' : selected ? `Lipa ${tzs(selected.amount)}` : 'Chagua kiasi'}
      </button>
    </div>
  );
}
