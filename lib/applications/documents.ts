/*
 * Applicant/guarantor document rules (spec §8.3, §8.4, §24). Accept PDF, JPG,
 * JPEG and PNG only; validate extension AND MIME type (server also validates the
 * file signature before storing). Pure so the upload UI and the server share the
 * exact same rules.
 */
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const ACCEPTED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const;

// 4 MiB: documents are uploaded one per request, and Vercel caps request
// bodies at ~4.5 MB — a larger limit here would accept files the platform
// then rejects with an opaque 413.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Allowlisted applicant document types (spec §8.3, build spec #3). This is the
// superset the upload endpoint accepts; which of these are actually REQUIRED
// depends on the chosen identity type — see requiredApplicantDocTypes().
export const APPLICANT_DOC_TYPES = [
  'nida_front',
  'nida_back',
  'voter_id',
  'licence',
  'photo',
  'declaration',
] as const;
export type ApplicantDocType = (typeof APPLICANT_DOC_TYPES)[number];

/*
 * Required applicant documents for a given identity type (build spec #3):
 * NIDA needs both sides, Voter ID needs the voter card, Driving Licence needs
 * the licence. A photo and a signed declaration are always required. The
 * driving licence is NEVER required unless it IS the chosen identity document,
 * so a NIDA/voter applicant is not blocked by it.
 */
export function requiredApplicantDocTypes(
  identityType: 'nida' | 'driving_licence' | 'voter_id',
): ApplicantDocType[] {
  const identity: ApplicantDocType[] =
    identityType === 'nida'
      ? ['nida_front', 'nida_back']
      : identityType === 'voter_id'
        ? ['voter_id']
        : ['licence'];
  return [...identity, 'photo', 'declaration'];
}

// Required per-guarantor documents (spec §8.4).
export const GUARANTOR_DOC_TYPES = [
  'photo',
  'nida_front',
  'nida_back',
  'declaration',
] as const;
export type GuarantorDocType = (typeof GUARANTOR_DOC_TYPES)[number];

export type FileRejection = 'type' | 'extension' | 'size' | 'empty';

export type FileCheck =
  | { ok: true }
  | { ok: false; reason: FileRejection };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Validate a selected file's MIME type, extension and size. */
export function validateFile(input: {
  name: string;
  type: string;
  size: number;
}): FileCheck {
  if (input.size <= 0) return { ok: false, reason: 'empty' };
  if (input.size > MAX_FILE_BYTES) return { ok: false, reason: 'size' };
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(input.type))
    return { ok: false, reason: 'type' };
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(input.name)))
    return { ok: false, reason: 'extension' };
  return { ok: true };
}

export const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
