'use client';

import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  contractBuilderSchema,
  type ContractBuilderInput,
  type ContractBuilderFormInput,
  WEEKDAY_LABELS,
} from '@/lib/contracts/validation';
import { createContract } from '@/lib/contracts/actions';
import { scheduleSummary } from '@/lib/obligations/schedule';
import {
  formatDuration,
  monthlyInstalmentCount,
  normalizeDuration,
} from '@/lib/contracts/duration';
import { resolveContractTerm, endDateWithoutPhoneLoan, type TermInput } from '@/lib/contracts/term';
import { instalmentFromDailyRate, explainInstalment } from '@/lib/contracts/pricing';
import { describePhoneLoan } from '@/lib/loans/phone';
import { formatLongDate } from '@/lib/dates/format';
import { summarizePlan, type PlanEntry, type PlanFrequency } from '@/lib/obligations/plan';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { TextField, SelectField, TextAreaField } from '@/components/forms/Field';
import { PaymentPlanBuilder } from './PaymentPlanBuilder';

// Server-side createContract rejections mapped to owner-facing copy.
const CONTRACT_ERRORS: Record<string, string> = {
  motorcycle_assigned_to_other:
    'That motorcycle is assigned to a different rider. Pick the rider it is assigned to, or release the assignment on their rider page first.',
  motorcycle_in_contract: 'That motorcycle is already under a contract.',
  motorcycle_unavailable: 'That motorcycle is inactive and cannot be leased.',
  motorcycle_not_found: 'That motorcycle no longer exists — reload and try again.',
  invalid_duration:
    'That term could not be turned into an end date. Check the duration or enter an exact end date.',
  invalid_amount: 'Enter the daily rate (or an instalment amount greater than 0).',
  phone_loan_failed: 'The phone loan could not be created. Nothing was saved — try again.',
  plan_empty: 'The payment plan has no payments selected.',
  plan_out_of_term: 'The plan has payment dates outside the contract term.',
  plan_duplicate_dates: 'The plan has two payments on the same date.',
  plan_too_long: 'That plan has too many payments.',
};

type Option = { id: string; label: string };
type MotoOption = {
  id: string;
  label: string;
  assignedRiderId: string | null;
  assignedRiderLabel: string | null;
};

export function ContractBuilder({
  riders,
  motorcycles,
  defaultAmount,
  phoneLoanByRider = {},
}: {
  riders: Option[];
  motorcycles: MotoOption[];
  defaultAmount: number;
  /** riderId → requested phone-loan amount (null = asked but no amount given). */
  phoneLoanByRider?: Record<string, number | null>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContractBuilderFormInput, unknown, ContractBuilderInput>({
    resolver: zodResolver(contractBuilderSchema),
    defaultValues: {
      scheduleType: 'daily',
      selectedWeekdays: [],
      ownershipTransfers: false,
      installmentAmount: defaultAmount || undefined,
      paymentDeadlineTime: '18:00',
      durationYears: 0,
      durationMonths: 0,
      durationWeeks: 0,
      durationDays: 0,
      endDateMode: 'duration',
      extendForPaymentDays: true,
      includePhoneLoan: false,
      phoneLoanMonths: 3,
    },
  });

  // The owner-edited payment plan (#1). Held outside RHF because it is a table
  // of rows the user edits directly, then submitted with the form.
  const [plan, setPlan] = useState<PlanEntry[] | null>(null);

  const values = useWatch({ control });
  const weekdays = values.selectedWeekdays ?? [];
  const scheduleType = values.scheduleType ?? 'daily';
  const endDateMode = values.endDateMode ?? 'duration';
  const duration = normalizeDuration({
    years: values.durationYears,
    months: values.durationMonths,
    weeks: values.durationWeeks,
    days: values.durationDays,
  });
  const monthsLabel = duration.months || duration.years ? String(duration.years * 12 + duration.months) : 'N';

  // Weekly defaults its payment day to the contract's start weekday (owner can
  // change it). Set a concrete value AS SOON AS weekly is chosen — otherwise the
  // native <select> visibly shows "Sun" while the form value stays undefined,
  // and the contract is rejected on submit for a field that looks filled.
  useEffect(() => {
    if (
      scheduleType === 'weekly' &&
      (values.weeklyWeekday === undefined || (values.weeklyWeekday as unknown) === '')
    ) {
      const wd = values.startDate
        ? new Date(`${values.startDate}T00:00:00Z`).getUTCDay()
        : 0; // matches the first option the select already shows
      setValue('weeklyWeekday', wd, { shouldValidate: true });
    }
  }, [scheduleType, values.startDate, values.weeklyWeekday, setValue]);

  // The applicant answered "motorcycle + phone" on their application — surface
  // it the moment that rider is selected, rather than relying on the owner to
  // remember what someone asked for weeks earlier.
  const selectedRiderWantsPhone =
    values.riderId !== undefined && values.riderId in phoneLoanByRider;
  const requestedPhoneAmount = values.riderId ? phoneLoanByRider[values.riderId] : null;

  // A bike already assigned to a rider can only be leased to THAT rider, so it
  // only appears once that rider is selected. Available (unassigned) bikes
  // always appear. Bikes assigned to a different rider are surfaced as a hint.
  const selectedRiderId = values.riderId;
  const visibleMotorcycles = motorcycles.filter(
    (m) => m.assignedRiderId === null || m.assignedRiderId === selectedRiderId,
  );
  const assignedToOthers = motorcycles.filter(
    (m) => m.assignedRiderId !== null && m.assignedRiderId !== selectedRiderId,
  );

  function toggleWeekday(day: number) {
    const next = weekdays.includes(day)
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].sort();
    setValue('selectedWeekdays', next, { shouldValidate: true });
  }

  const scheduleWeekdays =
    scheduleType === 'weekly'
      ? values.weeklyWeekday === undefined || (values.weeklyWeekday as unknown) === ''
        ? []
        : [Number(values.weeklyWeekday)]
      : weekdays;
  const frequency: PlanFrequency =
    scheduleType === 'selected_weekdays' ? 'custom' : (scheduleType as PlanFrequency);

  // The instalment is DERIVED from the daily rate: 10,000/day → 70,000/week,
  // 300,000/month. The owner enters one number, not two (client feedback).
  const dailyRate = Number(values.dailyRate) || 0;
  const derivedInstalment = instalmentFromDailyRate(dailyRate, scheduleType);
  const pricingHint = explainInstalment(dailyRate, scheduleType);
  useEffect(() => {
    if (derivedInstalment > 0 && Number(values.installmentAmount) !== derivedInstalment) {
      setValue('installmentAmount', derivedInstalment, { shouldValidate: true });
    }
  }, [derivedInstalment, values.installmentAmount, setValue]);

  // The whole term — duration, phone loan and payment-day extension — resolved
  // by the SAME function the server calls, so the preview cannot disagree with
  // what gets saved.
  const phoneLoanInput =
    values.includePhoneLoan && Number(values.phoneLoanAmount) > 0
      ? {
          principal: Number(values.phoneLoanAmount),
          termMonths: Number(values.phoneLoanMonths) || 3,
        }
      : null;
  const termInput: TermInput | null = values.startDate
    ? {
        startDate: values.startDate,
        duration,
        endDateMode,
        exactEndDate: (values.exactEndDate as string) || null,
        paymentDaysTarget: Number(values.paymentDaysTarget) || null,
        scheduleType,
        selectedWeekdays: scheduleWeekdays,
        extendForPaymentDays: values.extendForPaymentDays ?? true,
        phoneLoan: phoneLoanInput,
      }
    : null;

  let term: ReturnType<typeof resolveContractTerm> | null = null;
  let termError: string | null = null;
  try {
    term = termInput ? resolveContractTerm(termInput) : null;
  } catch (e) {
    term = null;
    termError = e instanceof Error ? e.message : null;
  }
  const computedEndDate = term?.endDate ?? null;
  const withoutPhone = termInput && phoneLoanInput ? endDateWithoutPhoneLoan(termInput) : null;

  // Live preview (spec §10.3 step 3). An edited plan is authoritative; otherwise
  // the cadence engine is asked. Both throw until fully specified → no preview.
  let preview: { count: number; total: number; endDate: string } | null = null;
  try {
    const amount = Number(values.installmentAmount);
    if (values.startDate && computedEndDate && amount) {
      if (plan) {
        const { count, total } = summarizePlan(plan);
        preview = { count, total, endDate: computedEndDate };
      } else {
        const deadline = values.paymentDeadlineTime || '18:00';
        const dueDay = scheduleType === 'monthly' ? Number(values.dueDayOfMonth) : undefined;
        const { count, total } = scheduleSummary(
          {
            startDate: term?.leaseStartDate ?? values.startDate,
            endDate: computedEndDate,
            scheduleType,
            selectedWeekdays: scheduleWeekdays,
            dueDayOfMonth: dueDay,
            monthlyCount:
              scheduleType === 'monthly' && dueDay
                ? monthlyInstalmentCount({
                    startDate: term?.leaseStartDate ?? values.startDate,
                    endDate: computedEndDate,
                    duration,
                    dueDayOfMonth: dueDay,
                  })
                : undefined,
            deadlineTime: deadline,
          },
          amount,
        );
        preview = { count, total, endDate: computedEndDate };
      }
    }
  } catch {
    preview = null;
  }

  async function onSubmit(v: ContractBuilderInput) {
    setError(null);
    try {
      const res = await createContract({ ...v, paymentPlan: plan ?? undefined });
      if (res.ok && res.data) {
        router.push(`/owner/contracts/${res.data.id}`);
        router.refresh();
      } else {
        setError(
          !res.ok
            ? CONTRACT_ERRORS[res.error] ?? 'Could not create the contract. Check the fields.'
            : 'Could not create the contract. Check the fields.',
        );
      }
    } catch {
      setError('Network error — check the contract register before retrying.');
    }
  }

  // Safety net: if validation fails on a field that is not currently rendered
  // (e.g. a stale value left behind after switching schedule types), the field
  // error would be invisible and the button would appear dead. Always surface
  // SOMETHING at the form level.
  function onInvalid() {
    setError('Some fields are invalid — check the highlighted fields (including the schedule settings).');
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex flex-col gap-5">
      {motorcycles.length === 0 && (
        <p role="alert" className="rounded-[--radius-card] border border-warning bg-surface p-3 text-sm text-primary-dark">
          No motorcycles are free to lease. A bike appears here when it is{' '}
          <em>available</em>, or already assigned to a rider but not yet under a
          contract; bikes that are inactive or under a live contract are hidden.{' '}
          <Link href="/owner/motorcycles" className="font-semibold underline">
            Check the motorcycle register
          </Link>{' '}
          — or register one at{' '}
          <Link href="/owner/motorcycles/new" className="font-semibold underline">
            Add motorcycle
          </Link>
          .
        </p>
      )}
      {riders.length === 0 && (
        <p role="alert" className="rounded-[--radius-card] border border-warning bg-surface p-3 text-sm text-primary-dark">
          No eligible riders (only <em>active</em> or <em>onboarding</em> riders
          can hold a contract).{' '}
          <Link href="/owner/riders" className="font-semibold underline">
            Open the rider register
          </Link>
          .
        </p>
      )}
      <SelectField label="Rider" required error={errors.riderId?.message} defaultValue="" {...register('riderId')}>
        <option value="" disabled>Select rider…</option>
        {riders.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </SelectField>
      <SelectField label="Motorcycle" required error={errors.motorcycleId?.message} defaultValue="" {...register('motorcycleId')}>
        <option value="" disabled>Select motorcycle…</option>
        {visibleMotorcycles.map((m) => (
          <option key={m.id} value={m.id}>
            {m.assignedRiderId ? `${m.label} — already assigned to this rider` : m.label}
          </option>
        ))}
      </SelectField>
      {assignedToOthers.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Hidden: {assignedToOthers.map((m) => `${m.label} (assigned to ${m.assignedRiderLabel})`).join('; ')}.
          A bike assigned to a rider can only be leased to that rider — select
          them, or release the assignment on their rider page first.
        </p>
      )}

      <TextField label="Start date" type="date" required error={errors.startDate?.message} {...register('startDate')} />

      {/* Flexible contract duration (#9) */}
      <fieldset className="flex flex-col gap-3 rounded-[--radius-card] border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-muted-foreground">Contract length</legend>

        <SelectField label="Set the end date by" {...register('endDateMode')}>
          <option value="duration">Duration (years / months / weeks / days)</option>
          <option value="payment_days">Number of payment days</option>
          <option value="exact">Exact end date</option>
        </SelectField>

        {endDateMode === 'payment_days' ? (
          <>
            <TextField
              label="Payment days"
              type="number"
              min={1}
              max={3650}
              required
              error={errors.paymentDaysTarget?.message}
              {...register('paymentDaysTarget')}
            />
            <p className="text-xs text-muted-foreground">
              The contract runs until this many PAYMENT DAYS have fallen. With
              custom weekdays that is longer than the same number of calendar
              days — e.g. 28 payment days paid six days a week ends four days
              later than 28 calendar days would.
            </p>
          </>
        ) : endDateMode === 'duration' ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TextField label="Years" type="number" min={0} max={10} error={errors.durationYears?.message} {...register('durationYears')} />
              <TextField label="Months" type="number" min={0} max={600} error={errors.durationMonths?.message} {...register('durationMonths')} />
              <TextField label="Weeks" type="number" min={0} max={520} error={errors.durationWeeks?.message} {...register('durationWeeks')} />
              <TextField label="Days" type="number" min={0} max={3650} error={errors.durationDays?.message} {...register('durationDays')} />
            </div>
            <p className="text-xs text-muted-foreground">
              Combine units freely — e.g. 3 months, 12 weeks, 90 days, or
              &ldquo;6 months, 1 week and 4 days&rdquo;. Months are real calendar
              months (never a flat 30 days) and leap years are handled.
            </p>
          </>
        ) : (
          <TextField
            label="End date"
            type="date"
            required
            min={values.startDate}
            error={errors.exactEndDate?.message}
            hint="Use this when the term must end on a specific day."
            {...register('exactEndDate')}
          />
        )}

        <div className="rounded-[--radius-card] bg-surface p-2 text-sm">
          {computedEndDate && term ? (
            <>
              <p>
                Term: <strong className="text-primary-dark">{formatDate(values.startDate)}</strong> →{' '}
                <strong className="text-primary-dark">{formatDate(computedEndDate)}</strong>
                {endDateMode === 'duration' && ` · ${formatDuration(duration)}`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ends {formatLongDate(computedEndDate)}.
              </p>
              {term.leaseStartDate !== term.startDate && (
                <p className="mt-1 text-xs text-primary-dark">
                  Phone loan is collected first · motorcycle payments start{' '}
                  <strong>{formatDate(term.leaseStartDate)}</strong>
                  {withoutPhone ? ` (without the phone the contract would end ${formatDate(withoutPhone)})` : ''}.
                </p>
              )}
              {term.paymentDays && term.paymentDays.extraCalendarDays > 0 && (
                <p className="mt-1 text-xs text-primary-dark">
                  {term.paymentDays.targetDays} payment days on the chosen weekdays takes{' '}
                  {term.paymentDays.extraCalendarDays} extra calendar day
                  {term.paymentDays.extraCalendarDays === 1 ? '' : 's'} — the end date has been
                  extended from {formatDate(term.baseEndDate)}.
                </p>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              {termError ?? 'Enter a start date and a term to see the calculated end date.'}
            </span>
          )}
        </div>
      </fieldset>

      <SelectField label="Payment frequency" required error={errors.scheduleType?.message} {...register('scheduleType')}>
        <option value="daily">Daily — every day</option>
        <option value="weekly">Weekly — one day a week</option>
        <option value="monthly">Monthly — one payment a month</option>
        <option value="selected_weekdays">Custom — chosen weekdays</option>
      </SelectField>

      {scheduleType === 'selected_weekdays' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Weekdays</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleWeekday(day)}
                className={`min-h-11 rounded-[--radius-card] border px-3 text-sm font-semibold ${
                  weekdays.includes(day) ? 'border-primary bg-primary text-white' : 'border-border bg-white text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {errors.selectedWeekdays && (
            <span className="text-xs text-overdue">{errors.selectedWeekdays.message}</span>
          )}
          <label className="mt-1 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5" {...register('extendForPaymentDays')} />
            <span>
              Extend the end date until every payment day has been collected
              <span className="block text-xs text-muted-foreground">
                {weekdays.length > 0
                  ? `${weekdays.length} payment day${weekdays.length === 1 ? '' : 's'} a week — the term runs on until the full number of payment days has fallen.`
                  : 'Choose the weekdays above.'}
              </span>
            </span>
          </label>
        </div>
      )}

      {scheduleType === 'weekly' && (
        <SelectField label="Payment day (weekly)" required error={errors.weeklyWeekday?.message} {...register('weeklyWeekday')}>
          {WEEKDAY_LABELS.map((label, day) => (
            <option key={day} value={day}>{label}</option>
          ))}
        </SelectField>
      )}

      {scheduleType === 'monthly' && (
        <div className="flex flex-col gap-1.5">
          <TextField
            label="Monthly due day"
            type="number"
            min={1}
            max={31}
            required
            error={errors.dueDayOfMonth?.message}
            {...register('dueDayOfMonth')}
          />
          <span className="text-xs text-muted-foreground">
            Day of the month the payment is due (1–31). Enter <strong>31</strong> for the last day of the month.
            One obligation per month; a {monthsLabel}-month contract makes {monthsLabel} monthly payments.
          </span>
        </div>
      )}

      <fieldset className="flex flex-col gap-3 rounded-[--radius-card] border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-muted-foreground">Payment amount</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Daily rate (TZS)"
            type="number"
            min={1}
            error={errors.dailyRate?.message}
            hint="The agreed rate per day. Weekly and monthly instalments are calculated from it."
            {...register('dailyRate')}
          />
          <TextField
            label={
              scheduleType === 'weekly'
                ? 'Weekly instalment (TZS)'
                : scheduleType === 'monthly'
                  ? 'Monthly instalment (TZS)'
                  : 'Instalment amount (TZS)'
            }
            type="number"
            min={1}
            required
            error={errors.installmentAmount?.message}
            {...register('installmentAmount')}
          />
        </div>
        {pricingHint && (
          <p className="rounded-[--radius-card] bg-surface p-2 text-xs text-primary-dark">
            {pricingHint}
          </p>
        )}
        <TextField label="Payment deadline" type="time" required error={errors.paymentDeadlineTime?.message} {...register('paymentDeadlineTime')} />
      </fieldset>

      {/* Phone loan — motorcycle only, or motorcycle + phone? */}
      <fieldset className="flex flex-col gap-3 rounded-[--radius-card] border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-muted-foreground">Phone loan</legend>
        {selectedRiderWantsPhone && !values.includePhoneLoan && (
          <p className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-2 text-xs text-amber-900">
            This rider asked for a motorcycle <strong>and a phone</strong> on their application
            {requestedPhoneAmount ? ` (${formatTZS(requestedPhoneAmount)})` : ''}. Tick the box below
            to add the phone loan.
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" {...register('includePhoneLoan')} />
          <span>
            Motorcycle <strong>and</strong> phone
            <span className="block text-xs text-muted-foreground">
              The phone loan is repaid first; motorcycle payments start once it is cleared.
            </span>
          </span>
        </label>
        {values.includePhoneLoan && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="Loan amount (TZS)"
                type="number"
                min={1}
                required
                error={errors.phoneLoanAmount?.message}
                {...register('phoneLoanAmount')}
              />
              <TextField
                label="Repayment (months)"
                type="number"
                min={1}
                max={3}
                error={errors.phoneLoanMonths?.message}
                hint="Maximum 3"
                {...register('phoneLoanMonths')}
              />
              <TextField
                label="Phone (optional)"
                error={errors.phoneDescription?.message}
                {...register('phoneDescription')}
              />
            </div>
            {term?.phoneLoan && (
              <div className="rounded-[--radius-card] bg-surface p-2 text-xs">
                <p className="font-semibold text-primary-dark">{describePhoneLoan(term.phoneLoan)}</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                  {term.phoneInstalments.map((i) => (
                    <li key={i.dueDate}>
                      Instalment {i.index}: {formatDate(i.dueDate)} · {formatTZS(i.amount)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-primary-dark">
                  Adds {term.phoneLoanExtraMonths} month
                  {term.phoneLoanExtraMonths === 1 ? '' : 's'} to the contract.
                </p>
              </div>
            )}
          </>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" {...register('ownershipTransfers')} />
        <span>Ownership transfers to rider at completion</span>
      </label>
      {values.ownershipTransfers && (
        <TextAreaField label="Ownership transfer notes" error={errors.ownershipTransferNotes?.message} {...register('ownershipTransferNotes')} />
      )}
      <TextAreaField label="Special terms" error={errors.specialTerms?.message} {...register('specialTerms')} />

      {/* Bulk payment-plan generator (#1) */}
      <PaymentPlanBuilder
        startDate={term?.leaseStartDate ?? values.startDate ?? ''}
        endDate={computedEndDate ?? ''}
        amount={Number(values.installmentAmount) || 0}
        frequency={frequency}
        weekdays={scheduleWeekdays}
        dueDayOfMonth={scheduleType === 'monthly' ? Number(values.dueDayOfMonth) || undefined : undefined}
        plan={plan}
        onChange={setPlan}
      />

      {preview && (
        <div className="rounded-[--radius-card] border border-primary bg-surface p-4 text-sm">
          <p className="font-semibold text-primary-dark">Preview</p>
          <p className="text-foreground">
            {preview.count} payment{preview.count === 1 ? '' : 's'} · total{' '}
            {formatTZS(preview.total)} · ends {formatDate(preview.endDate)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {plan
              ? 'Using the generated plan above — the exact dates and amounts listed there will be created.'
              : 'Using the plain schedule. Generate a plan above if you need to exclude days or vary amounts.'}
          </p>
        </div>
      )}

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {isSubmitting ? 'Creating…' : 'Create draft contract'}
      </button>
    </form>
  );
}
