import { NextResponse } from 'next/server';
import { checkPermission } from '@/lib/auth/session';
import { getContractPerformanceReport } from '@/lib/contracts/performance-queries';
import { renderPerformancePdf } from '@/lib/contracts/performance-pdf';

/*
 * Printable rider performance report for one contract (client request
 * 2026-10-23) — when the rider started, what they paid and what they still
 * owed at termination. Staff only (`contracts.read`); generated per request
 * from the ledger and never cached.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await checkPermission('contracts.read');
  if (!actor || (actor.role !== 'owner' && actor.role !== 'accountant')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const report = await getContractPerformanceReport(id);
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const pdf = await renderPerformancePdf(report, actor.fullName ?? 'Ng’umbi Riders');
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      // inline: opens in the browser's viewer, where Print is one click.
      'content-disposition': `inline; filename="performance-${report.contractNumber}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
