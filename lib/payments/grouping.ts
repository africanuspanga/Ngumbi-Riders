/*
 * Grouping the flat transaction ledger by outcome (client feedback 2026-09-06:
 * "group transaction successful, expired, failed so it is easier for owner").
 *
 * PURE, so the ordering and the money totals are unit tested rather than
 * eyeballed on a page. The owner reads these figures to decide whether a
 * rider actually paid, so a group whose total silently omitted a row would be
 * worse than no grouping at all.
 *
 * Only SUCCESSFUL money is real money. Every other group exists so the owner
 * can see why an attempt did not become money — which is exactly the question
 * that took a month to answer for the rider locked out by a stuck pending.
 */

export type GroupedPaymentStatus =
  | 'successful'
  | 'in_progress'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'reversed';

/**
 * payment_status (0001_enums.sql) → the group it is displayed under.
 *
 * `created` and `pending` are shown together as "in progress": the difference
 * between them is an internal detail of the Snippe handshake, and the owner's
 * question is only ever "is this still happening or not?".
 */
const STATUS_GROUP: Record<string, GroupedPaymentStatus> = {
  completed: 'successful',
  created: 'in_progress',
  pending: 'in_progress',
  failed: 'failed',
  expired: 'expired',
  cancelled: 'cancelled',
  reversed: 'reversed',
};

/** Display order: money first, then the reasons money did not arrive. */
export const GROUP_ORDER: readonly GroupedPaymentStatus[] = [
  'successful',
  'in_progress',
  'failed',
  'expired',
  'cancelled',
  'reversed',
];

export const GROUP_LABELS: Record<GroupedPaymentStatus, string> = {
  successful: 'Successful',
  in_progress: 'In progress',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  reversed: 'Reversed',
};

export const GROUP_DESCRIPTIONS: Record<GroupedPaymentStatus, string> = {
  successful: 'Money received and settled against the rider’s days.',
  in_progress: 'Started but not yet resolved by the provider.',
  failed: 'The provider rejected the payment. Nothing was taken.',
  expired: 'The rider never approved the prompt in time.',
  cancelled: 'Abandoned before completion.',
  reversed: 'Money was returned after settling. Needs the owner’s attention.',
};

/** Tone token per group, so colour and label can never disagree. */
export const GROUP_TONE: Record<GroupedPaymentStatus, string> = {
  successful: 'text-[color:var(--color-paid)]',
  in_progress: 'text-[color:var(--color-warning)]',
  failed: 'text-[color:var(--color-overdue)]',
  expired: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
  reversed: 'text-[color:var(--color-overdue)]',
};

/** Which group a raw payment_status belongs to. Unknown values are shown, never dropped. */
export function groupOf(status: string): GroupedPaymentStatus {
  return STATUS_GROUP[status] ?? 'in_progress';
}

export type GroupedPayments<T> = {
  group: GroupedPaymentStatus;
  label: string;
  description: string;
  tone: string;
  payments: T[];
  /** Sum of the group's amounts, in integer TZS. */
  total: number;
};

/**
 * Split payments into display groups, preserving the order they arrived in
 * (the query sorts newest first) and dropping nothing.
 *
 * Empty groups are omitted: a page listing "Reversed (0)" for a business that
 * has never had a reversal is noise, and the owner asked for this screen to be
 * EASIER to read.
 */
export function groupPayments<T extends { status: string; amount: number }>(
  payments: readonly T[],
): GroupedPayments<T>[] {
  const buckets = new Map<GroupedPaymentStatus, T[]>();
  for (const payment of payments) {
    const group = groupOf(payment.status);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(payment);
    else buckets.set(group, [payment]);
  }

  const result: GroupedPayments<T>[] = [];
  for (const group of GROUP_ORDER) {
    const bucket = buckets.get(group);
    if (!bucket || bucket.length === 0) continue;
    result.push({
      group,
      label: GROUP_LABELS[group],
      description: GROUP_DESCRIPTIONS[group],
      tone: GROUP_TONE[group],
      payments: bucket,
      total: bucket.reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0),
    });
  }
  return result;
}
