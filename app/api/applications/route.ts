import { NextResponse, after, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applicationSchema } from '@/lib/validation/application';
import { encryptPII } from '@/lib/security/crypto';
import { normalizePhone } from '@/lib/auth/phone';
import { formatApplicationReference } from '@/lib/applications/reference';
import { createUploadToken } from '@/lib/applications/upload-token';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/request';
import { localDateString } from '@/lib/dates/tz';
import { enqueueSms, processOutbox } from '@/lib/messaging/outbox';
import { notifyOwner } from '@/lib/notifications/service';
import { serverEnv } from '@/lib/env';

/*
 * Public rider application submission (spec §8, §23.3). Anonymous users have no
 * direct table/bucket access; everything goes through this validated server
 * endpoint using the service-role client. The client is never trusted — the
 * payload is re-validated here and sensitive identifiers are encrypted before
 * insert (spec §25.1).
 *
 * Documents are NOT part of this request: 13 files in one multipart body blows
 * Vercel's ~4.5 MB request cap, so this endpoint returns a short-lived signed
 * upload token and the client posts each document individually to
 * /api/applications/documents.
 *
 * Duplicate detection currently keys on phone (plaintext); a deterministic
 * blind-index for NIDA/licence is a tracked follow-up.
 */
export const runtime = 'nodejs';

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

  // Encrypt the primary identity number into the column that matches its type,
  // and separately store an optional driving licence (build spec #3). The
  // driving licence is only mandatory when it IS the identity document.
  const idNumber = data.identityNumber.replace(/[\s-]/g, '');
  const nidaEncrypted = data.identityType === 'nida' ? encryptPII(idNumber) : null;
  const voterEncrypted = data.identityType === 'voter_id' ? encryptPII(idNumber) : null;
  const licenceEncrypted =
    data.identityType === 'driving_licence'
      ? encryptPII(idNumber)
      : data.drivingLicenceNumber
        ? encryptPII(data.drivingLicenceNumber.trim())
        : null;

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
  // Business year in EAT, not server-UTC (differs 21:00–24:00 UTC on Dec 31).
  const year = Number(localDateString().slice(0, 4));
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
        identity_type: data.identityType,
        nida_number_encrypted: nidaEncrypted,
        driving_licence_encrypted: licenceEncrypted,
        voter_id_encrypted: voterEncrypted,
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

  // ---- Guarantor (build spec #4: exactly one) -----------------------------
  const g = data.guarantor;
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

  // Notify the guarantor by SMS that they have been listed (build spec #4).
  // Enqueued to the outbox (delivered by the cron via Mobishastra) — a failure
  // here must NEVER fail the application, so it is best-effort and non-blocking.
  try {
    const applicantName = `${data.firstName} ${data.lastName}`.trim();
    await enqueueSms({
      recipient: normalizePhone(g.phone),
      subject: 'guarantor_listed',
      text:
        `Habari ${g.fullName}, umeorodheshwa kama mdhamini wa ${applicantName} ` +
        `katika mfumo wa maombi ya pikipiki wa Ng'umbi Riders. Kama si sahihi, ` +
        `tafadhali wasiliana na Ng'umbi Riders mara moja.`,
    });
  } catch {
    /* outbox enqueue is best-effort; the application still succeeds */
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

  // ---- Notify the owner of the new request (build spec #6) ----------------
  // In-app notification always; SMS to OWNER_NOTIFY_PHONE if configured. Both
  // best-effort — a notification failure must never fail the submission.
  try {
    const applicantName = `${data.firstName} ${data.lastName}`.trim();
    await notifyOwner({
      type: 'application_submitted',
      title: 'Ombi jipya la mwendeshaji',
      body: `${applicantName} amewasilisha ombi (${reference}).`,
      deepLink: `/owner/applications/${applicationId}`,
      dedupeKey: `application_submitted:${applicationId}`,
    });
    const ownerPhone = serverEnv().OWNER_NOTIFY_PHONE;
    if (ownerPhone) {
      await enqueueSms({
        recipient: ownerPhone,
        subject: 'application_submitted',
        text:
          `Ombi jipya la pikipiki limewasilishwa na ${applicantName} (${reference}). ` +
          `Tafadhali likague katika mfumo wa Ng'umbi Riders.`,
      });
    }
  } catch {
    /* best-effort owner alert; the application still succeeds */
  }

  // The enqueued SMS (guarantor confirmation + owner alert) would otherwise
  // wait for the ONCE-DAILY midnight outbox run — up to 24h late for messages
  // that are the point of spec #4/#6. Drain the outbox after the response is
  // sent; the outbox remains the durable retry path if this attempt fails.
  after(async () => {
    try {
      await processOutbox();
    } catch {
      /* the nightly outbox run retries anything left */
    }
  });

  // Documents are uploaded one-by-one via /api/applications/documents using
  // this short-lived capability token (Vercel request-size cap).
  const uploadToken = createUploadToken(applicationId);

  return NextResponse.json({ ok: true, reference, applicationId, uploadToken });
}
