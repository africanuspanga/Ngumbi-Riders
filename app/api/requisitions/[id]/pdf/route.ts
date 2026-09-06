import { NextResponse } from 'next/server';
import { checkPermission } from '@/lib/auth/session';
import { getRequisition } from '@/lib/requisitions/queries';
import { renderRequisitionPdf } from '@/lib/requisitions/pdf';

/*
 * Download a purchase requisition as a PDF (client feedback 2026-09-06).
 *
 * Available AT ANY STAGE, as asked — draft, submitted, approved, rejected —
 * and the document states which one on its face, so a draft can never be
 * mistaken for an authorisation once it is printed.
 *
 * `requisitions.read` is staff-only (owner + accountant), which is the same
 * permission that lets them see the request on screen; riders hold neither.
 * The PDF is generated per request rather than stored: it is derived entirely
 * from the row and its lines, so caching a copy would only create something
 * that could go stale against the record (D-034 rule 3).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await checkPermission('requisitions.read');
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await params;
  const requisition = await getRequisition(id);
  if (!requisition) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const pdf = await renderRequisitionPdf({
    requisitionNumber: requisition.requisitionNumber,
    title: requisition.title,
    description: requisition.description,
    department: requisition.department,
    fiscalYear: requisition.fiscalYear,
    requestDate: requisition.requestDate,
    currency: requisition.currency,
    paymentInformation: requisition.paymentInformation,
    status: requisition.status,
    paymentStatus: requisition.paymentStatus,
    requestedByName: requisition.requestedByName,
    approverName: requisition.approverName,
    decidedByName: requisition.decidedByName,
    decidedAt: requisition.decidedAt,
    decisionNote: requisition.decisionNote,
    paymentMarkedByName: requisition.paymentMarkedByName,
    paymentMarkedAt: requisition.paymentMarkedAt,
    paymentNote: requisition.paymentNote,
    submittedAt: requisition.submittedAt,
    createdAt: requisition.createdAt,
    items: requisition.items.map((i) => ({
      position: i.position,
      description: i.description,
      category: i.category,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      budgetCover: i.budgetCover,
    })),
    generatedByName: actor.fullName ?? 'Ng’umbi Riders',
  });

  // The requisition number carries slashes (REQ/2026/09/0030), which are not
  // legal in a filename — flattened to dashes so the browser saves it cleanly.
  const fileName = `${requisition.requisitionNumber.replace(/\//g, '-')}.pdf`;

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${fileName}"`,
      // Derived from live data and permission-checked per request: never store
      // it in a shared cache.
      'cache-control': 'private, no-store',
    },
  });
}
