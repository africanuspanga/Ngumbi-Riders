/*
 * Human-readable application reference (spec §8.6): NGR-APP-YYYY-000123.
 * Pure/formatting helpers; the sequence number itself is allocated by the
 * database (a per-year counter) when the application is inserted.
 */
export const APPLICATION_PREFIX = 'NGR-APP';

export function formatApplicationReference(year: number, seq: number): string {
  const paddedSeq = String(seq).padStart(6, '0');
  return `${APPLICATION_PREFIX}-${year}-${paddedSeq}`;
}

const REFERENCE_RE = /^NGR-APP-(\d{4})-(\d{6})$/;

export function parseApplicationReference(
  reference: string,
): { year: number; seq: number } | null {
  const m = REFERENCE_RE.exec(reference);
  if (!m) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
}

export function isApplicationReference(reference: string): boolean {
  return REFERENCE_RE.test(reference);
}
