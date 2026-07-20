import type { createAdminClient } from '@/lib/supabase/admin';

/*
 * Rider-number allocation (NGR-R-0001 …). The next number MUST come from the
 * highest number ever issued, not from count(*): rider rows can be deleted
 * (e.g. the demo accounts removed 2026-07-18), after which the count lags the
 * sequence forever and every count-derived number collides with an existing
 * rider — which surfaced to the owner as a bogus "phone already exists" on
 * every manual creation attempt.
 *
 * Zero-padded to 4 digits, so lexicographic max = numeric max up to 9999
 * riders (the count(*)+1 scheme is on the tech-debt list to become a DB
 * sequence if concurrent creation ever matters).
 */

const RIDER_NUMBER_PREFIX = 'NGR-R-';

export function formatRiderNumber(seq: number): string {
  return `${RIDER_NUMBER_PREFIX}${String(seq).padStart(4, '0')}`;
}

/** Numeric suffix of a rider number; 0 when the format is unrecognised. */
export function parseRiderNumberSeq(riderNumber: string): number {
  const digits = /(\d+)$/.exec(riderNumber)?.[1];
  return digits ? parseInt(digits, 10) : 0;
}

/** Next free sequence = highest issued + 1 (1 when no riders exist). */
export async function nextRiderSeq(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  const { data, error } = await admin
    .from('riders')
    .select('rider_number')
    .order('rider_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`rider number lookup failed: ${error.message}`);
  const last = (data as { rider_number: string } | null)?.rider_number;
  return last ? parseRiderNumberSeq(last) + 1 : 1;
}
