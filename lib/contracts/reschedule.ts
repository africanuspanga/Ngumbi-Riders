/*
 * Changing the payment frequency of a LIVE contract (client feedback
 * 2026-10-29, D-055).
 *
 * THE REPORT
 *
 * "The owner is failing to edit the payment plan from daily to weekly or
 *  monthly." The editor closes the term/schedule fields once a contract is
 *  active, because from then on the obligations ARE the money record. The
 *  price-correction form (reprice.ts) changes the AMOUNT, never the cadence,
 *  so a daily contract had no way to become weekly at all.
 *
 * THE RULE
 *
 * Only the FUTURE, still-scheduled lease days change cadence. Everything the
 * rider has already done or failed to do is history and stays put:
 *
 *   • settled days (paid / paid_in_advance)      — untouched
 *   • today's day and every arrear (due/overdue) — untouched, same date, same
 *     amount, so arrears keep their clock (the same reason reprice.ts never
 *     re-dates anything)
 *   • phone-loan instalments                     — untouched (their own plan)
 *
 * What the rider still owed for the rest of the lease (the sum of those future
 * days) is re-cut into instalments of the new cadence: N full instalments at
 * the new price and, when it does not divide evenly, one smaller final one.
 * Money is conserved to the shilling — the database function refuses a plan
 * where it is not.
 *
 * Instalments start on the first date of the new cadence AFTER today. A date
 * already used by an untouched day (an advance payment, a phone instalment, a
 * cancelled day) is skipped, because the database allows one obligation per
 * contract per date. An existing future day that lands on a chosen date is
 * KEPT and re-priced rather than cancelled and re-created, so the plan never
 * collides with itself.
 *
 * Pure and dependency-free so every rule is unit tested. Integer TZS.
 */

import { generateSchedule, type ScheduleType } from '@/lib/obligations/schedule';

export class RescheduleError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export type RescheduleObligation = {
  id: string;
  dueDate: string;
  amountDue: number;
  status: string;
  kind: string;
};

export type RescheduleCadence = {
  scheduleType: ScheduleType;
  /** weekly: exactly one weekday; selected_weekdays: one or more. 0=Sun. */
  selectedWeekdays?: number[];
  /** monthly only, 1..31 (31 = last day of the month). */
  dueDayOfMonth?: number | null;
};

export type ReschedulePlan = {
  /** Future scheduled lease days being re-cut. */
  scopeCount: number;
  /** What the rider owed on them — and still owes after. */
  scopeTotal: number;
  instalment: number;
  instalmentCount: number;
  /** The final instalment (equals `instalment` when it divides evenly). */
  lastAmount: number;
  firstDate: string;
  lastDate: string;
  /** The contract's new end date: the last live obligation of any kind. */
  endDate: string;
  updates: { id: string; amount: number }[];
  inserts: { dueDate: string; dueAt: string; localDueTime: string; amount: number }[];
  cancelIds: string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const STEP_DAYS: Record<ScheduleType, number> = {
  daily: 1,
  selected_weekdays: 1,
  weekly: 7,
  monthly: 31,
};

/** Days a live obligation on the calendar no longer occupies. */
const DEAD_STATUSES = new Set(['cancelled', 'postponed']);

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!) + days * DAY_MS);
  return dt.toISOString().slice(0, 10);
}

/** The arithmetic alone — small enough to run in the browser for a preview. */
export function rescheduleMath(scopeTotal: number, instalment: number) {
  if (!Number.isInteger(instalment) || instalment <= 0) {
    throw new RescheduleError('invalid_amount');
  }
  if (scopeTotal <= 0) return { instalmentCount: 0, lastAmount: 0 };
  const instalmentCount = Math.ceil(scopeTotal / instalment);
  const lastAmount = scopeTotal - (instalmentCount - 1) * instalment;
  return { instalmentCount, lastAmount };
}

/** The days a reschedule re-cuts: future, scheduled, lease. */
export function isInRescheduleScope(o: RescheduleObligation, today: string): boolean {
  return o.kind === 'lease' && o.status === 'scheduled' && o.dueDate > today;
}

export function validateCadence(c: RescheduleCadence): void {
  const days = (c.selectedWeekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (c.scheduleType === 'weekly' && days.length !== 1) {
    throw new RescheduleError('invalid_cadence', 'Weekly needs exactly one weekday');
  }
  if (c.scheduleType === 'selected_weekdays' && days.length === 0) {
    throw new RescheduleError('invalid_cadence', 'Pick at least one weekday');
  }
  if (c.scheduleType === 'monthly') {
    const d = c.dueDayOfMonth;
    if (!d || !Number.isInteger(d) || d < 1 || d > 31) {
      throw new RescheduleError('invalid_cadence', 'Monthly needs a due day 1–31');
    }
  }
}

export function planReschedule(input: {
  obligations: RescheduleObligation[];
  today: string;
  cadence: RescheduleCadence;
  instalment: number;
  deadlineTime: string;
}): ReschedulePlan {
  const { obligations, today, cadence, instalment, deadlineTime } = input;
  if (!DATE_RE.test(today)) throw new RescheduleError('invalid_date');
  validateCadence(cadence);

  const scope = obligations.filter((o) => isInRescheduleScope(o, today));
  if (scope.length === 0) throw new RescheduleError('nothing_to_reschedule');
  const scopeTotal = scope.reduce((s, o) => s + o.amountDue, 0);
  const { instalmentCount, lastAmount } = rescheduleMath(scopeTotal, instalment);

  const scopeByDate = new Map(scope.map((o) => [o.dueDate, o]));
  const scopeIds = new Set(scope.map((o) => o.id));
  // Dates held by days this change does not touch. Cancelled/postponed rows
  // still occupy their date in the (contract_id, due_date) unique constraint.
  const taken = new Set(obligations.filter((o) => !scopeIds.has(o.id)).map((o) => o.dueDate));

  // Generate enough candidate dates to survive skipping every taken one.
  const needed = instalmentCount + taken.size;
  const startDate = addDays(today, 1);
  const weekdays =
    cadence.scheduleType === 'weekly' || cadence.scheduleType === 'selected_weekdays'
      ? (cadence.selectedWeekdays ?? [])
      : [];
  const perWeek = cadence.scheduleType === 'selected_weekdays' ? Math.max(1, weekdays.length) : 7;
  const horizonDays =
    cadence.scheduleType === 'selected_weekdays'
      ? Math.ceil((needed * 7) / perWeek) + 7
      : needed * STEP_DAYS[cadence.scheduleType] + 7;
  const candidates = generateSchedule({
    startDate,
    endDate: addDays(startDate, horizonDays),
    scheduleType: cadence.scheduleType,
    selectedWeekdays: weekdays,
    dueDayOfMonth: cadence.dueDayOfMonth ?? undefined,
    monthlyCount: cadence.scheduleType === 'monthly' ? needed : undefined,
    deadlineTime,
  }).filter((g) => g.dueDate > today && !taken.has(g.dueDate));

  const chosen = candidates.slice(0, instalmentCount);
  if (chosen.length < instalmentCount) throw new RescheduleError('no_free_dates');

  const updates: ReschedulePlan['updates'] = [];
  const inserts: ReschedulePlan['inserts'] = [];
  const kept = new Set<string>();
  chosen.forEach((g, i) => {
    const amount = i === chosen.length - 1 ? lastAmount : instalment;
    const existing = scopeByDate.get(g.dueDate);
    if (existing) {
      updates.push({ id: existing.id, amount });
      kept.add(existing.id);
    } else {
      inserts.push({ dueDate: g.dueDate, dueAt: g.dueAtUtc, localDueTime: g.localDueTime, amount });
    }
  });
  const cancelIds = scope.filter((o) => !kept.has(o.id)).map((o) => o.id);

  const lastDate = chosen[chosen.length - 1]!.dueDate;
  let endDate = lastDate;
  for (const o of obligations) {
    if (scopeIds.has(o.id) || DEAD_STATUSES.has(o.status)) continue;
    if (o.dueDate > endDate) endDate = o.dueDate;
  }

  const after =
    updates.reduce((s, u) => s + u.amount, 0) + inserts.reduce((s, u) => s + u.amount, 0);
  if (after !== scopeTotal) throw new RescheduleError('not_conserved'); // unreachable; belt and braces

  return {
    scopeCount: scope.length,
    scopeTotal,
    instalment,
    instalmentCount,
    lastAmount,
    firstDate: chosen[0]!.dueDate,
    lastDate,
    endDate,
    updates,
    inserts,
    cancelIds,
  };
}
