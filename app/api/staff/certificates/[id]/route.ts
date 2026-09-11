import { NextResponse } from 'next/server';
import { staffCertificateUrl } from '@/lib/staff/profile';

/*
 * Open one staff certificate. The staff-documents bucket is PRIVATE (0035), so
 * the file is reached through a 120-second signed URL minted server-side.
 * `staffCertificateUrl` makes the authorisation decision — the Director reads
 * anyone's, everybody else only their own — so this route stays a thin redirect
 * and there is exactly one place that rule lives.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const signed = await staffCertificateUrl(id);
  if (!signed.ok || !signed.data) {
    const status = signed.ok ? 404 : signed.error === 'forbidden' ? 403 : 404;
    return NextResponse.json({ error: signed.ok ? 'not_found' : signed.error }, { status });
  }
  return NextResponse.redirect(signed.data.url);
}
