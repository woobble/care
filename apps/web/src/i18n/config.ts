export const locales = ['en', 'de'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';
export const localeCookieName = 'CARE_LOCALE';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}
