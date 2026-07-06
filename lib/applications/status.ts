import type { ApplicationStatus } from '@/lib/supabase/types';

/*
 * Application review state machine (spec §8.5). Owner-driven transitions only;
 * `draft` is a client-side pre-submit state and `converted_to_rider` is
 * terminal (handled by the convert action). Pure and unit tested so the allowed
 * moves cannot silently drift.
 */
const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['under_review', 'rejected', 'waitlisted', 'withdrawn'],
  under_review: ['interview', 'verification', 'approved', 'rejected', 'waitlisted', 'withdrawn'],
  interview: ['verification', 'approved', 'rejected', 'waitlisted', 'withdrawn'],
  verification: ['approved', 'rejected', 'waitlisted', 'withdrawn'],
  waitlisted: ['under_review', 'approved', 'rejected', 'withdrawn'],
  approved: ['converted_to_rider', 'rejected'],
  rejected: [],
  withdrawn: [],
  converted_to_rider: [],
};

export function isApplicationStatus(
  value: string | undefined | null,
): value is ApplicationStatus {
  return value != null && Object.prototype.hasOwnProperty.call(TRANSITIONS, value);
}

export function allowedTransitions(from: ApplicationStatus): ApplicationStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return allowedTransitions(from).includes(to);
}

export function isTerminal(status: ApplicationStatus): boolean {
  return allowedTransitions(status).length === 0;
}

// Owner-facing labels + a colour token per status for the pipeline UI.
export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: 'neutral' | 'progress' | 'good' | 'bad' | 'warn' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'progress' },
  under_review: { label: 'Under review', tone: 'progress' },
  interview: { label: 'Interview', tone: 'progress' },
  verification: { label: 'Verification', tone: 'progress' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  waitlisted: { label: 'Waitlisted', tone: 'warn' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  converted_to_rider: { label: 'Converted to rider', tone: 'good' },
};

// Statuses shown as pipeline filter tabs (excludes the pre-submit draft state).
export const PIPELINE_STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'interview',
  'verification',
  'approved',
  'waitlisted',
  'rejected',
  'converted_to_rider',
];
