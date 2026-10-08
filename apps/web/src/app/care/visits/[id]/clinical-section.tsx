'use client';

import { useState } from 'react';
import type { components } from '@care/api-client';
import { Button, Input, Label } from '@care/ui';
import { useTranslations } from 'next-intl';
import { deleteClinicalRecordAction, saveClinicalRecordAction } from '../../actions';
import { formatNumber } from '../../../../i18n/format';
import type { Locale } from '../../../../i18n/config';
import { formatVisitDateTime, visitDateTimeInputValue } from '../../../../lib/care-date';

type ClinicalDetail = components['schemas']['ClinicalDocumentationDetailDto'];
type ClinicalRecord = ClinicalDetail['records'][number];
type Measurement = Extract<ClinicalRecord, { kind: 'measurement' }>;
type Observation = Extract<ClinicalRecord, { kind: 'observation' }>;
type Assessment = Extract<ClinicalRecord, { kind: 'assessment' }>;
type RiskAssessment = Extract<ClinicalRecord, { kind: 'risk_assessment' }>;
type RecordKind = ClinicalRecord['kind'];

const measurementTypes = [
  'blood_pressure',
  'pulse',
  'temperature',
  'weight',
  'blood_glucose',
  'oxygen_saturation',
  'respiratory_rate',
] as const satisfies readonly Measurement['measurementType'][];
const observationCategories = [
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
const riskTypes = [
  'fall',
  'pressure_ulcer',
  'dehydration',
  'malnutrition',
] as const satisfies readonly RiskAssessment['riskType'][];
const riskLevels = [
  'none',
  'low',
  'moderate',
  'high',
] as const satisfies readonly RiskAssessment['level'][];

const measurementTypeLabels = {
  blood_pressure: 'measurements.types.blood_pressure',
  pulse: 'measurements.types.pulse',
  temperature: 'measurements.types.temperature',
  weight: 'measurements.types.weight',
  blood_glucose: 'measurements.types.blood_glucose',
  oxygen_saturation: 'measurements.types.oxygen_saturation',
  respiratory_rate: 'measurements.types.respiratory_rate',
} as const;
const observationCategoryLabels = {
  mobility: 'observations.categories.mobility',
  orientation: 'observations.categories.orientation',
  pain: 'observations.categories.pain',
  skin: 'observations.categories.skin',
  nutrition: 'observations.categories.nutrition',
  hydration: 'observations.categories.hydration',
  elimination: 'observations.categories.elimination',
  sleep: 'observations.categories.sleep',
  mood: 'observations.categories.mood',
  general_condition: 'observations.categories.general_condition',
} as const;
const observationValues = {
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
const riskTypeLabels = {
  fall: 'risks.types.fall',
  pressure_ulcer: 'risks.types.pressure_ulcer',
  dehydration: 'risks.types.dehydration',
  malnutrition: 'risks.types.malnutrition',
} as const;
const riskLevelLabels = {
  none: 'risks.levels.none',
  low: 'risks.levels.low',
  moderate: 'risks.levels.moderate',
  high: 'risks.levels.high',
} as const;

export function ClinicalSection({
  detail,
  errorCode,
  visitId,
  timezone,
  defaultTime,
  locale,
}: {
  detail: ClinicalDetail | undefined;
  errorCode: string | undefined;
  visitId: string;
  timezone: string;
  defaultTime: string;
  locale: Locale;
}) {
  const t = useTranslations('CareDocumentation.clinical');
  const editable = detail?.documentationStatus === 'draft';

  return (
    <section
      aria-labelledby="clinical-documentation-heading"
      className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5"
    >
      <header>
        <h3 id="clinical-documentation-heading" className="text-lg font-semibold">
          {t('title')}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{t('description')}</p>
      </header>
      {errorCode || !detail ? (
        <p role="alert" className="text-red-800">
          {t('loadFailed')}
        </p>
      ) : (
        <>
          {!detail.records.length ? <p className="text-sm text-slate-600">{t('empty')}</p> : null}
          <RecordGroup
            kind="measurement"
            records={detail.records.filter(
              (record): record is Measurement => record.kind === 'measurement',
            )}
            detail={detail}
            editable={editable}
            visitId={visitId}
            timezone={timezone}
            defaultTime={defaultTime}
            locale={locale}
          />
          <RecordGroup
            kind="observation"
            records={detail.records.filter(
              (record): record is Observation => record.kind === 'observation',
            )}
            detail={detail}
            editable={editable}
            visitId={visitId}
            timezone={timezone}
            defaultTime={defaultTime}
            locale={locale}
          />
          <RecordGroup
            kind="assessment"
            records={detail.records.filter(
              (record): record is Assessment => record.kind === 'assessment',
            )}
            detail={detail}
            editable={editable}
            visitId={visitId}
            timezone={timezone}
            defaultTime={defaultTime}
            locale={locale}
          />
          <RecordGroup
            kind="risk_assessment"
            records={detail.records.filter(
              (record): record is RiskAssessment => record.kind === 'risk_assessment',
            )}
            detail={detail}
            editable={editable}
            visitId={visitId}
            timezone={timezone}
            defaultTime={defaultTime}
            locale={locale}
          />
          {!editable ? <p className="text-sm text-slate-600">{t('draftOnly')}</p> : null}
        </>
      )}
    </section>
  );
}

function RecordGroup({
  kind,
  records,
  detail,
  editable,
  visitId,
  timezone,
  defaultTime,
  locale,
}: {
  kind: RecordKind;
  records: ClinicalRecord[];
  detail: ClinicalDetail;
  editable: boolean;
  visitId: string;
  timezone: string;
  defaultTime: string;
  locale: Locale;
}) {
  const t = useTranslations('CareDocumentation.clinical');
  const groupTitle =
    kind === 'measurement'
      ? t('measurements.title')
      : kind === 'observation'
        ? t('observations.title')
        : kind === 'assessment'
          ? t('assessments.title')
          : t('risks.title');
  const emptyText =
    kind === 'measurement'
      ? t('measurements.empty')
      : kind === 'observation'
        ? t('observations.empty')
        : kind === 'assessment'
          ? t('assessments.empty')
          : t('risks.empty');

  return (
    <section className="grid gap-3 border-t pt-4">
      <h4 className="font-semibold">{groupTitle}</h4>
      {records.length ? (
        <ul className="grid gap-3">
          {records.map((record) => (
            <li key={record.id}>
              <RecordCard
                record={record}
                detail={detail}
                editable={editable}
                visitId={visitId}
                timezone={timezone}
                defaultTime={defaultTime}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      ) : detail.records.length ? (
        <p className="text-sm text-slate-600">{emptyText}</p>
      ) : null}
      {editable ? (
        <details className="rounded-md bg-slate-50 p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            {kind === 'measurement'
              ? t('measurements.add')
              : kind === 'observation'
                ? t('observations.add')
                : kind === 'assessment'
                  ? t('assessments.add')
                  : t('risks.add')}
          </summary>
          <RecordForm
            kind={kind}
            detail={detail}
            visitId={visitId}
            timezone={timezone}
            defaultTime={defaultTime}
          />
        </details>
      ) : null}
    </section>
  );
}

function RecordCard({
  record,
  detail,
  editable,
  visitId,
  timezone,
  defaultTime,
  locale,
}: {
  record: ClinicalRecord;
  detail: ClinicalDetail;
  editable: boolean;
  visitId: string;
  timezone: string;
  defaultTime: string;
  locale: Locale;
}) {
  const t = useTranslations('CareDocumentation.clinical');
  return (
    <article className="grid gap-3 rounded-md border p-3">
      <ClinicalRecordSummary record={record} timezone={timezone} locale={locale} />
      {record.correctedByRecordId ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-950">
          {t('records.corrected')}
        </p>
      ) : null}
      {record.correctsRecordId ? (
        <div className="rounded bg-blue-50 px-2 py-1 text-sm text-blue-950">
          <p className="font-medium">{t('records.correction')}</p>
          {record.correctionReason ? <p>{record.correctionReason}</p> : null}
        </div>
      ) : null}
      {editable && !record.correctedByRecordId ? (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <details className="min-w-0 flex-1 rounded-md bg-slate-50 p-3">
            <summary className="min-h-10 cursor-pointer py-2 font-medium">
              {t('actions.edit')}
            </summary>
            <RecordForm
              kind={record.kind}
              record={record}
              detail={detail}
              visitId={visitId}
              timezone={timezone}
              defaultTime={defaultTime}
            />
          </details>
          <form action={deleteClinicalRecordAction} className="self-start">
            <input type="hidden" name="visitId" value={visitId} />
            <input type="hidden" name="documentationId" value={detail.documentationId} />
            <input type="hidden" name="expectedVersion" value={detail.documentationVersion} />
            <input type="hidden" name="expectedRecordVersion" value={record.recordVersion} />
            <input type="hidden" name="recordId" value={record.id} />
            <input type="hidden" name="kind" value={record.kind} />
            <Button
              type="submit"
              variant="secondary"
              className="min-h-11 text-red-800"
              aria-label={`${t('actions.delete')} ${recordLabel(record, t)}`}
            >
              {t('actions.delete')}
            </Button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function ClinicalRecordSummary({
  record,
  timezone,
  locale,
}: {
  record: ClinicalRecord;
  timezone: string;
  locale: Locale;
}) {
  const t = useTranslations('CareDocumentation.clinical');
  let title = '';
  let value = '';
  let at = '';
  let note: string | null | undefined;

  if (record.kind === 'measurement') {
    title = t(measurementTypeLabels[record.measurementType]);
    value = measurementValue(record, locale);
    at = formatVisitDateTime(record.measuredAt, timezone, locale);
    note = record.note;
  } else if (record.kind === 'observation') {
    title = t(
      observationCategoryLabels[record.category as keyof typeof observationCategoryLabels] ??
        'observations.title',
    );
    value =
      record.category === 'pain'
        ? `${t('observations.painScore')}: ${record.painScore ?? '–'}${record.location ? ` · ${record.location}` : ''}`
        : record.valueCode
          ? observationValueLabel(t, record.category, record.valueCode)
          : '–';
    at = formatVisitDateTime(record.observedAt, timezone, locale);
    note = record.note;
  } else if (record.kind === 'assessment') {
    title =
      record.assessmentType === 'general_condition'
        ? t('assessments.types.general_condition')
        : t('assessments.types.pain');
    value = record.resultCode
      ? t(
          `assessments.generalConditionResults.${record.resultCode}` as 'assessments.generalConditionResults.stable',
        )
      : `${t('assessments.score')}: ${record.score ?? '–'}`;
    at = formatVisitDateTime(record.assessedAt, timezone, locale);
    note = record.note;
  } else {
    title = t(riskTypeLabels[record.riskType]);
    value = t(riskLevelLabels[record.level]);
    at = formatVisitDateTime(record.assessedAt, timezone, locale);
    note = record.note;
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h5 className="font-medium">{title}</h5>
        <span className="text-sm text-slate-600">{at}</span>
      </div>
      <p className="mt-1">{value}</p>
      {record.kind === 'measurement' ? (
        <p className="mt-1 text-xs text-slate-500">
          {t(`measurements.sources.${record.source}` as 'measurements.sources.manual')}
        </p>
      ) : null}
      {record.kind === 'observation' && record.severity ? (
        <p className="mt-1 text-sm text-slate-600">
          {t(
            `observations.severityValues.${record.severity}` as 'observations.severityValues.mild',
          )}
        </p>
      ) : null}
      {record.kind === 'risk_assessment' ? (
        <p className="mt-1 text-xs text-slate-500">{record.source}</p>
      ) : null}
      {note ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{note}</p> : null}
    </div>
  );
}

function RecordForm({
  kind,
  record,
  detail,
  visitId,
  timezone,
  defaultTime,
}: {
  kind: RecordKind;
  record?: ClinicalRecord;
  detail: ClinicalDetail;
  visitId: string;
  timezone: string;
  defaultTime: string;
}) {
  const t = useTranslations('CareDocumentation.clinical');
  const [measurementType, setMeasurementType] = useState<Measurement['measurementType']>(
    record?.kind === 'measurement' ? record.measurementType : 'blood_pressure',
  );
  const [observationCategory, setObservationCategory] = useState<string>(
    record?.kind === 'observation' ? record.category : 'mobility',
  );
  const [assessmentType, setAssessmentType] = useState<Assessment['assessmentType']>(
    record?.kind === 'assessment'
      ? (record.assessmentType as Assessment['assessmentType'])
      : 'general_condition',
  );
  const [assessmentResultCode, setAssessmentResultCode] = useState(
    record?.kind === 'assessment' ? (record.resultCode ?? '') : '',
  );
  const [assessmentScore, setAssessmentScore] = useState(
    record?.kind === 'assessment' ? (record.score ?? '') : '',
  );
  const prefix = record?.id ?? `new-${kind}`;
  const fieldId = (field: string) => `${prefix}-${field}`;
  const timestamp =
    record?.kind === 'measurement'
      ? record.measuredAt
      : record?.kind === 'observation'
        ? record.observedAt
        : record?.kind === 'assessment' || record?.kind === 'risk_assessment'
          ? record.assessedAt
          : defaultTime;
  const timeLabel =
    kind === 'measurement'
      ? t('measurements.measuredAt')
      : kind === 'observation'
        ? t('observations.observedAt')
        : kind === 'assessment'
          ? t('assessments.assessedAt')
          : t('risks.assessedAt');

  return (
    <form action={saveClinicalRecordAction} className="mt-3 grid gap-3 border-t pt-3">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="documentationId" value={detail.documentationId} />
      <input type="hidden" name="expectedVersion" value={detail.documentationVersion} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="kind" value={kind} />
      {record ? (
        <>
          <input type="hidden" name="recordId" value={record.id} />
          <input type="hidden" name="expectedRecordVersion" value={record.recordVersion} />
        </>
      ) : null}

      {kind === 'measurement' ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor={fieldId('measurementType')}>{t('measurements.type')}</Label>
            <select
              id={fieldId('measurementType')}
              name="measurementType"
              value={measurementType}
              onChange={(event) =>
                setMeasurementType(event.target.value as Measurement['measurementType'])
              }
              className="min-h-11 rounded-md border bg-white px-3"
            >
              {measurementTypes.map((type) => (
                <option key={type} value={type}>
                  {t(measurementTypeLabels[type])}
                </option>
              ))}
            </select>
          </div>
          {measurementType === 'blood_pressure' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                id={fieldId('systolic')}
                name="systolic"
                label={t('measurements.systolic')}
                defaultValue={record?.kind === 'measurement' ? record.systolic : null}
                min="1"
                step="1"
                required
              />
              <NumberField
                id={fieldId('diastolic')}
                name="diastolic"
                label={t('measurements.diastolic')}
                defaultValue={record?.kind === 'measurement' ? record.diastolic : null}
                min="1"
                step="1"
                required
              />
            </div>
          ) : null}
          {measurementType === 'pulse' || measurementType === 'respiratory_rate' ? (
            <NumberField
              id={fieldId('integerValue')}
              name="integerValue"
              label={t('measurements.value')}
              defaultValue={record?.kind === 'measurement' ? record.integerValue : null}
              min="1"
              step="1"
              required
            />
          ) : null}
          {['temperature', 'weight', 'blood_glucose', 'oxygen_saturation'].includes(
            measurementType,
          ) ? (
            <NumberField
              id={fieldId('value')}
              name="value"
              label={t('measurements.value')}
              defaultValue={record?.kind === 'measurement' ? record.value : null}
              {...(measurementType === 'temperature' ? {} : { min: '0' })}
              {...(measurementType === 'oxygen_saturation' ? { max: '100' } : {})}
              step="0.001"
              required
            />
          ) : null}
          {measurementType === 'blood_glucose' ? (
            <SelectField
              id={fieldId('glucoseUnit')}
              name="glucoseUnit"
              label={t('measurements.glucoseUnit')}
              defaultValue={record?.kind === 'measurement' ? record.unit : 'mg/dL'}
              options={[
                ['mg/dL', t('measurements.units.milligramsPerDeciliter')],
                ['mmol/L', t('measurements.units.millimolesPerLiter')],
              ]}
            />
          ) : null}
          <SelectField
            id={fieldId('source')}
            name="source"
            label={t('measurements.source')}
            defaultValue={record?.kind === 'measurement' ? record.source : 'manual'}
            options={[
              ['manual', t('measurements.sources.manual')],
              ['device', t('measurements.sources.device')],
            ]}
          />
        </>
      ) : null}

      {kind === 'observation' ? (
        <>
          <SelectField
            id={fieldId('category')}
            name="category"
            label={t('observations.category')}
            value={observationCategory}
            onChange={(value) => setObservationCategory(value)}
            options={observationCategories.map(
              (category) => [category, t(observationCategoryLabels[category])] as const,
            )}
          />
          {observationCategory === 'pain' ? (
            <>
              <NumberField
                id={fieldId('painScore')}
                name="painScore"
                label={t('observations.painScore')}
                defaultValue={record?.kind === 'observation' ? record.painScore : null}
                min="0"
                max="10"
                step="1"
                required
              />
              <p className="-mt-2 text-sm text-slate-600">{t('observations.painScaleHint')}</p>
              <TextField
                id={fieldId('location')}
                name="location"
                label={t('observations.location')}
                defaultValue={record?.kind === 'observation' ? record.location : ''}
                maxLength={200}
              />
            </>
          ) : (
            <SelectField
              id={fieldId('valueCode')}
              name="valueCode"
              label={t('observations.value')}
              defaultValue={record?.kind === 'observation' ? (record.valueCode ?? '') : ''}
              required
              options={(
                observationValues[observationCategory as keyof typeof observationValues] ?? []
              ).map(
                (value) =>
                  [
                    value,
                    t(
                      `observations.values.${observationCategory}.${value}` as 'observations.values.mobility.independent',
                    ),
                  ] as const,
              )}
            />
          )}
          <SelectField
            id={fieldId('severity')}
            name="severity"
            label={t('observations.severity')}
            defaultValue={record?.kind === 'observation' ? (record.severity ?? '') : ''}
            options={[
              ['', t('observations.severity')],
              ['mild', t('observations.severityValues.mild')],
              ['moderate', t('observations.severityValues.moderate')],
              ['severe', t('observations.severityValues.severe')],
            ]}
          />
        </>
      ) : null}

      {kind === 'assessment' ? (
        <>
          <SelectField
            id={fieldId('assessmentType')}
            name="assessmentType"
            label={t('assessments.type')}
            value={assessmentType}
            onChange={(value) => setAssessmentType(value as Assessment['assessmentType'])}
            options={[
              ['general_condition', t('assessments.types.general_condition')],
              ['pain', t('assessments.types.pain')],
            ]}
          />
          {assessmentType === 'general_condition' ? (
            <SelectField
              id={fieldId('resultCode')}
              name="resultCode"
              label={t('assessments.result')}
              value={assessmentResultCode}
              onChange={setAssessmentResultCode}
              required={!assessmentScore}
              options={[
                ['', t('assessments.result')],
                ['stable', t('assessments.generalConditionResults.stable')],
                ['changed', t('assessments.generalConditionResults.changed')],
                ['declined', t('assessments.generalConditionResults.declined')],
              ]}
            />
          ) : null}
          <NumberField
            id={fieldId('score')}
            name="score"
            label={t('assessments.score')}
            value={assessmentScore}
            onChange={setAssessmentScore}
            {...(assessmentType === 'pain' ? { min: '0', max: '10' } : {})}
            step={assessmentType === 'pain' ? '1' : '0.001'}
            required={assessmentType === 'pain' || !assessmentResultCode}
          />
        </>
      ) : null}

      {kind === 'risk_assessment' ? (
        <>
          <SelectField
            id={fieldId('riskType')}
            name="riskType"
            label={t('risks.type')}
            defaultValue={record?.kind === 'risk_assessment' ? record.riskType : 'fall'}
            options={riskTypes.map((riskType) => [riskType, t(riskTypeLabels[riskType])] as const)}
          />
          <SelectField
            id={fieldId('level')}
            name="level"
            label={t('risks.level')}
            defaultValue={record?.kind === 'risk_assessment' ? record.level : 'low'}
            options={riskLevels.map((level) => [level, t(riskLevelLabels[level])] as const)}
          />
          <TextField
            id={fieldId('source')}
            name="source"
            label={t('risks.source')}
            defaultValue={record?.kind === 'risk_assessment' ? record.source : 'caregiver'}
            required
            maxLength={128}
          />
        </>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={fieldId('timestamp')}>{timeLabel}</Label>
        <Input
          id={fieldId('timestamp')}
          name={
            kind === 'measurement'
              ? 'measuredAt'
              : kind === 'observation'
                ? 'observedAt'
                : 'assessedAt'
          }
          type="datetime-local"
          required
          defaultValue={visitDateTimeInputValue(timestamp, timezone)}
        />
      </div>
      {kind === 'assessment' || kind === 'risk_assessment' ? (
        <div className="grid gap-2">
          <Label htmlFor={fieldId('validUntil')}>
            {kind === 'assessment' ? t('assessments.validUntil') : t('risks.validUntil')}
          </Label>
          <Input
            id={fieldId('validUntil')}
            name="validUntil"
            type="datetime-local"
            defaultValue={
              record?.kind === 'assessment' || record?.kind === 'risk_assessment'
                ? record.validUntil
                  ? visitDateTimeInputValue(record.validUntil, timezone)
                  : ''
                : ''
            }
          />
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor={fieldId('note')}>
          {kind === 'measurement'
            ? t('measurements.note')
            : kind === 'observation'
              ? t('observations.note')
              : kind === 'assessment'
                ? t('assessments.note')
                : t('risks.note')}
        </Label>
        <textarea
          id={fieldId('note')}
          name="note"
          defaultValue={record && 'note' in record ? (record.note ?? '') : ''}
          maxLength={1000}
          className="min-h-20 rounded-md border bg-white px-3 py-2"
        />
      </div>
      <Button type="submit" variant="secondary" className="min-h-11 w-full sm:w-fit">
        {record ? t('actions.update') : t('actions.save')}
      </Button>
    </form>
  );
}

function NumberField({
  id,
  name,
  label,
  defaultValue,
  value,
  onChange,
  min,
  max,
  step,
  required,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: number | string | null | undefined;
  value?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  step: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        min={min}
        max={max}
        step={step}
        required={required}
      />
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  required,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string | null | undefined;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue ?? ''}
        required={required}
        maxLength={maxLength}
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  value,
  onChange,
  required,
  options,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required={required}
        className="min-h-11 rounded-md border bg-white px-3"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || '__empty'} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function recordLabel(
  record: ClinicalRecord,
  t: ReturnType<typeof useTranslations<'CareDocumentation.clinical'>>,
): string {
  if (record.kind === 'measurement') return t(measurementTypeLabels[record.measurementType]);
  if (record.kind === 'observation') {
    return t(
      observationCategoryLabels[record.category as keyof typeof observationCategoryLabels] ??
        'observations.title',
    );
  }
  if (record.kind === 'assessment') {
    return record.assessmentType === 'general_condition'
      ? t('assessments.types.general_condition')
      : t('assessments.types.pain');
  }
  return t(riskTypeLabels[record.riskType]);
}

function measurementValue(record: Measurement, locale: Locale): string {
  if (record.measurementType === 'blood_pressure') {
    return `${record.systolic ?? '–'}/${record.diastolic ?? '–'} ${record.unit}`;
  }
  if (record.integerValue !== null && record.integerValue !== undefined) {
    return `${formatNumber(record.integerValue, locale)} ${record.unit}`;
  }
  return `${record.value ?? '–'} ${record.unit}`;
}

function observationValueLabel(
  t: ReturnType<typeof useTranslations<'CareDocumentation.clinical'>>,
  category: string,
  value: string,
): string {
  const key = `observations.values.${category}.${value}`;
  try {
    return t(key as 'observations.values.mobility.independent');
  } catch {
    return value;
  }
}
