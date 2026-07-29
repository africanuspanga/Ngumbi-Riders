'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPermission, getSessionProfile } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit/audit';
import { sniffFileType } from '@/lib/applications/file-signature';
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from './photo-constants';

/*
 * Rider profile picture upload / replace (build spec #3).
 *
 * Rules enforced here, server-side, because a client-side check is decoration:
 *   • Only the OWNER may set a rider's picture. A rider cannot change their own
 *     (the photo is identity evidence attached to a lease), and definitely not
 *     anyone else's — the client explicitly asked that unauthorised users be
 *     prevented from changing another rider's picture.
 *   • The bytes must really be a JPEG/PNG/WebP: the magic-byte sniffer decides,
 *     not the filename or the browser-supplied Content-Type.
 *   • Size cap below Vercel's request limit.
 *   • Stored in the PRIVATE rider-documents bucket and served through
 *     short-lived signed URLs — identity material never lands in a public
 *     bucket (spec §24).
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const ALLOWED = new Set<string>(ALLOWED_PHOTO_TYPES);

const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function uploadRiderPhoto(formData: FormData): Promise<ActionResult<{ path: string }>> {
  const actor = await checkPermission('riders.photo.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const riderId = formData.get('riderId');
  const file = formData.get('photo');
  if (typeof riderId !== 'string' || !riderId) return { ok: false, error: 'bad_request' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'too_large' };

  const buffer = Buffer.from(await file.arrayBuffer());
  // Magic-byte sniff: a .jpg extension proves nothing about the bytes.
  const sniffed = sniffFileType(buffer);
  if (!sniffed || !ALLOWED.has(sniffed)) return { ok: false, error: 'invalid_type' };

  const admin = createAdminClient();
  const { data: rider } = await admin
    .from('riders')
    .select('id, photo_path')
    .eq('id', riderId)
    .maybeSingle();
  if (!rider) return { ok: false, error: 'not_found' };
  const previousPath = (rider as { photo_path: string | null }).photo_path;

  const path = `${riderId}/profile-${Date.now()}.${EXT[sniffed]}`;
  const { error: upErr } = await admin.storage
    .from('rider-documents')
    .upload(path, buffer, { contentType: MIME[sniffed], upsert: false });
  if (upErr) return { ok: false, error: 'upload_failed' };

  const { error: updErr } = await admin
    .from('riders')
    .update({ photo_path: path })
    .eq('id', riderId);
  if (updErr) {
    // Don't leave an orphaned object behind if the row never picked it up.
    await admin.storage.from('rider-documents').remove([path]);
    return { ok: false, error: 'update_failed' };
  }

  // Remove the superseded picture — a profile photo is not a financial record,
  // so replacing it should not accumulate storage forever.
  if (previousPath && previousPath !== path) {
    await admin.storage.from('rider-documents').remove([previousPath]);
  }

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'rider.photo_updated',
    entityType: 'rider',
    entityId: riderId,
    metadata: { bytes: buffer.length, contentType: MIME[sniffed] },
  });
  revalidatePath(`/owner/riders/${riderId}`);
  revalidatePath('/owner/riders');
  revalidatePath('/rider/profile');
  return { ok: true, data: { path } };
}

/** Remove a rider's picture, falling back to the placeholder. Owner-only. */
export async function removeRiderPhoto(riderId: string): Promise<ActionResult> {
  const actor = await checkPermission('riders.photo.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: rider } = await admin
    .from('riders')
    .select('photo_path')
    .eq('id', riderId)
    .maybeSingle();
  if (!rider) return { ok: false, error: 'not_found' };
  const path = (rider as { photo_path: string | null }).photo_path;

  const { error } = await admin.from('riders').update({ photo_path: null }).eq('id', riderId);
  if (error) return { ok: false, error: 'update_failed' };
  if (path) await admin.storage.from('rider-documents').remove([path]);

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'rider.photo_removed',
    entityType: 'rider',
    entityId: riderId,
  });
  revalidatePath(`/owner/riders/${riderId}`);
  revalidatePath('/owner/riders');
  return { ok: true };
}

/**
 * Whether the signed-in user may view this rider's profile. Riders may only
 * ever open their OWN — the client asked this be verified explicitly.
 */
export async function canViewRiderProfile(riderId: string): Promise<boolean> {
  const profile = await getSessionProfile();
  if (!profile) return false;
  if (profile.role === 'owner') return true;
  if (profile.role === 'accountant') return profile.isActive;
  return profile.riderId === riderId;
}
