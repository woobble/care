import { describe, expect, it } from 'bun:test';

import de from '../../messages/de.json';
import en from '../../messages/en.json';

function messageKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translation catalogs', () => {
  it('keeps English and German message structures in parity', () => {
    expect(messageKeys(de).sort()).toEqual(messageKeys(en).sort());
  });

  it('translates benefit carryover and provider recognition errors', () => {
    expect(en.Benefits.carryover).toBe('Prior-year carryover');
    expect(de.Benefits.carryover).toBe('Übertrag aus dem Vorjahr');
    expect(en.Benefits.errors.providerRecognitionRequired).toBe(
      'Valid provider recognition is required for this statutory allocation.',
    );
    expect(de.Benefits.errors.providerRecognitionRequired).toBe(
      'Für diese gesetzliche Zuordnung ist eine gültige Anbieteranerkennung erforderlich.',
    );
  });
});
