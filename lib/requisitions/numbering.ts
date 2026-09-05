/*
 * Requisition-number allocation — REQ/YYYY/MM/NNNN, restarting each month.
 *
 * MAX-BASED, never count(*)+1. Rider numbering was count-based until the demo
 * accounts were deleted, after which the count lagged the issued sequence
 * forever and every new rider collided (see lib/riders/numbering.ts). A draft
 * requisition CAN be deleted by its author, so this table has exactly that
 * failure mode — the highest number ever issued is the only safe basis.
 *
 * The pure half is unit-tested; only `nextRequisitionNumber` touches the DB.
 */

import type { createAdminClient } from '@/lib/supabase/admin';

const PREFIX = 'REQ';

/** Zero-padded to 4 digits, so lexicographic max = numeric max up to 9999/month. */
export function formatRequisitionNumber(year: number, month: number, seq: number): string {
  return `${PREFIX}/${year}/${String(month).padStart(2, '0')}/${String(seq).padStart(4, '0')}`;
}

/** The `REQ/2026/09/` prefix every number issued in that month shares. */
export function monthPrefix(year: number, month: number): string {
  return `${PREFIX}/${year}/${String(month).padStart(2, '0')}/`;
}

/** Numeric suffix of a requisition number; 0 when the format is unrecognised. */
export function parseRequisitionSeq(requisitionNumber: string): number {
  const digits = /\/(\d+)$/.exec(requisitionNumber)?.[1];
  return digits ? parseInt(digits, 10) : 0;
}

/** Year + month (1-12) of an ISO calendar date, read textually so no timezone
 * conversion can shift a request into the previous month. */
export function yearMonthOf(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split('-');
  return { year: parseInt(y ?? '', 10), month: parseInt(m ?? '', 10) };
}

/**
 * Next free number for the month containing `isoDate` = highest issued that
 * month + 1. Collisions are still possible under genuinely concurrent
 * creation; the unique constraint catches them and the caller retries, which
 * is the same contract application and contract numbers work under.
 */
export async function nextRequisitionNumber(
  admin: ReturnType<typeof createAdminClient>,
  isoDate: string,
): Promise<string> {
  const { year, month } = yearMonthOf(isoDate);
  const prefix = monthPrefix(year, month);
  const { data, error } = await admin
    .from('purchase_requisitions')
    .select('requisition_number')
    .like('requisition_number', `${prefix}%`)
    .order('requisition_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`requisition number lookup failed: ${error.message}`);
  const last = (data as { requisition_number: string } | null)?.requisition_number;
  return formatRequisitionNumber(year, month, last ? parseRequisitionSeq(last) + 1 : 1);
}
