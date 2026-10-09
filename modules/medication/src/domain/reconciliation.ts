import {
  decimalMilliunits,
  isPositiveDecimal,
  validateSchedule,
  type DosageForm,
  type DosageUnit,
  type MedicationOrderStatus,
  type MedicationRoute,
  type MedicationSchedule,
} from './medication';

export const MEDICATION_RECONCILIATION_REASONS = [
  'initial_intake',
  'hospital_discharge',
  'physician_update',
  'periodic_review',
  'reported_change',
  'other',
] as const;

export const EXTERNAL_MEDICATION_SOURCE_TYPES = [
  'physician',
  'hospital_discharge',
  'pharmacy',
  'client',
  'representative',
  'other',
] as const;

export const REPORTED_MEDICATION_STATUSES = [
  'active',
  'paused',
  'discontinued',
  'unknown',
] as const;

export const MEDICATION_DISCREPANCY_TYPES = [
  'missing_in_internal_plan',
  'missing_in_external_source',
  'dose_mismatch',
  'route_mismatch',
  'schedule_mismatch',
  'medication_mismatch',
  'status_mismatch',
  'insufficient_information',
] as const;

export const MEDICATION_RECONCILIATION_DECISIONS = [
  'accept_internal',
  'accept_external',
  'requires_clarification',
  'no_change',
] as const;

export type MedicationReconciliationReason = (typeof MEDICATION_RECONCILIATION_REASONS)[number];
export type ExternalMedicationSourceType = (typeof EXTERNAL_MEDICATION_SOURCE_TYPES)[number];
export type MedicationSourceProvenance =
  | 'clinician_instruction'
  | 'pharmacy_record'
  | 'client_report'
  | 'representative_report'
  | 'other';
export type ReportedMedicationStatus = (typeof REPORTED_MEDICATION_STATUSES)[number];
export type MedicationDiscrepancyType = (typeof MEDICATION_DISCREPANCY_TYPES)[number];
export type MedicationReconciliationDecision = (typeof MEDICATION_RECONCILIATION_DECISIONS)[number];
export type MedicationReconciliationStatus = 'draft' | 'in_review' | 'completed' | 'cancelled';

export interface ExternalMedicationEntryFacts {
  medicationName: string;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: DosageForm | null;
  doseAmount: string | null;
  doseUnit: DosageUnit | null;
  route: MedicationRoute | null;
  scheduleDescription: string | null;
  structuredSchedule: MedicationSchedule | null;
  reportedStatus: ReportedMedicationStatus;
  note: string | null;
}

export interface MedicationBaselineFacts {
  orderId: string;
  orderRevisionId: string;
  orderVersion: number;
  status: MedicationOrderStatus;
  medicationSnapshot: {
    name: string;
    activeIngredient: string | null;
    strength: string | null;
    dosageForm: DosageForm;
  };
  doseAmount: string;
  doseUnit: DosageUnit;
  route: MedicationRoute;
  schedule: MedicationSchedule;
  validFrom: string;
  validUntil: string | null;
}

export interface MedicationDiscrepancyDraft {
  type: MedicationDiscrepancyType;
  field: string;
  externalValue: unknown | null;
  internalValue: unknown | null;
}

export function medicationSourceProvenance(
  sourceType: ExternalMedicationSourceType,
): MedicationSourceProvenance {
  switch (sourceType) {
    case 'physician':
    case 'hospital_discharge':
      return 'clinician_instruction' as const;
    case 'pharmacy':
      return 'pharmacy_record' as const;
    case 'client':
      return 'client_report' as const;
    case 'representative':
      return 'representative_report' as const;
    case 'other':
      return 'other' as const;
  }
}

export function sourceMayAuthorizeOrderChange(sourceType: ExternalMedicationSourceType): boolean {
  return sourceType === 'physician' || sourceType === 'hospital_discharge';
}

export function validateExternalMedicationEntry(entry: ExternalMedicationEntryFacts): boolean {
  return (
    entry.medicationName.trim().length > 0 &&
    entry.medicationName.length <= 200 &&
    (entry.activeIngredient === null || entry.activeIngredient.length <= 200) &&
    (entry.strength === null || entry.strength.length <= 120) &&
    (entry.doseAmount === null || isPositiveDecimal(entry.doseAmount)) &&
    (entry.doseAmount === null) === (entry.doseUnit === null) &&
    (entry.scheduleDescription === null || entry.scheduleDescription.length <= 1000) &&
    (entry.note === null || entry.note.length <= 2000) &&
    (entry.structuredSchedule === null || validateSchedule(entry.structuredSchedule))
  );
}

export function assertReconciliationTransition(
  current: MedicationReconciliationStatus,
  next: MedicationReconciliationStatus,
): void {
  const allowed: Record<MedicationReconciliationStatus, readonly MedicationReconciliationStatus[]> =
    {
      draft: ['in_review', 'cancelled'],
      in_review: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };
  if (current === next && current === 'in_review') return;
  if (!allowed[current].includes(next)) throw new MedicationReconciliationInvalidStateError();
}

export class MedicationReconciliationInvalidStateError extends Error {
  readonly code = 'MEDICATION_RECONCILIATION_INVALID_STATE';

  constructor() {
    super('Medication reconciliation cannot make the requested lifecycle transition');
    this.name = 'MedicationReconciliationInvalidStateError';
  }
}

/** Compare one source statement with one manually selected immutable order baseline. */
export function compareMedicationEntry(
  entry: ExternalMedicationEntryFacts,
  baseline: MedicationBaselineFacts,
): MedicationDiscrepancyDraft[] {
  const findings: MedicationDiscrepancyDraft[] = [];
  const finding = (
    type: MedicationDiscrepancyType,
    field: string,
    externalValue: unknown | null,
    internalValue: unknown | null,
  ) => findings.push({ type, field, externalValue, internalValue });

  if (normalize(entry.medicationName) !== normalize(baseline.medicationSnapshot.name)) {
    finding(
      'medication_mismatch',
      'medicationName',
      entry.medicationName,
      baseline.medicationSnapshot.name,
    );
  }
  compareOptionalIdentity(
    entry.activeIngredient,
    baseline.medicationSnapshot.activeIngredient,
    'activeIngredient',
    finding,
  );
  compareOptionalIdentity(
    entry.strength,
    baseline.medicationSnapshot.strength,
    'strength',
    finding,
  );
  if (entry.dosageForm === null) {
    finding('insufficient_information', 'dosageForm', null, baseline.medicationSnapshot.dosageForm);
  } else if (entry.dosageForm !== baseline.medicationSnapshot.dosageForm) {
    finding(
      'medication_mismatch',
      'dosageForm',
      entry.dosageForm,
      baseline.medicationSnapshot.dosageForm,
    );
  }

  if (entry.doseAmount === null || entry.doseUnit === null) {
    finding('insufficient_information', 'dose', doseValue(entry), doseValue(baseline));
  } else if (entry.doseUnit !== baseline.doseUnit) {
    finding('insufficient_information', 'dose', doseValue(entry), doseValue(baseline));
  } else if (decimalMilliunits(entry.doseAmount) !== decimalMilliunits(baseline.doseAmount)) {
    finding('dose_mismatch', 'dose', doseValue(entry), doseValue(baseline));
  }

  if (entry.route === null) {
    finding('insufficient_information', 'route', null, baseline.route);
  } else if (entry.route !== baseline.route) {
    finding('route_mismatch', 'route', entry.route, baseline.route);
  }

  if (entry.structuredSchedule === null) {
    finding('insufficient_information', 'schedule', entry.scheduleDescription, baseline.schedule);
  } else if (canonicalSchedule(entry.structuredSchedule) !== canonicalSchedule(baseline.schedule)) {
    finding('schedule_mismatch', 'schedule', entry.structuredSchedule, baseline.schedule);
  }

  if (entry.reportedStatus === 'unknown') {
    finding('insufficient_information', 'status', 'unknown', baseline.status);
  } else if (entry.reportedStatus !== baseline.status) {
    finding('status_mismatch', 'status', entry.reportedStatus, baseline.status);
  }

  return findings;
}

export function normalizeMedicationName(value: string): string {
  return normalize(value);
}

function compareOptionalIdentity(
  external: string | null,
  internal: string | null,
  field: string,
  finding: (
    type: MedicationDiscrepancyType,
    field: string,
    externalValue: unknown | null,
    internalValue: unknown | null,
  ) => void,
) {
  if (external === null || internal === null) {
    if (external !== internal) finding('insufficient_information', field, external, internal);
    return;
  }
  if (normalize(external) !== normalize(internal)) {
    finding('medication_mismatch', field, external, internal);
  }
}

function doseValue(value: { doseAmount: string | null; doseUnit: string | null }) {
  return value.doseAmount === null || value.doseUnit === null
    ? null
    : { amount: value.doseAmount, unit: value.doseUnit };
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function canonicalSchedule(schedule: MedicationSchedule): string {
  const normalized =
    schedule.type === 'fixed_times' ? { ...schedule, times: [...schedule.times].sort() } : schedule;
  return JSON.stringify(canonicalValue(normalized));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}
