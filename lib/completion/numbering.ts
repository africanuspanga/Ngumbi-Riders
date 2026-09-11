/*
 * Completion-request and certificate numbering.
 *
 * MAX-BASED, never count(*)+1 — the mistake that made every rider creation fail
 * after the demo accounts were deleted (lib/riders/numbering.ts). Completion
 * requests are never deleted, but a certificate can be REISSUED as a new
 * version, and the next number must come from the highest ever issued rather
 * than from how many rows happen to exist.
 *
 * The pure halves are unit tested; only the two async functions touch the DB.
 */

import type { createAdminClient } from '@/lib/supabase/admin';

const REQUEST_PREFIX = 'NGR-CC';
const CERTIFICATE_PREFIX = 'NGR-CERT';

/** NGR-CC-2026-0001. Zero-padded so lexicographic max = numeric max to 9999. */
export function formatRequestNumber(year: number, seq: number): string {
  return `${REQUEST_PREFIX}-${year}-${String(seq).padStart(4, '0')}`;
}

/** NGR-CERT-2026-0001. */
export function formatCertificateNumber(year: number, seq: number): string {
  return `${CERTIFICATE_PREFIX}-${year}-${String(seq).padStart(4, '0')}`;
}

/** Trailing sequence of either format; 0 when unrecognised. */
export function parseSeq(value: string): number {
  const digits = /-(\d+)$/.exec(value)?.[1];
  return digits ? parseInt(digits, 10) : 0;
}

/**
 * Year of an ISO date, read TEXTUALLY. Never passed through a Date: converting
 * would move a 1 January request into the previous year for any reader west of
 * EAT (build spec #5).
 */
export function yearOf(isoDate: string): number {
  return parseInt(isoDate.slice(0, 4), 10);
}

async function nextNumber(
  admin: ReturnType<typeof createAdminClient>,
  table: 'contract_completion_requests' | 'contract_certificates',
  column: 'request_number' | 'certificate_number',
  prefix: string,
  year: number,
  format: (year: number, seq: number) => string,
): Promise<string> {
  const like = `${prefix}-${year}-%`;
  const { data, error } = await admin
    .from(table)
    .select(column)
    .like(column, like)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();
  // Throw rather than guessing: a silently-reused number would collide on the
  // unique constraint at best, and duplicate a certificate number at worst.
  if (error) throw new Error(`${column} lookup failed: ${error.message}`);
  const last = (data as Record<string, string> | null)?.[column];
  return format(year, last ? parseSeq(last) + 1 : 1);
}

export async function nextRequestNumber(
  admin: ReturnType<typeof createAdminClient>,
  isoDate: string,
): Promise<string> {
  return nextNumber(
    admin,
    'contract_completion_requests',
    'request_number',
    REQUEST_PREFIX,
    yearOf(isoDate),
    formatRequestNumber,
  );
}

export async function nextCertificateNumber(
  admin: ReturnType<typeof createAdminClient>,
  isoDate: string,
): Promise<string> {
  return nextNumber(
    admin,
    'contract_certificates',
    'certificate_number',
    CERTIFICATE_PREFIX,
    yearOf(isoDate),
    formatCertificateNumber,
  );
}
