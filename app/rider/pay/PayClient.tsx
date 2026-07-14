'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { resendUssdPush, cancelPendingPayment } from '@/lib/payments/actions';
import { Confetti } from '@/components/rider/Confetti';

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
  // Confirm the payer number BEFORE any USSD request goes out.
  const [confirming, setConfirming] = useState(false);

  function askConfirm() {
    if (!selected) return;
    if (payerPhone.replace(/\D/g, '').length < 9) {
      setError('Namba ya simu si sahihi.');
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function resend(id: string) {
    setResendNote(null);
    try {
      const res = await resendUssdPush(id);
      setResendNote(res.ok ? 'Ombi limetumwa tena. Angalia simu yako.' : 'Imeshindikana kutuma tena. Jaribu tena.');
    } catch {
      setResendNote('Imeshindikana kutuma tena. Angalia mtandao kisha jaribu tena.');
    }
  }

  // Escape hatch: abandon the current (not-yet-confirmed) payment and return to
  // the amount + number screen — so the rider can pay from a different number
  // and is never stuck waiting on a payment that won't complete.
  async function cancelAndRestart(id: string) {
    setResendNote(null);
    setBusy(true);
    try {
      const res = await cancelPendingPayment(id);
      if (res.ok) {
        setPaymentId(null);
        setStatus('idle');
        setSelected(null);
        setConfirming(false);
        setError(null);
      } else {
        setResendNote('Imeshindikana kughairi. Jaribu tena.');
      }
    } catch {
      setResendNote('Imeshindikana kughairi. Angalia mtandao kisha jaribu tena.');
    } finally {
      setBusy(false);
    }
  }

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/payments/${id}/status`, { cache: 'no-store' });
      const data = await res.json();
      // Celebrate in place instead of redirecting straight away — a 'completed'
      // status flips PayClient to the "Malipo yamepokelewa" + confetti screen,
      // and the rider taps through to the receipt from there.
      if (res.ok) setStatus(data.status);
    } catch {
      /* keep polling */
    }
  }, []);

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
          config_error: 'Malipo bado hayajakamilika kusanidiwa. Tafadhali mwambie mmiliki.',
          provider_error: 'Imeshindikana kuanzisha malipo kwa sasa. Jaribu tena baadaye; ikiendelea, mwambie mmiliki.',
          server_error: 'Hitilafu ya mfumo imetokea. Jaribu tena.',
          no_active_contract: 'Huna mkataba unaoendelea.',
          obligation_reserved: 'Siku ulizochagua zina malipo mengine yanayosubiri. Jaribu tena baadaye.',
        };
        setError(map[data.error] ?? 'Imeshindikana kuanzisha malipo.');
        setConfirming(false); // back to the amount + number screen so the error is visible
        return;
      }
      setPaymentId(data.paymentId);
      setStatus('pending');
      setConfirming(false);
    } catch {
      setError('Hitilafu ya mtandao.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'completed') {
    return (
      <>
        <Confetti />
        <div className="flex flex-col items-center gap-3 rounded-[--radius-card] border border-primary bg-white p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-3xl font-bold text-primary">
            ✓
          </div>
          <p className="text-2xl font-bold text-primary-dark">Malipo yamepokelewa!</p>
          <p className="text-sm text-muted-foreground">Asante. Malipo yako yamekamilika.</p>
          <button
            type="button"
            onClick={() => router.push(paymentId ? `/rider/payments/${paymentId}` : '/rider')}
            className="mt-1 rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover"
          >
            Ona risiti
          </button>
          <button
            type="button"
            onClick={() => router.push('/rider')}
            className="text-sm font-medium text-muted-foreground underline"
          >
            Rudi mwanzo
          </button>
        </div>
      </>
    );
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
        <button
          type="button"
          onClick={() => cancelAndRestart(paymentId)}
          disabled={busy}
          className="text-sm font-medium text-muted-foreground underline disabled:opacity-60"
        >
          Ghairi — lipa kwa namba nyingine
        </button>
      </div>
    );
  }

  if (status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'reversed') {
    return (
      <div className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-5 text-center">
        <p className="font-semibold text-overdue">Malipo hayakukamilika</p>
        <button
          type="button"
          onClick={() => { setPaymentId(null); setStatus('idle'); setSelected(null); setConfirming(false); }}
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

  // Confirm the payer number before sending the USSD request.
  if (confirming && selected) {
    return (
      <div className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-5">
        <p className="text-center font-semibold text-primary-dark">
          Je, hii ndiyo namba unayotaka kulipia?
        </p>
        <div className="rounded-[--radius-card] bg-surface p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{payerPhone}</p>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Utalipa <span className="font-semibold text-primary-dark">{tzs(selected.amount)}</span>.
          Ombi la USSD litatumwa kwenye namba hii — utaweka PIN yako ya pesa za simu.
        </p>
        {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={initiate}
          className="rounded-[--radius-card] bg-primary px-6 py-4 text-lg font-bold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? 'Inatuma ombi…' : 'Ndiyo, tuma ombi la malipo'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="text-sm font-medium text-primary underline disabled:opacity-60"
        >
          Hapana, badilisha namba
        </button>
      </div>
    );
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="payer-phone" className="text-sm font-medium">
          Namba ya kulipia
        </label>
        <input
          id="payer-phone"
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="07XX XXX XXX"
          value={payerPhone}
          onChange={(e) => setPayerPhone(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          Unaweza kulipa kwa namba yoyote ya simu — si lazima iwe namba yako.
          {phone && payerPhone !== phone ? (
            <button
              type="button"
              onClick={() => setPayerPhone(phone)}
              className="ml-1 font-medium text-primary underline"
            >
              Tumia namba yangu
            </button>
          ) : null}
        </span>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}

      <button
        type="button"
        disabled={!selected || busy}
        onClick={askConfirm}
        className="rounded-[--radius-card] bg-primary px-6 py-4 text-lg font-bold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {selected ? `Lipa ${tzs(selected.amount)}` : 'Chagua kiasi'}
      </button>
    </div>
  );
}
