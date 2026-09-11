/*
 * Staff / administration profile vocabulary (client feedback 2026-09-11 #9).
 *
 * PURE and dependency-free, so the employee's own page, the Director's review
 * queue and any future export all read the same words. A plain lib/ module,
 * not a constant exported from a 'use client' component: a server module
 * importing from one gets a client REFERENCE rather than the value, which is
 * the outage class spec rule 16 exists to prevent.
 */

export type EmploymentStatus = 'probation' | 'permanent' | 'inactive' | 'terminated';

export const EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = [
  'probation',
  'permanent',
  'inactive',
  'terminated',
] as const;

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  probation: 'Probation',
  permanent: 'Confirmed permanent employee',
  inactive: 'Inactive',
  terminated: 'Terminated',
};

/**
 * Employment status is an HR fact and says NOTHING about system access, which
 * is `profiles.is_active` and is managed at /owner/staff. Keeping them separate
 * is deliberate: an employee on leave may keep their login, and a terminated
 * one must lose it by an explicit act rather than as a side effect of a form
 * somebody filled in. The UI says so in these words.
 */
export const EMPLOYMENT_STATUS_HINTS: Record<EmploymentStatus, string> = {
  probation: 'Newly hired and still within their probation period.',
  permanent: 'Confirmed in post.',
  inactive: 'Not currently working — on leave or stood down.',
  terminated: 'No longer employed. Revoke their system access separately, on the Staff page.',
};

export type StaffReviewStatus = 'draft' | 'submitted' | 'approved' | 'returned';

export const REVIEW_STATUSES: readonly StaffReviewStatus[] = [
  'draft',
  'submitted',
  'approved',
  'returned',
] as const;

export const REVIEW_STATUS_LABELS: Record<StaffReviewStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting the Director’s review',
  approved: 'Approved',
  returned: 'Returned for correction',
};

export const REVIEW_STATUS_HINTS: Record<StaffReviewStatus, string> = {
  draft: 'Only you can see this. Submit it when it is complete.',
  submitted: 'With the Managing Director. You can still correct it; that resets the review.',
  approved: 'Approved by the Managing Director.',
  returned: 'The Managing Director asked for changes. Correct it and submit again.',
};

export type StaffCertificateKind =
  | 'education'
  | 'professional'
  | 'training'
  | 'experience_letter'
  | 'other';

export const CERTIFICATE_KINDS: readonly StaffCertificateKind[] = [
  'education',
  'professional',
  'training',
  'experience_letter',
  'other',
] as const;

export const CERTIFICATE_KIND_LABELS: Record<StaffCertificateKind, string> = {
  education: 'Education certificate',
  professional: 'Professional certificate',
  training: 'Training certificate',
  experience_letter: 'Experience letter',
  other: 'Other supporting document',
};

/*
 * 4 MiB per file, and PDF/JPG/PNG/WebP only — the same limits every other
 * upload in this system has, for the same two reasons: Vercel rejects a body
 * over ~4.5 MB with an opaque 413 (D-030), and the magic-byte sniffer only
 * recognises these four, so accepting anything else would mean accepting a file
 * whose type we cannot verify.
 */
export const MAX_CERTIFICATE_BYTES = 4 * 1024 * 1024;
export const CERTIFICATE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
export const MAX_CERTIFICATES = 20;

/*
 * There is deliberately no `isEditable(status)` helper: an employee may edit
 * their record at EVERY stage, including an approved one. Editing an approved
 * record resets it to 'submitted' (the 0035 trigger does that, not application
 * code), so the Director sees the change rather than an old approval quietly
 * covering text they never read.
 */

/** True when the Director has something to act on. */
export function awaitsReview(status: StaffReviewStatus): boolean {
  return status === 'submitted';
}
