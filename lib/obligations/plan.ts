/*
 * Bulk payment-plan generator (build spec #1). The owner picks a start date, an
 * end date, an amount and a frequency, and the whole schedule is generated at
 * once — instead of ticking 60 dates by hand. Every generated row can then be
 * excluded, re-dated or re-priced individually before saving, so a fully
 * customised plan is still possible.
 *
 * Pure and dependency-free: the plan is the money calendar, so every rule here
 * is unit tested. The result feeds `contracts.payment_plan`, which
 * `activateContract` turns into `payment_obligations` rows.
 *
 * Relationship to lib/obligations/schedule.ts: that module generates the
 * calendar implied by a contract's schedule_type and is still the engine for
 * contracts that use a plain cadence. This module produces an EXPLICIT,
 * editable list of (date, amount) pairs. When a plan is stored, it wins —
 * because the owner may have edited it away from any pure cadence.
 */

import { dueTimestampUtc } from './schedule';

export type PlanFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';

/** One row of the editable plan. `included: false` = an excluded day. */
export type PlanEntry = {
  dueDate: string; // YYYY-MM-DD
  amount: number; // integer TZS
  included: boolean;
};

export type PlanGeneratorInput = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, inclusive
  frequency: PlanFrequency;
  /** Amount per payment, integer TZS. */
  amount: number;
  /**
   * weekly — the weekday the payment falls on (0=Sun..6=Sat). Defaults to the
   * start date's weekday.
   * custom — one or more weekdays; a payment on each, every week.
   */
  weekdays?: number[];
  /** monthly — day of month (1..31; 31 = last day of the month). */
  dueDayOfMonth?: number;
};

export class PlanError extends Error {}

/** Safety cap: the same ceiling the schedule engine uses (~5 years daily). */
export const MAX_PLAN_ENTRIES = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const daysInMonth = (year: number, monthIdx0: number): number =>
  new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();

function toUtcMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export const weekdayOf = (dateStr: string): number => new Date(toUtcMidnight(dateStr)).getUTCDay();

function assertRange(startDate: string, endDate: string): void {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) throw new PlanError('Invalid date');
  if (endDate < startDate) throw new PlanError('End date is before start date');
}

/**
 * Generate every applicable payment date in [startDate, endDate] for the chosen
 * frequency. All rows come back `included: true` at the requested amount — the
 * owner deselects or edits from there.
 */
export function generatePlan(input: PlanGeneratorInput): PlanEntry[] {
  assertRange(input.startDate, input.endDate);
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new PlanError('Amount must be greater than 0');

  const dates =
    input.frequency === 'monthly'
      ? monthlyDates(input)
      : weekdayFilteredDates(input);

  if (dates.length === 0) throw new PlanError('No payment dates fall in that period');
  if (dates.length > MAX_PLAN_ENTRIES) throw new PlanError('That period generates too many payments');

  return dates.map((dueDate) => ({ dueDate, amount, included: true }));
}

/** daily / weekly / custom — walk the range, keeping the wanted weekdays. */
function weekdayFilteredDates(input: PlanGeneratorInput): string[] {
  let keep: Set<number> | null = null;
  if (input.frequency === 'weekly') {
    const wd = input.weekdays?.[0] ?? weekdayOf(input.startDate);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new PlanError('Invalid weekly payment day');
    keep = new Set([wd]);
  } else if (input.frequency === 'custom') {
    const wds = (input.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (wds.length === 0) throw new PlanError('Select at least one weekday');
    keep = new Set(wds);
  }

  const startMs = toUtcMidnight(input.startDate);
  const endMs = toUtcMidnight(input.endDate);
  const out: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    if (keep && !keep.has(new Date(ms).getUTCDay())) continue;
    out.push(formatUtcDate(ms));
    // Bail early rather than building a multi-year array before the cap check.
    if (out.length > MAX_PLAN_ENTRIES) break;
  }
  return out;
}

/** monthly — one payment per month on the chosen day, clamped per month. */
function monthlyDates(input: PlanGeneratorInput): string[] {
  const dueDay = input.dueDayOfMonth;
  if (!dueDay || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new PlanError('Choose the monthly due day (1–31; 31 = last day of month)');
  }
  const [sy, sm] = input.startDate.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < 600; i++) {
    const total = sm! - 1 + i;
    const y = sy! + Math.floor(total / 12);
    const mIdx = ((total % 12) + 12) % 12;
    const day = Math.min(dueDay, daysInMonth(y, mIdx));
    const date = `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date > input.endDate) break;
    if (date >= input.startDate) out.push(date);
  }
  return out;
}

/**
 * Normalise an owner-edited plan for saving: drop excluded rows, drop invalid
 * ones, collapse duplicate dates (last edit wins — the DB's
 * `unique (contract_id, due_date)` would reject them anyway) and sort by date.
 * Never throws; `validatePlan` reports what a caller should refuse.
 */
export function normalizePlan(entries: PlanEntry[]): PlanEntry[] {
  const byDate = new Map<string, PlanEntry>();
  for (const e of entries) {
    if (!e?.included) continue;
    if (!DATE_RE.test(e.dueDate)) continue;
    const amount = Math.round(Number(e.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    byDate.set(e.dueDate, { dueDate: e.dueDate, amount, included: true });
  }
  return [...byDate.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Count and total of the rows that would actually be saved. */
export function summarizePlan(entries: PlanEntry[]): { count: number; total: number } {
  const rows = normalizePlan(entries);
  return { count: rows.length, total: rows.reduce((s, e) => s + e.amount, 0) };
}

export type PlanValidation = { ok: true; entries: PlanEntry[] } | { ok: false; error: string };

/**
 * Server-side gate before a plan is stored. Never trust the client's dates or
 * amounts (spec rule 3): every row must be a real date inside the contract
 * term, with a positive integer amount, and the plan must not be empty.
 */
export function validatePlan(
  entries: PlanEntry[],
  bounds: { startDate: string; endDate: string },
): PlanValidation {
  const rows = normalizePlan(entries);
  if (rows.length === 0) return { ok: false, error: 'plan_empty' };
  if (rows.length > MAX_PLAN_ENTRIES) return { ok: false, error: 'plan_too_long' };
  if (rows.length !== new Set(rows.map((r) => r.dueDate)).size) {
    return { ok: false, error: 'plan_duplicate_dates' };
  }
  for (const r of rows) {
    if (r.dueDate < bounds.startDate || r.dueDate > bounds.endDate) {
      return { ok: false, error: 'plan_out_of_term' };
    }
  }
  return { ok: true, entries: rows };
}

/**
 * Shape the plan the way `activate_contract_and_generate_obligations` expects.
 * `amount` is carried per row so an edited instalment survives into the
 * obligation (the DB function falls back to the contract amount when absent).
 */
export function planToObligations(
  entries: PlanEntry[],
  deadlineTime: string,
): { dueDate: string; dueAtUtc: string; localDueTime: string; amount: number }[] {
  return normalizePlan(entries).map((e) => ({
    dueDate: e.dueDate,
    dueAtUtc: dueTimestampUtc(e.dueDate, deadlineTime),
    localDueTime: deadlineTime,
    amount: e.amount,
  }));
}

/** The contract `schedule_type` a generated frequency corresponds to. */
export const FREQUENCY_TO_SCHEDULE_TYPE: Record<PlanFrequency, 'daily' | 'weekly' | 'monthly' | 'selected_weekdays'> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  custom: 'selected_weekdays',
};
