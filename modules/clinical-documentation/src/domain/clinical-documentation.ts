export const CLINICAL_RECORD_KINDS = [
  'measurement',
  'observation',
  'assessment',
  'risk_assessment',
] as const;

export type ClinicalRecordKind = (typeof CLINICAL_RECORD_KINDS)[number];

export const MEASUREMENT_TYPES = [
  'blood_pressure',
  'pulse',
  'temperature',
  'weight',
  'blood_glucose',
  'oxygen_saturation',
  'respiratory_rate',
] as const;

export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];
export type MeasurementUnit = 'mmHg' | 'Cel' | 'kg' | 'bpm' | '/min' | '%' | 'mg/dL' | 'mmol/L';
export type MeasurementSource = 'manual' | 'device';

export const OBSERVATION_CATEGORIES = [
  'mobility',
  'orientation',
  'pain',
  'skin',
  'nutrition',
  'hydration',
  'elimination',
  'sleep',
  'mood',
  'general_condition',
] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

export const OBSERVATION_CODES = {
  mobility: ['independent', 'assistance_required', 'bedbound'],
  orientation: ['oriented', 'disoriented'],
  skin: ['intact', 'redness', 'altered'],
  nutrition: ['adequate', 'reduced', 'declined'],
  hydration: ['adequate', 'reduced', 'declined'],
  elimination: ['unchanged', 'changed', 'incontinence'],
  sleep: ['restful', 'disturbed'],
  mood: ['calm', 'anxious', 'low', 'agitated'],
  general_condition: ['stable', 'changed', 'declined'],
} as const;
export type ObservationValueCode =
  (typeof OBSERVATION_CODES)[keyof typeof OBSERVATION_CODES][number];

export const OBSERVATION_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type ObservationSeverity = (typeof OBSERVATION_SEVERITIES)[number];

export const ASSESSMENT_TYPES = ['general_condition', 'pain'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export const GENERAL_CONDITION_RESULTS = ['stable', 'changed', 'declined'] as const;
export type GeneralConditionResult = (typeof GENERAL_CONDITION_RESULTS)[number];

export const RISK_TYPES = ['fall', 'pressure_ulcer', 'dehydration', 'malnutrition'] as const;
export type RiskType = (typeof RISK_TYPES)[number];

export const RISK_LEVELS = ['none', 'low', 'moderate', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface ClinicalRecord {
  id: string;
  tenantId: string;
  documentationId: string;
  executionId: string;
  kind: ClinicalRecordKind;
  recordedByUserId: string;
  /** Null only for corrections made by an actor without an active employee link. */
  recordedByEmployeeId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  correctsRecordId: string | null;
  correctionReason: string | null;
  /** Derived from later records; this is never stored on the original row. */
  correctedByRecordId: string | null;
}

export interface Measurement extends ClinicalRecord {
  kind: 'measurement';
  measurementType: MeasurementType;
  value: string | null;
  integerValue: number | null;
  systolic: number | null;
  diastolic: number | null;
  unit: MeasurementUnit;
  measuredAt: Date;
  source: MeasurementSource;
  note: string | null;
}

export interface StructuredObservation extends ClinicalRecord {
  kind: 'observation';
  category: ObservationCategory;
  valueCode: ObservationValueCode | null;
  painScore: number | null;
  location: string | null;
  severity: ObservationSeverity | null;
  note: string | null;
  observedAt: Date;
}

export interface Assessment extends ClinicalRecord {
  kind: 'assessment';
  assessmentType: AssessmentType;
  resultCode: GeneralConditionResult | null;
  score: string | null;
  assessedAt: Date;
  validUntil: Date | null;
  note: string | null;
}

export interface RiskAssessment extends ClinicalRecord {
  kind: 'risk_assessment';
  riskType: RiskType;
  level: RiskLevel;
  assessedAt: Date;
  validUntil: Date | null;
  source: string;
  note: string | null;
}

export type ClinicalRecordDetail =
  | Measurement
  | StructuredObservation
  | Assessment
  | RiskAssessment;

export type RecordAmendment = ClinicalRecordDetail & {
  correctsRecordId: string;
  correctionReason: string;
};

export interface NewClinicalRecord {
  id?: string;
  tenantId: string;
  clientId: string;
  documentationId: string;
  executionId: string;
  kind: ClinicalRecordKind;
  recordedByUserId: string;
  /** Null only for corrections made by an actor without an active employee link. */
  recordedByEmployeeId: string | null;
  correctsRecordId?: string | null;
  correctionReason?: string | null;
}

export interface MeasurementInput {
  measurementType: MeasurementType;
  value: string | null;
  integerValue: number | null;
  systolic: number | null;
  diastolic: number | null;
  unit: MeasurementUnit;
  measuredAt: Date;
  source: MeasurementSource;
  note?: string | null;
}

export interface StructuredObservationInput {
  category: ObservationCategory;
  valueCode?: ObservationValueCode | null;
  painScore?: number | null;
  location?: string | null;
  severity?: ObservationSeverity | null;
  note?: string | null;
  observedAt: Date;
}

export interface AssessmentInput {
  assessmentType: AssessmentType;
  resultCode?: GeneralConditionResult | null;
  score?: string | null;
  assessedAt: Date;
  validUntil?: Date | null;
  note?: string | null;
}

export interface RiskAssessmentInput {
  riskType: RiskType;
  level: RiskLevel;
  assessedAt: Date;
  validUntil?: Date | null;
  source: string;
  note?: string | null;
}

export interface ClinicalHistoryFilters {
  kind: ClinicalRecordKind;
  measurementType?: MeasurementType;
  observationCategory?: ObservationCategory;
  assessmentType?: AssessmentType;
  riskType?: RiskType;
  currentOnly?: boolean;
  from?: Date;
  until?: Date;
  page: number;
  pageSize: number;
}

export interface ClinicalHistoryPage {
  items: ClinicalRecordDetail[];
  page: number;
  pageSize: number;
  total: number;
}

export function validateMeasurement(input: MeasurementInput, now = new Date()): void {
  if (!MEASUREMENT_TYPES.includes(input.measurementType)) throw new InvalidClinicalRecordError();
  requirePastOrPresentDate(input.measuredAt, now);
  validateOptionalNote(input.note, 1000);
  if (input.source !== 'manual' && input.source !== 'device') {
    throw new InvalidClinicalRecordError();
  }

  switch (input.measurementType) {
    case 'blood_pressure':
      if (
        input.value !== null ||
        input.integerValue !== null ||
        !validInteger(input.systolic, 1) ||
        !validInteger(input.diastolic, 1) ||
        input.unit !== 'mmHg'
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    case 'pulse':
      if (
        input.value !== null ||
        !validInteger(input.integerValue, 1) ||
        input.systolic !== null ||
        input.diastolic !== null ||
        input.unit !== 'bpm'
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    case 'respiratory_rate':
      if (
        input.value !== null ||
        !validInteger(input.integerValue, 1) ||
        input.systolic !== null ||
        input.diastolic !== null ||
        input.unit !== '/min'
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    case 'temperature':
      if (
        !validDecimal(input.value, true) ||
        input.integerValue !== null ||
        input.systolic !== null ||
        input.diastolic !== null ||
        input.unit !== 'Cel'
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    case 'weight':
      if (
        !validDecimal(input.value, false) ||
        input.integerValue !== null ||
        input.systolic !== null ||
        input.diastolic !== null ||
        input.unit !== 'kg'
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    case 'blood_glucose':
      if (
        !validDecimal(input.value, false) ||
        input.integerValue !== null ||
        input.systolic !== null ||
        input.diastolic !== null ||
        (input.unit !== 'mg/dL' && input.unit !== 'mmol/L')
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    case 'oxygen_saturation': {
      const thousandths = decimalThousandths(input.value);
      if (
        thousandths === null ||
        thousandths < 0n ||
        thousandths > 100_000n ||
        input.integerValue !== null ||
        input.systolic !== null ||
        input.diastolic !== null ||
        input.unit !== '%'
      ) {
        throw new InvalidClinicalRecordError();
      }
      return;
    }
  }
}

export function validateStructuredObservation(
  input: StructuredObservationInput,
  now = new Date(),
): void {
  if (!OBSERVATION_CATEGORIES.includes(input.category)) throw new InvalidClinicalRecordError();
  requirePastOrPresentDate(input.observedAt, now);
  if (input.severity != null && !OBSERVATION_SEVERITIES.includes(input.severity)) {
    throw new InvalidClinicalRecordError();
  }
  validateOptionalNote(input.note, 1000);
  const valueCode = input.valueCode ?? null;
  const painScore = input.painScore ?? null;
  const location = normalizedOptionalText(input.location);
  if (location !== null && location.length > 200) throw new InvalidClinicalRecordError();
  if (input.category === 'pain') {
    if (
      valueCode !== null ||
      painScore === null ||
      !Number.isInteger(painScore) ||
      painScore < 0 ||
      painScore > 10
    ) {
      throw new InvalidClinicalRecordError();
    }
    return;
  }
  if (
    painScore !== null ||
    location !== null ||
    valueCode === null ||
    !(OBSERVATION_CODES[input.category] as readonly string[]).includes(valueCode)
  ) {
    throw new InvalidClinicalRecordError();
  }
}

export function validateAssessment(input: AssessmentInput, now = new Date()): void {
  if (!ASSESSMENT_TYPES.includes(input.assessmentType)) throw new InvalidClinicalRecordError();
  requirePastOrPresentDate(input.assessedAt, now);
  validateValidity(input.assessedAt, input.validUntil ?? null);
  validateOptionalDecimal(input.score);
  validateOptionalNote(input.note, 1000);
  const resultCode = input.resultCode ?? null;
  if (input.assessmentType === 'general_condition') {
    if (
      (resultCode === null && input.score == null) ||
      (resultCode !== null && !GENERAL_CONDITION_RESULTS.includes(resultCode))
    ) {
      throw new InvalidClinicalRecordError();
    }
    return;
  }
  if (resultCode !== null || input.score == null || !/^(?:0|[1-9]|10)$/.test(input.score)) {
    throw new InvalidClinicalRecordError();
  }
}

export function validateRiskAssessment(input: RiskAssessmentInput, now = new Date()): void {
  if (!RISK_TYPES.includes(input.riskType) || !RISK_LEVELS.includes(input.level)) {
    throw new InvalidClinicalRecordError();
  }
  requirePastOrPresentDate(input.assessedAt, now);
  validateValidity(input.assessedAt, input.validUntil ?? null);
  validateCode(input.source);
  validateOptionalNote(input.note, 1000);
}

export function validateRecordAmendment(input: {
  correctsRecordId?: string | null;
  correctionReason?: string | null;
}): void {
  const recordId = input.correctsRecordId ?? null;
  const reason = input.correctionReason ?? null;
  if (
    (recordId === null) !== (reason === null) ||
    (recordId !== null && !isUuid(recordId)) ||
    (reason !== null && (reason.trim().length === 0 || reason.trim().length > 1000))
  ) {
    throw new InvalidClinicalRecordError();
  }
}

export function validateNewClinicalRecord(input: {
  clientId: string;
  recordedByEmployeeId: string | null;
  correctsRecordId?: string | null;
  correctionReason?: string | null;
}): void {
  if (!isUuid(input.clientId)) throw new InvalidClinicalRecordError();
  validateRecordAmendment(input);
  if (input.recordedByEmployeeId === null && input.correctsRecordId == null) {
    throw new InvalidClinicalRecordError();
  }
}

export function validateAmendmentTarget(input: {
  correctsRecordId: string | null;
  correctedByRecordId: string | null;
}): void {
  if (input.correctsRecordId !== null || input.correctedByRecordId !== null) {
    throw new ClinicalRecordAmendmentConflictError();
  }
}

export class ClinicalRecordAmendmentConflictError extends Error {
  readonly code = 'CLINICAL_RECORD_AMENDMENT_CONFLICT';

  constructor() {
    super('The clinical record has already been amended');
    this.name = 'ClinicalRecordAmendmentConflictError';
  }
}

export class InvalidClinicalRecordError extends Error {
  readonly code = 'CLINICAL_RECORD_INVALID';

  constructor() {
    super('The clinical record is invalid');
    this.name = 'InvalidClinicalRecordError';
  }
}

function validDecimal(value: string | null, allowNegative: boolean): boolean {
  const thousandths = decimalThousandths(value);
  return thousandths !== null && (allowNegative || thousandths > 0n);
}

function validateOptionalDecimal(value: string | null | undefined): void {
  if (value != null && decimalThousandths(value) === null) {
    throw new InvalidClinicalRecordError();
  }
}

function decimalThousandths(value: string | null): bigint | null {
  if (value === null || !/^-?(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const result = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return negative ? -result : result;
}

function validInteger(value: number | null, minimum: number): boolean {
  return value !== null && Number.isInteger(value) && value >= minimum && value <= 2_147_483_647;
}

function validateValidity(assessedAt: Date, validUntil: Date | null): void {
  if (validUntil !== null && (!validDate(validUntil) || validUntil < assessedAt)) {
    throw new InvalidClinicalRecordError();
  }
}

function requireDate(value: Date): void {
  if (!validDate(value)) throw new InvalidClinicalRecordError();
}

function validDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function requirePastOrPresentDate(value: Date, now: Date): void {
  requireDate(value);
  requireDate(now);
  if (value.getTime() > now.getTime()) throw new InvalidClinicalRecordError();
}

function validateCode(value: string): void {
  if (value.trim().length === 0 || value !== value.trim() || value.length > 128) {
    throw new InvalidClinicalRecordError();
  }
}

function validateOptionalNote(value: string | null | undefined, maxLength: number): void {
  if (value != null && value.length > maxLength) throw new InvalidClinicalRecordError();
}

function normalizedOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
