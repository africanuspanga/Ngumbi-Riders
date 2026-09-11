import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getDepartmentDetail } from '@/lib/departments/detail';
import { localDateString } from '@/lib/dates/tz';
import { parseFilters } from '@/lib/reports/cashflow';
import { DepartmentDetailView } from '@/components/departments/DepartmentDetailView';

export const metadata = { title: 'Department' };

export default async function AccountantDepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAccountant();
  const { id } = await params;
  const sp = await searchParams;
  const today = localDateString();
  const filters = parseFilters(sp, { from: `${today.slice(0, 7)}-01`, to: today });

  const detail = await getDepartmentDetail(id, { from: filters.from, to: filters.to });
  if (!detail) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/accountant/departments" className="text-sm font-medium text-muted-foreground">
        ← Departments
      </Link>
      {/* canManageBudgets is false: budgets are the Director's (see 0030 §RLS
          and lib/auth/roles.ts). The board still shows them. */}
      <DepartmentDetailView detail={detail} basePath="/accountant" canManageBudgets={false} />
    </div>
  );
}
