'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { repriceContract } from '@/lib/contracts/actions';
import {
  computeRepriceMath,
  describeReprice,
  type RepriceSummary,
} from '@/lib/contracts/reprice';
import { instalmentFromDailyRate, explainInstalment } from '@/lib/contracts/pricing';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import type { ScheduleType } from '@/lib/supabase/types';

/*
 * Correcting the repayment amount on a LIVE contract (client feedback
 * 2026-09-22 — the Alfred Francis Msangi case).
 *
 * Deliberately a SEPARATE form from the ordinary editor above it, and worded
 * like an amendment rather than an edit, because that is what it is: every
 * other field on this page changes a description, this one changes what a
 * rider owes on days that already exist. So it asks for a reason, shows the
 * full arithmetic before it will submit, and names the number of days it is
 * about to add.
 *
 * The preview is computed from the SAME pure function the server writes with
 * (`computeRepriceMath`), so what is on screen when the owner presses the
 * button is what lands in the database.
 */
const ERRORS: Record<string, string> = {
  validation: 'Enter a daily rate and a reason of at least 10 characters.',
  locked: 'This contract is locked after completion sign-off. Use the amendment process.',
  not_live: 'Only an active or paused contract can be re-priced here. Use the editor above.',
  missing_dates: 'The contract has no end date, so no payment days can be added.',
  invalid_amount: 'That daily rate does not produce a usable instalment.',
  obligation_reserved:
    'A payment is in flight against one of these days right now. Wait for it to complete or fail, then try again — re-pricing underneath it would strand the rider’s money.',
  read_failed: 'The payment calendar could not be read. Reload and try again.',
  reprice_failed: 'The payment days could not be updated. Reload and check the contract.',
  extension_failed: 'The extra payment days could not be generated. Nothing else was changed.',
  update_failed: 'The contract header could not be saved. Reload and check the contract.',
  not_found: 'That contract no longer exists.',
};

export function ContractRepriceForm({
  contractId,
  scheduleType,
  currentInstalment,
  currentDailyRate,
  endDate,
  summary,
}: {
  contractId: string;
  scheduleType: ScheduleType;
  currentInstalment: number;
  currentDailyRate: number | null;
  endDate: string | null;
  summary: RepriceSummary;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [dailyRate, setDailyRate] = useState(currentDailyRate ? String(currentDailyRate) : '');
  const [recoverShortfall, setRecoverShortfall] = useState(true);
  const [reason, setReason] = useState('');

  const rate = Number(dailyRate) || 0;
  const newInstalment = instalmentFromDailyRate(rate, scheduleType);
  const pricingHint = explainInstalment(rate, scheduleType);
  const math = newInstalment > 0 ? computeRepriceMath(summary, newInstalment) : null;
  const unchanged = newInstalment === currentInstalment;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await repriceContract(contractId, { dailyRate, recoverShortfall, reason });
      if (res.ok) {
        const d = res.data!;
        setDone(
          `Done. ${d.repriced} unpaid payment day(s) re-priced to ${formatTZS(d.plan.newInstalment)}` +
            (d.added > 0 ? `, ${d.added} day(s) added, contract now ends ${formatDate(d.endDate!)}` : '') +
            '.',
        );
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? `The correction failed (${res.error}).`);
      }
    } catch {
      setError('Network error — reload the contract and check it before retrying.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50/40 p-4">
      <div>
        <h2 className="font-semibold text-primary-dark">Correct the repayment amount</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          For a contract that was created with the wrong price. Unpaid payment days are re-priced
          in place — their dates do not move, so arrears keep their clock. Days that have already
          been paid are never changed.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure label="Now charging" value={formatTZS(currentInstalment)} />
        <Figure label="Unpaid days" value={String(summary.unsettledCount)} />
        <Figure label="Settled days" value={String(summary.settledCount)} />
        <Figure label="Ends" value={endDate ? formatDate(endDate) : '—'} />
      </dl>

      {done ? (
        <p role="status" className="rounded-[--radius-card] bg-white p-3 text-sm font-medium text-primary-dark">
          {done}
        </p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-12 self-start rounded-[--radius-card] border border-[color:var(--color-warning)] bg-white px-5 font-semibold text-amber-900"
        >
          Correct the amount
        </button>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Agreed daily rate (TZS)</span>
            <input
              type="number"
              min={1}
              className="input"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Enter the DAILY rate you agreed with the rider. The instalment for this contract’s
              frequency is worked out from it.
            </span>
          </label>

          {pricingHint && (
            <p className="rounded-[--radius-card] bg-white p-2 text-xs text-primary-dark">
              {pricingHint} New instalment: <strong>{formatTZS(newInstalment)}</strong>.
            </p>
          )}

          {math && !unchanged && (
            <div className="flex flex-col gap-2 rounded-[--radius-card] bg-white p-3 text-sm">
              <p className="font-medium text-primary-dark">What this will do</p>
              <p className="text-muted-foreground">{describeReprice(math, recoverShortfall)}</p>
              <dl className="mt-1 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <Figure
                  label="Unpaid total"
                  value={`${formatTZS(math.unsettledTotalBefore)} → ${formatTZS(math.unsettledTotalAfter)}`}
                />
                {math.shortfall > 0 && (
                  <Figure label="Under-collected" value={formatTZS(math.shortfall)} />
                )}
                {recoverShortfall && math.extraPaymentDays > 0 && (
                  <Figure label="Days to add" value={String(math.extraPaymentDays)} />
                )}
                <Figure label="Contract total after" value={formatTZS(math.contractTotalAfter)} />
              </dl>
            </div>
          )}

          {math?.overpaid && (
            <p className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-white p-3 text-sm text-amber-900">
              The rider has already paid <strong>{formatTZS(-math.shortfall)}</strong> more than the
              corrected price on settled days. No payment days will be added — this system keeps no
              rider credit balance on purpose, so settle the difference with the rider directly.
            </p>
          )}

          {math && math.shortfall > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5"
                checked={recoverShortfall}
                onChange={(e) => setRecoverShortfall(e.target.checked)}
              />
              <span>
                Add {math.extraPaymentDays} payment day(s) at the corrected price to recover the{' '}
                {formatTZS(math.shortfall)} under-collected on days already paid. Untick to write it
                off instead.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Reason for the correction</span>
            <textarea
              className="input min-h-20"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Contract was entered at 10,000 per week; the agreed daily rate is 10,000, so the week is 70,000."
            />
            <span className="text-xs text-muted-foreground">
              Recorded in the audit log. At least 10 characters.
            </span>
          </label>

          {unchanged && newInstalment > 0 && (
            <p className="text-sm text-muted-foreground">
              That is the amount the contract already charges — nothing to correct.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-overdue">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || unchanged || newInstalment <= 0 || reason.trim().length < 10}
              className="min-h-12 rounded-[--radius-card] bg-primary px-5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Applying…' : 'Apply the correction'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-12 rounded-[--radius-card] border border-border bg-white px-5 font-semibold"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold text-primary-dark">{value}</dd>
    </div>
  );
}
