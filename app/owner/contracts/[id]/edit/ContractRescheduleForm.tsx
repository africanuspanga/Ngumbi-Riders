'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { rescheduleContract } from '@/lib/contracts/actions';
import { rescheduleMath } from '@/lib/contracts/reschedule';
import { instalmentFromDailyRate, explainInstalment } from '@/lib/contracts/pricing';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import type { ScheduleType } from '@/lib/supabase/types';

/*
 * Change how often a LIVE contract is paid — daily → weekly, daily → monthly
 * and back (client feedback 2026-10-29, D-055).
 *
 * Only the days still to come are re-cut. Today, arrears and paid days stay as
 * they are, and the rider owes exactly the same amount for the rest of the
 * lease before and after — the preview shows that figure on both sides, and
 * the database refuses the change if it does not hold.
 */
const ERRORS: Record<string, string> = {
  validation: 'Choose a frequency, a daily rate and a reason of at least 10 characters.',
  unchanged: 'That is already how this contract is paid.',
  locked: 'This contract is locked after completion sign-off. Use the amendment process.',
  not_live: 'Only an active or paused contract can change frequency here.',
  invalid_amount: 'That daily rate does not produce a usable instalment.',
  invalid_cadence: 'Pick the weekday (weekly), the weekdays, or the due day of the month (monthly).',
  nothing_to_reschedule: 'There are no future payment days left to change on this contract.',
  no_free_dates: 'Could not find free dates for the new schedule. Contact support.',
  obligation_reserved:
    'A payment is in progress against one of these days. Wait for it to finish, then try again.',
  stale: 'A payment landed while you were editing. Reload the page and try again.',
  read_failed: 'The payment calendar could not be read. Reload and try again.',
  reschedule_failed: 'The change could not be saved. Nothing was changed — reload and try again.',
  not_found: 'That contract no longer exists.',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCIES: { value: ScheduleType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'selected_weekdays', label: 'Selected weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const PER: Record<ScheduleType, string> = {
  daily: 'day',
  selected_weekdays: 'payment day',
  weekly: 'week',
  monthly: 'month',
};

export function ContractRescheduleForm({
  contractId,
  scheduleType,
  selectedWeekdays,
  dueDayOfMonth,
  currentInstalment,
  currentDailyRate,
  summary,
}: {
  contractId: string;
  scheduleType: ScheduleType;
  selectedWeekdays: number[];
  dueDayOfMonth: number | null;
  currentInstalment: number;
  currentDailyRate: number | null;
  summary: { count: number; total: number; firstDate: string | null; lastDate: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [frequency, setFrequency] = useState<ScheduleType>(
    scheduleType === 'daily' ? 'weekly' : 'daily',
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    selectedWeekdays.length ? selectedWeekdays : [1],
  );
  const [dueDay, setDueDay] = useState(String(dueDayOfMonth ?? 1));
  const [dailyRate, setDailyRate] = useState(currentDailyRate ? String(currentDailyRate) : '');
  const [reason, setReason] = useState('');

  const rate = Number(dailyRate) || 0;
  const instalment = instalmentFromDailyRate(rate, frequency);
  const pricingHint = explainInstalment(rate, frequency);
  const math = instalment > 0 && summary.total > 0 ? rescheduleMath(summary.total, instalment) : null;

  function toggleWeekday(d: number) {
    if (frequency === 'weekly') {
      setWeekdays([d]);
      return;
    }
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  const cadenceReady =
    frequency === 'weekly'
      ? weekdays.length >= 1
      : frequency === 'selected_weekdays'
        ? weekdays.length >= 1
        : frequency === 'monthly'
          ? Number(dueDay) >= 1 && Number(dueDay) <= 31
          : true;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await rescheduleContract(contractId, {
        scheduleType: frequency,
        selectedWeekdays:
          frequency === 'weekly' ? weekdays.slice(0, 1) : frequency === 'selected_weekdays' ? weekdays : [],
        dueDayOfMonth: frequency === 'monthly' ? Number(dueDay) : null,
        dailyRate,
        reason,
      });
      if (res.ok) {
        const d = res.data!;
        setDone(
          `Done. The rider now pays ${formatTZS(d.instalment)} per ${PER[frequency]}` +
            ` — ${d.instalmentCount} payment(s), first on ${formatDate(d.firstDate)}` +
            (d.lastAmount !== d.instalment ? `, the last one ${formatTZS(d.lastAmount)}` : '') +
            `. Contract now ends ${formatDate(d.endDate)}. Still owed for the rest of the lease: ${formatTZS(d.scopeTotal)} (unchanged).`,
        );
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? `The change failed (${res.error}).`);
      }
    } catch {
      setError('Network error — reload the contract and check it before retrying.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-(--radius-card) border border-border bg-white p-4">
      <div>
        <h2 className="font-semibold text-primary-dark">Change payment frequency</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Switch this contract between daily, weekly and monthly payments. Only the payment days
          still to come are changed. Today, missed days and paid days stay as they are, and the
          rider owes the same total for the rest of the lease.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure
          label="Now"
          value={`${FREQUENCIES.find((f) => f.value === scheduleType)?.label ?? scheduleType} · ${formatTZS(currentInstalment)}`}
        />
        <Figure label="Future days" value={String(summary.count)} />
        <Figure label="Still owed on them" value={formatTZS(summary.total)} />
        <Figure label="Last day" value={summary.lastDate ? formatDate(summary.lastDate) : '—'} />
      </dl>

      {done ? (
        <p role="status" className="rounded-(--radius-card) bg-surface p-3 text-sm font-medium text-primary-dark">
          {done}
        </p>
      ) : summary.count === 0 ? (
        <p className="text-sm text-muted-foreground">
          There are no future payment days left to change on this contract.
        </p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-12 self-start rounded-(--radius-card) bg-primary px-5 font-semibold text-white hover:bg-primary-hover"
        >
          Change frequency
        </button>
      ) : (
        <>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1.5 font-medium">New frequency</legend>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={frequency === f.value}
                  onClick={() => {
                    setFrequency(f.value);
                    if (f.value === 'weekly') setWeekdays((w) => w.slice(0, 1).length ? w.slice(0, 1) : [1]);
                  }}
                  className={`min-h-11 rounded-(--radius-card) border px-4 font-semibold ${
                    frequency === f.value
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-white text-primary-dark'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </fieldset>

          {(frequency === 'weekly' || frequency === 'selected_weekdays') && (
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="mb-1.5 font-medium">
                {frequency === 'weekly' ? 'Pay every' : 'Pay on'}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w, i) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={weekdays.includes(i)}
                    onClick={() => toggleWeekday(i)}
                    className={`min-h-11 min-w-12 rounded-(--radius-card) border px-2 text-sm font-semibold ${
                      weekdays.includes(i)
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-white text-primary-dark'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {frequency === 'monthly' && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Due day of the month</span>
              <input
                type="number"
                min={1}
                max={31}
                className="input max-w-32"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">31 means the last day of each month.</span>
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Agreed daily rate (TZS)</span>
            <input
              type="number"
              min={1}
              className="input"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
            />
            {pricingHint && <span className="text-xs text-muted-foreground">{pricingHint}</span>}
          </label>

          {math && (
            <div className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-3 text-sm">
              <p className="font-medium text-primary-dark">What this will do</p>
              <p className="text-muted-foreground">
                The {summary.count} future payment day(s) ({formatTZS(summary.total)}) become{' '}
                <strong>{math.instalmentCount}</strong> payment(s) of{' '}
                <strong>{formatTZS(instalment)}</strong> per {PER[frequency]}
                {math.lastAmount !== instalment && (
                  <>
                    , with a smaller last payment of <strong>{formatTZS(math.lastAmount)}</strong>
                  </>
                )}
                , starting on the first matching day after today. The rider still owes{' '}
                {formatTZS(summary.total)} for the rest of the lease — nothing added, nothing
                forgiven. Today, missed days and paid days are not changed.
              </p>
            </div>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Reason for the change</span>
            <textarea
              className="input min-h-20"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Rider asked to pay weekly from November; agreed with the owner."
            />
            <span className="text-xs text-muted-foreground">
              Recorded in the audit log. At least 10 characters.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm font-medium text-overdue">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !math || !cadenceReady || reason.trim().length < 10}
              className="min-h-12 rounded-(--radius-card) bg-primary px-5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Change frequency'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-12 rounded-(--radius-card) border border-border bg-white px-5 font-semibold"
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
