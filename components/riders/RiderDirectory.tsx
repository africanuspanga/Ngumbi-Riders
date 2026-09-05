'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  applyRiderDirectory,
  directoryFacets,
  paginate,
  DEFAULT_PER_PAGE,
  EMPTY_FILTERS,
  RIDER_FILTER_LABELS,
  RIDER_SORT_LABELS,
  type RiderDirectoryFilters,
  type RiderDirectoryRow,
  type RiderQuickFilter,
  type RiderSort,
  type RiderView,
} from '@/lib/riders/directory';
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONE } from '@/lib/contracts/status';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { RiderAvatar } from '@/components/riders/RiderAvatar';
import { LayoutGridIcon, TableIcon, SearchIcon, XIcon } from 'lucide-react';

/*
 * The display preference lives in a cookie, not localStorage, so the SERVER
 * knows it and renders the right view immediately. Reading localStorage in an
 * effect would flash the wrong layout on every load and set state during the
 * effect body (which React Compiler correctly flags as a cascading render).
 */
export const RIDER_VIEW_COOKIE = 'ngr_riders_view';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const RIDER_STATUS_TONE: Record<string, string> = {
  onboarding: 'bg-blue-50 text-[color:var(--color-advance)]',
  active: 'bg-surface text-[color:var(--color-paid)]',
  suspended: 'bg-amber-50 text-[color:var(--color-warning)]',
  terminated: 'bg-red-50 text-[color:var(--color-overdue)]',
  inactive: 'bg-surface text-muted-foreground',
};

/**
 * Rider directory (build spec #2): search, sort, filter and card/table views
 * over the full rider list.
 *
 * Filtering runs in the browser over a single server fetch. At this fleet size
 * (tens to low hundreds of riders) that is instant and avoids a round-trip per
 * keystroke; the query behind it is paginated so the data itself is never
 * truncated. If the fleet grows past a few thousand, move the filter to the
 * server — the pure helpers in lib/riders/directory.ts already run in both
 * places unchanged.
 */
export function RiderDirectory({
  riders,
  basePath,
  canCreate = false,
  initialView = 'card',
}: {
  riders: RiderDirectoryRow[];
  /** '/owner/riders' or '/accountant/riders'. */
  basePath: string;
  canCreate?: boolean;
  /** Remembered preference, read from the cookie server-side. */
  initialView?: RiderView;
}) {
  const [filters, setFilters] = useState<RiderDirectoryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<RiderSort>('name_asc');
  const [view, setView] = useState<RiderView>(initialView);
  const [page, setPage] = useState(1);

  function chooseView(next: RiderView) {
    setView(next);
    try {
      // Persisted for the next visit (and for the server's first render).
      document.cookie = `${RIDER_VIEW_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    } catch {
      /* preference is a nicety, never block the UI on it */
    }
  }

  function update(patch: Partial<RiderDirectoryFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1); // a changed filter must not leave the owner on a now-empty page
  }

  const facets = useMemo(() => directoryFacets(riders), [riders]);
  const districtOptions = useMemo(() => {
    if (!filters.region) return facets.districts;
    const inRegion = new Set(
      riders.filter((r) => r.region === filters.region && r.district).map((r) => r.district!),
    );
    return [...inRegion].sort((a, b) => a.localeCompare(b));
  }, [riders, facets.districts, filters.region]);

  const results = useMemo(
    () => applyRiderDirectory(riders, filters, sort),
    [riders, filters, sort],
  );
  const totalPages = Math.max(1, Math.ceil(results.length / DEFAULT_PER_PAGE));
  const pageRows = paginate(results, Math.min(page, totalPages), DEFAULT_PER_PAGE);
  const hasFilters =
    filters.search !== '' ||
    filters.quick !== 'all' ||
    filters.region !== '' ||
    filters.district !== '' ||
    filters.motorcycleId !== '' ||
    filters.registeredFrom !== '' ||
    filters.registeredTo !== '';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">Riders</h1>
          <p className="text-sm text-muted-foreground">
            {results.length} of {riders.length} rider{riders.length === 1 ? '' : 's'}
            {hasFilters ? ' matching your filters' : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-[--radius-card] border border-border bg-white p-0.5">
            <ViewButton active={view === 'card'} onClick={() => chooseView('card')} label="Card view">
              <LayoutGridIcon className="size-4" />
            </ViewButton>
            <ViewButton active={view === 'table'} onClick={() => chooseView('table')} label="Table view">
              <TableIcon className="size-4" />
            </ViewButton>
          </div>
          {canCreate && (
            <Link
              href={`${basePath}/new`}
              className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
            >
              Add rider
            </Link>
          )}
        </div>
      </header>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          placeholder="Search name, phone, rider code, motorcycle registration or contract number…"
          aria-label="Search riders"
          className="input w-full pl-9"
        />
      </div>

      {/* Quick filters */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RIDER_FILTER_LABELS) as RiderQuickFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => update({ quick: key })}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              filters.quick === key
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-white text-muted-foreground hover:bg-surface'
            }`}
          >
            {RIDER_FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Sort + detailed filters */}
      <div className="grid gap-3 rounded-[--radius-card] border border-border bg-white p-3 md:grid-cols-3 lg:grid-cols-6">
        <Labelled label="Sort by">
          <select value={sort} onChange={(e) => setSort(e.target.value as RiderSort)} className="input">
            {(Object.keys(RIDER_SORT_LABELS) as RiderSort[]).map((k) => (
              <option key={k} value={k}>
                {RIDER_SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Region">
          <select
            value={filters.region}
            onChange={(e) => update({ region: e.target.value, district: '' })}
            className="input"
          >
            <option value="">All regions</option>
            {facets.regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="District">
          <select
            value={filters.district}
            onChange={(e) => update({ district: e.target.value })}
            className="input"
          >
            <option value="">All districts</option>
            {districtOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Motorcycle">
          <select
            value={filters.motorcycleId}
            onChange={(e) => update({ motorcycleId: e.target.value })}
            className="input"
          >
            <option value="">Any motorcycle</option>
            {facets.motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Registered from">
          <input
            type="date"
            value={filters.registeredFrom}
            onChange={(e) => update({ registeredFrom: e.target.value })}
            className="input"
          />
        </Labelled>
        <Labelled label="Registered to">
          <input
            type="date"
            value={filters.registeredTo}
            onChange={(e) => update({ registeredTo: e.target.value })}
            className="input"
          />
        </Labelled>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setFilters(EMPTY_FILTERS);
            setPage(1);
          }}
          className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" /> Clear all filters
        </button>
      )}

      {results.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          {riders.length === 0 ? 'No riders yet.' : 'No riders match these filters.'}
        </p>
      ) : view === 'card' ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pageRows.map((r) => (
            <li key={r.id}>
              <Link
                href={`${basePath}/${r.id}`}
                className="flex h-full flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4 hover:border-primary hover:bg-surface"
              >
                <div className="flex items-center gap-3">
                  <RiderAvatar photoUrl={r.photoUrl} name={r.fullName} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{r.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.riderNumber} · {r.phone}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip className={RIDER_STATUS_TONE[r.status]}>{r.status}</Chip>
                  {r.contractStatus && (
                    <Chip className={CONTRACT_STATUS_TONE[r.contractStatus]}>
                      {CONTRACT_STATUS_LABELS[r.contractStatus]}
                    </Chip>
                  )}
                </div>
                <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <Fact label="Motorcycle" value={r.motorcycleRegistration ?? r.motorcycleCode ?? 'None'} />
                  <Fact label="Location" value={[r.district, r.region].filter(Boolean).join(', ') || '—'} />
                  <Fact label="Paid" value={formatTZS(r.amountPaid)} />
                  <Fact
                    label="Outstanding"
                    value={formatTZS(r.amountOutstanding)}
                    tone={r.amountOutstanding > 0 ? 'overdue' : undefined}
                  />
                  <Fact label="Next payment" value={formatDate(r.nextPaymentDate)} />
                  <Fact label="Registered" value={formatDate(r.registeredAt)} />
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Rider</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Motorcycle</th>
                <th className="px-3 py-2">Contract</th>
                <th className="px-3 py-2">Registered</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                {canCreate && (
                  <th className="px-3 py-2 text-right">
                    <span className="sr-only">Edit</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-surface">
                  <td className="px-3 py-2">
                    <Link href={`${basePath}/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <RiderAvatar photoUrl={r.photoUrl} name={r.fullName} size={28} />
                      {r.fullName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.riderNumber}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.phone}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.motorcycleRegistration ?? r.motorcycleCode ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.contractStatus ? (
                      <Chip className={CONTRACT_STATUS_TONE[r.contractStatus]}>
                        {CONTRACT_STATUS_LABELS[r.contractStatus]}
                      </Chip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(r.registeredAt)}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      r.amountOutstanding > 0 ? 'text-[color:var(--color-overdue)]' : 'text-muted-foreground'
                    }`}
                  >
                    {formatTZS(r.amountOutstanding)}
                  </td>
                  {canCreate && (
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`${basePath}/${r.id}/edit`}
                        className="font-medium text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {Math.min(page, totalPages)} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex min-h-9 min-w-9 items-center justify-center rounded-[--radius-card] px-2 ${
        active ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className ?? 'bg-surface text-muted-foreground'}`}
    >
      {children}
    </span>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'overdue' }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`truncate font-medium ${tone === 'overdue' ? 'text-[color:var(--color-overdue)]' : 'text-foreground'}`}
      >
        {value}
      </dd>
    </div>
  );
}
