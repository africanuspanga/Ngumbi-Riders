import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  validateFile,
  ACCEPTED_EXTENSIONS,
  APPLICANT_DOC_TYPES,
  GUARANTOR_DOC_TYPES,
} from '@/lib/applications/documents';
import { fileSignatureMatches } from '@/lib/applications/file-signature';
import { verifyUploadToken } from '@/lib/applications/upload-token';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/request';

/*
 * Public per-document upload for a freshly submitted application (spec §8.3,
 * §8.4, §24). One file per request — 13 documents in one multipart body would
 * exceed Vercel's ~4.5 MB request cap. Authorization is the short-lived signed
 * token issued by POST /api/applications; scope/docType are allowlisted, and
 * the file's leading bytes must match its claimed MIME type before storage.
 * Uploads are idempotent (upsert) so the client can safely retry.
 */
export const runtime = 'nodejs';
// A 4 MiB upload on a slow mobile link + magic-byte scan needs headroom.
export const maxDuration = 60;

const SCOPES = ['applicant', 'guarantor'] as const;

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? ext : 'bin';
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const limit = await enforceRateLimit('upload_sign', ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const token = form.get('token');
  const scope = form.get('scope');
  const docType = form.get('docType');
  const file = form.get('file');
  if (
    typeof token !== 'string' ||
    typeof scope !== 'string' ||
    typeof docType !== 'string' ||
    !(file instanceof File)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const applicationId = verifyUploadToken(token);
  if (!applicationId) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  // Allowlisted scope + doc type only — these become storage keys and the
  // doc_type column, so free-form values are never accepted.
  if (!(SCOPES as readonly string[]).includes(scope)) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 422 });
  }
  const allowedTypes: readonly string[] =
    scope === 'applicant' ? APPLICANT_DOC_TYPES : GUARANTOR_DOC_TYPES;
  if (!allowedTypes.includes(docType)) {
    return NextResponse.json({ error: 'invalid_doc_type' }, { status: 422 });
  }

  const check = validateFile({ name: file.name, type: file.type, size: file.size });
  if (!check.ok) {
    return NextResponse.json({ error: 'file_rejected', reason: check.reason }, { status: 422 });
  }
  // Confirm the real leading bytes match the claimed type — a lying MIME
  // type / extension is not enough to get a file stored (spec §8.6, §24).
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!fileSignatureMatches(head, file.type)) {
    return NextResponse.json({ error: 'file_rejected', reason: 'signature' }, { status: 422 });
  }

  const admin = createAdminClient();

  // Documents may only be attached while the application awaits review.
  const { data: app } = await admin
    .from('rider_applications')
    .select('id, status')
    .eq('id', applicationId)
    .maybeSingle();
  if (!app || (app as { status: string }).status !== 'submitted') {
    return NextResponse.json({ error: 'not_accepting_documents' }, { status: 409 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = extOf(file.name);

  // Upload failures must be visible to the client (which retries) — never
  // silently accept an application document that was not stored. Metadata
  // rows are idempotent: a retry of the same document updates the path
  // (the extension may differ between attempts) instead of duplicating.
  if (scope === 'applicant') {
    const path = `${applicationId}/${docType}.${ext}`;
    const { error: upErr } = await admin.storage
      .from('application-documents')
      .upload(path, buffer, { contentType: file.type, upsert: true });
    if (upErr) return NextResponse.json({ error: 'upload_failed' }, { status: 500 });

    const { data: existing } = await admin
      .from('application_documents')
      .select('id')
      .eq('application_id', applicationId)
      .eq('doc_type', docType)
      .maybeSingle();
    const { error } = existing
      ? await admin
          .from('application_documents')
          .update({ storage_path: path })
          .eq('id', (existing as { id: string }).id)
      : await admin
          .from('application_documents')
          .insert({ application_id: applicationId, doc_type: docType, storage_path: path });
    if (error) return NextResponse.json({ error: 'record_failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Build spec #4 — a single guarantor per application.
  const { data: gRows } = await admin
    .from('guarantors')
    .select('id')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: true })
    .limit(1);
  const guarantorId = ((gRows ?? []) as { id: string }[])[0]?.id;
  if (!guarantorId) {
    return NextResponse.json({ error: 'guarantor_not_found' }, { status: 409 });
  }
  const path = `${applicationId}/${guarantorId}/${docType}.${ext}`;
  const { error: upErr } = await admin.storage
    .from('guarantor-documents')
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: 'upload_failed' }, { status: 500 });

  const { data: existing } = await admin
    .from('guarantor_documents')
    .select('id')
    .eq('guarantor_id', guarantorId)
    .eq('doc_type', docType)
    .maybeSingle();
  const { error } = existing
    ? await admin
        .from('guarantor_documents')
        .update({ storage_path: path })
        .eq('id', (existing as { id: string }).id)
    : await admin
        .from('guarantor_documents')
        .insert({ guarantor_id: guarantorId, doc_type: docType, storage_path: path });
  if (error) return NextResponse.json({ error: 'record_failed' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
