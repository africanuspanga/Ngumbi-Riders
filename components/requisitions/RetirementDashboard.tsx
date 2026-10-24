import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import type { RetirementBoard } from '@/lib/requisitions/retirement-queries';
import {
  AGING_LABELS,
  STATE_LABELS,
  summarizeByStaff,
  summarizeRetirements,
  type AgingBucket,
  type RetirementRow,
  type RetirementState,
} from '@/lib/requisitions/retirement';

/*
 * Retirement Performance Monitoring (client request 2026-10-23), modelled on
 * the reference system the owner showed: headline totals, an aging breakdown
 * of unretired money, and tabs for active / fully retired / per-person
 * summary. One component for both roles; the tabs differ:
 *
 *   owner       Awaiting verification · Active · Fully retired · Summary
 *   accountant  My retirements · Eligible requests · Active · Fully retired · Summary
 *
 * Filters are a plain GET form, so the URL the page reads is the URL the
 * export reads (the ReportFilterBar rule).
 */

export type RetirementTab = 'verify' | 'mine' | 'eligible' | 'active' | 'retired' | 'summary';

const STATE_TONE: Record<RetirementState, string> = {
  unretired: 'bg-overdue/10 text-overdue',
  partially_retired: 'bg-warning/15 text-warning',
  fully_retired: 'bg-paid/15 text-paid',
};

const AGING_TONE: Record<AgingBucket, string> = {
  within_period: 'border-l-paid',
  days_8_14: 'border-l-warning',
  days_15_30: 'border-l-[#E8590C]',
  days_over_30: 'border-l-overdue',
};

function daysTone(days: number | null): string {
  if (days === null) return 'bg-muted text-muted-foreground';
  if (days <= 7) return 'bg-paid/15 text-paid';
  if (days <= 14) return 'bg-warning/15 text-warning';
  return 'bg-overdue/10 text-overdue';
}

function Card({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className={`rounded-(--radius-card) border border-border border-l-4 ${accent} bg-white p-3`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-lg font-bold tabular-nums text-primary-dark sm:text-xl">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type BoardEntry = RetirementBoard['entries'][number];

const ENTRY_TONE: Record<BoardEntry['status'], string> = {
  submitted: 'bg-warning/15 text-warning',
  approved: 'bg-paid/15 text-paid',
  rejected: 'bg-overdue/10 text-overdue',
};
const ENTRY_LABEL: Record<BoardEntry['status'], string> = {
  submitted: 'Awaiting verification',
  approved: 'Verified',
  rejected: 'Rejected',
};

/**
 * Individual retirement entries with their receipts. Used for "Retirements I
 * submitted" (the submitter's own record) and for the Director's verification
 * queue, where the receipt must be one click away — not two pages away.
 */
function EntryList({
  entries,
  basePath,
  title,
  showSubmitter,
}: {
  entries: BoardEntry[];
  basePath: '/owner' | '/accountant';
  title: string;
  showSubmitter: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id} className="rounded-(--radius-card) border border-border bg-white p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`${basePath}/requisitions/${e.requisitionId}`} className="font-semibold text-primary-dark underline">
                  {e.requisitionNumber}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">{e.requisitionTitle}</span>
                <p className="mt-1 text-foreground">{e.description}</p>
                <p className="text-xs text-muted-foreground">
                  {showSubmitter && <>{e.submittedByName} · </>}submitted {formatDateTime(e.submittedAt)} · spent on{' '}
                  {formatDate(e.spentOn)}
                </p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ENTRY_TONE[e.status]}`}>
                  {ENTRY_LABEL[e.status]}
                </span>
                <p className="mt-1 font-semibold tabular-nums">{formatTZS(e.spentAmount)} spent</p>
                {e.returnedAmount > 0 && (
                  <p className="text-xs tabular-nums text-muted-foreground">{formatTZS(e.returnedAmount)} returned</p>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <span className="text-xs font-semibold text-muted-foreground">Receipts:</span>
              {e.documents.length === 0 ? (
                <span className="text-xs font-semibold text-overdue">none attached</span>
              ) : (
                e.documents.map((d) => (
                  <a
                    key={d.id}
                    href={`/api/requisitions/documents/${d.id}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-primary hover:bg-surface"
                  >
                    {d.fileName}
                  </a>
                ))
              )}
              {e.status === 'rejected' && e.decisionNote && (
                <span className="w-full text-xs text-overdue">Reason: {e.decisionNote}</span>
              )}
              {e.status === 'submitted' && basePath === '/owner' && (
                <Link href={`/owner/requisitions/${e.requisitionId}`} className="ml-auto text-xs font-semibold text-primary underline">
                  Verify →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RetirementDashboard({
  rows,
  entries,
  entriesAvailable,
  basePath,
  tab,
  tabs,
  viewerId,
  filters,
  staff,
}: {
  rows: RetirementRow[];
  entries: BoardEntry[];
  entriesAvailable: boolean;
  basePath: '/owner' | '/accountant';
  tab: RetirementTab;
  tabs: RetirementTab[];
  viewerId: string;
  filters: { from: string | null; to: string | null; staffId: string | null };
  staff: { id: string; name: string }[];
}) {
  const s = summarizeRetirements(rows);
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.staffId) query.set('staff', filters.staffId);
  const tabHref = (t: RetirementTab) => {
    const q = new URLSearchParams(query);
    q.set('tab', t);
    return `${basePath}/retirements?${q.toString()}`;
  };
  const exportQuery = query.toString();

  const TAB_LABELS: Record<RetirementTab, string> = {
    verify: `Awaiting verification (${s.awaitingVerificationCount})`,
    mine: 'My retirements',
    eligible: 'Eligible requests',
    active: 'Active requests',
    retired: 'Fully retired',
    summary: 'Summary table',
  };

  // "Mine" = requests I raised OR retired against: a request is often raised
  // by the Director on someone's behalf and retired by the person who spent.
  const myEntries = entries.filter((e) => e.submittedById === viewerId).reverse();
  const mineIds = new Set(myEntries.map((e) => e.requisitionId));
  const pendingEntries = entries.filter((e) => e.status === 'submitted');

  const visible =
    tab === 'verify'
      ? rows.filter((r) => r.pendingCount > 0)
      : tab === 'mine'
        ? rows.filter((r) => r.requestedById === viewerId || mineIds.has(r.id))
        : tab === 'eligible'
          ? rows.filter((r) => r.outstanding - r.pendingAmount > 0)
          : tab === 'retired'
            ? rows.filter((r) => r.state === 'fully_retired')
            : rows.filter((r) => r.state !== 'fully_retired');

  return (
    <div className="flex flex-col gap-5">
      {!entriesAvailable && (
        <p className="rounded-(--radius-card) border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Itemised retirement entries are not switched on yet (database migration 0036 pending).
          Figures below use the retirements recorded so far.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Paid requests" value={String(s.totalRequests)} accent="border-l-primary" />
        <Card label="Total paid" value={formatTZS(s.totalPaid)} accent="border-l-paid" />
        <Card label="Total retired" value={formatTZS(s.totalRetired)} accent="border-l-paid" />
        <Card label="Outstanding" value={formatTZS(s.totalOutstanding)} accent="border-l-warning" />
        <Card label="Overall retired" value={`${s.overallRetiredPercent.toFixed(2)}%`} accent="border-l-[#E8590C]" />
        <Card label="Fully retired" value={String(s.fullyRetired)} accent="border-l-paid" />
        <Card label="Partially retired" value={String(s.partiallyRetired)} accent="border-l-warning" />
        <Card
          label="Unretired"
          value={String(s.unretired)}
          hint={s.awaitingVerificationCount > 0 ? `${s.awaitingVerificationCount} entr${s.awaitingVerificationCount === 1 ? 'y' : 'ies'} awaiting verification · ${formatTZS(s.awaitingVerificationAmount)}` : undefined}
          accent="border-l-overdue"
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Days overdue breakdown (money not yet retired)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(Object.keys(AGING_LABELS) as AgingBucket[]).map((b) => (
            <div key={b} className={`rounded-(--radius-card) border border-border border-l-4 ${AGING_TONE[b]} bg-white p-3 text-center`}>
              <p className="text-xs text-muted-foreground">{AGING_LABELS[b]}</p>
              <p className="font-display text-2xl font-bold tabular-nums">{s.aging[b]}</p>
            </div>
          ))}
        </div>
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-(--radius-card) border border-border bg-white p-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Paid from</span>
          <input type="date" name="from" defaultValue={filters.from ?? ''} className="min-h-9 rounded-(--radius-card) border border-border px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Paid to</span>
          <input type="date" name="to" defaultValue={filters.to ?? ''} className="min-h-9 rounded-(--radius-card) border border-border px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Staff</span>
          <select name="staff" defaultValue={filters.staffId ?? ''} className="min-h-9 rounded-(--radius-card) border border-border px-2">
            <option value="">Everyone</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-9 rounded-(--radius-card) bg-primary px-4 font-semibold text-white">Apply</button>
        <Link href={`${basePath}/retirements?tab=${tab}`} className="min-h-9 px-2 py-2 text-muted-foreground underline">Clear</Link>
        <span className="ml-auto flex gap-2">
          <a href={`/api/reports/retirements/export?${exportQuery}${exportQuery ? '&' : ''}format=xlsx`} className="min-h-9 rounded-(--radius-card) border border-border px-3 py-2 font-semibold">Excel</a>
          <a href={`/api/reports/retirements/export?${exportQuery}${exportQuery ? '&' : ''}format=csv`} className="min-h-9 rounded-(--radius-card) border border-border px-3 py-2 font-semibold">CSV</a>
        </span>
      </form>

      <nav className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${t === tab ? 'border-primary text-primary-dark' : 'border-transparent text-muted-foreground'}`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {tab === 'mine' && myEntries.length > 0 && (
        <EntryList entries={myEntries} basePath={basePath} title="Retirements I submitted" showSubmitter={false} />
      )}
      {tab === 'verify' && pendingEntries.length > 0 && (
        <EntryList entries={pendingEntries} basePath={basePath} title="Entries to verify — open each receipt before deciding" showSubmitter />
      )}

      {tab === 'summary' ? (
        <StaffSummary rows={rows} />
      ) : visible.length === 0 ? (
        <p className="rounded-(--radius-card) border border-border bg-white p-6 text-center text-muted-foreground">
          {tab === 'verify' ? 'Nothing is waiting for your verification. ✓' : 'Nothing to show here.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-white">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">Held by</th>
                <th className="px-3 py-2 text-right">Paid out</th>
                <th className="px-3 py-2 text-right">Retired</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2 text-right">Retired %</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Days since payment</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`${basePath}/requisitions/${r.id}`} className="font-semibold text-primary-dark underline">
                      {r.requisitionNumber}
                    </Link>
                    <span className="block max-w-64 truncate text-xs text-muted-foreground">{r.title}</span>
                  </td>
                  <td className="px-3 py-2">{r.requestedByName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTZS(r.paidAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatTZS(r.retiredAmount)}
                    {r.pendingAmount > 0 && (
                      <span className="block text-xs text-warning">+{formatTZS(r.pendingAmount)} awaiting</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.outstanding > 0 ? 'font-semibold text-overdue' : ''}`}>
                    {formatTZS(r.outstanding)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.retiredPercent.toFixed(2)}%</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_TONE[r.state]}`}>{STATE_LABELS[r.state]}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${daysTone(r.state === 'fully_retired' ? 0 : r.daysSincePayment)}`}>
                      {r.daysSincePayment === null ? '—' : `${r.daysSincePayment} days`}
                    </span>
                    {r.paidDate && <span className="block text-xs text-muted-foreground">{formatDate(r.paidDate)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StaffSummary({ rows }: { rows: RetirementRow[] }) {
  const people = summarizeByStaff(rows);
  if (people.length === 0) {
    return <p className="rounded-(--radius-card) border border-border bg-white p-6 text-center text-muted-foreground">No paid requests yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-white">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Staff</th>
            <th className="px-3 py-2 text-right">Requests</th>
            <th className="px-3 py-2 text-right">Paid out</th>
            <th className="px-3 py-2 text-right">Retired</th>
            <th className="px-3 py-2 text-right">Outstanding</th>
            <th className="px-3 py-2 text-right">Retired %</th>
            <th className="px-3 py-2 text-right">Oldest unretired</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.staffId} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-semibold">{p.staffName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.requests}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTZS(p.paid)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTZS(p.retired)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${p.outstanding > 0 ? 'font-semibold text-overdue' : ''}`}>{formatTZS(p.outstanding)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.retiredPercent.toFixed(2)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.oldestOutstandingDays === null ? '—' : `${p.oldestOutstandingDays} days`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
