import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applicationSchema } from '@/lib/validation/application';
import { encryptPII } from '@/lib/security/crypto';
import { normalizePhone } from '@/lib/auth/phone';
import { formatApplicationReference } from '@/lib/applications/reference';
import { validateFile, ACCEPTED_EXTENSIONS } from '@/lib/applications/documents';
import { fileSignatureMatches } from '@/lib/applications/file-signature';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/request';

/*
 * Public rider application submission (spec §8, §23.3). Anonymous users have no
 * direct table/bucket access; everything goes through this validated server
 * endpoint using the service-role client. The client is never trusted — the
 * payload is re-validated here and sensitive identifiers are encrypted before
 * insert (spec §25.1).
 *
 * NOTE: activates once Supabase credentials are configured. Until then it
 * returns a clear error. Duplicate detection currently keys on phone (plaintext);
 * a deterministic blind-index for NIDA/licence is a tracked follow-up.
 */
export const runtime = 'nodejs';

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? ext : 'bin';
}

export async function POST(request: NextRequest) {
  // Throttle public submissions per IP (spec §25.2).
  const ip = getClientIp(request.headers);
  const limit = await enforceRateLimit('application_submit', ip);
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

  // ---- Validate the text payload -----------------------------------------
  const rawPayload = form.get('payload');
  if (typeof rawPayload !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawPayload);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = applicationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 422 });
  }
  const data = parsed.data;
  const primaryPhone = normalizePhone(data.primaryPhone);

  // ---- Re-validate uploaded files server-side ----------------------------
  const docEntries = [...form.entries()].filter(
    ([k, v]) => k.startsWith('doc:') && v instanceof File,
  ) as [string, File][];
  for (const [, file] of docEntries) {
    const check = validateFile({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      return NextResponse.json(
        { error: 'file_rejected', reason: check.reason },
        { status: 422 },
      );
    }
    // Confirm the real leading bytes match the claimed type — a lying MIME
    // type / extension is not enough to get a file stored (spec §8.6, §24).
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!fileSignatureMatches(head, file.type)) {
      return NextResponse.json(
        { error: 'file_rejected', reason: 'signature' },
        { status: 422 },
      );
    }
  }

  const admin = createAdminClient();

  // ---- Duplicate detection (warn, never silently block — spec §8.6) ------
  // Surfaced to the owner; here we flag but still accept the application.
  const { data: dupApps } = await admin
    .from('rider_applications')
    .select('id')
    .eq('primary_phone', primaryPhone)
    .limit(1);
  const { data: dupRiders } = await admin
    .from('riders')
    .select('id')
    .eq('phone', primaryPhone)
    .limit(1);
  const duplicateFlags: string[] = [];
  if (dupApps && dupApps.length > 0) duplicateFlags.push('phone_matches_application');
  if (dupRiders && dupRiders.length > 0) duplicateFlags.push('phone_matches_rider');

  // ---- Allocate a human-readable reference (retry on race) ---------------
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;

  let applicationId: string | null = null;
  let reference = '';
  for (let attempt = 0; attempt < 3 && !applicationId; attempt++) {
    const { count } = await admin
      .from('rider_applications')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yearStart)
      .lt('created_at', yearEnd);
    reference = formatApplicationReference(year, (count ?? 0) + 1 + attempt);

    const { data: inserted, error } = await admin
      .from('rider_applications')
      .insert({
        reference,
        status: 'submitted',
        first_name: data.firstName,
        middle_name: data.middleName || null,
        last_name: data.lastName,
        date_of_birth: data.dateOfBirth,
        gender: data.gender,
        primary_phone: primaryPhone,
        alternative_phone: data.alternativePhone || null,
        email: data.email || null,
        region: data.region,
        district: data.district,
        ward: data.ward,
        street: data.street,
        full_address: data.fullAddress,
        nida_number_encrypted: encryptPII(data.nidaNumber),
        driving_licence_encrypted: encryptPII(data.drivingLicenceNumber),
        previous_experience: data.previousExperience || null,
        emergency_contact_name: data.emergencyContactName,
        emergency_contact_phone: data.emergencyContactPhone,
        emergency_contact_relationship: data.emergencyContactRelationship,
        duplicate_flags: duplicateFlags,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (!error && inserted) {
      applicationId = (inserted as { id: string }).id;
    } else if (error && !/duplicate key/i.test(error.message)) {
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
  }
  if (!applicationId) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  // ---- Guarantors ---------------------------------------------------------
  const guarantors = [data.guarantorOne, data.guarantorTwo];
  const guarantorIds: string[] = [];
  for (const g of guarantors) {
    const { data: gRow, error: gErr } = await admin
      .from('guarantors')
      .insert({
        application_id: applicationId,
        full_name: g.fullName,
        phone: g.phone,
        nida_number_encrypted: encryptPII(g.nidaNumber),
        residential_address: g.residentialAddress,
        relationship: g.relationship,
        occupation: g.occupation,
        employer: g.employer || null,
      })
      .select('id')
      .single();
    if (gErr || !gRow) {
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    guarantorIds.push((gRow as { id: string }).id);
  }

  // ---- Upload documents to private buckets --------------------------------
  for (const [key, file] of docEntries) {
    const docKey = key.slice('doc:'.length); // e.g. applicant.nida_front
    const [scope, docType] = docKey.split('.');
    if (!scope || !docType) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = extOf(file.name);

    if (scope === 'applicant') {
      const path = `${applicationId}/${docType}.${ext}`;
      const { error } = await admin.storage
        .from('application-documents')
        .upload(path, buffer, { contentType: file.type, upsert: true });
      if (!error) {
        await admin.from('application_documents').insert({
          application_id: applicationId,
          doc_type: docType,
          storage_path: path,
        });
      }
    } else {
      const gIndex = scope === 'guarantorOne' ? 0 : 1;
      const guarantorId = guarantorIds[gIndex];
      const path = `${applicationId}/${guarantorId}/${docType}.${ext}`;
      const { error } = await admin.storage
        .from('guarantor-documents')
        .upload(path, buffer, { contentType: file.type, upsert: true });
      if (!error && guarantorId) {
        await admin.from('guarantor_documents').insert({
          guarantor_id: guarantorId,
          doc_type: docType,
          storage_path: path,
        });
      }
    }
  }

  // ---- Drawn signature (transparent PNG data URL) -------------------------
  if (data.signature.startsWith('data:image/')) {
    const base64 = data.signature.split(',')[1] ?? '';
    const sigBuffer = Buffer.from(base64, 'base64');
    const path = `${applicationId}/signature.png`;
    const { error } = await admin.storage
      .from('application-documents')
      .upload(path, sigBuffer, { contentType: 'image/png', upsert: true });
    if (!error) {
      await admin.from('application_documents').insert({
        application_id: applicationId,
        doc_type: 'signature',
        storage_path: path,
      });
    }
  }

  return NextResponse.json({ ok: true, reference, applicationId });
}
