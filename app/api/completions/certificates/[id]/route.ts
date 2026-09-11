import { NextResponse } from 'next/server';
import { certificateUrl } from '@/lib/completion/actions';

/*
 * Download a certificate of accomplishment.
 *
 * The contract-certificates bucket is PRIVATE (0034), so the file is reached
 * through a 120-second signed URL minted server-side after the authorisation
 * check. `certificateUrl` does that check itself, including letting a RIDER
 * fetch their own certificate and nobody else's — so this route stays a thin
 * redirect and there is exactly one place the rule lives.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const signed = await certificateUrl(id);
  if (!signed.ok || !signed.data) {
    const status = signed.ok ? 404 : signed.error === 'forbidden' ? 403 : 404;
    return NextResponse.json({ error: signed.ok ? 'not_found' : signed.error }, { status });
  }
  return NextResponse.redirect(signed.data.url);
}
