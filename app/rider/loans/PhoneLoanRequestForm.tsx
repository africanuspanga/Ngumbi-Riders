'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitPhoneLoanRequest } from '@/lib/loans/requests';
import { computePhoneLoan, PhoneLoanError } from '@/lib/loans/phone';

/*
 * The rider's phone-loan request (client feedback 2026-09-11 #11).
 *
 * "The system should show the rider the available terms BEFORE submission,
 *  including amount requested, repayment duration, total amount to repay,
 *  instalment amount, maximum allowed amount and maximum allowed period."
 *
 * So the quote is computed as they type, by `computePhoneLoan` — the SAME pure
 * function the server uses when it stores the request. The rider cannot be
 * shown one figure and charged another, because there is only one function that
 * knows how to turn a principal into a repayment.
 *
 * Swahili throughout: this is a rider surface (spec rule 11).
 *
 * The limits arrive as plain numbers from the server (app_settings), not
 * imported from a shared constant, because the Director can change them — a
 * constant compiled into the bundle would go stale the day they do.
 */

const ERRORS: Record<string, string> = {
  over_max_amount: 'Kiasi ulichoomba kinazidi kiwango kinachoruhusiwa.',
  over_max_term: 'Muda wa kurejesha unazidi kiwango kinachoruhusiwa.',
  no_active_contract: 'Unahitaji mkataba unaoendelea wa pikipiki kuomba mkopo wa simu.',
  request_in_progress: 'Una ombi la mkopo wa simu linaendelea. Subiri lijibiwe.',
  invalid_terms: 'Kiasi au muda hauruhusiwi. Angalia tena.',
  validation: 'Tafadhali jaza kiasi na muda sahihi.',
  forbidden: 'Hauruhusiwi kufanya hili.',
  server_error: 'Hitilafu ya mfumo. Jaribu tena baadaye.',
};

function tzs(n: number) {
  return `TZS ${Math.round(n).toLocaleString('en-US')}`;
}

export function PhoneLoanRequestForm({
  maxAmount,
  maxMonths,
  interestBps,
}: {
  maxAmount: number;
  maxMonths: number;
  interestBps: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState(String(maxMonths));
  const [device, setDevice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const principal = Number(amount) || 0;
  const termMonths = Number(months) || 1;
  const overMax = principal > maxAmount;

  /*
   * The live quote. Derived on every render, never held in state — a stored
   * quote is a quote that can fall out of step with the box above it.
   * computePhoneLoan THROWS on invalid input rather than clamping, so an
   * out-of-range amount shows no quote at all instead of a plausible wrong one.
   */
  let quote: ReturnType<typeof computePhoneLoan> | null = null;
  if (principal > 0 && !overMax) {
    try {
      quote = computePhoneLoan({ principal, termMonths, interestBps });
    } catch (e) {
      if (!(e instanceof PhoneLoanError)) throw e;
      quote = null;
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await submitPhoneLoanRequest({
        principal: amount,
        termMonths: months,
        deviceDescription: device,
        reason,
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'Ombi halikutumwa. Jaribu tena.');
      }
    } catch {
      // A submit that may or may not have reached the server: say so rather
      // than inviting a second request that the unique index will reject.
      setError('Hitilafu ya mtandao. Angalia ukurasa huu tena kabla ya kutuma upya.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-[--radius-card] border border-[color:var(--color-paid)] bg-[color:var(--color-paid)]/5 p-4"
      >
        <span className="font-semibold text-[color:var(--color-paid)]">
          ✓ Ombi lako limetumwa
        </span>
        <span className="text-sm">
          Uhasibu wataliangalia na Mkurugenzi ataamua. Utaarifiwa kila hatua.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
      <div>
        <h2 className="font-semibold text-primary-dark">Omba mkopo wa simu</h2>
        <p className="text-sm text-muted-foreground">
          Kiwango cha juu {tzs(maxAmount)} · kurejesha ndani ya miezi {maxMonths} · riba{' '}
          {interestBps / 100}%
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Kiasi unachoomba (TZS)</span>
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          max={maxAmount}
          step={1000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Mfano: ${Math.min(250000, maxAmount)}`}
        />
        {overMax && (
          <span role="alert" className="text-sm font-medium text-overdue">
            Kiwango cha juu ni {tzs(maxAmount)}.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Muda wa kurejesha</span>
        <select className="input bg-white" value={months} onChange={(e) => setMonths(e.target.value)}>
          {Array.from({ length: maxMonths }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m === 1 ? 'Mwezi 1' : `Miezi ${m}`}
            </option>
          ))}
        </select>
      </label>

      {/* The terms, before submission — the heart of the request. */}
      {quote && (
        <dl className="flex flex-col gap-1 rounded-[--radius-card] border border-border bg-surface p-3 text-sm">
          <Row label="Kiasi cha mkopo" value={tzs(quote.principal)} />
          <Row label={`Riba (${quote.interestBps / 100}%)`} value={tzs(quote.interestAmount)} />
          <Row label="Jumla utakayolipa" value={tzs(quote.totalAmount)} strong />
          <Row
            label="Kila mwezi"
            value={
              quote.instalments.every((a) => a === quote!.instalments[0])
                ? `${tzs(quote.instalments[0]!)} × ${quote.termMonths}`
                : quote.instalments.map((a) => tzs(a)).join(' + ')
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Malipo ya pikipiki yatasimama mpaka umalize kulipa simu. Siku za pikipiki
            hazipotei — zinaahirishwa hadi mwisho wa mkataba.
          </p>
        </dl>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Simu unayotaka (si lazima)</span>
        <input
          className="input"
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          placeholder="Mfano: Tecno Spark 20"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Sababu (si lazima)</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || !quote}
        onClick={submit}
        className="min-h-12 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Inatuma…' : 'Tuma ombi'}
      </button>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-bold text-primary-dark' : 'font-medium'}>{value}</dd>
    </div>
  );
}
