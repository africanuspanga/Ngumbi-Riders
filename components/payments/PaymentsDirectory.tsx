'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  applyRiderDirectory,
  paginate,
  DEFAULT_PER_PAGE,
  EMPTY_FILTERS,
  RIDER_FILTER_LABELS,
  type RiderDirectoryFilters,
  type RiderDirectoryRow,
  type RiderQuickFilter,
  type RiderSort,
} from '@/lib/riders/directory';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatLongDate } from '@/lib/dates/format';
import { RiderAvatar } from '@/components/riders/RiderAvatar';
import { SearchIcon, XIcon, ArrowRightIcon } from 'lucide-react';

/*
 * Rider-centric payments interface (client feedback 2026-09-05):
 * "Drivers should not simply appear as one long list. There should be an
 *  option/interface similar to how the Riders section currently works."
 *
 * So the payments landing page is a DIRECTORY of riders showing each one's
 * money position, not a flat ledger of transactions. The flat ledger still
 * exists (Transactions) for reconciliation, but it is no longer the front door.
 *
 * The search / filter / sort logic is the SAME tested pure code the rider
 * directory uses (lib/riders/directory.ts) — a second implementation would
 * drift, and phone-number matching in particular is subtle.
 *
 * Colour language, exactly as the owner specified:
 *   GREEN — outstanding/accumulated (what is owed right now)
 *   RED   — the total remaining to finish the contract
 */
const SORTS: { value: RiderSort; label: string }[] = [
  { value: 'payment_status', label: 'Worst payment status first' },
  { value: 'balance_desc', label: 'Largest balance first' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'contract_end', label: 'Contract end date' },
];

const QUICK: RiderQuickFilter[] = ['all', 'overdue', 'contract_active', 'fully_paid', 'contract_completed'];

export function PaymentsDirectory({
  riders,
  basePath,
}: {
  riders: RiderDirectoryRow[];
  /** '/owner/payments' or '/accountant/payments'. */
  basePath: string;
}) {
  const [filters, setFilters] = useState<RiderDirectoryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<RiderSort>('payment_status');
  const [page, setPage] = useState(1);

  const rows = useMemo(() => applyRiderDirectory(riders, filters, sort), [riders, filters, sort]);
  const pageRows = useMemo(() => paginate(rows, page, DEFAULT_PER_PAGE), [rows, page]);
  const totalPages = Math.max(1, Math.ceil(rows.length / DEFAULT_PER_PAGE));

  function update(patch: Partial<RiderDirectoryFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  const totals = useMemo(
    () => ({
      dueNow: rows.reduce((s, r) => s + r.amountDueNow, 0),
      remaining: rows.reduce((s, r) => s + r.amountOutstanding, 0),
    }),
    [rows],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            type="search"
            className="input min-h-11 pl-9 pr-9"
            placeholder="Search name, phone, rider code, plate or contract…"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            aria-label="Search riders"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => update({ search: '' })}
              className="text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2"
              aria-label="Clear search"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => update({ quick: q })}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium ${
                filters.quick === q
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-white text-muted-foreground'
              }`}
            >
              {RIDER_FILTER_LABELS[q]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {rows.length} rider{rows.length === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-[color:var(--color-paid)]">
              {formatTZS(totals.dueNow)} owed now
            </span>{' '}
            ·{' '}
            <span className="font-semibold text-[color:var(--color-overdue)]">
              {formatTZS(totals.remaining)} remaining
            </span>
          </span>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Sort</span>
            <select
              className="input h-9 w-auto bg-white py-0"
              value={sort}
              onChange={(e) => setSort(e.target.value as RiderSort)}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Rows — cards on mobile, a table from `md` up. */}
      {pageRows.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          No riders match that search.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {pageRows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`${basePath}/rider/${r.id}`}
                  className="flex items-center gap-3 rounded-[--radius-card] border border-border bg-white p-3"
                >
                  <RiderAvatar name={r.fullName} photoUrl={r.photoUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-primary-dark">{r.fullName}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {r.riderNumber}
                      {r.contractNumber ? ` · ${r.contractNumber}` : ''}
                    </p>
                    <p className="mt-1 text-xs">
                      <span className="font-semibold text-[color:var(--color-paid)]">
                        {formatTZS(r.amountDueNow)}
                      </span>
                      <span className="text-muted-foreground"> owed now · </span>
                      <span className="font-semibold text-[color:var(--color-overdue)]">
                        {formatTZS(r.amountOutstanding)}
                      </span>
                      <span className="text-muted-foreground"> to finish</span>
                    </p>
                  </div>
                  <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-[--radius-card] border border-border bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 font-medium">Rider</th>
                  <th className="px-3 py-2 font-medium">Contract</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Owed now</th>
                  <th className="px-3 py-2 text-right font-medium">Remaining</th>
                  <th className="px-3 py-2 font-medium">Expected completion</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`${basePath}/rider/${r.id}`} className="font-medium hover:underline">
                        {r.fullName}
                      </Link>
                      <span className="text-muted-foreground block text-xs">{r.riderNumber}</span>
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {r.contractNumber ?? '—'}
                      {r.contractEndDate ? <span className="block">ends {formatDate(r.contractEndDate)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTZS(r.amountPaid)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[color:var(--color-paid)]">
                      {formatTZS(r.amountDueNow)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[color:var(--color-overdue)]">
                      {formatTZS(r.amountOutstanding)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {r.projectedEndDate ? formatLongDate(r.projectedEndDate) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`${basePath}/rider/${r.id}`} className="text-primary text-xs font-medium hover:underline">
                        Statement
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-h-10 rounded-[--radius-card] border border-border bg-white px-3 font-medium disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="min-h-10 rounded-[--radius-card] border border-border bg-white px-3 font-medium disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
