import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getDepartmentDetail } from '@/lib/departments/detail';
import { localDateString } from '@/lib/dates/tz';
import { parseFilters } from '@/lib/reports/cashflow';
import { DepartmentDetailView } from '@/components/departments/DepartmentDetailView';

export const metadata = { title: 'Department' };

export default async function OwnerDepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  const today = localDateString();
  const filters = parseFilters(sp, { from: `${today.slice(0, 7)}-01`, to: today });

  const detail = await getDepartmentDetail(id, { from: filters.from, to: filters.to });
  if (!detail) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/owner/departments" className="text-sm font-medium text-muted-foreground">
        ← Departments
      </Link>
      <DepartmentDetailView detail={detail} basePath="/owner" canManageBudgets />
    </div>
  );
}
