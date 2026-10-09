import Link from 'next/link';
import { Button, Input, Label } from '@care/ui';
import type { components } from '@care/api-client';
import { getLocale, getTranslations } from 'next-intl/server';
import { v7 as uuidv7 } from 'uuid';
import { errorMessageKey } from '../../../../../i18n/errors';
import { formatDateTime } from '../../../../../i18n/format';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import ReconciliationScheduleFields from './reconciliation-schedule-fields';
import {
  addMedicationReconciliationEntryAction,
  addMedicationReconciliationSourceAction,
  applyMedicationReconciliationAction,
  cancelMedicationReconciliationAction,
  compareMedicationReconciliationAction,
  completeMedicationReconciliationAction,
  matchMedicationReconciliationEntryAction,
  recordMedicationReconciliationDecisionAction,
  startMedicationReconciliationAction,
} from './reconciliation-actions';

type Entry = components['schemas']['MedicationReconciliationEntryDto'];
type Baseline = components['schemas']['MedicationReconciliationBaselineDto'];
type Discrepancy = components['schemas']['MedicationReconciliationDiscrepancyDto'];
type Source = components['schemas']['MedicationReconciliationSourceDto'];
type OrderRevision = components['schemas']['MedicationOrderRevisionDto'];
type Schedule = OrderRevision['schedule'];
type BaselineSnapshot = {
  status: string;
  medicationSnapshot: {
    name: string;
    activeIngredient: string | null;
    strength: string | null;
    dosageForm: string;
  };
  doseAmount: string;
  doseUnit: string;
  route: string;
  schedule: Schedule;
  validFrom: string;
  validUntil: string | null;
};
type Match = { baselineId: string | null; version: number };
type Translate = (key: string, values?: Record<string, string | number>) => string;

const reasons = [
  'initial_intake',
  'hospital_discharge',
  'physician_update',
  'periodic_review',
  'reported_change',
  'other',
] as const;
const sourceTypes = [
  'physician',
  'hospital_discharge',
  'pharmacy',
  'client',
  'representative',
  'other',
] as const;
const decisions = ['accept_internal', 'accept_external', 'requires_clarification', 'no_change'] as const;
const routes = [
  'oral',
  'topical',
  'subcutaneous',
  'intramuscular',
  'inhalation',
  'transdermal',
  'other',
] as const;
const units = ['mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch'] as const;
const dosageForms = [
  'tablet',
  'capsule',
  'drops',
  'solution',
  'injection',
  'cream',
  'patch',
  'inhalation',
  'other',
] as const;

export default async function MedicationReconciliationPanel({
  clientId,
  timezone,
  from,
  until,
  selectedId,
  currentOrderVersions,
  canRead,
  canCreate,
  canUpdate,
  canComplete,
}: Readonly<{
  clientId: string;
  timezone: string;
  from: string;
  until: string;
  selectedId: string | undefined;
  currentOrderVersions: Record<string, number>;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canComplete: boolean;
}>) {
  const [rootTranslator, reconciliationTranslator, medicationTranslator, api, header, locale] = await Promise.all([
    getTranslations(),
    getTranslations('MedicationReconciliation'),
    getTranslations('Medication'),
    getApiClient(),
    getTenantHeader(),
    getLocale(),
  ]);
  const t: Translate = (key, values) =>
    reconciliationTranslator(key as never, values as never) as string;
  const medicationT: Translate = (key, values) =>
    medicationTranslator(key as never, values as never) as string;
  const rootT: Translate = (key, values) => rootTranslator(key as never, values as never) as string;
  const clientUrl = '/clients/' + clientId + '/medications';
  const listUrl = (id?: string) => {
    const query = new URLSearchParams();
    if (id) query.set('reconciliationId', id);
    if (from) query.set('from', from);
    if (until) query.set('until', until);
    return clientUrl + (query.size ? '?' + query.toString() : '') + '#reconciliation';
  };

  if (!canRead) {
    return (
      <section id="reconciliation" className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="text-slate-600">{t('noReadPermission')}</p>
      </section>
    );
  }

  const listResult = await api.GET('/api/v1/clients/{clientId}/medication-reconciliations', {
    params: { path: { clientId }, header },
  });
  const reconciliations = listResult.data ?? [];
  const selectedFromQuery = selectedId
    ? reconciliations.find((item) => item.id === selectedId)
    : undefined;
  const selected = selectedId
    ? selectedFromQuery
    : reconciliations.find((item) => item.status === 'draft' || item.status === 'in_review') ??
      reconciliations[0];
  const detailResult = selected
    ? await api.GET('/api/v1/medication-reconciliations/{reconciliationId}', {
        params: { path: { reconciliationId: selected.id }, header },
      })
    : null;
  const detail = detailResult?.data;
  const reconciliation = detail?.reconciliation;
  const editable =
    canUpdate &&
    reconciliation !== undefined &&
    (reconciliation.status === 'draft' || reconciliation.status === 'in_review');
  const selectedIdForActions = reconciliation?.id ?? '';
  const entriesById = new Map((detail?.entries ?? []).map((entry) => [entry.id, entry]));
  const sourcesById = new Map((detail?.sources ?? []).map((source) => [source.id, source]));
  const baselinesById = new Map((detail?.baselines ?? []).map((baseline) => [baseline.id, baseline]));

  const reasonLabels = Object.fromEntries(reasons.map((reason) => [reason, t('reasons.' + reason)]));
  const sourceLabels = Object.fromEntries(sourceTypes.map((source) => [source, t('sourceTypes.' + source)]));
  const decisionLabels = Object.fromEntries(
    decisions.map((decision) => [decision, t('decisions.' + decision)]),
  ) as Record<(typeof decisions)[number], string>;
  const statusLabels = {
    draft: t('statuses.draft'),
    in_review: t('statuses.in_review'),
    completed: t('statuses.completed'),
    cancelled: t('statuses.cancelled'),
  };
  const findingLabels = {
    missing_in_internal_plan: t('discrepancyTypes.missing_in_internal_plan'),
    missing_in_external_source: t('discrepancyTypes.missing_in_external_source'),
    dose_mismatch: t('discrepancyTypes.dose_mismatch'),
    route_mismatch: t('discrepancyTypes.route_mismatch'),
    schedule_mismatch: t('discrepancyTypes.schedule_mismatch'),
    medication_mismatch: t('discrepancyTypes.medication_mismatch'),
    status_mismatch: t('discrepancyTypes.status_mismatch'),
    insufficient_information: t('discrepancyTypes.insufficient_information'),
  };
  const reportedStatusLabels = {
    active: t('reportedStatuses.active'),
    paused: t('reportedStatuses.paused'),
    discontinued: t('reportedStatuses.discontinued'),
    unknown: t('reportedStatuses.unknown'),
  };
  const routeLabels = Object.fromEntries(routes.map((route) => [route, medicationT('routes.' + route)]));
  const unitLabels = Object.fromEntries(units.map((unit) => [unit, medicationT('units.' + unit)]));
  const dosageFormLabels = Object.fromEntries(
    dosageForms.map((form) => [form, medicationT('dosageForms.' + form)]),
  );
  const routeLabel = (value?: string | null) =>
    value ? routeLabels[value] ?? value : t('unknown');
  const unitLabel = (value?: string | null) => (value ? unitLabels[value] ?? value : t('unknown'));
  const dosageFormLabel = (value?: string | null) =>
    value ? dosageFormLabels[value] ?? value : t('unknown');
  const statusLabel = (value?: string | null) =>
    value ? reportedStatusLabels[value as keyof typeof reportedStatusLabels] ?? value : t('unknown');
  const scheduleLabel = (schedule?: Schedule | null, description?: string | null) => {
    if (!schedule) return description?.trim() || t('unknown');
    if (schedule.type === 'fixed_times') return schedule.times.join(', ');
    if (schedule.type === 'interval') {
      return schedule.intervalMinutes + ' ' + medicationT('minutes');
    }
    return schedule.indication;
  };
  const valueLabel = (value: unknown, field: string) => {
    if (value === null || value === undefined || value === '') return t('unknown');
    if (typeof value === 'string') {
      if (field === 'route') return routeLabel(value);
      if (field === 'status') return statusLabel(value);
      return value;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      if (typeof object.amount === 'string' && typeof object.unit === 'string') {
        return object.amount + ' ' + unitLabel(object.unit);
      }
      if (typeof object.type === 'string') {
        return scheduleLabel(value as Schedule);
      }
    }
    return JSON.stringify(value) ?? t('unknown');
  };
  const baselineSnapshot = (baseline: Baseline): BaselineSnapshot =>
    baseline.snapshot as unknown as BaselineSnapshot;
  const currentFindings = (detail?.discrepancies ?? []).filter((finding) => finding.isCurrent);
  const unresolvedExternal = currentFindings.filter(
    (finding) => finding.latestDecision?.decision === 'accept_external' && !finding.application,
  );
  const applicationGroups = groupApplicationFindings(unresolvedExternal, entriesById);
  const canApplyFinding = (finding: Discrepancy, source: Source | undefined) => {
    if (!source || (source.sourceType !== 'physician' && source.sourceType !== 'hospital_discharge')) {
      return false;
    }
    if (!source.reference?.trim()) return false;
    if (!finding.baselineId || !finding.entryId) return false;
    const baseline = baselinesById.get(finding.baselineId);
    const entry = entriesById.get(finding.entryId);
    if (!baseline || !entry) return false;
    if (currentOrderVersions[baseline.orderId] !== baseline.orderVersion) return false;
    const snapshot = baselineSnapshot(baseline);
    if (finding.type === 'dose_mismatch') {
      return !!entry.doseAmount && !!entry.doseUnit && entry.doseUnit === snapshot.doseUnit;
    }
    if (finding.type === 'route_mismatch') return !!entry.route;
    if (finding.type === 'schedule_mismatch') {
      const schedule = entry.structuredSchedule as unknown as Schedule & { timezone?: string } | null;
      return !!schedule && schedule.timezone === timezone;
    }
    return finding.type === 'status_mismatch' && entry.reportedStatus !== 'unknown';
  };

  return (
    <section id="reconciliation" className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
      <header className="grid gap-2">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="max-w-3xl text-sm text-slate-700">{t('description')}</p>
      </header>

      {listResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {rootT(errorMessageKey(listResult.error.code))}
        </p>
      ) : null}
      {selectedId && !selectedFromQuery && !listResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('notFound')}
        </p>
      ) : null}
      {detailResult?.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {rootT(errorMessageKey(detailResult.error.code))}
        </p>
      ) : null}

      {canCreate ? (
        <form action={startMedicationReconciliationAction} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="grid gap-1.5">
            <Label htmlFor="reconciliation-reason">{t('reason')}</Label>
            <select
              id="reconciliation-reason"
              name="reason"
              defaultValue=""
              required
              className="min-h-12 rounded-md border bg-white px-3"
            >
              <option value="">{t('selectReason')}</option>
              {reasons.map((reason) => (
                <option key={reason} value={reason}>{reasonLabels[reason]}</option>
              ))}
            </select>
          </div>
          <Button type="submit" className="min-h-12 w-full sm:w-fit">{t('start')}</Button>
        </form>
      ) : null}

      <div className="grid gap-2">
        <h3 className="font-semibold">{t('history')}</h3>
        {reconciliations.length ? (
          <ol className="grid gap-2">
            {reconciliations.map((item) => (
              <li key={item.id}>
                <Link
                  href={listUrl(item.id)}
                  aria-current={item.id === selected?.id ? 'page' : undefined}
                  className={
                    'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 underline ' +
                    (item.id === selected?.id ? 'border-blue-700 bg-blue-50' : 'border-slate-200')
                  }
                >
                  <span>
                    {t('reasons.' + item.reason)} · {t('started', { date: formatDateTime(item.startedAt, locale) ?? '—' })}
                  </span>
                  <span className="font-medium">{statusLabels[item.status]}</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-600">{t('noHistory')}</p>
        )}
      </div>

      {!detail && !selectedId && !reconciliations.length ? null : null}
      {detail && reconciliation ? (
        <article className="grid gap-5 border-t pt-5">
          <header className="grid gap-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{t('title')}</h3>
                <p className="text-sm text-slate-600">
                  {t('reasons.' + reconciliation.reason)} · {statusLabels[reconciliation.status]} ·{' '}
                  {t('version', { version: reconciliation.version })}
                </p>
              </div>
              <p className="text-sm text-slate-600">
                {t('started', { date: formatDateTime(reconciliation.startedAt, locale) ?? '—' })}
              </p>
            </div>
            {reconciliation.completedAt ? (
              <p className="text-sm text-slate-600">
                {t('completedOn', { date: formatDateTime(reconciliation.completedAt, locale) ?? '—' })}
              </p>
            ) : null}
          </header>

          <section className="grid gap-3">
            <div>
              <h4 className="font-semibold">{t('baseline')}</h4>
              <p className="text-sm text-slate-600">{t('baselineHelp')}</p>
            </div>
            {detail.baselines.length ? (
              <div className="grid gap-3">
                {detail.baselines.map((baseline) => {
                  const snapshot = baselineSnapshot(baseline);
                  return (
                    <article key={baseline.id} className="rounded-md border p-3">
                      <h5 className="font-medium">
                        {snapshot.medicationSnapshot.name} · {t('orderVersion', { version: baseline.orderVersion })}
                      </h5>
                      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                        <Fact label={t('medicationName')} value={snapshot.medicationSnapshot.name} />
                        <Fact
                          label={t('doseAmount')}
                          value={snapshot.doseAmount + ' ' + unitLabel(snapshot.doseUnit)}
                        />
                        <Fact label={t('route')} value={routeLabel(snapshot.route)} />
                        <Fact label={t('scheduleDescription')} value={scheduleLabel(snapshot.schedule)} />
                        <Fact label={t('reportedStatus')} value={statusLabel(snapshot.status)} />
                        <Fact
                          label={t('validity')}
                          value={t('validityRange', {
                            from: snapshot.validFrom,
                            until: snapshot.validUntil ?? t('unknown'),
                          })}
                        />
                      </dl>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{t('noBaseline')}</p>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold">{t('sources')}</h4>
            </div>
            {detail.sources.length ? (
              <ul className="grid gap-2">
                {detail.sources.map((source) => (
                  <li key={source.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{t('sourceTypes.' + source.sourceType)}</p>
                    <p>{source.sourceName || t('unknown')} · {t('provenance.' + source.provenanceClass)}</p>
                    <p>{t('receivedAt', { date: formatDateTime(source.receivedAt, locale) ?? '—' })}</p>
                    {source.sourceDate ? <p>{t('sourceDate')}: {source.sourceDate}</p> : null}
                    <p>{t('reference')}: {source.reference || t('unknown')}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">{t('noSources')}</p>
            )}
            {editable ? (
              <form action={addMedicationReconciliationSourceAction} className="grid gap-3 rounded-md bg-slate-50 p-3">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="reconciliationId" value={selectedIdForActions} />
                <input type="hidden" name="expectedVersion" value={reconciliation.version} />
                <h5 className="font-medium">{t('addSource')}</h5>
                <SelectField
                  id="reconciliation-source-type"
                  name="sourceType"
                  label={t('sourceType')}
                  placeholder={t('selectSourceType')}
                  options={sourceTypes.map((value): [string, string] => [
                    value,
                    sourceLabels[value] ?? value,
                  ])}
                  required
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField id="reconciliation-source-name" name="sourceName" label={t('sourceName')} />
                  <TextField id="reconciliation-source-date" name="sourceDate" label={t('sourceDate')} type="date" />
                </div>
                <TextField id="reconciliation-source-reference" name="reference" label={t('reference')} />
                <p className="text-sm text-slate-600">{t('sourceReferenceHelp')}</p>
                <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">{t('addSource')}</Button>
              </form>
            ) : null}
          </section>

          <section className="grid gap-3">
            <h4 className="font-semibold">{t('entries')}</h4>
            {detail.entries.length ? (
              <div className="grid gap-3">
                {detail.entries.map((entry) => {
                  const source = sourcesById.get(entry.sourceId);
                  const match = entry.currentMatch as unknown as Match | null;
                  const baseline = match?.baselineId ? baselinesById.get(match.baselineId) : undefined;
                  const snapshot = baseline ? baselineSnapshot(baseline) : undefined;
                  const schedule = entry.structuredSchedule as unknown as Schedule | null;
                  return (
                    <article key={entry.id} className="grid gap-3 rounded-md border p-3">
                      <header>
                        <h5 className="font-medium">{entry.medicationName}</h5>
                        <p className="text-sm text-slate-600">
                          {source ? t('sourceTypes.' + source.sourceType) : t('unknown')}
                          {entry.isCurrent ? '' : ' · ' + t('superseded')}
                        </p>
                        {entry.correctionReason ? (
                          <p className="text-sm">{t('correctionReason')}: {entry.correctionReason}</p>
                        ) : null}
                      </header>
                      <ComparisonTable
                        external={{
                          medication: entry.medicationName,
                          activeIngredient: entry.activeIngredient,
                          strength: entry.strength,
                          dosageForm: entry.dosageForm,
                          dose: entry.doseAmount && entry.doseUnit
                            ? { amount: entry.doseAmount, unit: entry.doseUnit }
                            : null,
                          route: entry.route,
                          schedule: scheduleLabel(schedule, entry.scheduleDescription),
                          status: entry.reportedStatus,
                        }}
                        internal={snapshot ? {
                          medication: snapshot.medicationSnapshot.name,
                          activeIngredient: snapshot.medicationSnapshot.activeIngredient,
                          strength: snapshot.medicationSnapshot.strength,
                          dosageForm: snapshot.medicationSnapshot.dosageForm,
                          dose: { amount: snapshot.doseAmount, unit: snapshot.doseUnit },
                          route: snapshot.route,
                          schedule: scheduleLabel(snapshot.schedule),
                          status: snapshot.status,
                        } : null}
                        t={t}
                        formatValue={valueLabel}
                        routeLabel={routeLabel}
                        dosageFormLabel={dosageFormLabel}
                        statusLabel={statusLabel}
                      />
                      {editable && entry.isCurrent ? (
                        <form action={matchMedicationReconciliationEntryAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                          <input type="hidden" name="clientId" value={clientId} />
                          <input type="hidden" name="reconciliationId" value={selectedIdForActions} />
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="expectedVersion" value={reconciliation.version} />
                          <SelectField
                            id={'match-' + entry.id}
                            name="baselineId"
                            label={t('match')}
                            placeholder={t('noMatch')}
                            value={match?.baselineId ?? ''}
                            options={detail.baselines.map((item) => {
                              const itemSnapshot = baselineSnapshot(item);
                              return [
                                item.id,
                                itemSnapshot.medicationSnapshot.name + ' · ' + t('orderVersion', { version: item.orderVersion }),
                              ];
                            })}
                          />
                          <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">{t('saveMatch')}</Button>
                        </form>
                      ) : null}
                      {editable && entry.isCurrent ? (
                        <details className="border-t pt-3">
                          <summary className="cursor-pointer font-medium">{t('correctEntry')}</summary>
                          <EntryForm
                            action={addMedicationReconciliationEntryAction}
                            clientId={clientId}
                            reconciliationId={selectedIdForActions}
                            expectedVersion={reconciliation.version}
                            sourceId={entry.sourceId}
                            timezone={timezone}
                            entry={entry}
                            t={t}
                            medicationT={medicationT}
                            routeLabels={routeLabels}
                            unitLabels={unitLabels}
                            dosageFormLabels={dosageFormLabels}
                          />
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-600">{t('noEntries')}</p>
            )}
            {editable && detail.sources.length ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">{t('addEntry')}</summary>
                <div className="mt-3 grid gap-4">
                  {detail.sources.map((source) => (
                    <div key={source.id} className="border-t pt-3">
                      <p className="mb-2 text-sm font-medium">{t('sourceTypes.' + source.sourceType)}</p>
                      <EntryForm
                        action={addMedicationReconciliationEntryAction}
                        clientId={clientId}
                        reconciliationId={selectedIdForActions}
                        expectedVersion={reconciliation.version}
                        sourceId={source.id}
                        timezone={timezone}
                        t={t}
                        medicationT={medicationT}
                        routeLabels={routeLabels}
                        unitLabels={unitLabels}
                        dosageFormLabels={dosageFormLabels}
                      />
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {editable && !detail.sources.length ? (
              <p className="text-sm text-slate-600">{t('noSources')}</p>
            ) : null}
          </section>

          <section className="grid gap-3 border-t pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h4 className="font-semibold">{t('discrepancies')}</h4>
                {detail.comparisonCurrent ? (
                  <p className="text-sm text-slate-600">{t('comparisonCurrent')}</p>
                ) : (
                  <p className="text-sm text-amber-900">{t('comparisonStale')}</p>
                )}
              </div>
              {editable && detail.entries.some((entry) => entry.isCurrent) ? (
                <form action={compareMedicationReconciliationAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="reconciliationId" value={selectedIdForActions} />
                  <input type="hidden" name="expectedVersion" value={reconciliation.version} />
                  <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">{t('compare')}</Button>
                </form>
              ) : null}
            </div>
            {detail.comparisonCurrent ? (
              currentFindings.length ? (
                <div className="grid gap-3">
                  {currentFindings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      t={t}
                      findingLabels={findingLabels}
                      decisionLabels={decisionLabels}
                      formatValue={valueLabel}
                      editable={!!editable && !finding.application}
                      clientId={clientId}
                      reconciliationId={selectedIdForActions}
                      expectedVersion={reconciliation.version}
                      locale={locale}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{t('noDiscrepancies')}</p>
              )
            ) : (
              <p className="text-sm text-slate-600">{t('compareBeforeReview')}</p>
            )}
            {applicationGroups.length ? (
              <div className="grid gap-3 border-t pt-4">
                <h5 className="font-semibold">{t('apply')}</h5>
                {applicationGroups.map((group) => {
                  const source = group.sourceId ? sourcesById.get(group.sourceId) : undefined;
                  const eligibleFindings = group.findings.filter((finding) => canApplyFinding(finding, source));
                  const hasStaleBaseline = group.baselineId
                    ? (() => {
                        const baseline = baselinesById.get(group.baselineId);
                        return !!baseline && currentOrderVersions[baseline.orderId] !== baseline.orderVersion;
                      })()
                    : false;
                  return (
                    <form
                      key={group.key}
                      action={applyMedicationReconciliationAction}
                      className="grid gap-3 rounded-md border p-3"
                    >
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="reconciliationId" value={selectedIdForActions} />
                      <input type="hidden" name="expectedVersion" value={reconciliation.version} />
                      <input type="hidden" name="actionId" value={uuidv7()} />
                      <h6 className="font-medium">
                        {source ? t('sourceTypes.' + source.sourceType) : t('unknown')}
                        {group.baselineId && baselinesById.has(group.baselineId)
                          ? ' · ' + baselineSnapshot(baselinesById.get(group.baselineId)!).medicationSnapshot.name
                          : ''}
                      </h6>
                      {hasStaleBaseline ? (
                        <p className="text-sm text-amber-900">{t('staleBaseline')}</p>
                      ) : null}
                      {!eligibleFindings.length && source && source.sourceType !== 'physician' && source.sourceType !== 'hospital_discharge' ? (
                        <p className="text-sm text-slate-600">{t('sourceNotAuthorized')}</p>
                      ) : null}
                      {group.findings.map((finding) => {
                        const canApply = canApplyFinding(finding, source);
                        return (
                          <div key={finding.id} className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_1fr]">
                            <div className="text-sm">
                              <p className="font-medium">{findingLabels[finding.type]}</p>
                              <p>{t('external')}: {valueLabel(finding.externalValue, finding.field)}</p>
                              <p>{t('internal')}: {valueLabel(finding.internalValue, finding.field)}</p>
                              {!canApply ? <p className="text-slate-600">{t('unsupportedChange')}</p> : null}
                            </div>
                            <div className="grid gap-2">
                              <input type="hidden" name="discrepancyId" value={finding.id} />
                              <SelectField
                                id={'disposition-' + finding.id}
                                name={'disposition:' + finding.id}
                                label={t('apply')}
                                placeholder={t('selectDisposition')}
                                options={[
                                  ...(canApply ? [['apply_external', t('applyExternal')] as [string, string]] : []),
                                  ['not_applied', t('notApplied')],
                                ]}
                              />
                              <TextField
                                id={'application-reason-' + finding.id}
                                name={'reason:' + finding.id}
                                label={t('applicationReason')}
                              />
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-sm text-slate-600">{t('applicationReasonHelp')}</p>
                      <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">{t('saveApplication')}</Button>
                    </form>
                  );
                })}
              </div>
            ) : null}
            {detail.discrepancies.some((finding) => !finding.isCurrent) ? (
              <details className="border-t pt-3">
                <summary className="cursor-pointer font-medium">{t('earlierFindings')}</summary>
                <ul className="mt-3 grid gap-2">
                  {detail.discrepancies.filter((finding) => !finding.isCurrent).map((finding) => (
                    <li key={finding.id} className="rounded-md bg-slate-50 p-3 text-sm">
                      <p className="font-medium">{findingLabels[finding.type]}</p>
                      <p>{t('external')}: {valueLabel(finding.externalValue, finding.field)}</p>
                      <p>{t('internal')}: {valueLabel(finding.internalValue, finding.field)}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {editable ? (
            <section className="grid gap-3 border-t pt-4">
              <h4 className="font-semibold">{t('completion')}</h4>
              {reconciliation.status === 'in_review' && detail.comparisonCurrent && canComplete ? (
                <form action={completeMedicationReconciliationAction} className="grid gap-3 rounded-md bg-slate-50 p-3">
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="reconciliationId" value={selectedIdForActions} />
                  <input type="hidden" name="expectedVersion" value={reconciliation.version} />
                  <p className="text-sm text-slate-700">{t('completeConfirmation')}</p>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirm" value="yes" required className="mt-1 min-h-5 min-w-5" />
                    <span>{t('confirmCompletion')}</span>
                  </label>
                  <Button type="submit" className="min-h-12 w-full sm:w-fit">{t('complete')}</Button>
                </form>
              ) : null}
              {canUpdate ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer font-medium">{t('cancel')}</summary>
                  <form action={cancelMedicationReconciliationAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="clientId" value={clientId} />
                    <input type="hidden" name="reconciliationId" value={selectedIdForActions} />
                    <input type="hidden" name="expectedVersion" value={reconciliation.version} />
                    <TextField id="reconciliation-cancel-reason" name="reason" label={t('cancelReason')} />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="confirm" value="yes" required className="mt-1 min-h-5 min-w-5" />
                      <span>{t('confirmCancellation')}</span>
                    </label>
                    <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">{t('cancel')}</Button>
                  </form>
                </details>
              ) : null}
            </section>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function groupApplicationFindings(
  findings: Discrepancy[],
  entriesById: Map<string, Entry>,
) {
  const groups = new Map<string, { key: string; baselineId: string | null; sourceId: string | null; findings: Discrepancy[] }>();
  for (const finding of findings) {
    const entry = finding.entryId ? entriesById.get(finding.entryId) : undefined;
    const sourceId = entry?.sourceId ?? null;
    const key = (finding.baselineId ?? 'unmatched') + ':' + (sourceId ?? 'no-source');
    const group = groups.get(key) ?? {
      key,
      baselineId: finding.baselineId ?? null,
      sourceId,
      findings: [],
    };
    group.findings.push(finding);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function EntryForm({
  action,
  clientId,
  reconciliationId,
  expectedVersion,
  sourceId,
  timezone,
  entry,
  t,
  medicationT,
  routeLabels,
  unitLabels,
  dosageFormLabels,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  reconciliationId: string;
  expectedVersion: number;
  sourceId: string;
  timezone: string;
  entry?: Entry;
  t: Translate;
  medicationT: Translate;
  routeLabels: Record<string, string>;
  unitLabels: Record<string, string>;
  dosageFormLabels: Record<string, string>;
}>) {
  const structured = entry?.structuredSchedule as unknown as (Schedule & { timezone?: string }) | null | undefined;
  const sourceTimezone = structured?.timezone ?? timezone;
  const scheduleType = structured?.type ?? 'unknown';
  const id = entry?.id ?? sourceId;
  const field = (name: string) => 'entry-' + id + '-' + name;
  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="reconciliationId" value={reconciliationId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <input type="hidden" name="sourceId" value={sourceId} />
      {entry ? (
        <>
          <input type="hidden" name="supersedesEntryId" value={entry.id} />
          <TextField id={field('correctionReason')} name="correctionReason" label={t('correctionReason')} required />
        </>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={field('medicationName')} name="medicationName" label={t('medicationName')} value={entry?.medicationName ?? ''} required />
        <TextField id={field('activeIngredient')} name="activeIngredient" label={t('activeIngredient')} value={entry?.activeIngredient ?? ''} />
        <TextField id={field('strength')} name="strength" label={t('strength')} value={entry?.strength ?? ''} />
        <SelectField
          id={field('dosageForm')}
          name="dosageForm"
          label={t('dosageForm')}
          placeholder={t('unknown')}
          value={entry?.dosageForm ?? ''}
          options={dosageForms.map((form) => [form, dosageFormLabels[form] ?? form])}
        />
        <TextField id={field('doseAmount')} name="doseAmount" label={t('doseAmount')} value={entry?.doseAmount ?? ''} />
        <SelectField
          id={field('doseUnit')}
          name="doseUnit"
          label={t('doseUnit')}
          placeholder={t('unknown')}
          value={entry?.doseUnit ?? ''}
          options={units.map((unit) => [unit, unitLabels[unit] ?? unit])}
        />
        <SelectField
          id={field('route')}
          name="route"
          label={t('route')}
          placeholder={t('unknown')}
          value={entry?.route ?? ''}
          options={routes.map((route) => [route, routeLabels[route] ?? route])}
        />
        <SelectField
          id={field('reportedStatus')}
          name="reportedStatus"
          label={t('reportedStatus')}
          options={[
            ['active', t('reportedStatuses.active')],
            ['paused', t('reportedStatuses.paused')],
            ['discontinued', t('reportedStatuses.discontinued')],
            ['unknown', t('reportedStatuses.unknown')],
          ]}
          value={entry?.reportedStatus ?? 'unknown'}
        />
      </div>
      <TextField
        id={field('scheduleDescription')}
        name="scheduleDescription"
        label={t('scheduleDescription')}
        value={entry?.scheduleDescription ?? ''}
      />
      <ReconciliationScheduleFields
        idPrefix={field('')}
        values={{
          type: scheduleType,
          timezone: sourceTimezone,
          times: structured?.type === 'fixed_times' ? structured.times.join(', ') : '',
          anchorAt: structured?.type === 'interval' ? dateTimeInput(structured.anchorAt, sourceTimezone) : '',
          intervalMinutes: structured?.type === 'interval' ? String(structured.intervalMinutes) : '',
          indication: structured?.type === 'as_needed' ? structured.indication : '',
          maximumDoseAmount: structured?.type === 'as_needed' ? structured.maximumDoseAmount ?? '' : '',
          maximumAdministrations: structured?.type === 'as_needed' ? String(structured.maximumAdministrations ?? '') : '',
          frequencyWindowMinutes: structured?.type === 'as_needed' ? String(structured.frequencyWindowMinutes ?? '') : '',
          minimumIntervalMinutes: structured?.type === 'as_needed' ? String(structured.minimumIntervalMinutes ?? '') : '',
        }}
        labels={{
          title: t('structuredSchedule'),
          type: t('scheduleType'),
          unknown: t('scheduleUnknown'),
          fixedTimes: medicationT('fixedTimes'),
          interval: medicationT('interval'),
          asNeeded: medicationT('asNeeded'),
          timezone: t('timezone'),
          times: t('times'),
          anchorAt: t('anchorAt'),
          intervalMinutes: t('intervalMinutes'),
          indication: t('indication'),
          maximumDoseAmount: t('maximumDoseAmount'),
          maximumAdministrations: t('maximumAdministrations'),
          frequencyWindowMinutes: t('frequencyWindowMinutes'),
          minimumIntervalMinutes: t('minimumIntervalMinutes'),
        }}
      />
      <TextField id={field('note')} name="note" label={t('note')} value={entry?.note ?? ''} />
      <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
        {entry ? t('correctEntry') : t('recordEntry')}
      </Button>
    </form>
  );
}

function FindingCard({
  finding,
  t,
  findingLabels,
  decisionLabels,
  formatValue,
  editable,
  clientId,
  reconciliationId,
  expectedVersion,
  locale,
}: Readonly<{
  finding: Discrepancy;
  t: Translate;
  findingLabels: Record<Discrepancy['type'], string>;
  decisionLabels: Record<(typeof decisions)[number], string>;
  formatValue: (value: unknown, field: string) => string;
  editable: boolean;
  clientId: string;
  reconciliationId: string;
  expectedVersion: number;
  locale: Awaited<ReturnType<typeof getLocale>>;
}>) {
  const latest = finding.latestDecision;
  return (
    <article className="grid gap-3 rounded-md border border-slate-300 p-3">
      <h5 className="font-medium">{findingLabels[finding.type]}</h5>
      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label={t('external')} value={formatValue(finding.externalValue, finding.field)} />
        <Fact label={t('internal')} value={formatValue(finding.internalValue, finding.field)} />
      </dl>
      {latest ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium">{decisionLabels[latest.decision]}</p>
          {latest.reason ? <p>{t('reason')}: {latest.reason}</p> : null}
          {latest.clarificationOutcome ? <p>{t('clarificationOutcome')}: {latest.clarificationOutcome}</p> : null}
          <p>
            {t('decisionBy', {
              employee: latest.reviewedByEmployeeId,
              date: formatDateTime(latest.reviewedAt, locale) ?? '—',
            })}
          </p>
        </div>
      ) : null}
      {editable ? (
        <form action={recordMedicationReconciliationDecisionAction} className="grid gap-3 border-t pt-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="reconciliationId" value={reconciliationId} />
          <input type="hidden" name="discrepancyId" value={finding.id} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <SelectField
            id={'decision-' + finding.id}
            name="decision"
            label={t('decision')}
            placeholder={t('selectDecision')}
            value={latest?.decision ?? ''}
            options={decisions.map((decision) => [decision, decisionLabels[decision]])}
            required
          />
          <TextField id={'decision-reason-' + finding.id} name="reason" label={t('reason')} value={latest?.reason ?? ''} />
          <TextField
            id={'clarification-outcome-' + finding.id}
            name="clarificationOutcome"
            label={t('clarificationOutcome')}
            value={latest?.clarificationOutcome ?? ''}
          />
          <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">{t('saveDecision')}</Button>
        </form>
      ) : finding.application ? (
        <p className="text-sm text-slate-600">
          {t('applicationRecorded')}: {finding.application.disposition === 'applied' ? t('applied') : t('notApplied')}
        </p>
      ) : null}
    </article>
  );
}

function ComparisonTable({
  external,
  internal,
  t,
  formatValue,
  routeLabel,
  dosageFormLabel,
  statusLabel,
}: Readonly<{
  external: Record<string, unknown>;
  internal: Record<string, unknown> | null;
  t: Translate;
  formatValue: (value: unknown, field: string) => string;
  routeLabel: (value?: string | null) => string;
  dosageFormLabel: (value?: string | null) => string;
  statusLabel: (value?: string | null) => string;
}>) {
  const rows: Array<[string, string, (value: unknown) => string]> = [
    ['medication', t('medicationName'), (value) => formatValue(value, 'medication')],
    ['activeIngredient', t('activeIngredient'), (value) => formatValue(value, 'activeIngredient')],
    ['strength', t('strength'), (value) => formatValue(value, 'strength')],
    ['dosageForm', t('dosageForm'), (value) => dosageFormLabel(typeof value === 'string' ? value : null)],
    ['dose', t('doseAmount'), (value) => formatValue(value, 'dose')],
    ['route', t('route'), (value) => routeLabel(typeof value === 'string' ? value : null)],
    ['schedule', t('scheduleDescription'), (value) => formatValue(value, 'schedule')],
    ['status', t('reportedStatus'), (value) => statusLabel(typeof value === 'string' ? value : null)],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className="p-2 font-semibold">{t('field')}</th>
            <th scope="col" className="p-2 font-semibold">{t('external')}</th>
            <th scope="col" className="p-2 font-semibold">{t('internal')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label, formatter]) => {
            const externalValue = external[key];
            const internalValue = internal?.[key];
            const externalLabel = formatter(externalValue);
            const internalLabel = internal ? formatter(internalValue) : t('unknown');
            const differs = !!internal && externalLabel !== internalLabel;
            return (
              <tr key={key} className={'border-b last:border-0 ' + (differs ? 'bg-amber-50' : '')}>
                <th scope="row" className="p-2 font-medium">{label}</th>
                <td className="p-2">{externalLabel}</td>
                <td className="p-2">{internalLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  value,
  type = 'text',
  required = false,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  value?: string;
  type?: string;
  required?: boolean;
}>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={value ?? ''} required={required} />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  placeholder,
  options,
  value,
  required = false,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  options: Array<[string, string]>;
  value?: string;
  required?: boolean;
}>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ''}
        required={required}
        className="min-h-12 rounded-md border bg-white px-3"
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </div>
  );
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="font-medium text-slate-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function dateTimeInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return values.year + '-' + values.month + '-' + values.day + 'T' + values.hour + ':' + values.minute;
}
