import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Badge, Button, Input, Label } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import { auditActionKey } from '@app/web/i18n/audit';
import { formatDate, formatDateTime, formatNumber } from '@app/web/i18n/format';
import type { Locale } from '@app/web/i18n/config';
import { quantityUnitKey, serviceAgreementStatusKey, unitLabelKey } from '@app/web/i18n/status';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import {
  addAgreementServiceAction,
  changeServiceAgreementStatusAction,
  createServiceAgreementAction,
  endAgreementServiceAction,
  updateAgreementServiceAction,
  updateServiceAgreementAction,
} from './actions';
import { generateAgreementVisitsAction } from '@app/web/app/(office)/planning/actions';
import { generateDocumentAction } from '@app/web/app/(office)/documents/actions';

type SearchParams = Promise<{
  error?: string;
  findServicesFor?: string;
  serviceValidFrom?: string;
  serviceValidUntil?: string;
  generated?: string;
  existing?: string;
  placement?: string;
}>;

const unitKeys = {
  occurrence: 'Common.units.occurrence',
  minute: 'Common.units.minute',
  hour: 'Common.units.hour',
  day: 'Common.units.day',
} as const;

const weekdayKeys = {
  monday: 'ServiceAgreements.weekdays.monday',
  tuesday: 'ServiceAgreements.weekdays.tuesday',
  wednesday: 'ServiceAgreements.weekdays.wednesday',
  thursday: 'ServiceAgreements.weekdays.thursday',
  friday: 'ServiceAgreements.weekdays.friday',
  saturday: 'ServiceAgreements.weekdays.saturday',
  sunday: 'ServiceAgreements.weekdays.sunday',
} as const;

type ServiceUnit = keyof typeof unitKeys;
type Weekday = keyof typeof weekdayKeys;
type ScheduleRule =
  | { type: 'daily' }
  | { type: 'on_demand' }
  | { type: 'weekly'; weekdays: Weekday[] }
  | { type: 'occurrences_per_week'; count: number }
  | { type: 'interval_days'; intervalDays: number };

export default async function ClientServiceAgreementsPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id: clientId } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [clientResult, agreementsResult, organizationsResult, facilitiesResult, timelineResult] =
    await Promise.all([
      get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
      get('/api/v1/clients/{clientId}/service-agreements', {
        params: { path: { clientId }, query: { page: 1, pageSize: 50 }, header },
      }),
      get('/api/v1/organizations', { params: { header } }),
      get('/api/v1/facilities', { params: { header } }),
      get('/api/v1/clients/{clientId}/timeline', { params: { path: { clientId }, header } }),
    ]);
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();
  const client = clientResult.data;
  if (!client) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        {t('ServiceAgreements.loadClientFailed')}
      </p>
    );
  }

  const agreements = agreementsResult.data?.items ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const timeline = (timelineResult.data ?? []).filter((entry) =>
    entry.action.startsWith('service_agreement.'),
  );
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canCreate =
    client.status !== 'archived' &&
    client.organizationId !== null &&
    client.primaryFacilityId !== null &&
    hasClientPermission(
      permissions,
      'service_agreement.create',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const organizationName = organizations.find((item) => item.id === client.organizationId)?.name;
  const facilityName = facilities.find((item) => item.id === client.primaryFacilityId)?.name;
  const selectedAgreement = agreements.find((item) => item.id === query.findServicesFor);
  const selectedProviderCanManage = selectedAgreement
    ? client.status !== 'archived' &&
      hasClientPermission(
        permissions,
        'service_agreement.manage_services',
        tenantId,
        selectedAgreement.organizationId,
        selectedAgreement.facilityId,
      ) &&
      hasClientPermission(
        permissions,
        'service.read',
        tenantId,
        selectedAgreement.organizationId,
        selectedAgreement.facilityId,
      )
    : false;
  const selectedServiceFrom = selectedAgreement
    ? validLineDate(query.serviceValidFrom, selectedAgreement.validFrom)
    : undefined;
  const selectedServiceUntil = selectedAgreement
    ? validLineEnd(query.serviceValidUntil, selectedAgreement.validUntil ?? null)
    : undefined;
  const servicePeriodValid =
    selectedAgreement !== undefined &&
    selectedServiceFrom !== undefined &&
    selectedServiceUntil !== undefined &&
    selectedServiceFrom >= selectedAgreement.validFrom &&
    (selectedAgreement.validUntil == null ||
      (selectedServiceUntil !== null && selectedServiceUntil <= selectedAgreement.validUntil)) &&
    (selectedServiceUntil === null || selectedServiceUntil >= selectedServiceFrom);
  const serviceOptionsResult =
    selectedAgreement && selectedProviderCanManage && servicePeriodValid
      ? await get('/api/v1/services', {
          params: {
            query: {
              status: 'active',
              organizationId: selectedAgreement.organizationId,
              facilityId: selectedAgreement.facilityId,
              validFrom: selectedServiceFrom,
              ...(selectedServiceUntil === null ? {} : { validUntil: selectedServiceUntil }),
              page: 1,
              pageSize: 100,
            },
            header,
          },
        })
      : undefined;
  const serviceOptions = serviceOptionsResult?.data?.items ?? [];
  const error = query.error ?? agreementsResult.error?.code;
  const generationSummary =
    query.generated !== undefined
      ? t('ServiceAgreements.generationSummary', {
          created: countLabel(query.generated, locale),
          existing: countLabel(query.existing, locale),
          manualPlacement: countLabel(query.placement, locale),
        })
      : null;
  const cadenceLabel = (rule: ScheduleRule | null | undefined): string => {
    if (!rule) return t('ServiceAgreements.cadenceLabels.notSet');
    if (rule.type === 'daily') return t('ServiceAgreements.cadenceLabels.daily');
    if (rule.type === 'on_demand') return t('ServiceAgreements.cadenceLabels.onDemand');
    if (rule.type === 'occurrences_per_week') {
      return t('ServiceAgreements.cadenceLabels.occurrencesPerWeek', {
        count: formatNumber(rule.count, locale),
      });
    }
    if (rule.type === 'interval_days') {
      return t('ServiceAgreements.cadenceLabels.intervalDays', {
        count: formatNumber(rule.intervalDays, locale),
      });
    }
    return t('ServiceAgreements.cadenceLabels.weekly', {
      days: rule.weekdays.map((day) => t(weekdayKeys[day])).join(', '),
    });
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href={`/clients/${client.id}`}>{t('Clients.detail.detailTitle')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">{t('ServiceAgreements.title')}</h1>
          <p className="text-slate-700">
            {client.preferredName || client.firstName} {client.lastName}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/clients/${client.id}`}>{t('ServiceAgreements.backToClient')}</Link>
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {generationSummary ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('ServiceAgreements.generationDone')} {generationSummary}
        </p>
      ) : null}

      <nav
        aria-label={t('ServiceAgreements.navigationLabel')}
        className="flex flex-wrap gap-2 border-b pb-3 text-sm"
      >
        <a className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href="#agreements">
          {t('ServiceAgreements.agreementsTab')}
        </a>
        <a className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href="#history">
          {t('ServiceAgreements.historyTab')}
        </a>
        <Link className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href="#overview">
          {t('ServiceAgreements.overviewTab')}
        </Link>
      </nav>

      <section id="overview" aria-labelledby="overview-title" className="grid gap-3 scroll-mt-6">
        <h2 id="overview-title" className="text-xl font-semibold">
          {t('ServiceAgreements.providerContext')}
        </h2>
        <dl className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2">
          <Field
            label={t('ServiceAgreements.organization')}
            value={organizationName ?? client.organizationId}
          />
          <Field
            label={t('ServiceAgreements.facility')}
            value={facilityName ?? client.primaryFacilityId}
          />
        </dl>
      </section>

      {canCreate ? (
        <details className="rounded-lg border bg-white p-5">
          <summary className="cursor-pointer font-semibold">
            {t('ServiceAgreements.createTitle')}
          </summary>
          <form action={createServiceAgreementAction} className="mt-4 grid gap-4">
            <input type="hidden" name="clientId" value={client.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <DateField
                id="new-agreement-from"
                name="validFrom"
                label={t('ServiceAgreements.validFrom')}
                defaultValue={today()}
                required
              />
              <DateField
                id="new-agreement-until"
                name="validUntil"
                label={t('ServiceAgreements.validUntilOptional')}
              />
              <TextField
                id="new-agreement-reference"
                name="reference"
                label={t('ServiceAgreements.referenceOptional')}
                maxLength={120}
              />
              <TextAreaField
                id="new-agreement-description"
                name="description"
                label={t('ServiceAgreements.planningNoteOptional')}
                maxLength={2000}
              />
            </div>
            <p className="text-sm text-slate-600">{t('ServiceAgreements.startsDraft')}</p>
            <Button type="submit" className="w-fit">
              {t('ServiceAgreements.createDraft')}
            </Button>
          </form>
        </details>
      ) : null}

      <section
        id="agreements"
        aria-labelledby="agreements-title"
        className="grid gap-4 scroll-mt-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="agreements-title" className="text-xl font-semibold">
            {t('ServiceAgreements.agreementsTab')}
          </h2>
          <p className="text-sm text-slate-600">
            {t('ServiceAgreements.agreementCount', { count: agreementsResult.data?.total ?? 0 })}
          </p>
        </div>
        {agreementsResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
            {t(errorMessageKey(agreementsResult.error.code))}
          </p>
        ) : agreements.length ? (
          <div className="grid gap-4">
            {await Promise.all(
              agreements.map(async (agreement) => {
                const [serviceResult, providerOrganizationResult, providerFacilityResult] =
                  await Promise.all([
                    get('/api/v1/service-agreements/{id}/services', {
                      params: { path: { id: agreement.id }, header },
                    }),
                    get('/api/v1/organizations/{id}', {
                      params: { path: { id: agreement.organizationId }, header },
                    }),
                    get('/api/v1/facilities/{id}', {
                      params: { path: { id: agreement.facilityId }, header },
                    }),
                  ]);
                const services = serviceResult.data ?? [];
                const canUpdate =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.update',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canManageServices =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.manage_services',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canActivate =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.activate',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canSuspend =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.suspend',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canEnd =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.end',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canGenerate =
                  agreement.status === 'active' &&
                  hasClientPermission(
                    permissions,
                    'schedule.generate',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const generationFrom = laterDate(today(), agreement.validFrom);
                const generationUntil = earlierDate(
                  addDays(generationFrom, 27),
                  agreement.validUntil ?? null,
                );
                const canSearchServices =
                  agreement.id === selectedAgreement?.id &&
                  selectedProviderCanManage &&
                  servicePeriodValid;
                const canGenerateDocument = hasClientPermission(
                  permissions,
                  'documents.generate',
                  tenantId,
                  agreement.organizationId,
                  agreement.facilityId,
                );
                return (
                  <article
                    key={agreement.id}
                    id={`agreement-${agreement.id}`}
                    className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm"
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-lg font-semibold">
                          {agreement.reference ||
                            t('ServiceAgreements.fallbackAgreement', {
                              id: agreement.id.slice(0, 8),
                            })}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {formatDate(agreement.validFrom, locale)} –{' '}
                          {formatDate(agreement.validUntil ?? null, locale) ??
                            t('ServiceAgreements.unlimited')}
                        </p>
                        <p className="text-sm text-slate-600">
                          {providerOrganizationResult.data?.name ?? agreement.organizationId}
                          {' · '}
                          {providerFacilityResult.data?.name ?? agreement.facilityId}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AgreementStatusBadge status={agreement.status} />
                        <Badge variant="outline">
                          {t('ServiceAgreements.serviceCount', { count: services.length })}
                        </Badge>
                      </div>
                    </header>

                    {agreement.description ? (
                      <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                        {agreement.description}
                      </p>
                    ) : null}

                    {canGenerateDocument ? (
                      <form
                        action={generateDocumentAction}
                        className="flex flex-wrap items-end gap-3 border-t pt-3"
                      >
                        <input type="hidden" name="sourceType" value="service_agreement" />
                        <input type="hidden" name="agreementId" value={agreement.id} />
                        <input
                          type="hidden"
                          name="returnTo"
                          value={`/clients/${client.id}/service-agreements`}
                        />
                        <label className="grid gap-1 text-sm font-medium">
                          <span>{t('Documents.language')}</span>
                          <select
                            name="locale"
                            defaultValue={locale}
                            className="h-10 rounded-md border bg-white px-3"
                          >
                            <option value="de">{t('Documents.languageOptions.german')}</option>
                            <option value="en">{t('Documents.languageOptions.english')}</option>
                          </select>
                        </label>
                        <Button type="submit">{t('Documents.generateAgreement')}</Button>
                        <Button asChild variant="secondary">
                          <Link
                            href={`/documents/preview?sourceType=service_agreement&id=${agreement.id}&locale=${locale}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('Documents.preview')}
                          </Link>
                        </Button>
                      </form>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {agreement.status === 'draft' && canActivate ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="activate"
                          label={t('ServiceAgreements.activate')}
                        />
                      ) : null}
                      {agreement.status === 'active' && canSuspend ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="suspend"
                          label={t('ServiceAgreements.suspend')}
                        />
                      ) : null}
                      {agreement.status === 'suspended' && canActivate ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="resume"
                          label={t('ServiceAgreements.resume')}
                        />
                      ) : null}
                      {agreement.status !== 'ended' && canEnd ? (
                        <form action={changeServiceAgreementStatusAction}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="agreementId" value={agreement.id} />
                          <input type="hidden" name="operation" value="end" />
                          <ConfirmSubmitButton
                            confirmation={t('ServiceAgreements.endConfirmation')}
                          >
                            {t('ServiceAgreements.end')}
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </div>

                    {canGenerate && generationUntil >= generationFrom ? (
                      <details className="rounded-md border border-dashed p-4">
                        <summary className="cursor-pointer font-semibold text-blue-900">
                          {t('ServiceAgreements.generateVisits')}
                        </summary>
                        <p className="mt-2 text-sm text-slate-600">
                          {t('ServiceAgreements.generateDescription')}
                        </p>
                        <form
                          action={generateAgreementVisitsAction}
                          className="mt-3 grid gap-3 sm:grid-cols-3"
                        >
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="agreementId" value={agreement.id} />
                          <DateField
                            id={`generate-${agreement.id}-from`}
                            name="from"
                            label={t('ServiceAgreements.from')}
                            defaultValue={generationFrom}
                            required
                          />
                          <DateField
                            id={`generate-${agreement.id}-until`}
                            name="until"
                            label={t('ServiceAgreements.untilMax')}
                            defaultValue={generationUntil}
                            required
                          />
                          <div className="flex items-end">
                            <Button type="submit">{t('ServiceAgreements.generateVisits')}</Button>
                          </div>
                        </form>
                      </details>
                    ) : null}

                    {agreement.status !== 'ended' && canUpdate ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-blue-900">
                          {t('ServiceAgreements.editPlanning')}
                        </summary>
                        <form action={updateServiceAgreementAction} className="mt-3 grid gap-4">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="agreementId" value={agreement.id} />
                          <div className="grid gap-4 md:grid-cols-2">
                            <DateField
                              id={`agreement-${agreement.id}-from`}
                              name="validFrom"
                              label={t('ServiceAgreements.validFrom')}
                              defaultValue={agreement.validFrom}
                              required
                            />
                            <DateField
                              id={`agreement-${agreement.id}-until`}
                              name="validUntil"
                              label={t('ServiceAgreements.validUntilOptional')}
                              defaultValue={agreement.validUntil ?? ''}
                            />
                            <TextField
                              id={`agreement-${agreement.id}-reference`}
                              name="reference"
                              label={t('ServiceAgreements.agreement')}
                              defaultValue={agreement.reference ?? ''}
                              maxLength={120}
                            />
                            <TextAreaField
                              id={`agreement-${agreement.id}-description`}
                              name="description"
                              label={t('ServiceAgreements.planningNoteOptional')}
                              defaultValue={agreement.description ?? ''}
                              maxLength={2000}
                            />
                          </div>
                          <Button type="submit" variant="secondary" className="w-fit">
                            {t('ServiceAgreements.saveChanges')}
                          </Button>
                        </form>
                      </details>
                    ) : null}

                    <section aria-labelledby={`services-${agreement.id}`} className="grid gap-3">
                      <h4 id={`services-${agreement.id}`} className="font-semibold">
                        {t('ServiceAgreements.plannedServices')}
                      </h4>
                      {serviceResult.error ? (
                        <p role="alert" className="text-sm text-red-800">
                          {t(errorMessageKey(serviceResult.error.code))}
                        </p>
                      ) : services.length ? (
                        <div className="grid gap-3">
                          {services.map((service) => (
                            <article key={service.id} className="grid gap-3 rounded-md border p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h5 className="font-medium">{service.serviceName}</h5>
                                  <p className="text-sm text-slate-600">
                                    {service.serviceCode} · {t(unitLabelKey(service.serviceUnit))}
                                    {service.quantity !== null && service.quantity !== undefined
                                      ? ` · ${t(quantityUnitKey(service.serviceUnit), { count: Number(service.quantity) })}`
                                      : ''}
                                  </p>
                                  <p className="text-sm text-slate-600">
                                    {cadenceLabel(service.scheduleRule)}
                                    {service.preferredTimeStart && service.preferredTimeEnd
                                      ? ` · ${t('ServiceAgreements.preferred')} ${service.preferredTimeStart}–${service.preferredTimeEnd}`
                                      : ''}
                                  </p>
                                  <p className="text-sm text-slate-600">
                                    {formatDate(service.validFrom ?? agreement.validFrom, locale)} –{' '}
                                    {formatDate(
                                      service.validUntil ?? agreement.validUntil ?? null,
                                      locale,
                                    ) ?? t('ServiceAgreements.unlimited')}
                                    {' · '}
                                    {t(
                                      service.status === 'active'
                                        ? 'ServiceAgreements.active'
                                        : 'ServiceAgreements.ended',
                                    )}
                                  </p>
                                  {service.note ? (
                                    <p className="mt-1 text-sm">{service.note}</p>
                                  ) : null}
                                </div>
                              </div>
                              {service.status === 'active' &&
                              canManageServices &&
                              agreement.status !== 'ended' ? (
                                <details>
                                  <summary className="cursor-pointer text-sm font-semibold text-blue-900">
                                    {t('ServiceAgreements.editPlanning')}
                                  </summary>
                                  <ServiceFields
                                    action={updateAgreementServiceAction}
                                    clientId={client.id}
                                    agreementId={agreement.id}
                                    serviceId={service.id}
                                    validFrom={service.validFrom ?? agreement.validFrom}
                                    validUntil={service.validUntil ?? agreement.validUntil ?? ''}
                                    quantity={service.quantity ?? ''}
                                    note={service.note ?? ''}
                                    scheduleRule={service.scheduleRule ?? null}
                                    preferredTimeStart={service.preferredTimeStart ?? ''}
                                    preferredTimeEnd={service.preferredTimeEnd ?? ''}
                                    idPrefix={`line-${service.id}`}
                                    submitLabel={t('ServiceAgreements.savePlanning')}
                                  />
                                  {services.filter((item) => item.status === 'active').length >
                                  1 ? (
                                    <form action={endAgreementServiceAction} className="mt-3">
                                      <input type="hidden" name="clientId" value={client.id} />
                                      <input
                                        type="hidden"
                                        name="agreementId"
                                        value={agreement.id}
                                      />
                                      <input type="hidden" name="serviceId" value={service.id} />
                                      <ConfirmSubmitButton
                                        confirmation={t('ServiceAgreements.endServiceConfirmation')}
                                      >
                                        {t('ServiceAgreements.endService')}
                                      </ConfirmSubmitButton>
                                    </form>
                                  ) : null}
                                </details>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                          {t('ServiceAgreements.noServices')}
                        </p>
                      )}

                      {canManageServices && agreement.status !== 'ended' ? (
                        <div className="grid gap-3 rounded-md border border-dashed p-4">
                          <h5 className="font-medium">{t('ServiceAgreements.addService')}</h5>
                          <form
                            method="get"
                            action={`/clients/${client.id}/service-agreements`}
                            className="grid gap-3 md:grid-cols-3"
                          >
                            <input type="hidden" name="findServicesFor" value={agreement.id} />
                            <DateField
                              id={`search-${agreement.id}-from`}
                              name="serviceValidFrom"
                              label={t('ServiceAgreements.validFromForService')}
                              defaultValue={
                                selectedAgreement?.id === agreement.id
                                  ? selectedServiceFrom
                                  : agreement.validFrom
                              }
                              required
                            />
                            <DateField
                              id={`search-${agreement.id}-until`}
                              name="serviceValidUntil"
                              label={t('ServiceAgreements.validUntilForService')}
                              defaultValue={
                                selectedAgreement?.id === agreement.id
                                  ? (selectedServiceUntil ?? '')
                                  : (agreement.validUntil ?? '')
                              }
                            />
                            <div className="flex items-end">
                              <Button type="submit" variant="secondary">
                                {t('ServiceAgreements.searchAvailableServices')}
                              </Button>
                            </div>
                          </form>
                          {canSearchServices ? (
                            serviceOptionsResult?.error ? (
                              <p role="alert" className="text-sm text-red-800">
                                {t(errorMessageKey(serviceOptionsResult.error.code))}
                              </p>
                            ) : serviceOptions.length ? (
                              <ServiceFields
                                action={addAgreementServiceAction}
                                clientId={client.id}
                                agreementId={agreement.id}
                                serviceOptions={serviceOptions}
                                validFrom={selectedServiceFrom}
                                validUntil={selectedServiceUntil ?? ''}
                                idPrefix={`add-${agreement.id}`}
                                submitLabel={t('ServiceAgreements.addService')}
                              />
                            ) : (
                              <p className="text-sm text-slate-600">
                                {t('ServiceAgreements.noMatchingServices')}
                              </p>
                            )
                          ) : selectedAgreement?.id === agreement.id && !servicePeriodValid ? (
                            <p role="alert" className="text-sm text-red-800">
                              {t('ServiceAgreements.servicePeriodInvalid')}
                            </p>
                          ) : selectedAgreement?.id === agreement.id ? (
                            <p className="text-sm text-slate-600">
                              {t('ServiceAgreements.serviceSearchDenied')}
                            </p>
                          ) : (
                            <p className="text-sm text-slate-600">
                              {t('ServiceAgreements.choosePeriod')}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </section>
                  </article>
                );
              }),
            )}
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            {t('ServiceAgreements.noAgreements')}
          </p>
        )}
      </section>

      <section id="history" aria-labelledby="history-title" className="grid gap-3 scroll-mt-6">
        <h2 id="history-title" className="text-xl font-semibold">
          {t('ServiceAgreements.history')}
        </h2>
        {timeline.length ? (
          <ol className="grid gap-3 border-l-2 border-blue-200 pl-5">
            {timeline.map((entry) => (
              <li key={entry.id} className="rounded-lg border bg-white p-4">
                <p className="font-medium">{t(auditActionKey(entry.action))}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateTime(entry.occurredAt, locale)} ·{' '}
                  {t('Clients.detail.editedBy', { actor: entry.actorId })}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            {t('ServiceAgreements.noHistory')}
          </p>
        )}
        <p className="text-sm">
          <Link className="text-blue-900 underline" href={`/clients/${client.id}#timeline`}>
            {t('ServiceAgreements.openFullTimeline')}
          </Link>
        </p>
      </section>
    </div>
  );
}

async function ServiceFields({
  action,
  clientId,
  agreementId,
  serviceId,
  serviceOptions,
  validFrom,
  validUntil,
  quantity,
  note,
  scheduleRule,
  preferredTimeStart,
  preferredTimeEnd,
  idPrefix,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  agreementId: string;
  serviceId?: string;
  serviceOptions?: Array<{
    id: string;
    code: string;
    name: string;
    categoryName: string;
    unit: ServiceUnit;
    defaultDurationMinutes: number | null;
  }>;
  validFrom: string | null | undefined;
  validUntil: string;
  quantity?: string;
  note?: string;
  scheduleRule?: ScheduleRule | null;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  idPrefix: string;
  submitLabel: string;
}) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="agreementId" value={agreementId} />
      {serviceId ? <input type="hidden" name="serviceId" value={serviceId} /> : null}
      {serviceOptions ? (
        <SelectField
          id={`${idPrefix}-service`}
          name="serviceDefinitionId"
          label={t('ServiceAgreements.service')}
          required
        >
          <option value="">{t('ServiceAgreements.selectService')}</option>
          {serviceOptions.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} · {service.categoryName} · {t(unitLabelKey(service.unit))}
              {service.defaultDurationMinutes != null
                ? ` · ${t('ServiceAgreements.duration', { count: formatNumber(service.defaultDurationMinutes, locale) })}`
                : ''}
            </option>
          ))}
        </SelectField>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <DateField
          id={`${idPrefix}-from`}
          name="validFrom"
          label={t('ServiceAgreements.validFromForService')}
          defaultValue={validFrom ?? ''}
        />
        <DateField
          id={`${idPrefix}-until`}
          name="validUntil"
          label={t('ServiceAgreements.validUntilForService')}
          defaultValue={validUntil}
        />
        <TextField
          id={`${idPrefix}-quantity`}
          name="quantity"
          label={t('ServiceAgreements.quantityOptional')}
          defaultValue={quantity ?? ''}
          maxLength={13}
          inputMode="decimal"
        />
        <SelectField
          id={`${idPrefix}-cadence`}
          name="cadence"
          label={t('ServiceAgreements.cadence')}
          defaultValue={scheduleRule?.type ?? 'none'}
        >
          <option value="none">{t('ServiceAgreements.cadenceUnspecified')}</option>
          <option value="daily">{t('ServiceAgreements.daily')}</option>
          <option value="weekly">{t('ServiceAgreements.weekly')}</option>
          <option value="occurrences_per_week">{t('ServiceAgreements.occurrencesPerWeek')}</option>
          <option value="interval_days">{t('ServiceAgreements.intervalDays')}</option>
          <option value="on_demand">{t('ServiceAgreements.onDemand')}</option>
        </SelectField>
        <TextField
          id={`${idPrefix}-count`}
          name="count"
          label={t('ServiceAgreements.occurrencesPerWeekHelp')}
          type="number"
          min={1}
          max={14}
          defaultValue={
            scheduleRule?.type === 'occurrences_per_week' ? String(scheduleRule.count) : ''
          }
        />
        <TextField
          id={`${idPrefix}-interval`}
          name="intervalDays"
          label={t('ServiceAgreements.intervalDaysHelp')}
          type="number"
          min={1}
          max={365}
          defaultValue={
            scheduleRule?.type === 'interval_days' ? String(scheduleRule.intervalDays) : ''
          }
        />
        <TimeField
          id={`${idPrefix}-preferred-start`}
          name="preferredTimeStart"
          label={t('ServiceAgreements.preferredTimeFrom')}
          defaultValue={preferredTimeStart ?? ''}
        />
        <TimeField
          id={`${idPrefix}-preferred-end`}
          name="preferredTimeEnd"
          label={t('ServiceAgreements.preferredTimeUntil')}
          defaultValue={preferredTimeEnd ?? ''}
        />
        <TextAreaField
          id={`${idPrefix}-note`}
          name="note"
          label={t('ServiceAgreements.operationalNote')}
          defaultValue={note ?? ''}
          maxLength={1000}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t('ServiceAgreements.weekdaysLegend')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {(Object.keys(weekdayKeys) as Weekday[]).map((day) => (
            <label key={day} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="weekdays"
                value={day}
                defaultChecked={
                  scheduleRule?.type === 'weekly' && scheduleRule.weekdays.includes(day)
                }
              />
              {t(weekdayKeys[day])}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" className="w-fit">
        {submitLabel}
      </Button>
    </form>
  );
}

function StatusAction({
  clientId,
  agreementId,
  operation,
  label,
}: {
  clientId: string;
  agreementId: string;
  operation: 'activate' | 'suspend' | 'resume';
  label: string;
}) {
  return (
    <form action={changeServiceAgreementStatusAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="agreementId" value={agreementId} />
      <input type="hidden" name="operation" value={operation} />
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

async function AgreementStatusBadge({
  status,
}: {
  status: 'draft' | 'active' | 'suspended' | 'ended';
}) {
  const t = await getTranslations();
  const variant =
    status === 'active'
      ? 'success'
      : status === 'draft'
        ? 'warning'
        : status === 'ended'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{t(serviceAgreementStatusKey(status))}</Badge>;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="break-words font-medium">{value || '—'}</dd>
    </div>
  );
}

function DateField({
  id,
  name,
  label,
  defaultValue,
  required = false,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | undefined;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="date" defaultValue={defaultValue} required={required} />
    </div>
  );
}

function TimeField({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="time" defaultValue={defaultValue} />
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  maxLength,
  inputMode,
  type = 'text',
  min,
  max,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  maxLength?: number;
  inputMode?: 'decimal' | 'numeric';
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        inputMode={inputMode}
        min={min}
        max={max}
      />
    </div>
  );
}

function TextAreaField({
  id,
  name,
  label,
  defaultValue,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  maxLength?: number;
}) {
  return (
    <div className="grid gap-2 md:col-span-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        className="min-h-20 rounded-md border px-3 py-2"
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  required = false,
  children,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="h-10 rounded-md border bg-white px-3"
      >
        {children}
      </select>
    </div>
  );
}

function validLineDate(value: string | undefined, fallback: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function validLineEnd(
  value: string | undefined,
  fallback: string | null,
): string | null | undefined {
  if (value === undefined) return fallback;
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function laterDate(left: string, right: string): string {
  return left > right ? left : right;
}

function earlierDate(candidate: string, upperBound: string | null): string {
  return upperBound !== null && upperBound < candidate ? upperBound : candidate;
}

function countLabel(value: string | undefined, locale: Locale): string {
  const count = Number(value);
  return formatNumber(Number.isInteger(count) && count >= 0 ? count : 0, locale);
}
