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

  it('translates clinical measurements, units, risks, observations, and validation errors', () => {
    expect(en.CareDocumentation.clinical.measurements.types.blood_pressure).toBe('Blood pressure');
    expect(de.CareDocumentation.clinical.measurements.types.blood_pressure).toBe('Blutdruck');

    expect(en.CareDocumentation.clinical.measurements.units.beatsPerMinute).toBe('beats/min');
    expect(de.CareDocumentation.clinical.measurements.units.beatsPerMinute).toBe('Schläge/min');

    expect(en.CareDocumentation.clinical.risks.levels.high).toBe('High');
    expect(de.CareDocumentation.clinical.risks.levels.high).toBe('Hoch');

    expect(en.CareDocumentation.clinical.observations.values.mobility.assistance_required).toBe(
      'Assistance required',
    );
    expect(de.CareDocumentation.clinical.observations.values.mobility.assistance_required).toBe(
      'Unterstützung erforderlich',
    );

    expect(en.Errors.clinicalRecordInvalid).toBe(
      'Check the clinical record details and try again.',
    );
    expect(de.Errors.clinicalRecordInvalid).toBe('Bitte prüfen Sie die Angaben zum Pflegeeintrag.');
  });
});
