/*
 * Whole-obligation payment selection and oldest-first allocation
 * (spec §3.1, §3.2, §11). A rider NEVER pays an arbitrary amount: they choose a
 * number of whole obligations, and the server always applies money to the
 * OLDEST outstanding obligation first. Pure and dependency-free so the accounting
 * rules are exhaustively unit tested.
 */
export type SelectableObligation = {
  id: string;
  dueDate: string; // YYYY-MM-DD
  amountDue: number;
  status: string;
};

const OUTSTANDING = new Set(['scheduled', 'due', 'overdue']);

/** Outstanding obligations, oldest first (tie-broken by id for determinism). */
export function outstanding(obs: SelectableObligation[]): SelectableObligation[] {
  return obs
    .filter((o) => OUTSTANDING.has(o.status))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : 1));
}

export class SelectionError extends Error {}

/** The oldest `count` outstanding obligations and their exact total. */
export function selectOldest(
  obs: SelectableObligation[],
  count: number,
): { obligationIds: string[]; amount: number } {
  const list = outstanding(obs);
  if (!Number.isInteger(count) || count < 1) {
    throw new SelectionError('Count must be a positive whole number');
  }
  if (count > list.length) {
    throw new SelectionError('Not enough outstanding obligations');
  }
  const chosen = list.slice(0, count);
  return {
    obligationIds: chosen.map((o) => o.id),
    amount: chosen.reduce((s, o) => s + o.amountDue, 0),
  };
}

/**
 * Verify an amount corresponds to a whole number of the OLDEST obligations.
 * Rejects any amount that would leave an obligation partially settled or that
 * skips older obligations (spec §3.1: partial payments prohibited).
 */
export function validateWholeAmount(
  obs: SelectableObligation[],
  amount: number,
): { ok: true; obligationIds: string[] } | { ok: false; reason: string } {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  const list = outstanding(obs);
  let running = 0;
  const ids: string[] = [];
  for (const o of list) {
    running += o.amountDue;
    ids.push(o.id);
    if (running === amount) return { ok: true, obligationIds: ids };
    if (running > amount) return { ok: false, reason: 'partial_obligation' };
  }
  return { ok: false, reason: 'exceeds_outstanding' };
}

export type PaymentOption = {
  key: string;
  label: string;
  count: number;
  amount: number;
};

export type PaymentCadence = 'daily' | 'selected_weekdays' | 'weekly' | 'monthly';

// One obligation = one day / week / month depending on the contract cadence.
// Labels and bundle sizes MUST match: "Lipa siku 7" on a monthly contract would
// read as "pay 7 days" while actually charging SEVEN MONTHS oldest-first.
const CADENCE_PRESETS: Record<PaymentCadence, { counts: number[]; unit: (n: number) => string }> = {
  daily: { counts: [3, 7, 14], unit: (n) => `Lipa siku ${n}` },
  selected_weekdays: { counts: [3, 7, 14], unit: (n) => `Lipa siku ${n}` },
  weekly: { counts: [1, 2, 4], unit: (n) => (n === 1 ? 'Lipa wiki 1' : `Lipa wiki ${n}`) },
  monthly: { counts: [1, 2, 3], unit: (n) => (n === 1 ? 'Lipa mwezi 1' : `Lipa miezi ${n}`) },
};

/** Preset options shown to the rider (spec §3.1). All allocate oldest-first. */
export function presetOptions(
  obs: SelectableObligation[],
  today: string,
  cadence: PaymentCadence = 'daily',
): PaymentOption[] {
  const list = outstanding(obs);
  const overdue = list.filter((o) => o.dueDate < today);
  const todayObs = list.filter((o) => o.dueDate === today);
  const options: PaymentOption[] = [];

  const amountForCount = (count: number) =>
    list.slice(0, count).reduce((s, o) => s + o.amountDue, 0);

  if (overdue.length === 0 && todayObs.length > 0) {
    options.push({ key: 'pay_today', label: 'Lipa leo', count: 1, amount: amountForCount(1) });
  }
  if (overdue.length > 0) {
    options.push({
      key: 'clear_arrears',
      label: 'Lipa madeni yote',
      count: overdue.length,
      amount: amountForCount(overdue.length),
    });
    if (todayObs.length > 0) {
      // Every obligation due today, not a hardcoded one — a postponement
      // replacement can land on a regular due day, giving today two.
      const c = overdue.length + todayObs.length;
      options.push({ key: 'arrears_plus_today', label: 'Madeni + leo', count: c, amount: amountForCount(c) });
    }
  }
  const preset = CADENCE_PRESETS[cadence];
  for (const n of preset.counts) {
    if (list.length >= n) {
      const key = `next_${n}`;
      // Skip presets that duplicate an option already offered (e.g. a monthly
      // rider's "Lipa mwezi 1" when "Lipa leo" already covers the same single
      // obligation).
      if (options.some((o) => o.count === n)) continue;
      options.push({ key, label: preset.unit(n), count: n, amount: amountForCount(n) });
    }
  }
  return options;
}
