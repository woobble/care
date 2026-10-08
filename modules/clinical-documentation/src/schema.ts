import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientRecords } from '@care/clients';

const clinicalDocumentation = pgSchema('clinical_documentation');

export const clinicalRecords = clinicalDocumentation.table(
  'records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    documentationId: uuid('documentation_id').notNull(),
    executionId: uuid('execution_id').notNull(),
    kind: text('kind')
      .$type<'measurement' | 'observation' | 'assessment' | 'risk_assessment'>()
      .notNull(),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    recordedByEmployeeId: uuid('recorded_by_employee_id'),
    version: integer('version').notNull().default(1),
    correctsRecordId: uuid('corrects_record_id'),
    correctionReason: text('correction_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('clinical_records_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('clinical_records_tenant_client_id_kind_uq').on(
      table.tenantId,
      table.clientId,
      table.id,
      table.kind,
    ),
    uniqueIndex('clinical_records_tenant_id_document_execution_kind_uq').on(
      table.tenantId,
      table.id,
      table.documentationId,
      table.executionId,
      table.kind,
    ),
    index('clinical_records_document_created_idx').on(
      table.tenantId,
      table.documentationId,
      table.createdAt,
      table.id,
    ),
    index('clinical_records_execution_created_idx').on(
      table.tenantId,
      table.executionId,
      table.createdAt,
    ),
    uniqueIndex('clinical_records_corrects_record_uq')
      .on(table.tenantId, table.correctsRecordId)
      .where(sql`${table.correctsRecordId} IS NOT NULL`),
    check(
      'clinical_records_kind_ck',
      sql`${table.kind} IN ('measurement', 'observation', 'assessment', 'risk_assessment')`,
    ),
    check('clinical_records_version_ck', sql`${table.version} > 0`),
    check(
      'clinical_records_employee_attribution_ck',
      sql`${table.recordedByEmployeeId} IS NOT NULL OR ${table.correctsRecordId} IS NOT NULL`,
    ),
    foreignKey({
      name: 'clinical_records_tenant_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    check(
      'clinical_records_correction_ck',
      sql`(${table.correctsRecordId} IS NULL AND ${table.correctionReason} IS NULL) OR (${table.correctsRecordId} IS NOT NULL AND ${table.correctsRecordId} <> ${table.id} AND length(trim(coalesce(${table.correctionReason}, ''))) BETWEEN 1 AND 1000)`,
    ),
  ],
);

export const measurements = clinicalDocumentation.table(
  'measurements',
  {
    tenantId: uuid('tenant_id').notNull(),
    recordId: uuid('record_id').notNull(),
    measurementType: text('measurement_type')
      .$type<
        | 'blood_pressure'
        | 'pulse'
        | 'temperature'
        | 'weight'
        | 'blood_glucose'
        | 'oxygen_saturation'
        | 'respiratory_rate'
      >()
      .notNull(),
    value: numeric('value', { precision: 10, scale: 3, mode: 'string' }),
    integerValue: integer('integer_value'),
    systolic: integer('systolic'),
    diastolic: integer('diastolic'),
    unit: text('unit')
      .$type<'mmHg' | 'Cel' | 'kg' | 'bpm' | '/min' | '%' | 'mg/dL' | 'mmol/L'>()
      .notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    source: text('source').$type<'manual' | 'device'>().notNull(),
    note: text('note'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordId] }),
    index('clinical_measurements_type_time_idx').on(
      table.tenantId,
      table.measurementType,
      table.measuredAt,
      table.recordId,
    ),
    check(
      'clinical_measurements_value_ck',
      sql`(measurement_type = 'blood_pressure' AND value IS NULL AND integer_value IS NULL AND systolic > 0 AND diastolic > 0 AND unit = 'mmHg') OR (measurement_type = 'pulse' AND value IS NULL AND integer_value > 0 AND systolic IS NULL AND diastolic IS NULL AND unit = 'bpm') OR (measurement_type = 'respiratory_rate' AND value IS NULL AND integer_value > 0 AND systolic IS NULL AND diastolic IS NULL AND unit = '/min') OR (measurement_type = 'temperature' AND value IS NOT NULL AND integer_value IS NULL AND systolic IS NULL AND diastolic IS NULL AND unit = 'Cel') OR (measurement_type = 'weight' AND value > 0 AND integer_value IS NULL AND systolic IS NULL AND diastolic IS NULL AND unit = 'kg') OR (measurement_type = 'blood_glucose' AND value > 0 AND integer_value IS NULL AND systolic IS NULL AND diastolic IS NULL AND unit IN ('mg/dL', 'mmol/L')) OR (measurement_type = 'oxygen_saturation' AND value BETWEEN 0 AND 100 AND integer_value IS NULL AND systolic IS NULL AND diastolic IS NULL AND unit = '%')`,
    ),
    check('clinical_measurements_source_ck', sql`${table.source} IN ('manual', 'device')`),
    check(
      'clinical_measurements_finite_value_ck',
      sql`${table.value} IS NULL OR ${table.value}::text NOT IN ('NaN', 'Infinity', '-Infinity')`,
    ),
    check(
      'clinical_measurements_note_ck',
      sql`${table.note} IS NULL OR length(${table.note}) <= 1000`,
    ),
  ],
);

export const structuredObservations = clinicalDocumentation.table(
  'observations',
  {
    tenantId: uuid('tenant_id').notNull(),
    recordId: uuid('record_id').notNull(),
    category: text('category')
      .$type<
        | 'mobility'
        | 'orientation'
        | 'pain'
        | 'skin'
        | 'nutrition'
        | 'hydration'
        | 'elimination'
        | 'sleep'
        | 'mood'
        | 'general_condition'
      >()
      .notNull(),
    valueCode: text('value_code'),
    painScore: integer('pain_score'),
    location: text('location'),
    severity: text('severity').$type<'mild' | 'moderate' | 'severe'>(),
    note: text('note'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordId] }),
    index('clinical_observations_category_time_idx').on(
      table.tenantId,
      table.category,
      table.observedAt,
      table.recordId,
    ),
    check(
      'clinical_observations_values_ck',
      sql`((category = 'mobility' AND value_code IN ('independent', 'assistance_required', 'bedbound') AND pain_score IS NULL AND location IS NULL) OR (category = 'orientation' AND value_code IN ('oriented', 'disoriented') AND pain_score IS NULL AND location IS NULL) OR (category = 'pain' AND value_code IS NULL AND pain_score BETWEEN 0 AND 10) OR (category = 'skin' AND value_code IN ('intact', 'redness', 'altered') AND pain_score IS NULL AND location IS NULL) OR (category = 'nutrition' AND value_code IN ('adequate', 'reduced', 'declined') AND pain_score IS NULL AND location IS NULL) OR (category = 'hydration' AND value_code IN ('adequate', 'reduced', 'declined') AND pain_score IS NULL AND location IS NULL) OR (category = 'elimination' AND value_code IN ('unchanged', 'changed', 'incontinence') AND pain_score IS NULL AND location IS NULL) OR (category = 'sleep' AND value_code IN ('restful', 'disturbed') AND pain_score IS NULL AND location IS NULL) OR (category = 'mood' AND value_code IN ('calm', 'anxious', 'low', 'agitated') AND pain_score IS NULL AND location IS NULL) OR (category = 'general_condition' AND value_code IN ('stable', 'changed', 'declined') AND pain_score IS NULL AND location IS NULL)) AND length(trim(coalesce(value_code, ''))) <= 128 AND length(trim(coalesce(location, ''))) <= 200`,
    ),
    check(
      'clinical_observations_severity_ck',
      sql`${table.severity} IS NULL OR ${table.severity} IN ('mild', 'moderate', 'severe')`,
    ),
    check(
      'clinical_observations_note_ck',
      sql`${table.note} IS NULL OR length(${table.note}) <= 1000`,
    ),
  ],
);

export const assessments = clinicalDocumentation.table(
  'assessments',
  {
    tenantId: uuid('tenant_id').notNull(),
    recordId: uuid('record_id').notNull(),
    assessmentType: text('assessment_type').$type<'general_condition' | 'pain'>().notNull(),
    resultCode: text('result_code').$type<'stable' | 'changed' | 'declined'>(),
    score: numeric('score', { precision: 10, scale: 3, mode: 'string' }),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    note: text('note'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordId] }),
    index('clinical_assessments_type_time_idx').on(
      table.tenantId,
      table.assessmentType,
      table.assessedAt,
      table.recordId,
    ),
    check(
      'clinical_assessments_code_ck',
      sql`((assessment_type = 'general_condition' AND (result_code IN ('stable', 'changed', 'declined') OR (result_code IS NULL AND score IS NOT NULL))) OR (assessment_type = 'pain' AND result_code IS NULL AND score BETWEEN 0 AND 10 AND score = trunc(score)))`,
    ),
    check(
      'clinical_assessments_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.assessedAt}`,
    ),
    check(
      'clinical_assessments_finite_score_ck',
      sql`${table.score} IS NULL OR ${table.score}::text NOT IN ('NaN', 'Infinity', '-Infinity')`,
    ),
    check(
      'clinical_assessments_note_ck',
      sql`${table.note} IS NULL OR length(${table.note}) <= 1000`,
    ),
  ],
);

export const riskAssessments = clinicalDocumentation.table(
  'risk_assessments',
  {
    tenantId: uuid('tenant_id').notNull(),
    recordId: uuid('record_id').notNull(),
    riskType: text('risk_type')
      .$type<'fall' | 'pressure_ulcer' | 'dehydration' | 'malnutrition'>()
      .notNull(),
    level: text('level').$type<'none' | 'low' | 'moderate' | 'high'>().notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    source: text('source').notNull(),
    note: text('note'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordId] }),
    index('clinical_risk_assessments_type_time_idx').on(
      table.tenantId,
      table.riskType,
      table.assessedAt,
      table.recordId,
    ),
    check(
      'clinical_risk_assessments_type_ck',
      sql`${table.riskType} IN ('fall', 'pressure_ulcer', 'dehydration', 'malnutrition')`,
    ),
    check(
      'clinical_risk_assessments_level_ck',
      sql`${table.level} IN ('none', 'low', 'moderate', 'high')`,
    ),
    check(
      'clinical_risk_assessments_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.assessedAt}`,
    ),
    check(
      'clinical_risk_assessments_source_ck',
      sql`length(trim(${table.source})) BETWEEN 1 AND 128`,
    ),
    check(
      'clinical_risk_assessments_note_ck',
      sql`${table.note} IS NULL OR length(${table.note}) <= 1000`,
    ),
  ],
);

export const clinicalDocumentationSchema = {
  clinicalRecords,
  measurements,
  structuredObservations,
  assessments,
  riskAssessments,
};
