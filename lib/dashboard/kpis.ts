/*
 * Owner dashboard KPI calculations (spec §14.1). Pure and dependency-free so the
 * exact definitions are unit tested. The spec is deliberate that "settled for
 * today" and "collected today" answer DIFFERENT questions and must not be
 * merged.
 */
export type KpiObligation = {
  riderId: string;
  dueDate: string; // YYYY-MM-DD
  amountDue: number;
  status: string;
};

export type KpiPayment = {
  amount: number;
  status: string;
  completedDate: string | null; // YYYY-MM-DD in local tz
  method: string;
};

const SETTLED = new Set(['paid', 'paid_in_advance']);
const UNPAID = new Set(['scheduled', 'due', 'overdue']);
const EXCLUDED = new Set(['exempted', 'postponed', 'cancelled']);

export type OwnerKpis = {
  expectedToday: number;
  settledToday: number;
  collectedToday: number;
  outstandingToday: number;
  collectionRate: number | null; // 0..1, or null when nothing expected
  totalArrears: number;
  arrearsCount: number;
  paidRiders: number;
  unpaidRiders: number;
};

export function computeOwnerKpis(
  obligations: KpiObligation[],
  paymentsToday: KpiPayment[],
  today: string,
): OwnerKpis {
  const dueToday = obligations.filter((o) => o.dueDate === today && !EXCLUDED.has(o.status));

  const expectedToday = dueToday.reduce((s, o) => s + o.amountDue, 0);
  const settledToday = dueToday
    .filter((o) => SETTLED.has(o.status))
    .reduce((s, o) => s + o.amountDue, 0);
  const outstandingToday = dueToday
    .filter((o) => UNPAID.has(o.status))
    .reduce((s, o) => s + o.amountDue, 0);

  // Collected today = completed payment transactions received today, regardless
  // of which date's obligations they settle (§14.1).
  const collectedToday = paymentsToday
    .filter((p) => p.status === 'completed' && p.completedDate === today)
    .reduce((s, p) => s + p.amount, 0);

  // Arrears = all overdue unpaid obligations (dueDate before today, still unpaid).
  const arrears = obligations.filter(
    (o) => o.dueDate < today && UNPAID.has(o.status),
  );
  const totalArrears = arrears.reduce((s, o) => s + o.amountDue, 0);

  // Rider payment state: a rider is "unpaid" if they have any unpaid obligation
  // due today or earlier.
  const unpaidRiderIds = new Set<string>();
  const allRiderIds = new Set<string>();
  for (const o of obligations) {
    allRiderIds.add(o.riderId);
    if (o.dueDate <= today && UNPAID.has(o.status)) unpaidRiderIds.add(o.riderId);
  }

  return {
    expectedToday,
    settledToday,
    collectedToday,
    outstandingToday,
    collectionRate: expectedToday > 0 ? settledToday / expectedToday : null,
    totalArrears,
    arrearsCount: arrears.length,
    paidRiders: allRiderIds.size - unpaidRiderIds.size,
    unpaidRiders: unpaidRiderIds.size,
  };
}

// ---- Arrears aging (spec §14.2, §19.2) ----------------------------------
export type AgingBuckets = {
  oneDay: number;
  twoToThree: number;
  fourToSeven: number;
  eightToThirty: number;
  overThirty: number;
};

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function arrearsAging(
  obligations: KpiObligation[],
  today: string,
): AgingBuckets {
  const buckets: AgingBuckets = {
    oneDay: 0,
    twoToThree: 0,
    fourToSeven: 0,
    eightToThirty: 0,
    overThirty: 0,
  };
  for (const o of obligations) {
    if (o.dueDate >= today || !UNPAID.has(o.status)) continue;
    const d = daysBetween(o.dueDate, today);
    if (d <= 1) buckets.oneDay += o.amountDue;
    else if (d <= 3) buckets.twoToThree += o.amountDue;
    else if (d <= 7) buckets.fourToSeven += o.amountDue;
    else if (d <= 30) buckets.eightToThirty += o.amountDue;
    else buckets.overThirty += o.amountDue;
  }
  return buckets;
}
