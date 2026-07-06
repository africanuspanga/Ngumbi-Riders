// Swahili is the default interface language; English is optional (spec §1.66).
export const locales = ['sw', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'sw';
export const localeCookie = 'NEXT_LOCALE';

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
