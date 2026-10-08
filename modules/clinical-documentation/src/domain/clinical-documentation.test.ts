import { describe, expect, test } from 'bun:test';
import {
  ClinicalRecordAmendmentConflictError,
  validateAmendmentTarget,
  validateAssessment,
  validateMeasurement,
  validateNewClinicalRecord,
  validateRecordAmendment,
  validateRiskAssessment,
  validateStructuredObservation,
} from './clinical-documentation';

const now = new Date('2026-10-08T12:00:00.000Z');
const past = new Date('2026-10-08T11:00:00.000Z');

describe('clinical record validation', () => {
  test('accepts explicit measurement units without normalizing unusual readings', () => {
    expect(() =>
      validateMeasurement(
        {
          measurementType: 'blood_pressure',
          value: null,
          integerValue: null,
          systolic: 230,
          diastolic: 145,
          unit: 'mmHg',
          measuredAt: past,
          source: 'manual',
        },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      validateMeasurement(
        {
          measurementType: 'blood_glucose',
          value: '1.234',
          integerValue: null,
          systolic: null,
          diastolic: null,
          unit: 'mmol/L',
          measuredAt: past,
          source: 'device',
        },
        now,
      ),
    ).not.toThrow();
  });

  test('accepts supported numeric measurements and rejects excess decimal precision', () => {
    const validMeasurements = [
      {
        measurementType: 'weight',
        value: '72.125',
        integerValue: null,
        systolic: null,
        diastolic: null,
        unit: 'kg',
      },
      {
        measurementType: 'pulse',
        value: null,
        integerValue: 72,
        systolic: null,
        diastolic: null,
        unit: 'bpm',
      },
      {
        measurementType: 'blood_glucose',
        value: '108.125',
        integerValue: null,
        systolic: null,
        diastolic: null,
        unit: 'mg/dL',
      },
      {
        measurementType: 'oxygen_saturation',
        value: '97.5',
        integerValue: null,
        systolic: null,
        diastolic: null,
        unit: '%',
      },
    ] as const;

    for (const input of validMeasurements) {
      expect(() =>
        validateMeasurement({ ...input, measuredAt: past, source: 'manual' }, now),
      ).not.toThrow();
    }
    expect(() =>
      validateMeasurement(
        {
          measurementType: 'weight',
          value: '72.1234',
          integerValue: null,
          systolic: null,
          diastolic: null,
          unit: 'kg',
          measuredAt: past,
          source: 'manual',
        },
        now,
      ),
    ).toThrow();
  });

  test('enforces numeric bounds and rejects future measurement timestamps', () => {
    expect(() =>
      validateMeasurement(
        {
          measurementType: 'pulse',
          value: null,
          integerValue: 0,
          systolic: null,
          diastolic: null,
          unit: 'bpm',
          measuredAt: past,
          source: 'manual',
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      validateMeasurement(
        {
          measurementType: 'oxygen_saturation',
          value: '100.001',
          integerValue: null,
          systolic: null,
          diastolic: null,
          unit: '%',
          measuredAt: past,
          source: 'manual',
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      validateMeasurement(
        {
          measurementType: 'temperature',
          value: '37.0',
          integerValue: null,
          systolic: null,
          diastolic: null,
          unit: 'Cel',
          measuredAt: new Date(now.getTime() + 1),
          source: 'manual',
        },
        now,
      ),
    ).toThrow();
  });

  test('allows optional location for pain observations and rejects it for coded categories', () => {
    expect(() =>
      validateStructuredObservation(
        {
          category: 'pain',
          painScore: 0,
          location: '  lower back  ',
          observedAt: past,
        },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      validateStructuredObservation(
        {
          category: 'mobility',
          valueCode: 'independent',
          location: 'hallway',
          observedAt: past,
        },
        now,
      ),
    ).toThrow();
  });

  test('allows a general condition score without a result code and validates pain scores', () => {
    expect(() =>
      validateAssessment(
        {
          assessmentType: 'general_condition',
          score: '4.250',
          assessedAt: past,
        },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      validateAssessment(
        {
          assessmentType: 'pain',
          score: '10.001',
          assessedAt: past,
        },
        now,
      ),
    ).toThrow();
  });

  test('requires risk validity to start no earlier than assessment', () => {
    expect(() =>
      validateRiskAssessment(
        {
          riskType: 'fall',
          level: 'moderate',
          assessedAt: past,
          validUntil: new Date(past.getTime() - 1),
          source: 'screening',
        },
        now,
      ),
    ).toThrow();
  });
});

describe('clinical record amendments', () => {
  test('requires correction target and reason together', () => {
    expect(() => validateRecordAmendment({})).not.toThrow();
    expect(() =>
      validateRecordAmendment({
        correctsRecordId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    ).toThrow();
  });

  test('allows missing employee attribution only for a correction row', () => {
    const clientId = '123e4567-e89b-12d3-a456-426614174000';
    expect(() =>
      validateNewClinicalRecord({
        clientId,
        recordedByEmployeeId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    ).not.toThrow();
    expect(() => validateNewClinicalRecord({ clientId, recordedByEmployeeId: null })).toThrow();
    expect(() =>
      validateNewClinicalRecord({
        clientId,
        recordedByEmployeeId: null,
        correctsRecordId: '123e4567-e89b-12d3-a456-426614174000',
        correctionReason: 'Correction reason',
      }),
    ).not.toThrow();
  });

  test('requires a valid client reference for each clinical record', () => {
    expect(() =>
      validateNewClinicalRecord({
        clientId: 'invalid',
        recordedByEmployeeId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    ).toThrow();
  });

  test('rejects correction chains and duplicate replacements as conflicts', () => {
    expect(() =>
      validateAmendmentTarget({ correctsRecordId: null, correctedByRecordId: null }),
    ).not.toThrow();
    expect(() =>
      validateAmendmentTarget({
        correctsRecordId: '123e4567-e89b-12d3-a456-426614174000',
        correctedByRecordId: null,
      }),
    ).toThrow(ClinicalRecordAmendmentConflictError);
    expect(() =>
      validateAmendmentTarget({
        correctsRecordId: null,
        correctedByRecordId: '123e4567-e89b-12d3-a456-426614174001',
      }),
    ).toThrow(ClinicalRecordAmendmentConflictError);
  });
});
