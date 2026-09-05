'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateContract } from '@/lib/contracts/actions';
import { WEEKDAY_LABELS } from '@/lib/contracts/validation';
import { resolveContractTerm, type TermInput } from '@/lib/contracts/term';
import { instalmentFromDailyRate, explainInstalment } from '@/lib/contracts/pricing';
import { normalizeDuration } from '@/lib/contracts/duration';
import { formatDate } from '@/lib/dates/format';
import { formatTZS } from '@/lib/money/format';
import type { ScheduleType } from '@/lib/supabase/types';

/*
 * Contract editor (client feedback 2026-09-05): "I should be able to edit an
 * existing contract and its details — for example I may not have entered the
 * correct motorcycle plate number."
 *
 * The form is deliberately in two halves, and says so on screen:
 *   • details that can always be corrected, and
 *   • the term / schedule / price, which are locked once the contract is
 *     ACTIVE because the obligations are the money record by then. The server
 *     enforces the same rule — this is only the explanation.
 */
const ERRORS: Record<string, string> = {
  validation: 'Some fields are invalid — check the highlighted values.',
  locked_after_activation:
    'The term, schedule and amounts cannot be changed once the contract is active — the payment days are already the money record. Use "Extend term" on the contract page, or terminate and re-issue.',
  motorcycle_in_contract: 'That motorcycle is already under another contract.',
  motorcycle_unavailable: 'That motorcycle is inactive and cannot be leased.',
  motorcycle_not_found: 'That motorcycle no longer exists — reload the page.',
  motorcycle_assigned_to_other: 'That motorcycle is assigned to a different rider.',
  invalid_duration: 'That term could not be turned into an end date.',
  invalid_amount: 'Enter a daily rate or an instalment amount greater than 0.',
  missing_dates: 'The contract has no start date — set one before editing the term.',
  not_found: 'That contract no longer exists.',
  update_failed: 'The contract could not be saved. Reload and try again.',
};

export type EditorContract = {
  id: string;
  contractNumber: string;
  status: string;
  motorcycleId: string;
  registration: string;
  startDate: string | null;
  endDate: string | null;
  scheduleType: ScheduleType;
  selectedWeekdays: number[];
  dueDayOfMonth: number | null;
  durationYears: number;
  durationMonths: number;
  durationWeeks: number;
  durationDays: number;
  endDateSource: 'duration' | 'exact' | 'payment_days';
  paymentDaysTarget: number | null;
  dailyRate: number | null;
  installmentAmount: number;
  paymentDeadlineTime: string;
  ownershipTransfers: boolean;
  ownershipTransferNotes: string | null;
  specialTerms: string | null;
  phoneLoan: { principal: number; termMonths: number; interestBps: number } | null;
};

export function ContractEditor({
  contract,
  motorcycles,
  termEditable,
}: {
  contract: EditorContract;
  motorcycles: { id: string; label: string }[];
  termEditable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [motorcycleId, setMotorcycleId] = useState(contract.motorcycleId);
  const [deadline, setDeadline] = useState(contract.paymentDeadlineTime);
  const [ownershipTransfers, setOwnershipTransfers] = useState(contract.ownershipTransfers);
  const [ownershipNotes, setOwnershipNotes] = useState(contract.ownershipTransferNotes ?? '');
  const [specialTerms, setSpecialTerms] = useState(contract.specialTerms ?? '');

  const [startDate, setStartDate] = useState(contract.startDate ?? '');
  const [endDateMode, setEndDateMode] = useState(contract.endDateSource);
  const [exactEndDate, setExactEndDate] = useState(contract.endDate ?? '');
  const [paymentDaysTarget, setPaymentDaysTarget] = useState(
    contract.paymentDaysTarget ? String(contract.paymentDaysTarget) : '',
  );
  const [years, setYears] = useState(String(contract.durationYears));
  const [months, setMonths] = useState(String(contract.durationMonths));
  const [weeks, setWeeks] = useState(String(contract.durationWeeks));
  const [days, setDays] = useState(String(contract.durationDays));
  const [scheduleType, setScheduleType] = useState<ScheduleType>(contract.scheduleType);
  const [weekdays, setWeekdays] = useState<number[]>(contract.selectedWeekdays ?? []);
  const [dueDayOfMonth, setDueDayOfMonth] = useState(
    contract.dueDayOfMonth ? String(contract.dueDayOfMonth) : '',
  );
  const [dailyRate, setDailyRate] = useState(contract.dailyRate ? String(contract.dailyRate) : '');
  const [extendForPaymentDays, setExtendForPaymentDays] = useState(true);

  const derivedInstalment = instalmentFromDailyRate(Number(dailyRate), scheduleType);
  const pricingHint = explainInstalment(Number(dailyRate), scheduleType);

  const termInput: TermInput | null = startDate
    ? {
        startDate,
        duration: normalizeDuration({ years, months, weeks, days }),
        endDateMode,
        exactEndDate: endDateMode === 'exact' ? exactEndDate : null,
        paymentDaysTarget: Number(paymentDaysTarget) || null,
        scheduleType,
        selectedWeekdays: scheduleType === 'weekly' ? weekdays.slice(0, 1) : weekdays,
        extendForPaymentDays,
        phoneLoan: contract.phoneLoan,
      }
    : null;
  let preview: ReturnType<typeof resolveContractTerm> | null = null;
  let previewError: string | null = null;
  try {
    preview = termInput && termEditable ? resolveContractTerm(termInput) : null;
  } catch (e) {
    previewError = e instanceof Error ? e.message : 'Could not compute the term.';
  }

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateContract(contract.id, {
        motorcycleId,
        paymentDeadlineTime: deadline,
        ownershipTransfers,
        ownershipTransferNotes: ownershipNotes,
        specialTerms,
        ...(termEditable
          ? {
              startDate,
              endDateMode,
              exactEndDate: endDateMode === 'exact' ? exactEndDate : '',
              paymentDaysTarget: endDateMode === 'payment_days' ? paymentDaysTarget : '',
              extendForPaymentDays,
              durationYears: years,
              durationMonths: months,
              durationWeeks: weeks,
              durationDays: days,
              scheduleType,
              selectedWeekdays: scheduleType === 'selected_weekdays' ? weekdays : [],
              weeklyWeekday: scheduleType === 'weekly' ? (weekdays[0] ?? 0) : '',
              dueDayOfMonth: scheduleType === 'monthly' ? dueDayOfMonth : '',
              dailyRate,
              installmentAmount: derivedInstalment || contract.installmentAmount,
            }
          : {}),
      });
      if (res.ok) {
        router.push(`/owner/contracts/${contract.id}`);
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? `Could not save the contract (${res.error}).`);
      }
    } catch {
      setError('Network error — reload the contract before retrying.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Details</h2>
        <p className="text-xs text-muted-foreground">
          These can be corrected at any time — none of them change what anyone owes.
        </p>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Motorcycle</span>
          <select className="input bg-white" value={motorcycleId} onChange={(e) => setMotorcycleId(e.target.value)}>
            <option value={contract.motorcycleId}>{contract.registration} (current)</option>
            {motorcycles
              .filter((m) => m.id !== contract.motorcycleId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </select>
          <span className="text-xs text-muted-foreground">
            To fix a wrong plate number on the SAME bike, edit the motorcycle record instead —
            changing it here swaps the contract onto a different motorcycle.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Payment deadline</span>
          <input type="time" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={ownershipTransfers}
            onChange={(e) => setOwnershipTransfers(e.target.checked)}
          />
          <span>Ownership transfers to rider at completion</span>
        </label>
        {ownershipTransfers && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Ownership transfer notes</span>
            <textarea className="input min-h-20" value={ownershipNotes} onChange={(e) => setOwnershipNotes(e.target.value)} />
          </label>
        )}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Special terms</span>
          <textarea className="input min-h-20" value={specialTerms} onChange={(e) => setSpecialTerms(e.target.value)} />
        </label>
      </section>

      <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Term, schedule and amount</h2>
        {!termEditable ? (
          <p className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3 text-sm text-amber-900">
            This contract is <strong>{contract.status}</strong>, so its payment days already exist and
            ARE the money record. Changing the term or the price underneath them would restate
            settled history. Use <strong>Extend term</strong> on the contract page to add days, or
            terminate and issue a new contract.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Start date</span>
              <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Set the end date by</span>
              <select
                className="input bg-white"
                value={endDateMode}
                onChange={(e) => setEndDateMode(e.target.value as typeof endDateMode)}
              >
                <option value="duration">Duration (years / months / weeks / days)</option>
                <option value="payment_days">Number of payment days</option>
                <option value="exact">Exact end date</option>
              </select>
            </label>

            {endDateMode === 'duration' && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumberField label="Years" value={years} onChange={setYears} />
                <NumberField label="Months" value={months} onChange={setMonths} />
                <NumberField label="Weeks" value={weeks} onChange={setWeeks} />
                <NumberField label="Days" value={days} onChange={setDays} />
              </div>
            )}
            {endDateMode === 'payment_days' && (
              <NumberField label="Payment days" value={paymentDaysTarget} onChange={setPaymentDaysTarget} />
            )}
            {endDateMode === 'exact' && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">End date</span>
                <input
                  type="date"
                  className="input"
                  min={startDate}
                  value={exactEndDate}
                  onChange={(e) => setExactEndDate(e.target.value)}
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Payment frequency</span>
              <select
                className="input bg-white"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
              >
                <option value="daily">Daily — every day</option>
                <option value="weekly">Weekly — one day a week</option>
                <option value="monthly">Monthly — one payment a month</option>
                <option value="selected_weekdays">Custom — chosen weekdays</option>
              </select>
            </label>

            {(scheduleType === 'selected_weekdays' || scheduleType === 'weekly') && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  {scheduleType === 'weekly' ? 'Payment day' : 'Payment weekdays'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() =>
                        scheduleType === 'weekly' ? setWeekdays([day]) : toggleWeekday(day)
                      }
                      className={`min-h-11 rounded-[--radius-card] border px-3 text-sm font-semibold ${
                        weekdays.includes(day)
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-white text-muted-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {scheduleType === 'selected_weekdays' && (
                  <label className="mt-1 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5"
                      checked={extendForPaymentDays}
                      onChange={(e) => setExtendForPaymentDays(e.target.checked)}
                    />
                    <span>Extend the end date until every payment day has been collected</span>
                  </label>
                )}
              </div>
            )}

            {scheduleType === 'monthly' && (
              <NumberField label="Monthly due day (1–31)" value={dueDayOfMonth} onChange={setDueDayOfMonth} />
            )}

            <NumberField label="Daily rate (TZS)" value={dailyRate} onChange={setDailyRate} />
            {pricingHint && (
              <p className="rounded-[--radius-card] bg-surface p-2 text-xs text-primary-dark">
                {pricingHint} Instalment saved: {formatTZS(derivedInstalment || contract.installmentAmount)}.
              </p>
            )}

            <div className="rounded-[--radius-card] bg-surface p-2 text-sm">
              {preview ? (
                <>
                  <p>
                    New term: <strong>{formatDate(preview.startDate)}</strong> →{' '}
                    <strong>{formatDate(preview.endDate)}</strong>
                  </p>
                  {preview.paymentDays && preview.paymentDays.extraCalendarDays > 0 && (
                    <p className="mt-1 text-xs text-primary-dark">
                      Extended {preview.paymentDays.extraCalendarDays} calendar day(s) so all{' '}
                      {preview.paymentDays.targetDays} payment days are collected.
                    </p>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {previewError ?? 'Enter a start date and a term to preview the end date.'}
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="min-h-12 rounded-[--radius-card] bg-primary px-5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <Link
          href={`/owner/contracts/${contract.id}`}
          className="flex min-h-12 items-center rounded-[--radius-card] border border-border px-5 font-semibold"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        min={0}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
