/*
 * Pure SMS helpers — no server imports, so they are unit tested directly and
 * shared with the VPS relay's expectations.
 */

/**
 * Digits only, always with the Tanzanian country code. Mobishastra accepts
 * digits and defaults to UAE numbering; a local "0753 522 155" must become
 * "255753522155" or the gateway rejects it (or worse, routes it abroad).
 */
export function toMsisdn(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (/^0[67]\d{8}$/.test(digits)) return `255${digits.slice(1)}`;
  if (/^[67]\d{8}$/.test(digits)) return `255${digits}`;
  return digits;
}

/*
 * One character outside the GSM-7 alphabet switches the WHOLE message to
 * Unicode, which the gateway bills at 70 characters per SMS instead of 160
 * (doc §"Hello = The SMS content"). Typography this codebase uses everywhere
 * (curly apostrophes in "Ng’umbi", em dashes, ellipses, non-breaking spaces)
 * would silently double or triple the cost of every reminder, so it is folded
 * to plain equivalents before sending.
 */
const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚‛′`´]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[–—―−]/g, '-'],
  [/…/g, '...'],
  [/[     ]/g, ' '],
  [/[​-‍﻿]/g, ''],
  [/•/g, '*'],
  [/[✓✔]/g, ''],
];

export function normalizeSmsText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Characters GSM-7 can carry (basic set + the common extension chars). */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!GSM7.includes(ch)) return false;
  return true;
}

/** How many SMS parts the gateway will bill (doc: 160/153 GSM, 70/63 Unicode). */
export function smsParts(text: string): number {
  const gsm = isGsm7(text);
  const len = [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 63;
  if (len <= single) return 1;
  return Math.ceil(len / multi);
}
