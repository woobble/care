import { describe, expect, it } from 'bun:test';
import {
  assertOrderTransition,
  decimalMilliunits,
  isPositiveDecimal,
  medicationScheduleInstant,
  validateOrderFacts,
  validateSchedule,
  MedicationOrderInvalidStateError,
  type MedicationOrderFacts,
} from './medication';

describe('medication dosage and schedule invariants', () => {
  it('uses precise thousandth-unit dosage arithmetic', () => {
    expect(isPositiveDecimal('0.001')).toBe(true);
    expect(isPositiveDecimal('1.234')).toBe(true);
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('1.2345')).toBe(false);
    expect(isPositiveDecimal('01')).toBe(false);
    expect(decimalMilliunits('12.3')).toBe(12_300n);
  });

  it('validates unique fixed daily times and bounded interval schedules', () => {
    expect(validateSchedule({ type: 'fixed_times', times: ['08:00', '20:30'], timezone: 'Europe/Berlin' })).toBe(true);
    expect(validateSchedule({ type: 'fixed_times', times: ['08:00', '08:00'], timezone: 'Europe/Berlin' })).toBe(false);
    expect(validateSchedule({ type: 'interval', anchorAt: '2026-10-09T08:00:00.000Z', intervalMinutes: 30, timezone: 'UTC' })).toBe(true);
    expect(validateSchedule({ type: 'interval', anchorAt: 'not-a-date', intervalMinutes: 30, timezone: 'UTC' })).toBe(false);
    expect(validateSchedule({ type: 'interval', anchorAt: '2026-10-09T08:00:00.000Z', intervalMinutes: 29, timezone: 'UTC' })).toBe(false);
  });

  it('resolves daylight-saving gaps forward and repeated local times to the earlier instant', () => {
    expect(medicationScheduleInstant('2026-03-08', '02:30', 'America/New_York')?.toISOString())
      .toBe('2026-03-08T07:30:00.000Z');
    expect(medicationScheduleInstant('2026-11-01', '01:30', 'America/New_York')?.toISOString())
      .toBe('2026-11-01T05:30:00.000Z');
  });

  it('requires explicit PRN indication and paired frequency limits', () => {
    expect(validateSchedule({ type: 'as_needed', indication: 'Pain', timezone: 'UTC', maximumDoseAmount: '2', maximumAdministrations: 3, frequencyWindowMinutes: 1440 })).toBe(true);
    expect(validateSchedule({ type: 'as_needed', indication: ' ', timezone: 'UTC' })).toBe(false);
    expect(validateSchedule({ type: 'as_needed', indication: 'Pain', timezone: 'UTC', maximumAdministrations: 3 })).toBe(false);
    expect(validateSchedule({ type: 'as_needed', indication: 'Pain', timezone: 'UTC', maximumDoseAmount: '0' })).toBe(false);
  });

  it('rejects invalid order facts before persistence', () => {
    const facts: MedicationOrderFacts = {
      medicationDefinitionId: '00000000-0000-4000-8000-000000000001',
      medicationSnapshot: { name: 'Example medication', activeIngredient: null, strength: null, dosageForm: 'tablet', manufacturer: null },
      doseAmount: '1',
      doseUnit: 'tablet',
      route: 'oral',
      instructions: null,
      indication: null,
      prescriberName: null,
      sourceType: 'prescriber',
      sourceReference: 'record-123',
      prescribedAt: null,
      validFrom: '2026-10-09',
      validUntil: '2026-10-10',
      schedule: { type: 'fixed_times', times: ['08:00'], timezone: 'Europe/Berlin' },
    };
    expect(validateOrderFacts(facts)).toBe(true);
    expect(validateOrderFacts({ ...facts, validUntil: '2026-10-08' })).toBe(false);
    expect(validateOrderFacts({ ...facts, doseAmount: '0' })).toBe(false);
    expect(validateOrderFacts({ ...facts, sourceReference: ' '.repeat(1_001) })).toBe(false);
  });
});

describe('medication order lifecycle', () => {
  it('permits draft, active, and paused transitions while keeping discontinued final', () => {
    expect(() => assertOrderTransition('draft', 'active')).not.toThrow();
    expect(() => assertOrderTransition('active', 'paused')).not.toThrow();
    expect(() => assertOrderTransition('paused', 'active')).not.toThrow();
    expect(() => assertOrderTransition('active', 'discontinued')).not.toThrow();
    expect(() => assertOrderTransition('discontinued', 'active')).toThrow(MedicationOrderInvalidStateError);
    expect(() => assertOrderTransition('draft', 'paused')).toThrow(MedicationOrderInvalidStateError);
  });
});
