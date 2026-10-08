import { describe, expect, it } from 'bun:test';
import { defaultLocale, isLocale, localeCookieName, locales, resolveLocale } from './config';

describe('locale configuration', () => {
  it('supports English and German with English as the default', () => {
    expect(locales).toEqual(['en', 'de']);
    expect(defaultLocale).toBe('en');
    expect(localeCookieName).toBe('CARE_LOCALE');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('accepts only supported locale cookie values', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(resolveLocale('de')).toBe('de');
    expect(resolveLocale('invalid')).toBe('en');
  });
});
