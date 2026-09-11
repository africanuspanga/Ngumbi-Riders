/*
 * Collection totals BY SOURCE (client feedback 2026-09-11 #1).
 *
 * "The dashboard should make it clear whether the amount shown comes from
 *  Snippe confirmed collections, cash payments recorded manually, or the
 *  combined system total."
 *
 * That sentence is the whole design. Every figure this module produces carries
 * its source with it, because the three numbers answer three different
 * questions and the owner has been reading one as if it were another:
 *
 *   MOBILE  money Snippe actually confirmed and this system settled. It is the
 *           only figure that should ever be compared against the Snippe
 *           balance, and even then it is not equal to it — see below.
 *   CASH    money a human says they received. Nothing outside this system
 *           knows about it, so it can never appear in a provider balance.
 *   TOTAL   what the business collected. The only figure that matches the
 *           ledger, and the one the reports use.
 *
 * WHY THE SNIPPE BALANCE IS NOT "TOTAL MOBILE COLLECTED": the balance is a
 * float — money in minus money withdrawn minus fees — while mobile collections
 * are a cumulative inflow. They are never expected to be equal, and the
 * dashboard says so rather than inviting the owner to treat a difference as a
 * missing payment.
 *
 * PURE and dependency-free: dates arrive as YYYY-MM-DD strings already
 * resolved to the EAT calendar day by the caller. Nothing here constructs a
 * Date, so a payment made at 23:30 EAT cannot slide into the previous day the
 * way a UTC slice would (build spec #5).
 */

/** One completed payment, reduced to what a collections total needs. */
export type CollectionPayment = {
  paymentId: string;
  /** EAT calendar day the money landed, YYYY-MM-DD. */
  date: string;
  method: string;
  amount: number;
};

export type SourceTotals = {
  /** Snippe-confirmed mobile money. */
  mobile: number;
  /** Cash recorded by the owner or confirmed from an accountant's request. */
  cash: number;
  /** mobile + cash — the combined system total. */
  total: number;
  /** How many payments made up the total. */
  payments: number;
};

export type CollectionsSummary = {
  today: SourceTotals;
  /** Rolling 7 days ENDING today, inclusive — not a partial calendar week. */
  week: SourceTotals;
  /** Calendar month to date. */
  month: SourceTotals;
  /** Every completed payment ever recorded. */
  allTime: SourceTotals;
  /** The window each period covers, so the UI never has to re-derive it. */
  periods: {
    today: string;
    weekFrom: string;
    weekTo: string;
    monthFrom: string;
    monthTo: string;
  };
};

const EMPTY: SourceTotals = { mobile: 0, cash: 0, total: 0, payments: 0 };

function add(acc: SourceTotals, p: CollectionPayment): SourceTotals {
  const cash = p.method === 'cash';
  return {
    mobile: acc.mobile + (cash ? 0 : p.amount),
    cash: acc.cash + (cash ? p.amount : 0),
    total: acc.total + p.amount,
    payments: acc.payments + 1,
  };
}

/** Sum the payments whose date falls in [from, to] (string compare: ISO dates sort). */
export function totalsBetween(
  payments: CollectionPayment[],
  from: string,
  to: string,
): SourceTotals {
  return payments
    .filter((p) => p.date >= from && p.date <= to)
    .reduce(add, { ...EMPTY });
}

/**
 * Shift an ISO calendar date by whole days, textually safe.
 *
 * Uses Date.UTC purely as day arithmetic on a date with no time component, so
 * no timezone conversion can occur — the value goes in as Y/M/D and comes back
 * as Y/M/D.
 */
export function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function summariseCollections(
  payments: CollectionPayment[],
  today: string,
): CollectionsSummary {
  const weekFrom = shiftDays(today, -6);
  const monthFrom = `${today.slice(0, 7)}-01`;

  return {
    today: totalsBetween(payments, today, today),
    week: totalsBetween(payments, weekFrom, today),
    month: totalsBetween(payments, monthFrom, today),
    allTime: payments.reduce(add, { ...EMPTY }),
    periods: {
      today,
      weekFrom,
      weekTo: today,
      monthFrom,
      monthTo: today,
    },
  };
}

/* ------------------------------------------------------------------------ *
 * Reconciliation items
 * ------------------------------------------------------------------------ */

/**
 * A mobile payment that did not end as money. These are the rows the owner
 * must look at: a `pending` older than the provider's own expiry is money the
 * rider may believe they sent, and it keeps its days RESERVED, which blocks
 * recording cash for the same days (the month-long lockout fixed in 0026).
 */
export type ReconciliationItem = {
  paymentId: string;
  status: string;
  amount: number;
  createdAt: string;
  riderId: string | null;
  riderName: string | null;
};

export type ReconciliationSnapshot = {
  pending: { count: number; amount: number };
  failed: { count: number; amount: number };
  /** Pending for longer than `staleAfterHours` — the ones that need a human. */
  stale: ReconciliationItem[];
  items: ReconciliationItem[];
};

export function reconciliationSnapshot(
  items: ReconciliationItem[],
  nowMs: number,
  staleAfterHours = 1,
): ReconciliationSnapshot {
  const pendingItems = items.filter((i) => i.status === 'pending' || i.status === 'created');
  const failedItems = items.filter(
    (i) => i.status === 'failed' || i.status === 'expired' || i.status === 'reversed',
  );
  const cutoff = nowMs - staleAfterHours * 3_600_000;

  return {
    pending: {
      count: pendingItems.length,
      amount: pendingItems.reduce((s, i) => s + i.amount, 0),
    },
    failed: {
      count: failedItems.length,
      amount: failedItems.reduce((s, i) => s + i.amount, 0),
    },
    stale: pendingItems
      .filter((i) => Date.parse(i.createdAt) < cutoff)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    items: [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)),
  };
}

/* ------------------------------------------------------------------------ *
 * Provider balance
 * ------------------------------------------------------------------------ */

/**
 * What the dashboard can say about the Snippe collection balance. Modelled as
 * a discriminated union rather than a nullable number because "we could not
 * ask" and "the balance is zero" are completely different facts and were
 * indistinguishable in every earlier integration surface in this codebase.
 */
export type BalanceState =
  | { state: 'ok'; available: number; balance: number; currency: string }
  | { state: 'not_configured' }
  | { state: 'forbidden' }
  | { state: 'unavailable'; reason: string };

/** One sentence explaining a non-'ok' balance, in the owner's terms. */
export function balanceExplanation(b: BalanceState): string | null {
  switch (b.state) {
    case 'ok':
      return null;
    case 'not_configured':
      return 'Snippe is not connected yet, so only cash appears here. Add SNIPPE_API_KEY to show the live balance.';
    case 'forbidden':
      return 'The Snippe API key cannot read the balance. Regenerate it in the Snippe dashboard with the collection:read scope as well as collection:create.';
    case 'unavailable':
      return `Snippe did not answer (${b.reason}). The collections below are this system's own record and are unaffected.`;
  }
}
