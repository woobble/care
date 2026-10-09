import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label } from '@care/ui';
import type { components } from '@care/api-client';
import { getLocale, getTranslations } from 'next-intl/server';
import { errorMessageKey } from '../../../../../i18n/errors';
import { formatDateTime } from '../../../../../i18n/format';
import { formatVisitDateTime } from '../../../../../lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasTenantPermission,
} from '../../../../../lib/api';
import {
  activateMedicationOrderAction,
  createMedicationDefinitionAction,
  correctMedicationAdministrationAction,
  discontinueMedicationOrderAction,
  pauseMedicationOrderAction,
  resumeMedicationOrderAction,
  saveMedicationOrderAction,
  updateMedicationDefinitionAction,
} from './actions';

type MedicationOrder = components['schemas']['MedicationOrderListDto'];
type MedicationRevision = components['schemas']['MedicationOrderRevisionDto'];
type MedicationSchedule = MedicationRevision['schedule'];

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
const outcomes = ['administered', 'not_administered', 'refused', 'withheld'] as const;
const reasons = [
  'client_refused',
  'client_unavailable',
  'medication_unavailable',
  'held_per_instruction',
  'administration_not_possible',
  'other',
] as const;

export default async function ClientMedicationsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; from?: string; until?: string; corrected?: string }>;
}>) {
  const { id: clientId } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const currentDate = today();
  const until = query.until && isDate(query.until) ? query.until : currentDate;
  const from = query.from && isDate(query.from) ? query.from : addDays(until, -30);
  const [
    clientResult,
    ordersResult,
    definitionsResult,
    historyResult,
    facilitiesResult,
    organizationsResult,
    grants,
  ] = await Promise.all([
    api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
    api.GET('/api/v1/clients/{clientId}/medication-orders', {
      params: { path: { clientId }, header },
    }),
    api.GET('/api/v1/medications', { params: { query: { clientId }, header } }),
    api.GET('/api/v1/clients/{clientId}/medication-administrations', {
      params: { path: { clientId }, query: { from, until }, header },
    }),
    api.GET('/api/v1/facilities', { params: { header } }),
    api.GET('/api/v1/organizations', { params: { header } }),
    getPermissionGrants(api),
  ]);
  if (!clientResult.data) notFound();
  const client = clientResult.data;
  const orders = ordersResult.data ?? [];
  const definitions = definitionsResult.data ?? [];
  const timezone =
    facilitiesResult.data?.find((facility) => facility.id === client.primaryFacilityId)?.timezone ??
    organizationsResult.data?.find((organization) => organization.id === client.organizationId)
      ?.timezone ??
    'UTC';
  const tenantId = header['X-Tenant-Id'];
  const canManageOrders = hasClientPermission(
    grants,
    'medication.order.manage',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canManageCatalog = hasTenantPermission(grants, 'medication.order.manage', tenantId);
  const canCorrect = hasClientPermission(
    grants,
    'medication.administration.correct',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const orderHistories = await Promise.all(
    orders.map((entry) =>
      api.GET('/api/v1/medication-orders/{orderId}', {
        params: { path: { orderId: entry.order.id }, header },
      }),
    ),
  );
  const revisionsByOrder = new Map(
    orders.map((entry, index) => [entry.order.id, orderHistories[index]?.data?.revisions ?? []]),
  );
  const statusLabels: Record<string, string> = {
    draft: t('Medication.statuses.draft'),
    active: t('Medication.statuses.active'),
    paused: t('Medication.statuses.paused'),
    discontinued: t('Medication.statuses.discontinued'),
  };
  const routeLabels: Record<string, string> = {
    oral: t('Medication.routes.oral'),
    topical: t('Medication.routes.topical'),
    subcutaneous: t('Medication.routes.subcutaneous'),
    intramuscular: t('Medication.routes.intramuscular'),
    inhalation: t('Medication.routes.inhalation'),
    transdermal: t('Medication.routes.transdermal'),
    other: t('Medication.routes.other'),
  };
  const unitLabels: Record<string, string> = {
    mg: t('Medication.units.mg'),
    g: t('Medication.units.g'),
    mL: t('Medication.units.mL'),
    tablet: t('Medication.units.tablet'),
    capsule: t('Medication.units.capsule'),
    drop: t('Medication.units.drop'),
    puff: t('Medication.units.puff'),
    patch: t('Medication.units.patch'),
  };
  const outcomeLabels: Record<string, string> = {
    administered: t('Medication.administered'),
    not_administered: t('Medication.notAdministered'),
    refused: t('Medication.refused'),
    withheld: t('Medication.withheld'),
  };
  const reasonLabels: Record<string, string> = {
    client_refused: t('Medication.clientRefused'),
    client_unavailable: t('Medication.clientUnavailable'),
    medication_unavailable: t('Medication.medicationUnavailable'),
    held_per_instruction: t('Medication.heldPerInstruction'),
    administration_not_possible: t('Medication.administrationNotPossible'),
    other: t('Medication.other'),
  };
  const definitionLabels: Record<string, string> = {
    tablet: t('Medication.dosageForms.tablet'),
    capsule: t('Medication.dosageForms.capsule'),
    drops: t('Medication.dosageForms.drops'),
    solution: t('Medication.dosageForms.solution'),
    injection: t('Medication.dosageForms.injection'),
    cream: t('Medication.dosageForms.cream'),
    patch: t('Medication.dosageForms.patch'),
    inhalation: t('Medication.dosageForms.inhalation'),
    other: t('Medication.dosageForms.other'),
  };
  const scheduleSummary = (schedule: MedicationSchedule) => {
    if (schedule.type === 'fixed_times')
      return `${t('Medication.fixedTimes')}: ${schedule.times.join(', ')}`;
    if (schedule.type === 'interval')
      return `${t('Medication.interval')}: ${schedule.intervalMinutes} ${t('Medication.minutes')}`;
    return `${t('Medication.asNeeded')}: ${schedule.indication}`;
  };
  const field = (
    key: string,
    label: string,
    value?: string | null,
    type = 'text',
    fieldName = key.slice(key.lastIndexOf('-') + 1),
    required = false,
  ) => (
    <div className="grid gap-1.5" key={key}>
      <Label htmlFor={key}>{label}</Label>
      <Input id={key} name={fieldName} type={type} defaultValue={value ?? ''} required={required} />
    </div>
  );
  const orderEditor = (order?: MedicationOrder, revision?: MedicationRevision | null) => {
    const prefix = order?.order.id ?? 'new';
    const schedule = revision?.schedule;
    const scheduleType = schedule?.type ?? '';
    const selectedDefinition = revision?.medicationDefinitionId ?? '';
    const scheduleTimezone = schedule?.timezone ?? timezone;
    const dateTimeAnchor =
      schedule?.type === 'interval' ? dateTimeInput(schedule.anchorAt, schedule.timezone) : '';
    return (
      <form action={saveMedicationOrderAction} className="grid gap-4 rounded-md border p-4">
        <input type="hidden" name="clientId" value={clientId} />
        {order ? <input type="hidden" name="orderId" value={order.order.id} /> : null}
        {order ? <input type="hidden" name="expectedVersion" value={order.order.version} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-definition`}>{t('Medication.medication')}</Label>
            <select
              id={`${prefix}-definition`}
              name="medicationDefinitionId"
              defaultValue={selectedDefinition}
              required
              className="min-h-12 rounded-md border bg-white px-3"
            >
              <option value="">{t('Medication.selectMedication')}</option>
              {definitions
                .filter(
                  (definition) =>
                    definition.status === 'active' || definition.id === selectedDefinition,
                )
                .map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                    {definition.status === 'archived'
                      ? ` · ${t('Medication.statuses.archived')}`
                      : ''}
                  </option>
                ))}
            </select>
          </div>
          {field(
            `${prefix}-doseAmount`,
            t('Medication.doseAmount'),
            revision?.doseAmount,
            'text',
            undefined,
            true,
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-doseUnit`}>{t('Medication.doseUnit')}</Label>
            <select
              id={`${prefix}-doseUnit`}
              name="doseUnit"
              defaultValue={revision?.doseUnit ?? ''}
              required
              className="min-h-12 rounded-md border bg-white px-3"
            >
              <option value="">{t('Medication.selectDoseUnit')}</option>
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabels[unit]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-route`}>{t('Medication.route')}</Label>
            <select
              id={`${prefix}-route`}
              name="route"
              defaultValue={revision?.route ?? ''}
              required
              className="min-h-12 rounded-md border bg-white px-3"
            >
              <option value="">{t('Medication.selectRoute')}</option>
              {routes.map((route) => (
                <option key={route} value={route}>
                  {routeLabels[route]}
                </option>
              ))}
            </select>
          </div>
          {field(`${prefix}-instructions`, t('Medication.instructions'), revision?.instructions)}
          {field(`${prefix}-indication`, t('Medication.indication'), revision?.indication)}
          {field(`${prefix}-prescriberName`, t('Medication.prescriber'), revision?.prescriberName)}
          {field(
            `${prefix}-sourceReference`,
            t('Medication.sourceReference'),
            revision?.sourceReference,
          )}
          {field(
            `${prefix}-prescribedAt`,
            t('Medication.prescribedAt'),
            revision?.prescribedAt ? dateTimeInput(revision.prescribedAt, scheduleTimezone) : '',
            'datetime-local',
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-sourceType`}>{t('Medication.sourceType')}</Label>
            <select
              id={`${prefix}-sourceType`}
              name="sourceType"
              defaultValue={revision?.sourceType ?? ''}
              required
              className="min-h-12 rounded-md border bg-white px-3"
            >
              <option value="">{t('Medication.selectSourceType')}</option>
              <option value="prescriber">{t('Medication.prescriberSource')}</option>
              <option value="care_authorizing_source">
                {t('Medication.careAuthorizingSource')}
              </option>
              <option value="staff_transcription">{t('Medication.staffTranscription')}</option>
            </select>
          </div>
          {field(
            `${prefix}-validFrom`,
            t('Medication.validFrom'),
            revision?.validFrom,
            'date',
            undefined,
            true,
          )}
          {field(`${prefix}-validUntil`, t('Medication.validUntil'), revision?.validUntil, 'date')}
        </div>
        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 font-semibold">{t('Medication.scheduleType')}</legend>
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-scheduleType`}>{t('Medication.scheduleType')}</Label>
            <select
              id={`${prefix}-scheduleType`}
              name="scheduleType"
              defaultValue={scheduleType}
              required
              className="min-h-12 rounded-md border bg-white px-3"
            >
              {!schedule ? <option value="">{t('Medication.selectScheduleType')}</option> : null}
              <option value="fixed_times">{t('Medication.fixedTimes')}</option>
              <option value="interval">{t('Medication.interval')}</option>
              <option value="as_needed">{t('Medication.asNeeded')}</option>
            </select>
          </div>
          <p className="text-sm text-slate-600">{t('Medication.scheduleFieldsHelp')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              `${prefix}-times`,
              t('Medication.times'),
              schedule?.type === 'fixed_times' ? schedule.times.join(', ') : '',
            )}
            {field(
              `${prefix}-anchorAt`,
              t('Medication.anchorAt'),
              dateTimeAnchor,
              'datetime-local',
            )}
            {field(
              `${prefix}-intervalMinutes`,
              t('Medication.intervalMinutes'),
              schedule?.type === 'interval' ? String(schedule.intervalMinutes) : '',
              'number',
            )}
            {field(
              `${prefix}-prnIndication`,
              t('Medication.prnIndication'),
              schedule?.type === 'as_needed' ? schedule.indication : '',
            )}
            {field(
              `${prefix}-maximumDoseAmount`,
              t('Medication.maximumDose'),
              schedule?.type === 'as_needed' ? schedule.maximumDoseAmount : '',
            )}
            {field(
              `${prefix}-maximumAdministrations`,
              t('Medication.maximumAdministrations'),
              schedule?.type === 'as_needed' && schedule.maximumAdministrations
                ? String(schedule.maximumAdministrations)
                : '',
              'number',
            )}
            {field(
              `${prefix}-frequencyWindowMinutes`,
              t('Medication.frequencyWindowMinutes'),
              schedule?.type === 'as_needed' && schedule.frequencyWindowMinutes
                ? String(schedule.frequencyWindowMinutes)
                : '',
              'number',
            )}
            {field(
              `${prefix}-minimumIntervalMinutes`,
              t('Medication.minimumIntervalMinutes'),
              schedule?.type === 'as_needed' && schedule.minimumIntervalMinutes
                ? String(schedule.minimumIntervalMinutes)
                : '',
              'number',
            )}
          </div>
        </fieldset>
        <p className="text-sm text-slate-600">{t('Medication.notPrescribing')}</p>
        <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
          {order ? t('Medication.saveRevision') : t('Medication.saveDraft')}
        </Button>
      </form>
    );
  };

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6">
      <header className="grid gap-2">
        <Link
          className="w-fit text-sm font-semibold text-blue-800 underline"
          href={`/clients/${clientId}`}
        >
          {t('Medication.backToClient')}
        </Link>
        <h1 className="text-3xl font-semibold">
          {t('Medication.title')} · {client.preferredName ?? client.firstName} {client.lastName}
        </h1>
        <p className="max-w-3xl text-slate-700">{t('Medication.description')}</p>
        <p className="max-w-3xl rounded-md bg-amber-50 p-3 text-sm text-amber-950">
          {t('Medication.notPrescribing')}
        </p>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.corrected ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('Medication.corrected')}
        </p>
      ) : null}

      {!ordersResult.data && ordersResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Medication.noReadAccess')}{' '}
          {ordersResult.error.code ? t(errorMessageKey(ordersResult.error.code)) : ''}
        </p>
      ) : null}

      {canManageCatalog ? (
        <details className="rounded-lg border bg-white p-4">
          <summary className="cursor-pointer font-semibold">{t('Medication.catalog')}</summary>
          <div className="mt-4 grid gap-4">
            <ul className="grid gap-2">
              {definitions.map((definition) => (
                <li
                  key={definition.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <span>
                    {definition.name} ·{' '}
                    {definitionLabels[definition.dosageForm] ?? definitionLabels.other} ·{' '}
                    {routeLabels[definition.route] ?? routeLabels.other}
                  </span>
                  <form action={updateMedicationDefinitionAction}>
                    <input type="hidden" name="clientId" value={clientId} />
                    <input type="hidden" name="definitionId" value={definition.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={definition.status === 'active' ? 'archived' : 'active'}
                    />
                    <Button type="submit" variant="secondary" className="min-h-11">
                      {definition.status === 'active'
                        ? t('Medication.archiveDefinition')
                        : t('Medication.restoreDefinition')}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={createMedicationDefinitionAction} className="grid gap-4 border-t pt-4">
              <input type="hidden" name="clientId" value={clientId} />
              <h2 className="text-lg font-semibold">{t('Medication.createDefinition')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {field('definition-name', t('Medication.medication'))}
                {field('definition-activeIngredient', t('Medication.activeIngredient'))}
                {field('definition-strength', t('Medication.strength'))}
                {field('definition-manufacturer', t('Medication.manufacturer'))}
                {field('definition-externalCode', t('Medication.externalCode'))}
                <div className="grid gap-1.5">
                  <Label htmlFor="definition-dosageForm">{t('Medication.dosageForm')}</Label>
                  <select
                    id="definition-dosageForm"
                    name="dosageForm"
                    defaultValue=""
                    required
                    className="min-h-12 rounded-md border bg-white px-3"
                  >
                    <option value="">{t('Medication.selectDosageForm')}</option>
                    {dosageForms.map((form) => (
                      <option key={form} value={form}>
                        {definitionLabels[form]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="definition-route">{t('Medication.route')}</Label>
                  <select
                    id="definition-route"
                    name="route"
                    defaultValue=""
                    required
                    className="min-h-12 rounded-md border bg-white px-3"
                  >
                    <option value="">{t('Medication.selectRoute')}</option>
                    {routes.map((route) => (
                      <option key={route} value={route}>
                        {routeLabels[route]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
                {t('Medication.createDefinition')}
              </Button>
            </form>
          </div>
        </details>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{t('Medication.medicationPlan')}</h2>
          {canManageOrders ? (
            <a
              href="#new-order"
              className="rounded-md border px-4 py-3 font-semibold text-blue-900 underline"
            >
              {t('Medication.newOrder')}
            </a>
          ) : null}
        </div>
        {orders.length ? (
          <div className="grid gap-4">
            {orders.map((entry) => {
              const revision = entry.currentRevision;
              const history = revisionsByOrder.get(entry.order.id) ?? [];
              const definition = definitions.find(
                (item) => item.id === revision?.medicationDefinitionId,
              );
              const canRevise =
                canManageOrders &&
                entry.order.status !== 'discontinued' &&
                definition?.status !== 'archived';
              return (
                <article key={entry.order.id} className="grid gap-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {revision?.medicationSnapshot.name ?? t('Medication.unknownMedication')}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {t('Medication.version', { version: entry.order.version })} ·{' '}
                        {statusLabels[entry.order.status]}
                      </p>
                    </div>
                    {revision ? (
                      <p className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                        {revision.doseAmount} {unitLabels[revision.doseUnit]} ·{' '}
                        {routeLabels[revision.route]}
                      </p>
                    ) : null}
                  </div>
                  {revision ? (
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      <Fact
                        label={t('Medication.scheduleType')}
                        value={scheduleSummary(revision.schedule)}
                      />
                      <Fact
                        label={t('Medication.validity')}
                        value={`${revision.validFrom}${revision.validUntil ? ` – ${revision.validUntil}` : ''}`}
                      />
                      <Fact
                        label={t('Medication.sourceReference')}
                        value={revision.sourceReference || '—'}
                      />
                      <Fact
                        label={t('Medication.prescriber')}
                        value={revision.prescriberName || '—'}
                      />
                    </dl>
                  ) : null}
                  {canManageOrders && revision && entry.order.status === 'draft' ? (
                    <form
                      action={activateMedicationOrderAction}
                      className="grid gap-2 rounded-md bg-blue-50 p-3"
                    >
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="orderId" value={entry.order.id} />
                      <input type="hidden" name="expectedVersion" value={entry.order.version} />
                      <p className="text-sm">{t('Medication.activateConfirmation')}</p>
                      <Button
                        type="submit"
                        disabled={!revision.sourceReference?.trim()}
                        className="min-h-12 w-full sm:w-fit"
                      >
                        {t('Medication.activate')}
                      </Button>
                    </form>
                  ) : null}
                  {canManageOrders && entry.order.status === 'active' ? (
                    <ActionForm
                      action={pauseMedicationOrderAction}
                      clientId={clientId}
                      orderId={entry.order.id}
                      version={entry.order.version}
                      label={t('Medication.pause')}
                    />
                  ) : null}
                  {canManageOrders && entry.order.status === 'paused' ? (
                    <ActionForm
                      action={resumeMedicationOrderAction}
                      clientId={clientId}
                      orderId={entry.order.id}
                      version={entry.order.version}
                      label={t('Medication.resume')}
                    />
                  ) : null}
                  {canManageOrders && entry.order.status !== 'discontinued' ? (
                    <ActionForm
                      action={discontinueMedicationOrderAction}
                      clientId={clientId}
                      orderId={entry.order.id}
                      version={entry.order.version}
                      label={t('Medication.discontinue')}
                    />
                  ) : null}
                  {canRevise ? (
                    <details className="grid gap-3 border-t pt-3">
                      <summary className="cursor-pointer font-semibold">
                        {t('Medication.revise')}
                      </summary>
                      {orderEditor(entry, revision)}
                    </details>
                  ) : null}
                  <details className="border-t pt-3">
                    <summary className="cursor-pointer font-semibold">
                      {t('Medication.revisionHistory')}
                    </summary>
                    <ol className="mt-3 grid gap-3">
                      {history.map((item) => (
                        <li key={item.id} className="rounded-md bg-slate-50 p-3 text-sm">
                          <p className="font-semibold">
                            {t('Medication.version', { version: item.version })} ·{' '}
                            {statusLabels[item.status]}
                          </p>
                          <p>
                            {item.medicationSnapshot.name} · {item.doseAmount}{' '}
                            {unitLabels[item.doseUnit]} · {routeLabels[item.route]}
                          </p>
                          <p>
                            {scheduleSummary(item.schedule)} · {item.validFrom}
                            {item.validUntil ? ` – ${item.validUntil}` : ''}
                          </p>
                          <p>
                            {t('Medication.sourceReference')}: {item.sourceReference || '—'}
                          </p>
                          <time dateTime={item.createdAt}>
                            {formatDateTime(item.createdAt, locale)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-600">{t('Medication.noOrders')}</p>
        )}
        {canManageOrders ? (
          <details id="new-order" className="grid gap-3 border-t pt-4">
            <summary className="cursor-pointer text-lg font-semibold">
              {t('Medication.newOrder')}
            </summary>
            {definitions.some((definition) => definition.status === 'active') ? (
              orderEditor()
            ) : (
              <p className="text-slate-600">{t('Medication.catalogUnavailable')}</p>
            )}
          </details>
        ) : null}
      </section>

      <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">{t('Medication.history')}</h2>
        <form method="get" className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="from">{t('Medication.from')}</Label>
            <Input id="from" type="date" name="from" defaultValue={from} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="until">{t('Medication.until')}</Label>
            <Input id="until" type="date" name="until" defaultValue={until} required />
          </div>
          <Button type="submit" variant="secondary" className="min-h-12">
            {t('Medication.loadHistory')}
          </Button>
        </form>
        {historyResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
            {t(errorMessageKey(historyResult.error.code))}
          </p>
        ) : null}
        {!historyResult.error &&
        historyResult.data &&
        historyResult.data.due.length === 0 &&
        historyResult.data.history.length === 0 ? (
          <p className="text-slate-600">{t('Medication.noHistory')}</p>
        ) : null}
        {historyResult.data?.due.length ? (
          <div className="grid gap-3">
            <h3 className="font-semibold">{t('Medication.dueAdministrations')}</h3>
            {historyResult.data.due.map((due) => (
              <article
                key={due.occurrenceId}
                className="rounded-md border border-amber-300 bg-amber-50 p-3"
              >
                <p className="font-semibold">
                  {due.medication.name} · {due.orderedDose.amount}{' '}
                  {unitLabels[due.orderedDose.unit]} · {routeLabels[due.route]}
                </p>
                <p>
                  {formatDateTime(due.scheduledAt, locale)} ·{' '}
                  {due.status === 'due'
                    ? t('Medication.due')
                    : t('Medication.overdueNotDocumented')}
                </p>
              </article>
            ))}
          </div>
        ) : null}
        {historyResult.data?.history.length ? (
          <div className="grid gap-3">
            {historyResult.data.history.map((record) => {
              const correction = record.currentCorrection;
              const outcome = correction?.outcome ?? record.outcome;
              const actualDose = correction
                ? correction.actualDoseAmount && correction.actualDoseUnit
                  ? { amount: correction.actualDoseAmount, unit: correction.actualDoseUnit }
                  : null
                : record.actualDose;
              const reasonCode = correction?.reasonCode ?? record.reasonCode;
              return (
                <article key={record.id} className="grid gap-3 rounded-md border p-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold">{record.medication.name}</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                      {outcomeLabels[outcome]}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <Fact
                      label={t('Medication.scheduledAt')}
                      value={
                        record.scheduledAt
                          ? formatVisitDateTime(
                              record.scheduledAt,
                              record.scheduledTimezone ?? timezone,
                              locale,
                            )
                          : t('Medication.asNeeded')
                      }
                    />
                    <Fact
                      label={t('Medication.orderedDose')}
                      value={`${record.orderedDose.amount} ${unitLabels[record.orderedDose.unit]}`}
                    />
                    <Fact
                      label={t('Medication.actualDose')}
                      value={
                        actualDose ? `${actualDose.amount} ${unitLabels[actualDose.unit]}` : '—'
                      }
                    />
                    <Fact
                      label={t('Medication.employee')}
                      value={record.administeredByEmployeeName}
                    />
                    <Fact
                      label={t('Medication.actualTime')}
                      value={formatVisitDateTime(record.occurredAt, timezone, locale)}
                    />
                    {reasonCode ? (
                      <Fact
                        label={t('Medication.reason')}
                        value={reasonLabels[reasonCode] ?? t('Medication.other')}
                      />
                    ) : null}
                  </dl>
                  {correction ? (
                    <p className="rounded bg-amber-50 p-2 text-sm">
                      {t('Medication.corrected')}: {correction.correctionReason}
                    </p>
                  ) : null}
                  {record.corrections.length ? (
                    <details className="border-t pt-2">
                      <summary className="cursor-pointer font-semibold">
                        {t('Medication.correctionHistory')}
                      </summary>
                      <ol className="mt-2 grid gap-2">
                        {record.corrections.map((item) => (
                          <li key={item.id} className="rounded bg-slate-50 p-3 text-sm">
                            <p>
                              {t('Medication.version', { version: item.version })} ·{' '}
                              {outcomeLabels[item.outcome]}
                            </p>
                            <p>{item.correctionReason}</p>
                            <p>
                              {item.correctedByEmployeeName} ·{' '}
                              {formatVisitDateTime(item.correctedAt, timezone, locale)}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  {canCorrect ? (
                    <details className="border-t pt-2">
                      <summary className="cursor-pointer font-semibold">
                        {t('Medication.correctRecord')}
                      </summary>
                      <form
                        action={correctMedicationAdministrationAction}
                        className="mt-3 grid gap-3"
                      >
                        <input type="hidden" name="clientId" value={clientId} />
                        <input type="hidden" name="recordId" value={record.id} />
                        <div className="grid gap-1.5">
                          <Label htmlFor={`correction-outcome-${record.id}`}>
                            {t('Medication.outcome')}
                          </Label>
                          <select
                            id={`correction-outcome-${record.id}`}
                            name="outcome"
                            required
                            defaultValue=""
                            className="min-h-12 rounded-md border bg-white px-3"
                          >
                            <option value="">{t('Medication.selectOutcome')}</option>
                            {outcomes.map((item) => (
                              <option key={item} value={item}>
                                {outcomeLabels[item]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {field(
                            `correction-dose-${record.id}`,
                            t('Medication.actualDose'),
                            record.orderedDose.amount,
                            'text',
                            'actualDoseAmount',
                          )}
                          <div className="grid gap-1.5">
                            <Label htmlFor={`correction-unit-${record.id}`}>
                              {t('Medication.doseUnit')}
                            </Label>
                            <select
                              id={`correction-unit-${record.id}`}
                              name="actualDoseUnit"
                              defaultValue={record.orderedDose.unit}
                              className="min-h-12 rounded-md border bg-white px-3"
                            >
                              {units.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unitLabels[unit]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor={`correction-reason-${record.id}`}>
                              {t('Medication.reason')}
                            </Label>
                            <select
                              id={`correction-reason-${record.id}`}
                              name="reasonCode"
                              defaultValue=""
                              className="min-h-12 rounded-md border bg-white px-3"
                            >
                              <option value="">{t('Medication.selectReason')}</option>
                              {reasons.map((item) => (
                                <option key={item} value={item}>
                                  {reasonLabels[item]}
                                </option>
                              ))}
                            </select>
                          </div>
                          {field(
                            `correction-administrationReason-${record.id}`,
                            t('Medication.administrationReason'),
                            undefined,
                            'text',
                            'administrationReason',
                          )}
                          {field(
                            `correction-correctionReason-${record.id}`,
                            t('Medication.correctionReason'),
                            undefined,
                            'text',
                            'correctionReason',
                          )}
                        </div>
                        <Button
                          type="submit"
                          variant="secondary"
                          className="min-h-12 w-full sm:w-fit"
                        >
                          {t('Medication.correctRecord')}
                        </Button>
                      </form>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ActionForm({
  action,
  clientId,
  orderId,
  version,
  label,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  orderId: string;
  version: number;
  label: string;
}>) {
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Button type="submit" variant="secondary" className="min-h-11">
        {label}
      </Button>
    </form>
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
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function isDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
