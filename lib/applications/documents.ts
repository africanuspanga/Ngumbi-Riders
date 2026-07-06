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

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB (matches storage limit)

// Required applicant documents (spec §8.3).
export const APPLICANT_DOC_TYPES = [
  'nida_front',
  'nida_back',
  'licence',
  'photo',
  'declaration',
] as const;
export type ApplicantDocType = (typeof APPLICANT_DOC_TYPES)[number];

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
