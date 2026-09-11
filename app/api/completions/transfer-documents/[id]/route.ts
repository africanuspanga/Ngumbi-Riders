import { NextResponse } from 'next/server';
import { transferDocumentUrl } from '@/lib/completion/actions';

/*
 * Open one ownership-transfer document. STAFF ONLY — `transferDocumentUrl`
 * requires `completion.read`, which riders do not hold: the transfer paperwork
 * is the business's record and the rider receives the physical copy (0034 gives
 * them no read policy on that table either).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const signed = await transferDocumentUrl(id);
  if (!signed.ok || !signed.data) {
    const status = signed.ok ? 404 : signed.error === 'forbidden' ? 403 : 404;
    return NextResponse.json({ error: signed.ok ? 'not_found' : signed.error }, { status });
  }
  return NextResponse.redirect(signed.data.url);
}
