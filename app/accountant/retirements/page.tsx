import { requireAccountant } from '@/lib/auth/session';
import { getRetirementBoard, listRetirementStaff } from '@/lib/requisitions/retirement-queries';
import { RetirementDashboard, type RetirementTab } from '@/components/requisitions/RetirementDashboard';

export const metadata = { title: 'Retirements' };

const TABS: RetirementTab[] = ['mine', 'eligible', 'active', 'retired', 'summary'];
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Retirements for the finance team (client request
 * 2026-10-23): requests eligible to retire, their own retirements and the
 * same performance figures the Managing Director sees.
 */
export default async function AccountantRetirementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const profile = await requireAccountant();
  const sp = await searchParams;
  const filters = {
    from: date(sp.from),
    to: date(sp.to),
    staffId: sp.staff && /^[0-9a-f-]{36}$/i.test(sp.staff) ? sp.staff : null,
  };
  const [board, staff] = await Promise.all([getRetirementBoard(filters), listRetirementStaff()]);
  const tab = TABS.includes(sp.tab as RetirementTab) ? (sp.tab as RetirementTab) : 'eligible';

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Retirement management</h1>
        <p className="text-sm text-muted-foreground">
          Money released against approved purchase requests, and how much of it has been accounted for.
        </p>
      </header>
      <RetirementDashboard
        rows={board.rows}
        entriesAvailable={board.entriesAvailable}
        basePath="/accountant"
        tab={tab}
        tabs={TABS}
        viewerId={profile.userId}
        filters={filters}
        staff={staff}
      />
    </div>
  );
}
