import { requireOwner } from '@/lib/auth/session';
import { getRetirementBoard, listRetirementStaff } from '@/lib/requisitions/retirement-queries';
import { RetirementDashboard, type RetirementTab } from '@/components/requisitions/RetirementDashboard';

export const metadata = { title: 'Retirements' };

const TABS: RetirementTab[] = ['verify', 'active', 'retired', 'summary'];
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Retirement Performance Monitoring for the Managing Director (client request
 * 2026-10-23): how much released money has been accounted for, who is holding
 * the rest and for how long, and the entries waiting for his verification.
 */
export default async function OwnerRetirementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const profile = await requireOwner();
  const sp = await searchParams;
  const filters = {
    from: date(sp.from),
    to: date(sp.to),
    staffId: sp.staff && /^[0-9a-f-]{36}$/i.test(sp.staff) ? sp.staff : null,
  };
  const [board, staff] = await Promise.all([getRetirementBoard(filters), listRetirementStaff()]);
  const awaiting = board.rows.some((r) => r.pendingCount > 0);
  const tab = TABS.includes(sp.tab as RetirementTab) ? (sp.tab as RetirementTab) : awaiting ? 'verify' : 'active';

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Retirement performance</h1>
        <p className="text-sm text-muted-foreground">
          Money released against approved purchase requests, and how much of it has been accounted for.
        </p>
      </header>
      <RetirementDashboard
        rows={board.rows}
        entries={board.entries}
        entriesAvailable={board.entriesAvailable}
        basePath="/owner"
        tab={tab}
        tabs={TABS}
        viewerId={profile.userId}
        filters={filters}
        staff={staff}
      />
    </div>
  );
}
