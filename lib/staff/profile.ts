'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { checkPermission, getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { createNotification, notifyOwner } from '@/lib/notifications/service';
import { sniffFileType } from '@/lib/applications/file-signature';
import {
  CERTIFICATE_KINDS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  MAX_CERTIFICATE_BYTES,
  MAX_CERTIFICATES,
  type EmploymentStatus,
  type StaffCertificateKind,
} from './profile-constants';

/*
 * STAFF / ADMINISTRATION PROFILES (client feedback 2026-09-11 #9).
 *
 * "Full name, phone, email, role, education profile, work experience,
 *  employment status, attached certificates, start date, notes. When these
 *  details are entered, the staff profile should go to the director for review
 *  or approval."
 *
 * WHO MAY CHANGE WHAT — the whole design in four lines:
 *
 *   an employee   edits their OWN record and submits it for review. They may
 *                 NOT set their own employment status; that is the Director's.
 *   the Director  edits anyone's, approves or returns a submission, and is the
 *                 only role that sets an employment status.
 *   an accountant sees nobody else's record. It is not finance data, and 0035
 *                 gives them no policy on the table.
 *
 * `staff_profiles` carries no name, email or role: those live on `profiles` and
 * duplicating them guarantees two answers to one question the first time
 * somebody is renamed.
 *
 * EMPLOYMENT STATUS IS NOT SYSTEM ACCESS. Marking someone 'terminated' here
 * records an HR fact; it does not sign them out. Revoking access is a separate,
 * deliberate act at /owner/staff, and conflating the two would mean a mistyped
 * dropdown could lock a colleague out of the system mid-shift.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

const profileSchema = z
  .object({
    phone: z.string().trim().max(32).optional().or(z.literal('')),
    jobTitle: z.string().trim().max(120).optional().or(z.literal('')),
    startDate: isoDate.optional().or(z.literal('')),
    endDate: isoDate.optional().or(z.literal('')),
    education: z.string().trim().max(4000).optional().or(z.literal('')),
    workExperience: z.string().trim().max(4000).optional().or(z.literal('')),
    notes: z.string().trim().max(4000).optional().or(z.literal('')),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  });

function revalidateStaffSurfaces(profileId?: string) {
  revalidatePath('/owner/staff-profiles');
  revalidatePath('/accountant/profile');
  revalidatePath('/owner/staff');
  if (profileId) revalidatePath(`/owner/staff-profiles/${profileId}`);
}

type Admin = ReturnType<typeof createAdminClient>;

/** The staff_profiles row for a profile, creating an empty one on first visit. */
async function ensureRow(admin: Admin, profileId: string): Promise<string | null> {
  const { data } = await admin
    .from('staff_profiles')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();
  const existing = (data as { id: string } | null)?.id;
  if (existing) return existing;

  const { data: created, error } = await admin
    .from('staff_profiles')
    .insert({ profile_id: profileId })
    .select('id')
    .single();
  if (error || !created) {
    // 23505 = somebody else created it in the same breath; read it back.
    if (error?.code === '23505') {
      const { data: retry } = await admin
        .from('staff_profiles')
        .select('id')
        .eq('profile_id', profileId)
        .maybeSingle();
      return (retry as { id: string } | null)?.id ?? null;
    }
    return null;
  }
  return (created as { id: string }).id;
}

/**
 * Who may write to a given staff record: its owner, or the Director.
 *
 * Returned as a discriminated result rather than a boolean so the caller can
 * tell "not allowed" from "no such record", which need different messages.
 */
async function authoriseWrite(
  admin: Admin,
  targetProfileId: string,
): Promise<
  | { ok: true; actor: { userId: string; role: string; fullName: string | null }; isDirector: boolean }
  | { ok: false; error: string }
> {
  const actor = await checkPermission('staff_profiles.write');
  if (!actor) return { ok: false, error: 'forbidden' };
  const isDirector = actor.role === 'owner';
  if (!isDirector && actor.userId !== targetProfileId) return { ok: false, error: 'forbidden' };
  return { ok: true, actor, isDirector };
}

/* ------------------------------------------------------------------------ *
 * The record itself
 * ------------------------------------------------------------------------ */

export async function saveStaffProfile(
  targetProfileId: string,
  input: unknown,
): Promise<ActionResult> {
  const admin = createAdminClient();
  const auth = await authoriseWrite(admin, targetProfileId);
  if (!auth.ok) return auth;

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const id = await ensureRow(admin, targetProfileId);
  if (!id) return { ok: false, error: 'server_error' };

  // NOTE what is absent: employment_status and review_status. An employee
  // cannot promote themselves, and saving a draft does not silently submit it.
  const { error } = await admin
    .from('staff_profiles')
    .update({
      phone: parsed.data.phone?.trim() || null,
      job_title: parsed.data.jobTitle?.trim() || null,
      start_date: parsed.data.startDate || null,
      end_date: parsed.data.endDate || null,
      education: parsed.data.education?.trim() || null,
      work_experience: parsed.data.workExperience?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
    })
    .eq('id', id);
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: auth.actor.userId,
    actorRole: auth.actor.role as 'owner',
    action: 'staff_profile.saved',
    entityType: 'staff_profile',
    entityId: id,
    metadata: { targetProfileId, byDirector: auth.isDirector },
  });

  revalidateStaffSurfaces(targetProfileId);
  return { ok: true };
}

/** Send the record to the Managing Director for review. */
export async function submitStaffProfile(targetProfileId: string): Promise<ActionResult> {
  const admin = createAdminClient();
  const auth = await authoriseWrite(admin, targetProfileId);
  if (!auth.ok) return auth;

  const id = await ensureRow(admin, targetProfileId);
  if (!id) return { ok: false, error: 'server_error' };

  const { data: changed, error } = await admin
    .from('staff_profiles')
    .update({ review_status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', id)
    .in('review_status', ['draft', 'returned', 'submitted'])
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!changed || changed.length === 0) return { ok: false, error: 'already_approved' };

  const { data: who } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', targetProfileId)
    .maybeSingle();
  const name =
    (who as { full_name: string | null; email: string | null } | null)?.full_name ??
    (who as { email: string | null } | null)?.email ??
    'A staff member';

  await notifyOwner({
    type: 'staff_profile_submitted',
    title: 'Staff profile awaiting your review',
    body: `${name} has submitted their staff profile for approval.`,
    deepLink: `/owner/staff-profiles/${targetProfileId}`,
    // Keyed on the SUBMISSION, not the profile: a second submission after a
    // return is a new thing the Director needs to hear about.
    dedupeKey: `staff_profile_submitted:${id}:${Date.now()}`,
  });

  await writeAudit({
    actorId: auth.actor.userId,
    actorRole: auth.actor.role as 'owner',
    action: 'staff_profile.submitted',
    entityType: 'staff_profile',
    entityId: id,
    metadata: { targetProfileId },
  });

  revalidateStaffSurfaces(targetProfileId);
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * The Director's decisions
 * ------------------------------------------------------------------------ */

export async function reviewStaffProfile(
  targetProfileId: string,
  decision: 'approved' | 'returned',
  note?: string,
): Promise<ActionResult> {
  const actor = await checkPermission('staff_profiles.review');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  if (decision === 'returned' && (note?.trim()?.length ?? 0) < 3) {
    return { ok: false, error: 'reason_required' };
  }

  const admin = createAdminClient();
  const id = await ensureRow(admin, targetProfileId);
  if (!id) return { ok: false, error: 'not_found' };

  const { error } = await admin
    .from('staff_profiles')
    .update({
      review_status: decision,
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim()?.slice(0, 2000) || null,
    })
    .eq('id', id);
  if (error) return { ok: false, error: 'server_error' };

  await createNotification({
    profileId: targetProfileId,
    type: 'staff_profile_reviewed',
    title: decision === 'approved' ? 'Your staff profile was approved' : 'Your staff profile needs changes',
    body:
      decision === 'approved'
        ? 'The Managing Director approved your staff profile.'
        : (note?.trim() ?? 'The Managing Director asked for changes.'),
    deepLink: '/accountant/profile',
    dedupeKey: `staff_profile_reviewed:${id}:${decision}:${Date.now()}`,
  });

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: `staff_profile.${decision}`,
    entityType: 'staff_profile',
    entityId: id,
    metadata: { targetProfileId, note: note?.trim() || null },
  });

  revalidateStaffSurfaces(targetProfileId);
  return { ok: true };
}

/**
 * Set someone's employment status. DIRECTOR ONLY.
 *
 * Records an HR fact and nothing more — see the header: it does not touch
 * `profiles.is_active`, so nobody is signed out by a dropdown. The audit row
 * names both statuses so the change is traceable.
 */
export async function setEmploymentStatus(
  targetProfileId: string,
  status: EmploymentStatus,
): Promise<ActionResult> {
  const actor = await checkPermission('staff_profiles.review');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  if (!EMPLOYMENT_STATUSES.includes(status)) return { ok: false, error: 'invalid_status' };

  const admin = createAdminClient();
  const id = await ensureRow(admin, targetProfileId);
  if (!id) return { ok: false, error: 'not_found' };

  const { data: before } = await admin
    .from('staff_profiles')
    .select('employment_status')
    .eq('id', id)
    .maybeSingle();
  const from = (before as { employment_status: EmploymentStatus } | null)?.employment_status;

  const { error } = await admin
    .from('staff_profiles')
    .update({ employment_status: status })
    .eq('id', id);
  if (error) return { ok: false, error: 'server_error' };

  await createNotification({
    profileId: targetProfileId,
    type: 'staff_employment_status',
    title: 'Your employment status was updated',
    body: `It is now recorded as: ${EMPLOYMENT_STATUS_LABELS[status]}.`,
    deepLink: '/accountant/profile',
    dedupeKey: `staff_employment:${id}:${status}:${Date.now()}`,
  });

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'staff_profile.employment_status_changed',
    entityType: 'staff_profile',
    entityId: id,
    metadata: { targetProfileId, from: from ?? null, to: status },
  });

  revalidateStaffSurfaces(targetProfileId);
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------------ */

/**
 * Attach one certificate. One file per request (D-030): Vercel rejects a body
 * over ~4.5 MB with an opaque 413, and a scanned degree certificate is easily
 * 3 MB on its own.
 *
 * The BYTES decide the type, never the filename or the browser-supplied
 * Content-Type — the same magic-byte sniffer the public application uploader
 * has used since Phase 2 (spec §24).
 */
export async function uploadStaffCertificate(
  formData: FormData,
): Promise<ActionResult<{ id: string; fileName: string }>> {
  const targetProfileId = formData.get('profileId');
  if (typeof targetProfileId !== 'string' || !targetProfileId) {
    return { ok: false, error: 'bad_request' };
  }

  const admin = createAdminClient();
  const auth = await authoriseWrite(admin, targetProfileId);
  if (!auth.ok) return auth;

  const file = formData.get('file');
  const rawKind = formData.get('kind');
  const title = formData.get('title');
  const issuer = formData.get('issuer');
  const issuedOn = formData.get('issuedOn');

  const kind: StaffCertificateKind =
    typeof rawKind === 'string' && (CERTIFICATE_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as StaffCertificateKind)
      : 'other';
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_CERTIFICATE_BYTES) return { ok: false, error: 'too_large' };
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  if (trimmedTitle.length < 2) return { ok: false, error: 'title_required' };

  const staffProfileId = await ensureRow(admin, targetProfileId);
  if (!staffProfileId) return { ok: false, error: 'server_error' };

  const { count } = await admin
    .from('staff_certificates')
    .select('id', { count: 'exact', head: true })
    .eq('staff_profile_id', staffProfileId);
  if ((count ?? 0) >= MAX_CERTIFICATES) return { ok: false, error: 'too_many' };

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffFileType(buffer);
  if (!sniffed) return { ok: false, error: 'invalid_type' };
  const mime =
    sniffed === 'pdf'
      ? 'application/pdf'
      : sniffed === 'jpeg'
        ? 'image/jpeg'
        : sniffed === 'png'
          ? 'image/png'
          : 'image/webp';
  const ext = sniffed === 'jpeg' ? 'jpg' : sniffed;

  const hash = createHash('sha256').update(buffer).digest('hex');
  const path = `${targetProfileId}/${Date.now()}-${hash.slice(0, 8)}.${ext}`;
  const { error: upErr } = await admin.storage
    .from('staff-documents')
    .upload(path, buffer, { contentType: mime });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { data: row, error } = await admin
    .from('staff_certificates')
    .insert({
      staff_profile_id: staffProfileId,
      kind,
      title: trimmedTitle.slice(0, 200),
      issuer: typeof issuer === 'string' ? issuer.trim().slice(0, 200) || null : null,
      issued_on:
        typeof issuedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(issuedOn) ? issuedOn : null,
      file_name: file.name.slice(0, 255),
      storage_path: path,
      mime_type: mime,
      size_bytes: file.size,
      sha256_hash: hash,
      uploaded_by: auth.actor.userId,
    })
    .select('id')
    .single();
  if (error || !row) {
    // Never leave an orphan in the bucket when its row failed to write.
    await admin.storage.from('staff-documents').remove([path]);
    return { ok: false, error: 'insert_failed' };
  }

  await writeAudit({
    actorId: auth.actor.userId,
    actorRole: auth.actor.role as 'owner',
    action: 'staff_profile.certificate_uploaded',
    entityType: 'staff_certificate',
    entityId: (row as { id: string }).id,
    metadata: { targetProfileId, kind, title: trimmedTitle.slice(0, 120), sha256: hash },
  });

  revalidateStaffSurfaces(targetProfileId);
  return { ok: true, data: { id: (row as { id: string }).id, fileName: file.name } };
}

/** Remove a certificate the employee (or the Director) attached in error. */
export async function deleteStaffCertificate(certificateId: string): Promise<ActionResult> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('staff_certificates')
    .select('id, storage_path, title, staff_profile_id, staff_profiles(profile_id)')
    .eq('id', certificateId)
    .maybeSingle();
  const cert = data as unknown as {
    id: string;
    storage_path: string;
    title: string;
    staff_profile_id: string;
    staff_profiles: { profile_id: string } | null;
  } | null;
  if (!cert?.staff_profiles) return { ok: false, error: 'not_found' };

  const auth = await authoriseWrite(admin, cert.staff_profiles.profile_id);
  if (!auth.ok) return auth;

  const { error } = await admin.from('staff_certificates').delete().eq('id', certificateId);
  if (error) return { ok: false, error: 'server_error' };
  // Best-effort: the row is the record, and an orphan object costs storage, not
  // correctness.
  await admin.storage.from('staff-documents').remove([cert.storage_path]);

  await writeAudit({
    actorId: auth.actor.userId,
    actorRole: auth.actor.role as 'owner',
    action: 'staff_profile.certificate_deleted',
    entityType: 'staff_certificate',
    entityId: certificateId,
    metadata: { title: cert.title, targetProfileId: cert.staff_profiles.profile_id },
  });

  revalidateStaffSurfaces(cert.staff_profiles.profile_id);
  return { ok: true };
}

/**
 * A short-lived signed URL for one certificate. The bucket is PRIVATE (0035),
 * so the file is only ever reached through a URL minted here after the
 * authorisation check, and never embedded in a page.
 */
export async function staffCertificateUrl(
  certificateId: string,
): Promise<ActionResult<{ url: string }>> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('staff_certificates')
    .select('id, storage_path, staff_profiles(profile_id)')
    .eq('id', certificateId)
    .maybeSingle();
  const cert = data as unknown as {
    id: string;
    storage_path: string;
    staff_profiles: { profile_id: string } | null;
  } | null;
  if (!cert?.staff_profiles) return { ok: false, error: 'not_found' };

  // The Director reads anyone's; everybody else reads only their own. An
  // accountant has no business in a colleague's education history.
  const isDirector = profile.role === 'owner';
  if (!isDirector && profile.userId !== cert.staff_profiles.profile_id) {
    return { ok: false, error: 'forbidden' };
  }

  const { data: signed, error } = await admin.storage
    .from('staff-documents')
    .createSignedUrl(cert.storage_path, 120);
  if (error || !signed?.signedUrl) return { ok: false, error: 'sign_failed' };
  return { ok: true, data: { url: signed.signedUrl } };
}
