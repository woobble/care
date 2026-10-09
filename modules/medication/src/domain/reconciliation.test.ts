import { describe, expect, it } from 'bun:test';
import {
  assertReconciliationTransition,
  compareMedicationEntry,
  medicationSourceProvenance,
  sourceMayAuthorizeOrderChange,
  MedicationReconciliationInvalidStateError,
  type ExternalMedicationEntryFacts,
  type MedicationBaselineFacts,
} from './reconciliation';

const entry: ExternalMedicationEntryFacts = {
  medicationName: 'Example Drug',
  activeIngredient: 'Example ingredient',
  strength: '10 mg',
  dosageForm: 'tablet',
  doseAmount: '1',
  doseUnit: 'tablet',
  route: 'oral',
  scheduleDescription: null,
  structuredSchedule: { type: 'fixed_times', times: ['08:00'], timezone: 'Europe/Berlin' },
  reportedStatus: 'active',
  note: null,
};

const baseline: MedicationBaselineFacts = {
  orderId: 'order-1',
  orderRevisionId: 'revision-1',
  orderVersion: 2,
  status: 'active',
  medicationSnapshot: {
    name: 'Example Drug',
    activeIngredient: 'Example ingredient',
    strength: '10 mg',
    dosageForm: 'tablet',
  },
  doseAmount: '1.000',
  doseUnit: 'tablet',
  route: 'oral',
  schedule: { type: 'fixed_times', times: ['08:00'], timezone: 'Europe/Berlin' },
  validFrom: '2026-10-01',
  validUntil: null,
};

describe('medication reconciliation lifecycle', () => {
  it('allows review and cancellation but keeps terminal states closed', () => {
    expect(() => assertReconciliationTransition('draft', 'in_review')).not.toThrow();
    expect(() => assertReconciliationTransition('draft', 'cancelled')).not.toThrow();
    expect(() => assertReconciliationTransition('in_review', 'completed')).not.toThrow();
    expect(() => assertReconciliationTransition('completed', 'in_review')).toThrow(
      MedicationReconciliationInvalidStateError,
    );
    expect(() => assertReconciliationTransition('cancelled', 'completed')).toThrow(
      MedicationReconciliationInvalidStateError,
    );
  });
});

describe('medication reconciliation comparisons', () => {
  it('does not create a discrepancy for equal structured facts', () => {
    expect(compareMedicationEntry(entry, baseline)).toEqual([]);
  });

  it('reports dose, route, schedule, and status differences without choosing a correct side', () => {
    const findings = compareMedicationEntry(
      {
        ...entry,
        doseAmount: '2',
        route: 'topical',
        structuredSchedule: { type: 'fixed_times', times: ['20:00'], timezone: 'Europe/Berlin' },
        reportedStatus: 'paused',
      },
      baseline,
    );
    expect(findings.map(({ type, field }) => [type, field])).toEqual([
      ['dose_mismatch', 'dose'],
      ['route_mismatch', 'route'],
      ['schedule_mismatch', 'schedule'],
      ['status_mismatch', 'status'],
    ]);
  });

  it('does not treat unknown amounts or incompatible units as equal or zero', () => {
    expect(
      compareMedicationEntry({ ...entry, doseAmount: null, doseUnit: null }, baseline),
    ).toContainEqual(expect.objectContaining({ type: 'insufficient_information', field: 'dose' }));
    expect(compareMedicationEntry({ ...entry, doseUnit: 'mg' }, baseline)).toContainEqual(
      expect.objectContaining({ type: 'insufficient_information', field: 'dose' }),
    );
    expect(
      compareMedicationEntry(
        { ...entry, structuredSchedule: null, scheduleDescription: 'morning' },
        baseline,
      ),
    ).toContainEqual(
      expect.objectContaining({ type: 'insufficient_information', field: 'schedule' }),
    );
  });

  it('marks missing identity facts as insufficient information', () => {
    const findings = compareMedicationEntry(
      {
        ...entry,
        activeIngredient: null,
        strength: null,
        dosageForm: null,
      },
      baseline,
    );
    expect(findings.map(({ type, field }) => [type, field])).toEqual([
      ['insufficient_information', 'activeIngredient'],
      ['insufficient_information', 'strength'],
      ['insufficient_information', 'dosageForm'],
    ]);
  });

  it('keeps source authority explicit and limits order changes to clinician instructions', () => {
    expect(medicationSourceProvenance('physician')).toBe('clinician_instruction');
    expect(medicationSourceProvenance('client')).toBe('client_report');
    expect(sourceMayAuthorizeOrderChange('physician')).toBe(true);
    expect(sourceMayAuthorizeOrderChange('hospital_discharge')).toBe(true);
    expect(sourceMayAuthorizeOrderChange('pharmacy')).toBe(false);
    expect(sourceMayAuthorizeOrderChange('representative')).toBe(false);
  });
});
