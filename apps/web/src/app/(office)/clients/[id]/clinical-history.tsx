import Link from 'next/link';
import { Button } from '@care/ui';
import type { components } from '@care/api-client';
import { formatVisitDateTime } from '../../../../lib/care-date';
import type { Locale } from '../../../../i18n/config';
import { getTranslations } from 'next-intl/server';

type HistoryPage = components['schemas']['ClinicalRecordHistoryPageDto'];
type HistoryItem = HistoryPage['items'][number];
type Measurement = Extract<HistoryItem, { kind: 'measurement' }>;
type Observation = Extract<HistoryItem, { kind: 'observation' }>;
type Assessment = Extract<HistoryItem, { kind: 'assessment' }>;
type RiskAssessment = Extract<HistoryItem, { kind: 'risk_assessment' }>;
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

const assessmentTypeKeys = {
  general_condition: 'assessments.types.general_condition',
  pain: 'assessments.types.pain',
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

export function clinicalRange(from: string | undefined, until: string | undefined) {
  const fromDate = dateKeyDate(from);
  const untilDate = dateKeyDate(until);
  const rangeIsValid =
    fromDate !== null &&
    untilDate !== null &&
    untilDate.getTime() >= fromDate.getTime() &&
    untilDate.getTime() - fromDate.getTime() <= 365 * 24 * 60 * 60 * 1000;

  if (rangeIsValid && fromDate && untilDate) {
    return {
      from: fromDate.toISOString().slice(0, 10),
      until: untilDate.toISOString().slice(0, 10),
      fromInstant: fromDate.toISOString(),
      untilInstant: new Date(untilDate.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
    };
  }

  const today = new Date();
  const untilKey = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromKey = start.toISOString().slice(0, 10);
  return {
    from: fromKey,
    until: untilKey,
    fromInstant: `${fromKey}T00:00:00.000Z`,
    untilInstant: today.toISOString(),
  };
}

export async function ClinicalHistorySection({
  clientId,
  locale,
  from,
  until,
  page,
  measurements,
  observations,
  assessments,
  riskHistory,
  currentRisksPage,
  loadFailed,
}: {
  clientId: string;
  locale: Locale;
  from: string;
  until: string;
  page: number;
  measurements: HistoryPage | undefined;
  observations: HistoryPage | undefined;
  assessments: HistoryPage | undefined;
  riskHistory: HistoryPage | undefined;
  currentRisksPage: HistoryPage | undefined;
  loadFailed: boolean;
}) {
  const [t, common] = await Promise.all([
    getTranslations('CareDocumentation.clinical'),
    getTranslations('Common'),
  ]);
  const currentRisks =
    currentRisksPage?.items.filter(
      (item): item is RiskAssessment => item.kind === 'risk_assessment',
    ) ?? [];

  return (
    <section id="clinical" aria-labelledby="clinical-title" className="grid gap-4 scroll-mt-6">
      <div className="grid gap-2">
        <h2 id="clinical-title" className="text-xl font-semibold">
          {t('clientHistory.title')}
        </h2>
        <p className="text-sm text-slate-700">{t('clientHistory.description')}</p>
      </div>

      {loadFailed ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('clientHistory.loadFailed')}
        </p>
      ) : (
        <>
          <section aria-labelledby="current-risks-title" className="grid gap-3">
            <h3 id="current-risks-title" className="text-lg font-semibold">
              {t('clientHistory.currentRisks')}
            </h3>
            {currentRisks.length === 0 ? (
              <p className="rounded-lg border bg-white p-4 text-sm text-slate-700">
                {t('risks.noCurrentRisks')}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {currentRisks.map((risk) => (
                  <li key={risk.id} className="grid gap-1 rounded-lg border bg-white p-4">
                    <p className="font-semibold">{t(riskTypeKeys[risk.riskType])}</p>
                    <p>
                      {t('risks.level')}: {t(riskLevelKeys[risk.level])}
                    </p>
                    <p className="text-sm text-slate-700">
                      {t('clientHistory.assessedAt')}:{' '}
                      {formatVisitDateTime(risk.assessedAt, risk.timezone, locale)}
                    </p>
                    {risk.validUntil ? (
                      <p className="text-sm text-slate-700">
                        {t('assessments.validUntil')}:{' '}
                        {formatVisitDateTime(risk.validUntil, risk.timezone, locale)}
                      </p>
                    ) : null}
                    <RecordMetadata item={risk} t={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form
            action={`/clients/${clientId}#clinical`}
            method="get"
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
          >
            <label className="grid gap-1 text-sm">
              <span>{t('clientHistory.from')}</span>
              <input
                className="h-10 rounded-md border px-3"
                type="date"
                name="clinicalFrom"
                defaultValue={from}
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('clientHistory.until')}</span>
              <input
                className="h-10 rounded-md border px-3"
                type="date"
                name="clinicalUntil"
                defaultValue={until}
                required
              />
            </label>
            <input type="hidden" name="clinicalPage" value="1" />
            <Button type="submit" variant="secondary">
              {common('actions.apply')}
            </Button>
          </form>

          <div className="grid gap-5">
            <HistoryTable
              title={t('measurements.title')}
              empty={t('clientHistory.empty')}
              page={measurements}
              pageNumber={page}
              t={t}
            >
              {(measurements?.items ?? [])
                .filter((item): item is Measurement => item.kind === 'measurement')
                .map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    t={t}
                    date={item.measuredAt}
                    value={measurementValue(item)}
                    label={t(measurementTypeKeys[item.measurementType])}
                  />
                ))}
            </HistoryTable>
            <HistoryTable
              title={t('observations.title')}
              empty={t('clientHistory.empty')}
              page={observations}
              pageNumber={page}
              t={t}
            >
              {(observations?.items ?? [])
                .filter((item): item is Observation => item.kind === 'observation')
                .map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    t={t}
                    date={item.observedAt}
                    value={observationValue(item, t)}
                    label={t(observationCategoryKeys[item.category])}
                  />
                ))}
            </HistoryTable>
            <HistoryTable
              title={t('assessments.title')}
              empty={t('clientHistory.empty')}
              page={assessments}
              pageNumber={page}
              t={t}
            >
              {(assessments?.items ?? [])
                .filter((item): item is Assessment => item.kind === 'assessment')
                .map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    t={t}
                    date={item.assessedAt}
                    value={assessmentValue(item, t)}
                    label={t(assessmentTypeKeys[item.assessmentType])}
                  />
                ))}
            </HistoryTable>
            <HistoryTable
              title={t('risks.title')}
              empty={t('clientHistory.empty')}
              page={riskHistory}
              pageNumber={page}
              t={t}
            >
              {(riskHistory?.items ?? [])
                .filter((item): item is RiskAssessment => item.kind === 'risk_assessment')
                .map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    t={t}
                    date={item.assessedAt}
                    value={t(riskLevelKeys[item.level])}
                    label={t(riskTypeKeys[item.riskType])}
                  />
                ))}
            </HistoryTable>
          </div>
          <Pagination
            clientId={clientId}
            page={page}
            from={from}
            until={until}
            total={Math.max(
              measurements?.total ?? 0,
              observations?.total ?? 0,
              assessments?.total ?? 0,
              riskHistory?.total ?? 0,
            )}
            t={t}
          />
        </>
      )}
    </section>
  );
}

function HistoryTable({
  title,
  empty,
  page,
  pageNumber,
  t,
  children,
}: {
  title: string;
  empty: string;
  page: HistoryPage | undefined;
  pageNumber: number;
  t: ClinicalTranslator;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h3 className="text-lg font-semibold">{title}</h3>
      {!page || page.items.length === 0 ? (
        <p className="rounded-lg border bg-white p-4 text-sm text-slate-700">
          {page && page.total > 0 ? t('clientHistory.emptyPage') : empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="p-3">{t('clientHistory.dateTime')}</th>
                <th className="p-3">{t('clientHistory.value')}</th>
                <th className="p-3">{t('clientHistory.recordedBy')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">{children}</tbody>
          </table>
        </div>
      )}
      {page && page.total > 0 && (pageNumber - 1) * 25 < page.total ? (
        <p className="text-sm text-slate-600">
          {t('clientHistory.showing', {
            from: (pageNumber - 1) * 25 + 1,
            until: Math.min(pageNumber * 25, page.total),
            total: page.total,
          })}
        </p>
      ) : null}
    </section>
  );
}

function HistoryRow({
  item,
  locale,
  t,
  date,
  label,
  value,
}: {
  item: HistoryItem;
  locale: Locale;
  t: ClinicalTranslator;
  date: string;
  label: string;
  value: string;
}) {
  return (
    <tr>
      <td className="p-3 align-top">
        <p>{formatVisitDateTime(date, item.timezone, locale)}</p>
        <p className="mt-1 text-xs text-slate-600">
          {t('clientHistory.visit')}:{' '}
          {formatVisitDateTime(item.plannedStart, item.timezone, locale)}
        </p>
      </td>
      <td className="p-3 align-top">
        <p className="font-medium">{label}</p>
        <p>{value}</p>
        {item.kind === 'measurement' ? (
          <p className="mt-1 text-sm text-slate-700">
            {t('measurements.source')}: {measurementSourceLabel(item.source, t)}
          </p>
        ) : null}
        {item.kind === 'risk_assessment' ? (
          <p className="mt-1 text-sm text-slate-700">
            {t('risks.source')}: {item.source}
          </p>
        ) : null}
        {item.kind === 'assessment' && item.validUntil ? (
          <p className="mt-1 text-sm text-slate-700">
            {t('assessments.validUntil')}:{' '}
            {formatVisitDateTime(item.validUntil, item.timezone, locale)}
          </p>
        ) : null}
        {item.note ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{item.note}</p> : null}
        {item.correctsRecordId ? (
          <p className="mt-1 text-amber-800">
            {t('records.correctionReason', { reason: item.correctionReason ?? '' })}
          </p>
        ) : null}
        {item.correctedByRecordId ? (
          <p className="mt-1 text-slate-600">{t('records.corrected')}</p>
        ) : null}
      </td>
      <td className="p-3 align-top">
        {item.recordedByEmployeeName ?? t('clientHistory.unknownRecorder')}
      </td>
    </tr>
  );
}

function RecordMetadata({ item, t }: { item: RiskAssessment; t: ClinicalTranslator }) {
  return (
    <>
      <p className="text-sm text-slate-700">
        {t('clientHistory.recordedBy')}:{' '}
        {item.recordedByEmployeeName ?? t('clientHistory.unknownRecorder')}
      </p>
      {item.note ? <p className="whitespace-pre-wrap text-sm">{item.note}</p> : null}
      <p className="text-sm text-slate-700">
        {t('risks.source')}: {item.source}
      </p>
      {item.correctsRecordId ? (
        <p className="text-sm text-amber-800">
          {t('records.correctionReason', { reason: item.correctionReason ?? '' })}
        </p>
      ) : null}
      {item.correctedByRecordId ? (
        <p className="text-sm text-slate-600">{t('records.corrected')}</p>
      ) : null}
    </>
  );
}

function Pagination({
  clientId,
  page,
  from,
  until,
  total,
  t,
}: {
  clientId: string;
  page: number;
  from: string;
  until: string;
  total: number;
  t: ClinicalTranslator;
}) {
  const pageSize = 25;
  if (total <= pageSize) return null;
  return (
    <nav aria-label={t('clientHistory.pagination')} className="flex justify-end gap-2">
      {page > 1 ? (
        <Button asChild variant="secondary">
          <Link href={historyPageHref(clientId, from, until, page - 1)}>
            {t('clientHistory.previous')}
          </Link>
        </Button>
      ) : null}
      {page * pageSize < total ? (
        <Button asChild variant="secondary">
          <Link href={historyPageHref(clientId, from, until, page + 1)}>
            {t('clientHistory.next')}
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}

function historyPageHref(clientId: string, from: string, until: string, page: number) {
  return `/clients/${clientId}?clinicalFrom=${from}&clinicalUntil=${until}&clinicalPage=${page}#clinical`;
}

function measurementValue(item: Measurement) {
  if (item.measurementType === 'blood_pressure')
    return `${item.systolic}/${item.diastolic} ${item.unit}`;
  return `${item.integerValue ?? item.value ?? ''} ${item.unit}`.trim();
}

function measurementSourceLabel(source: Measurement['source'], t: ClinicalTranslator) {
  return source === 'device' ? t('measurements.sources.device') : t('measurements.sources.manual');
}

function observationValue(item: Observation, t: ClinicalTranslator) {
  if (item.category === 'pain') {
    return `${item.painScore ?? ''}/10${item.location ? ` · ${item.location}` : ''}${severitySuffix(item.severity, t)}`;
  }
  if (!item.valueCode) return '';
  const labels: Record<string, string> = {};
  switch (item.category) {
    case 'mobility':
      labels.independent = t('observations.values.mobility.independent');
      labels.assistance_required = t('observations.values.mobility.assistance_required');
      labels.bedbound = t('observations.values.mobility.bedbound');
      break;
    case 'orientation':
      labels.oriented = t('observations.values.orientation.oriented');
      labels.disoriented = t('observations.values.orientation.disoriented');
      break;
    case 'skin':
      labels.intact = t('observations.values.skin.intact');
      labels.redness = t('observations.values.skin.redness');
      labels.altered = t('observations.values.skin.altered');
      break;
    case 'nutrition':
      labels.adequate = t('observations.values.nutrition.adequate');
      labels.reduced = t('observations.values.nutrition.reduced');
      labels.declined = t('observations.values.nutrition.declined');
      break;
    case 'hydration':
      labels.adequate = t('observations.values.hydration.adequate');
      labels.reduced = t('observations.values.hydration.reduced');
      labels.declined = t('observations.values.hydration.declined');
      break;
    case 'elimination':
      labels.unchanged = t('observations.values.elimination.unchanged');
      labels.changed = t('observations.values.elimination.changed');
      labels.incontinence = t('observations.values.elimination.incontinence');
      break;
    case 'sleep':
      labels.restful = t('observations.values.sleep.restful');
      labels.disturbed = t('observations.values.sleep.disturbed');
      break;
    case 'mood':
      labels.calm = t('observations.values.mood.calm');
      labels.anxious = t('observations.values.mood.anxious');
      labels.low = t('observations.values.mood.low');
      labels.agitated = t('observations.values.mood.agitated');
      break;
    case 'general_condition':
      labels.stable = t('observations.values.general_condition.stable');
      labels.changed = t('observations.values.general_condition.changed');
      labels.declined = t('observations.values.general_condition.declined');
      break;
  }
  return `${labels[item.valueCode] ?? item.valueCode.replaceAll('_', ' ')}${severitySuffix(item.severity, t)}`;
}

function severitySuffix(value: string | null | undefined, t: ClinicalTranslator): string {
  switch (value) {
    case 'mild':
      return ` · ${t('observations.severityValues.mild')}`;
    case 'moderate':
      return ` · ${t('observations.severityValues.moderate')}`;
    case 'severe':
      return ` · ${t('observations.severityValues.severe')}`;
    default:
      return '';
  }
}

function assessmentValue(item: Assessment, t: ClinicalTranslator) {
  const resultKeys = {
    stable: 'assessments.generalConditionResults.stable',
    changed: 'assessments.generalConditionResults.changed',
    declined: 'assessments.generalConditionResults.declined',
  } as const;
  const result =
    item.resultCode && item.resultCode in resultKeys
      ? t(resultKeys[item.resultCode as keyof typeof resultKeys])
      : item.resultCode;
  return [result, item.score].filter(Boolean).join(' · ');
}

function dateKeyDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
