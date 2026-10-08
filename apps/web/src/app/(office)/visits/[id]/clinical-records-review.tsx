import type { components } from '@care/api-client';
import { getTranslations } from 'next-intl/server';
import { formatNumber } from '../../../../i18n/format';
import type { Locale } from '../../../../i18n/config';
import { formatVisitDateTime } from '../../../../lib/care-date';

type ClinicalDetail = components['schemas']['ClinicalDocumentationDetailDto'];
type ClinicalRecord = ClinicalDetail['records'][number];
type ClinicalTranslator = Awaited<ReturnType<typeof getTranslations<'CareDocumentation.clinical'>>>;

const measurementTypeKeys = {
  blood_pressure: 'measurements.types.blood_pressure',
  pulse: 'measurements.types.pulse',
  temperature: 'measurements.types.temperature',
  weight: 'measurements.types.weight',
  blood_glucose: 'measurements.types.blood_glucose',
  oxygen_saturation: 'measurements.types.oxygen_saturation',
  respiratory_rate: 'measurements.types.respiratory_rate',
} as const;

const observationCategoryKeys = {
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

const riskTypeKeys = {
  fall: 'risks.types.fall',
  pressure_ulcer: 'risks.types.pressure_ulcer',
  dehydration: 'risks.types.dehydration',
  malnutrition: 'risks.types.malnutrition',
} as const;

const riskLevelKeys = {
  none: 'risks.levels.none',
  low: 'risks.levels.low',
  moderate: 'risks.levels.moderate',
  high: 'risks.levels.high',
} as const;

export async function ClinicalRecordsReview({
  detail,
  loadFailed,
  locale,
  timezone,
}: {
  detail: ClinicalDetail | undefined;
  loadFailed: boolean;
  locale: Locale;
  timezone: string;
}) {
  const t = await getTranslations('CareDocumentation.clinical');

  return (
    <section aria-labelledby="clinical-records-review-title" className="grid gap-3">
      <h3 id="clinical-records-review-title" className="font-semibold">
        {t('title')}
      </h3>
      {loadFailed ? (
        <p role="alert" className="text-sm text-red-800">
          {t('loadFailed')}
        </p>
      ) : !detail || detail.records.length === 0 ? (
        <p className="text-sm text-slate-600">{t('empty')}</p>
      ) : (
        <ul className="grid gap-2">
          {detail.records.map((record) => (
            <ClinicalRecordItem
              key={record.id}
              record={record}
              locale={locale}
              timezone={timezone}
              t={t}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClinicalRecordItem({
  record,
  locale,
  timezone,
  t,
}: {
  record: ClinicalRecord;
  locale: Locale;
  timezone: string;
  t: ClinicalTranslator;
}) {
  const { title, value, at, note } = describeRecord(record, locale, timezone, t);

  return (
    <li className="grid gap-1 rounded-md bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-medium">{title}</span>
        <time className="text-sm text-slate-600">{at}</time>
      </div>
      <p>{value}</p>
      {record.kind === 'measurement' ? (
        <p className="text-sm text-slate-600">
          {t('measurements.source')}:{' '}
          {t(`measurements.sources.${record.source}` as 'measurements.sources.manual')}
        </p>
      ) : null}
      {record.kind === 'risk_assessment' ? (
        <p className="text-sm text-slate-600">
          {t('risks.source')}: {record.source}
        </p>
      ) : null}
      {record.kind === 'observation' && record.severity ? (
        <p className="text-sm text-slate-600">
          {t('observations.severity')}:{' '}
          {t(
            `observations.severityValues.${record.severity}` as 'observations.severityValues.mild',
          )}
        </p>
      ) : null}
      {record.kind !== 'measurement' && record.kind !== 'observation' && record.validUntil ? (
        <p className="text-sm text-slate-600">
          {t('assessments.validUntil')}: {formatVisitDateTime(record.validUntil, timezone, locale)}
        </p>
      ) : null}
      {note ? <p className="whitespace-pre-wrap text-sm text-slate-700">{note}</p> : null}
      {record.correctsRecordId ? (
        <p className="text-sm text-amber-800">
          {t('records.correctionReason', { reason: record.correctionReason ?? '' })}
        </p>
      ) : null}
      {record.correctedByRecordId ? (
        <p className="text-sm text-slate-600">{t('records.corrected')}</p>
      ) : null}
    </li>
  );
}

function describeRecord(
  record: ClinicalRecord,
  locale: Locale,
  timezone: string,
  t: ClinicalTranslator,
): { title: string; value: string; at: string; note: string | null } {
  switch (record.kind) {
    case 'measurement':
      const scalarValue = record.integerValue ?? record.value;
      return {
        title: t(measurementTypeKeys[record.measurementType]),
        value:
          record.measurementType === 'blood_pressure'
            ? `${record.systolic ?? '–'}/${record.diastolic ?? '–'} ${record.unit}`
            : scalarValue === null
              ? '–'
              : `${formatNumber(Number(scalarValue), locale)} ${record.unit}`,
        at: formatVisitDateTime(record.measuredAt, timezone, locale),
        note: record.note ?? null,
      };
    case 'observation':
      return {
        title: t(observationCategoryKeys[record.category]),
        value:
          record.category === 'pain'
            ? `${t('observations.painScore')}: ${record.painScore ?? '–'}${record.location ? ` · ${record.location}` : ''}`
            : record.valueCode
              ? t(
                  `observations.values.${record.category}.${record.valueCode}` as 'observations.values.mobility.independent',
                )
              : '–',
        at: formatVisitDateTime(record.observedAt, timezone, locale),
        note: record.note ?? null,
      };
    case 'assessment':
      return {
        title: t(
          `assessments.types.${record.assessmentType}` as 'assessments.types.general_condition',
        ),
        value: record.resultCode
          ? t(
              `assessments.generalConditionResults.${record.resultCode}` as 'assessments.generalConditionResults.stable',
            )
          : `${t('assessments.score')}: ${record.score ?? '–'}`,
        at: formatVisitDateTime(record.assessedAt, timezone, locale),
        note: record.note ?? null,
      };
    case 'risk_assessment':
      return {
        title: t(riskTypeKeys[record.riskType]),
        value: t(riskLevelKeys[record.level]),
        at: formatVisitDateTime(record.assessedAt, timezone, locale),
        note: record.note ?? null,
      };
  }
}
