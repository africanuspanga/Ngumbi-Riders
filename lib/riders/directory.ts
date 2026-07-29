/*
 * Rider directory search / sort / filter (build spec #2).
 *
 * PURE and dependency-free so every rule is unit tested and so the same logic
 * runs on the server (initial render) and in the browser (instant re-filter as
 * the owner types). The row shape is produced by lib/riders/queries.ts.
 */

import type { ContractDisplayStatus } from '@/lib/contracts/status';
import type { RiderStatus, RiskLevel } from '@/lib/supabase/types';

export type RiderDirectoryRow = {
  id: string;
  riderNumber: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  fullName: string;
  phone: string;
  email: string | null;
  photoUrl: string | null;
  status: RiderStatus;
  riskLevel: RiskLevel;
  region: string | null;
  district: string | null;
  registeredAt: string; // ISO timestamp
  /** Present when the rider has a NIDA/licence on file (owner-only search). */
  nidaLast4: string | null;
  motorcycleId: string | null;
  motorcycleCode: string | null;
  motorcycleRegistration: string | null;
  contractId: string | null;
  contractNumber: string | null;
  contractStatus: ContractDisplayStatus | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  /** Money, in integer TZS. */
  amountPaid: number;
  amountOutstanding: number;
  outstandingCount: number;
  overdueCount: number;
  nextPaymentDate: string | null;
};

export type RiderSort =
  | 'name_asc'
  | 'name_desc'
  | 'registered_desc'
  | 'registered_asc'
  | 'contract_start'
  | 'contract_end'
  | 'payment_status'
  | 'balance_desc';

export const RIDER_SORT_LABELS: Record<RiderSort, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  registered_desc: 'Date registered (newest)',
  registered_asc: 'Date registered (oldest)',
  contract_start: 'Contract start date',
  contract_end: 'Contract end date',
  payment_status: 'Payment status (worst first)',
  balance_desc: 'Outstanding balance (highest)',
};

export type RiderQuickFilter =
  | 'all'
  | 'active'
  | 'contract_active'
  | 'contract_completed'
  | 'overdue'
  | 'fully_paid'
  | 'no_motorcycle';

export const RIDER_FILTER_LABELS: Record<RiderQuickFilter, string> = {
  all: 'All riders',
  active: 'Active riders',
  contract_active: 'Active contracts',
  contract_completed: 'Completed contracts',
  overdue: 'Overdue payments',
  fully_paid: 'Fully paid',
  no_motorcycle: 'No motorcycle assigned',
};

export type RiderDirectoryFilters = {
  search: string;
  quick: RiderQuickFilter;
  region: string;
  district: string;
  motorcycleId: string;
  /** Registration date range, YYYY-MM-DD (inclusive). */
  registeredFrom: string;
  registeredTo: string;
};

export const EMPTY_FILTERS: RiderDirectoryFilters = {
  search: '',
  quick: 'all',
  region: '',
  district: '',
  motorcycleId: '',
  registeredFrom: '',
  registeredTo: '',
};

export type RiderView = 'card' | 'table';

const norm = (v: string | null | undefined): string => (v ?? '').toLowerCase().trim();

const digits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/**
 * Reduce a Tanzanian phone number to its 9-digit national significant number,
 * so every way the owner might type it matches the stored E.164 value:
 *
 *   0712 345 678  →  712345678
 *   +255712345678 →  712345678
 *   255712345678  →  712345678
 *   712345678     →  712345678
 *
 * A naive digits-substring compare fails the most common case of all — the
 * local `0` prefix is REPLACED by `255`, so "0712345678" is not a substring of
 * "255712345678".
 */
function nationalPhoneDigits(v: string | null | undefined): string {
  let d = digits(v);
  if (d.startsWith('255')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d;
}

/**
 * Does this row match the free-text search? Searches name, phone, rider code,
 * motorcycle registration, motorcycle code and contract number. NIDA is matched
 * on its last 4 digits only, and only when the caller supplied them — the full
 * number is encrypted at rest and never leaves the server (spec §25.1).
 */
export function matchesSearch(row: RiderDirectoryRow, rawTerm: string): boolean {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return true;

  const haystack = [
    row.fullName,
    row.firstName,
    row.lastName,
    row.middleName,
    row.riderNumber,
    row.email,
    row.motorcycleRegistration,
    row.motorcycleCode,
    row.contractNumber,
    row.region,
    row.district,
  ];
  if (haystack.some((v) => norm(v).includes(term))) return true;

  // Phone: compare on the national significant number so 0712…, +255712… and
  // 712… all find the same rider. A partial (e.g. "345") still matches.
  const termDigits = digits(term);
  const termNational = nationalPhoneDigits(term);
  if (termNational.length >= 3 && nationalPhoneDigits(row.phone).includes(termNational)) return true;

  // National ID: last-4 match only.
  if (row.nidaLast4 && termDigits.length >= 4 && row.nidaLast4 === termDigits.slice(-4)) return true;

  return false;
}

export function matchesFilters(row: RiderDirectoryRow, f: RiderDirectoryFilters): boolean {
  switch (f.quick) {
    case 'active':
      if (row.status !== 'active') return false;
      break;
    case 'contract_active':
      if (row.contractStatus !== 'active' && row.contractStatus !== 'upcoming') return false;
      break;
    case 'contract_completed':
      if (row.contractStatus !== 'completed' && row.contractStatus !== 'ended_outstanding') return false;
      break;
    case 'overdue':
      if (row.overdueCount <= 0) return false;
      break;
    case 'fully_paid':
      // Has a contract, owes nothing.
      if (!row.contractId || row.amountOutstanding > 0) return false;
      break;
    case 'no_motorcycle':
      if (row.motorcycleId) return false;
      break;
    case 'all':
    default:
      break;
  }

  if (f.region && norm(row.region) !== norm(f.region)) return false;
  if (f.district && norm(row.district) !== norm(f.district)) return false;
  if (f.motorcycleId && row.motorcycleId !== f.motorcycleId) return false;

  // Registration date range — compare on the calendar day, not the instant.
  const registeredDay = row.registeredAt.slice(0, 10);
  if (f.registeredFrom && registeredDay < f.registeredFrom) return false;
  if (f.registeredTo && registeredDay > f.registeredTo) return false;

  return true;
}

/** Worst payment state first: overdue → outstanding → settled. */
function paymentRank(row: RiderDirectoryRow): number {
  if (row.overdueCount > 0) return 0;
  if (row.amountOutstanding > 0) return 1;
  return 2;
}

/** Nulls always sort last, in both directions — an empty date is not "earliest". */
function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

export function sortRiders(rows: RiderDirectoryRow[], sort: RiderSort): RiderDirectoryRow[] {
  const out = [...rows];
  const byName = (a: RiderDirectoryRow, b: RiderDirectoryRow) =>
    a.fullName.localeCompare(b.fullName, 'en', { sensitivity: 'base' });

  switch (sort) {
    case 'name_asc':
      out.sort(byName);
      break;
    case 'name_desc':
      out.sort((a, b) => byName(b, a));
      break;
    case 'registered_desc':
      out.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
      break;
    case 'registered_asc':
      out.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
      break;
    case 'contract_start':
      out.sort((a, b) => compareNullable(a.contractStartDate, b.contractStartDate) || byName(a, b));
      break;
    case 'contract_end':
      out.sort((a, b) => compareNullable(a.contractEndDate, b.contractEndDate) || byName(a, b));
      break;
    case 'payment_status':
      out.sort((a, b) => paymentRank(a) - paymentRank(b) || b.amountOutstanding - a.amountOutstanding || byName(a, b));
      break;
    case 'balance_desc':
      out.sort((a, b) => b.amountOutstanding - a.amountOutstanding || byName(a, b));
      break;
  }
  return out;
}

/** Search + filter + sort in one pass — what both the server and the UI call. */
export function applyRiderDirectory(
  rows: RiderDirectoryRow[],
  filters: RiderDirectoryFilters,
  sort: RiderSort,
): RiderDirectoryRow[] {
  return sortRiders(
    rows.filter((r) => matchesSearch(r, filters.search) && matchesFilters(r, filters)),
    sort,
  );
}

/** Distinct, sorted region/district/motorcycle options present in the data. */
export function directoryFacets(rows: RiderDirectoryRow[]): {
  regions: string[];
  districts: string[];
  motorcycles: { id: string; label: string }[];
} {
  const regions = new Set<string>();
  const districts = new Set<string>();
  const motorcycles = new Map<string, string>();
  for (const r of rows) {
    if (r.region) regions.add(r.region);
    if (r.district) districts.add(r.district);
    if (r.motorcycleId) {
      motorcycles.set(
        r.motorcycleId,
        r.motorcycleRegistration
          ? `${r.motorcycleCode ?? '—'} · ${r.motorcycleRegistration}`
          : (r.motorcycleCode ?? '—'),
      );
    }
  }
  return {
    regions: [...regions].sort((a, b) => a.localeCompare(b)),
    districts: [...districts].sort((a, b) => a.localeCompare(b)),
    motorcycles: [...motorcycles.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Simple page slice — the directory paginates client-side over a full fetch. */
export function paginate<T>(rows: T[], page: number, perPage: number): T[] {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const start = (safePage - 1) * perPage;
  return rows.slice(start, start + perPage);
}

export const DEFAULT_PER_PAGE = 25;
