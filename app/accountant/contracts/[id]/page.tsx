import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrinterIcon } from 'lucide-react';
import { requireAccountant } from '@/lib/auth/session';
import { getContractPerformanceReport } from '@/lib/contracts/performance-queries';
import { PerformanceReportView } from '@/components/contracts/PerformanceReportView';

export const metadata = { title: 'Rider performance report' };

/**
 * Read-only contract page for the finance team: the rider performance report
 * (client request 2026-10-23). Linked from the rider profile, which used to
 * point here at a page that did not exist.
 */
export default async function AccountantContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccountant();
  const { id } = await params;
  const report = await getContractPerformanceReport(id);
  if (!report) notFound();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/accountant/contracts" className="text-sm font-medium text-muted-foreground">
            ← Contracts
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {report.contractNumber} · {report.rider.name}
          </h1>
        </div>
        <a
          href={`/api/contracts/${id}/performance-report`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 rounded-(--radius-card) bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          <PrinterIcon className="size-4" /> Print / download PDF
        </a>
      </header>
      <PerformanceReportView report={report} />
    </div>
  );
}
