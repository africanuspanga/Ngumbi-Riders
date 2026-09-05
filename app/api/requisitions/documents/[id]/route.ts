import { NextResponse } from 'next/server';
import { checkPermission } from '@/lib/auth/session';
import { requisitionDocumentUrl } from '@/lib/requisitions/actions';

/*
 * Open one supporting document. The requisition-documents bucket is PRIVATE
 * (0028), so the file is reached through a 120-second signed URL minted here
 * after the permission check — the same pattern every other document in this
 * system uses (spec §24). The URL is never embedded in a page, so it cannot
 * outlive the click that produced it.
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
  const signed = await requisitionDocumentUrl(id);
  if (!signed.ok || !signed.data) {
    return NextResponse.json({ error: signed.ok ? 'not_found' : signed.error }, { status: 404 });
  }
  return NextResponse.redirect(signed.data.url);
}
