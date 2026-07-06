/* Receipt number formatting (spec §13): NGR-RCPT-YYYY-000001. */
export const RECEIPT_PREFIX = 'NGR-RCPT';

export function formatReceiptNumber(year: number, seq: number): string {
  return `${RECEIPT_PREFIX}-${year}-${String(seq).padStart(6, '0')}`;
}

const RE = /^NGR-RCPT-(\d{4})-(\d{6})$/;
export function isReceiptNumber(v: string): boolean {
  return RE.test(v);
}
