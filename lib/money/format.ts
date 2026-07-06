/*
 * Money is stored as an integer number of Tanzanian shillings (TZS has no
 * routinely used minor unit). Never use floats for money. Formatting shows no
 * unnecessary decimals (spec §6.2).
 */
export const CURRENCY = 'TZS';

export function formatTZS(amount: number): string {
  if (!Number.isFinite(amount)) return 'TZS 0';
  const rounded = Math.round(amount);
  return `TZS ${rounded.toLocaleString('en-US')}`;
}

/** Sum obligation amounts safely as integers. */
export function sumTZS(amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + Math.round(n), 0);
}
