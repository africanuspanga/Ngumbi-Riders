/*
 * Contract status derivation (build spec #8). The stored `contract_status` enum
 * records the LIFECYCLE the owner drove (draft → active → completed/terminated).
 * What the owner and rider need to READ is a slightly richer picture that also
 * accounts for the calendar and the money:
 *
 *   Upcoming   — activated, but the term has not started yet.
 *   Active     — inside the term.
 *   Suspended  — paused by the owner.
 *   Completed  — term finished and nothing is owed.
 *   Ended — Outstanding Balance  — term finished but obligations are unpaid.
 *   Terminated / Cancelled — ended early by the owner.
 *
 * Pure and dependency-free so the rules are unit tested and identical on the
 * dashboard, the rider profile, the contract page and the reports.
 *
 * Why "ended with outstanding balance" is DERIVED rather than a new enum value:
 * it is a function of the obligation ledger, which changes every time a payment
 * settles. Storing it would mean a second source of truth for money that could
 * drift out of date — the exact failure this codebase has been bitten by. The
 * enum stays the lifecycle; the balance is read live.
 */

import type { ContractStatus } from '@/lib/supabase/types';

export type ContractDisplayStatus =
  | 'draft'
  | 'awaiting_signatures'
  | 'upcoming'
  | 'active'
  | 'suspended'
  | 'completed'
  | 'ended_outstanding'
  | 'terminated'
  | 'cancelled';

export type ContractStatusInput = {
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
  /** Obligations still owed (scheduled/due/overdue) on this contract. */
  outstandingCount?: number;
  /** Today in Africa/Dar_es_Salaam, YYYY-MM-DD. */
  today: string;
};

/**
 * True when an activated contract's term has finished and it should be moved to
 * `completed` by the nightly job. Paused contracts are deliberately excluded:
 * the owner suspended them on purpose and must decide how they end.
 */
export function shouldAutoComplete(input: {
  status: ContractStatus;
  endDate: string | null;
  today: string;
}): boolean {
  if (input.status !== 'active') return false;
  if (!input.endDate) return false;
  return input.endDate < input.today;
}

/**
 * The status to SHOW. Independent of whether the nightly completion job has run
 * yet — an active contract whose end date has passed already reads as ended, so
 * the owner never sees a stale "Active" on a finished lease.
 */
export function deriveContractDisplayStatus(input: ContractStatusInput): ContractDisplayStatus {
  const { status, startDate, endDate, today } = input;
  const outstanding = input.outstandingCount ?? 0;

  switch (status) {
    case 'draft':
      return 'draft';
    case 'awaiting_signatures':
      return 'awaiting_signatures';
    case 'cancelled':
      return 'cancelled';
    case 'terminated':
      return 'terminated';
    case 'paused':
      return 'suspended';
    case 'scheduled':
      return 'upcoming';
    case 'completed':
    case 'completed_early':
      return outstanding > 0 ? 'ended_outstanding' : 'completed';
    case 'active': {
      if (startDate && startDate > today) return 'upcoming';
      if (endDate && endDate < today) {
        return outstanding > 0 ? 'ended_outstanding' : 'completed';
      }
      return 'active';
    }
    default:
      return 'active';
  }
}

export const CONTRACT_STATUS_LABELS: Record<ContractDisplayStatus, string> = {
  draft: 'Draft',
  awaiting_signatures: 'Awaiting signatures',
  upcoming: 'Upcoming',
  active: 'Active',
  suspended: 'Suspended',
  completed: 'Contract Completed',
  ended_outstanding: 'Contract Ended — Outstanding Balance',
  terminated: 'Terminated',
  cancelled: 'Cancelled',
};

export const CONTRACT_STATUS_LABELS_SW: Record<ContractDisplayStatus, string> = {
  draft: 'Rasimu',
  awaiting_signatures: 'Inasubiri saini',
  upcoming: 'Utaanza hivi karibuni',
  active: 'Unaendelea',
  suspended: 'Umesimamishwa',
  completed: 'Mkataba Umekamilika',
  ended_outstanding: 'Mkataba Umeisha — Una Deni',
  terminated: 'Umevunjwa',
  cancelled: 'Umefutwa',
};

/** Tailwind tone classes, matching the palette used by the rider status chips. */
export const CONTRACT_STATUS_TONE: Record<ContractDisplayStatus, string> = {
  draft: 'bg-surface text-muted-foreground',
  awaiting_signatures: 'bg-amber-50 text-[color:var(--color-warning)]',
  upcoming: 'bg-blue-50 text-[color:var(--color-advance)]',
  active: 'bg-surface text-[color:var(--color-paid)]',
  suspended: 'bg-amber-50 text-[color:var(--color-warning)]',
  completed: 'bg-surface text-[color:var(--color-paid)]',
  ended_outstanding: 'bg-red-50 text-[color:var(--color-overdue)]',
  terminated: 'bg-red-50 text-[color:var(--color-overdue)]',
  cancelled: 'bg-surface text-muted-foreground',
};

/** Display statuses that count as "the lease is over". */
export const ENDED_DISPLAY_STATUSES: ContractDisplayStatus[] = [
  'completed',
  'ended_outstanding',
  'terminated',
  'cancelled',
];

/** Stored statuses that mean the contract is live (has or will have a calendar). */
export const LIVE_CONTRACT_STATUSES: ContractStatus[] = ['active', 'paused', 'scheduled'];

/** Obligation statuses that still represent money owed. */
export const OUTSTANDING_OBLIGATION_STATUSES = ['scheduled', 'due', 'overdue'] as const;
