'use client';

import { useState } from 'react';
import {
  generatePlan,
  summarizePlan,
  PlanError,
  type PlanEntry,
  type PlanFrequency,
} from '@/lib/obligations/plan';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateWithWeekday } from '@/lib/dates/format';
import { WEEKDAY_LABELS } from '@/lib/contracts/validation';

/*
 * Bulk payment-plan builder (build spec #1).
 *
 * The owner picks start, end, amount and frequency and gets the WHOLE schedule
 * at once — instead of ticking 60 dates by hand. Every generated row can then
 * be deselected, re-dated or re-priced, and the totals update live, before
 * anything is saved.
 *
 * Generation and totals come from the pure, unit-tested helpers in
 * lib/obligations/plan.ts; this component is only the interface. The plan is
 * re-validated server-side in createContract, so nothing here is trusted.
 */
export function PaymentPlanBuilder({
  startDate,
  endDate,
  amount,
  frequency,
  weekdays,
  dueDayOfMonth,
  plan,
  onChange,
}: {
  startDate: string;
  endDate: string;
  amount: number;
  frequency: PlanFrequency;
  weekdays: number[];
  dueDayOfMonth?: number;
  plan: PlanEntry[] | null;
  onChange: (plan: PlanEntry[] | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const canGenerate = Boolean(startDate && endDate && amount > 0);

  function generate() {
    setError(null);
    try {
      onChange(
        generatePlan({
          startDate,
          endDate,
          frequency,
          amount,
          weekdays,
          dueDayOfMonth,
        }),
      );
    } catch (e) {
      onChange(null);
      setError(
        e instanceof PlanError
          ? e.message
          : 'Could not generate the schedule. Check the dates and amount.',
      );
    }
  }

  function setAllIncluded(included: boolean) {
    if (!plan) return;
    onChange(plan.map((p) => ({ ...p, included })));
  }

  function updateRow(index: number, patch: Partial<PlanEntry>) {
    if (!plan) return;
    onChange(plan.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  const summary = plan ? summarizePlan(plan) : null;
  const excluded = plan ? plan.length - (summary?.count ?? 0) : 0;
  // Duplicate dates are collapsed on save; warn rather than fail silently.
  const duplicateDates = plan
    ? plan
        .filter((p) => p.included)
        .map((p) => p.dueDate)
        .filter((d, i, arr) => arr.indexOf(d) !== i)
    : [];
  const visibleRows = plan ? (showAll ? plan : plan.slice(0, 20)) : [];

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-card] border border-primary bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-primary-dark">Payment plan</h3>
          <p className="text-xs text-muted-foreground">
            Generate every payment date at once, then adjust individual days if
            you need to.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="rounded-[--radius-card] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {plan ? 'Regenerate schedule' : 'Generate schedule'}
        </button>
      </div>

      {!canGenerate && (
        <p className="text-xs text-muted-foreground">
          Set the start date, the term and the amount per payment first.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      {plan && summary && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[--radius-card] border border-border bg-white p-3 text-sm">
            <span>
              <strong className="text-primary-dark">{summary.count}</strong> payment
              {summary.count === 1 ? '' : 's'}
            </span>
            <span>
              Total <strong className="text-primary-dark">{formatTZS(summary.total)}</strong>
            </span>
            {excluded > 0 && <span className="text-muted-foreground">{excluded} excluded</span>}
            <span className="text-muted-foreground">
              {formatDate(plan[0]?.dueDate)} → {formatDate(plan[plan.length - 1]?.dueDate)}
            </span>
          </div>

          {duplicateDates.length > 0 && (
            <p className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-2 text-xs font-medium text-[color:var(--color-warning)]">
              Two payments share the same date ({[...new Set(duplicateDates)].map((d) => formatDate(d)).join(', ')}).
              Only one payment per date is kept — change or exclude the duplicate.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAllIncluded(true)}
              className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-surface"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setAllIncluded(false)}
              className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-surface"
            >
              Deselect all
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface"
            >
              Discard plan (use the plain schedule)
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-[--radius-card] border border-border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Include</th>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount (TZS)</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => (
                  <tr
                    key={`${row.dueDate}-${i}`}
                    className={`border-t border-border ${row.included ? '' : 'opacity-50'}`}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={(e) => updateRow(i, { included: e.target.checked })}
                        aria-label={`Include payment on ${formatDate(row.dueDate)}`}
                        className="h-5 w-5"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5">
                      <input
                        type="date"
                        value={row.dueDate}
                        onChange={(e) => updateRow(i, { dueDate: e.target.value })}
                        min={startDate}
                        max={endDate}
                        aria-label={`Date of payment ${i + 1}`}
                        className="input py-1"
                      />
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                        {formatDateWithWeekday(row.dueDate)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={row.amount}
                        onChange={(e) => updateRow(i, { amount: Number(e.target.value) })}
                        aria-label={`Amount of payment ${i + 1}`}
                        className="input w-32 py-1 text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.length > 20 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-fit text-xs font-semibold text-primary underline"
            >
              {showAll ? 'Show first 20 only' : `Show all ${plan.length} payments`}
            </button>
          )}

          <p className="text-xs text-muted-foreground">
            Dates outside {formatDate(startDate)} – {formatDate(endDate)} are rejected when the
            contract is saved. Weekday of each date is shown for reference:{' '}
            {WEEKDAY_LABELS.join(', ')}.
          </p>
        </>
      )}
    </div>
  );
}
