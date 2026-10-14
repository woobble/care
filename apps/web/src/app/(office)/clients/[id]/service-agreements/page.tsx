import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Badge } from '@care/ui/components/badge';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { PageHeader } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { ResourceReference } from '@app/web/components/resource-reference';
import { AgreementServiceFields } from '@app/web/components/agreement-service-fields';
import {
  AgreementCostSummary,
  AgreementCostSummaryPanel,
  AgreementPeriodEndField,
  AgreementPeriodStartField,
} from '@app/web/components/agreement-cost-summary';
import { errorMessageKey } from '@app/web/i18n/errors';
import { auditActionKey } from '@app/web/i18n/audit';
import { formatDate, formatDateTime, formatNumber } from '@app/web/i18n/format';
import type { Locale } from '@app/web/i18n/config';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import { getFacilitiesByIds } from '@app/web/lib/facility-lookup';
import type { components } from '@care/api-client';
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
import { redirectToValidPage } from '@app/web/lib/pagination';

type SearchParams = Promise<{
  error?: string;
  findServicesFor?: string;
  serviceValidFrom?: string;
  serviceValidUntil?: string;
  generated?: string;
  existing?: string;
  placement?: string;
  agreementPage?: string;
  agreementPageSize?: string;
  agreementStatus?: string;
  agreementValidAt?: string;
  agreementSortBy?: string;
  agreementSortOrder?: string;
}>;

const weekdayKeys = {
  monday: 'ServiceAgreements.weekdays.monday',
  tuesday: 'ServiceAgreements.weekdays.tuesday',
  wednesday: 'ServiceAgreements.weekdays.wednesday',
  thursday: 'ServiceAgreements.weekdays.thursday',
  friday: 'ServiceAgreements.weekdays.friday',
  saturday: 'ServiceAgreements.weekdays.saturday',
  sunday: 'ServiceAgreements.weekdays.sunday',
} as const;

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
  const agreementPage = positivePage(query.agreementPage);
  const agreementPageSize = positivePageSize(query.agreementPageSize);
  const agreementStatus = ['draft', 'active', 'suspended', 'ended'].includes(
    query.agreementStatus ?? '',
  )
    ? (query.agreementStatus as 'draft' | 'active' | 'suspended' | 'ended')
    : 'all';
  const agreementValidAt =
    query.agreementValidAt && /^\d{4}-\d{2}-\d{2}$/.test(query.agreementValidAt)
      ? query.agreementValidAt
      : undefined;
  const agreementSortBy = ['validFrom', 'createdAt', 'status'].includes(query.agreementSortBy ?? '')
    ? (query.agreementSortBy as 'validFrom' | 'createdAt' | 'status')
    : 'validFrom';
  const agreementSortOrder = query.agreementSortOrder === 'asc' ? 'asc' : 'desc';
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [clientResult, agreementsResult, timelineResult] = await Promise.all([
    get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
    get('/api/v1/clients/{clientId}/service-agreements', {
      params: {
        path: { clientId },
        query: {
          page: agreementPage,
          pageSize: agreementPageSize,
          sortBy: agreementSortBy,
          sortOrder: agreementSortOrder,
          ...(agreementStatus === 'all' ? {} : { status: agreementStatus }),
          ...(agreementValidAt ? { validAt: agreementValidAt } : {}),
        },
        header,
      },
    }),
    get('/api/v1/clients/{clientId}/timeline', { params: { path: { clientId }, header } }),
  ]);
  if ((clientResult.error as { code?: string } | undefined)?.code === 'CLIENT_NOT_FOUND')
    notFound();
  const client = clientResult.data as components['schemas']['ClientResponseDto'] | undefined;
  if (!client) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
      >
        {t('ServiceAgreements.loadClientFailed')}
      </p>
    );
  }

  const agreementData = agreementsResult.data as
    | components['schemas']['ServiceAgreementListResponseDto']
    | undefined;
  const agreements = agreementData?.items ?? [];
  if (agreementData) {
    redirectToValidPage(
      `/clients/${clientId}/service-agreements`,
      query,
      agreementPage,
      agreementData.pageSize,
      agreementData.total,
      'agreementPage',
      'agreementPageSize',
    );
  }
  const [organizationLookup, facilityLookup] = await Promise.all([
    getOrganizationsByIds([
      ...(client.organizationId ? [client.organizationId] : []),
      ...agreements.map((agreement) => agreement.organizationId),
    ]),
    getFacilitiesByIds([
      ...(client.primaryFacilityId ? [client.primaryFacilityId] : []),
      ...agreements.map((agreement) => agreement.facilityId),
    ]),
  ]);
  const organizations = organizationLookup.items;
  const facilities = facilityLookup.items;
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
      <PageHeader
        eyebrow={<Link href={`/clients/${client.id}`}>{t('Clients.detail.detailTitle')}</Link>}
        title={t('ServiceAgreements.title')}
        meta={
          <p className="text-sm text-muted-foreground">
            {client.preferredName || client.firstName} {client.lastName}
          </p>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={`/clients/${client.id}`}>{t('ServiceAgreements.backToClient')}</Link>
          </Button>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {generationSummary ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('ServiceAgreements.generationDone')} {generationSummary}
        </p>
      ) : null}

      <nav
        aria-label={t('ServiceAgreements.navigationLabel')}
        className="flex flex-wrap gap-2 border-b pb-3 text-sm"
      >
        <a className="rounded-md px-3 py-2 text-primary hover:bg-accent" href="#agreements">
          {t('ServiceAgreements.agreementsTab')}
        </a>
        <a className="rounded-md px-3 py-2 text-primary hover:bg-accent" href="#history">
          {t('ServiceAgreements.historyTab')}
        </a>
        <Link className="rounded-md px-3 py-2 text-primary hover:bg-accent" href="#overview">
          {t('ServiceAgreements.overviewTab')}
        </Link>
      </nav>

      <section id="overview" aria-labelledby="overview-title" className="grid gap-3 scroll-mt-6">
        <h2 id="overview-title" className="text-xl font-semibold">
          {t('ServiceAgreements.providerContext')}
        </h2>
        <dl className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <Field
            label={t('ServiceAgreements.organization')}
            value={
              <ResourceReference
                label={organizationName ?? t('Resources.unavailableOrganization')}
                href={
                  organizationName ? `/administration/organizations/${client.organizationId}` : null
                }
              />
            }
          />
          <Field
            label={t('ServiceAgreements.facility')}
            value={
              client.primaryFacilityId ? (
                <ResourceReference
                  label={facilityName ?? t('Resources.unavailableFacility')}
                  href={
                    facilityName ? `/administration/facilities/${client.primaryFacilityId}` : null
                  }
                />
              ) : null
            }
          />
        </dl>
      </section>

      {canCreate ? (
        <details className="rounded-lg border bg-card p-5">
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
            <p className="text-sm text-muted-foreground">{t('ServiceAgreements.startsDraft')}</p>
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
          <p className="text-sm text-muted-foreground">
            {t('ServiceAgreements.agreementCount', { count: agreementData?.total ?? 0 })}
          </p>
        </div>
        <form
          method="get"
          className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input type="hidden" name="agreementPage" value="1" />
          <input type="hidden" name="agreementPageSize" value={agreementPageSize} />
          <SelectField
            id="agreement-status-filter"
            name="agreementStatus"
            label={t('ServiceAgreements.filterStatus')}
            defaultValue={agreementStatus}
          >
            <option value="all">{t('Common.filters.allStatuses')}</option>
            <option value="draft">{t('ServiceAgreements.status.draft')}</option>
            <option value="active">{t('ServiceAgreements.status.active')}</option>
            <option value="suspended">{t('ServiceAgreements.status.suspended')}</option>
            <option value="ended">{t('ServiceAgreements.status.ended')}</option>
          </SelectField>
          <DateField
            id="agreement-valid-at-filter"
            name="agreementValidAt"
            label={t('ServiceAgreements.validOn')}
            defaultValue={agreementValidAt ?? ''}
          />
          <SelectField
            id="agreement-sort-by"
            name="agreementSortBy"
            label={t('Common.fields.sortBy')}
            defaultValue={agreementSortBy}
          >
            <option value="validFrom">{t('ServiceAgreements.validFrom')}</option>
            <option value="createdAt">{t('Common.fields.created')}</option>
            <option value="status">{t('ServiceAgreements.filterStatus')}</option>
          </SelectField>
          <div className="flex items-end gap-2">
            <SelectField
              id="agreement-sort-order"
              name="agreementSortOrder"
              label={t('Common.fields.order')}
              defaultValue={agreementSortOrder}
            >
              <option value="asc">{t('Common.filters.ascending')}</option>
              <option value="desc">{t('Common.filters.descending')}</option>
            </SelectField>
            <Button type="submit" className="shrink-0">
              {t('Common.actions.apply')}
            </Button>
          </div>
        </form>
        {agreementsResult.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
          >
            {t(errorMessageKey(agreementsResult.error.code))}
          </p>
        ) : agreements.length ? (
          <div className="grid gap-4">
            {await Promise.all(
              agreements.map(async (agreement) => {
                const serviceResult = await get('/api/v1/service-agreements/{id}/services', {
                  params: { path: { id: agreement.id }, header },
                });
                const providerOrganizationName = organizations.find(
                  (item) => item.id === agreement.organizationId,
                )?.name;
                const providerFacilityName = facilities.find(
                  (item) => item.id === agreement.facilityId,
                )?.name;
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
                const agreementHref = agreementDetailHref(client.id, agreement.id, {
                  page: agreementPage,
                  pageSize: agreementPageSize,
                  status: agreementStatus,
                  ...(agreementValidAt ? { validAt: agreementValidAt } : {}),
                  sortBy: agreementSortBy,
                  sortOrder: agreementSortOrder,
                });
                return (
                  <article
                    key={agreement.id}
                    id={`agreement-${agreement.id}`}
                    className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm"
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-lg font-semibold">
                          <Link
                            href={agreementHref}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {agreement.reference || t('ServiceAgreements.fallbackAgreement')}
                          </Link>
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(agreement.validFrom, locale)} –{' '}
                          {formatDate(agreement.validUntil ?? null, locale) ??
                            t('ServiceAgreements.unlimited')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <ResourceReference
                            label={
                              providerOrganizationName ?? t('Resources.unavailableOrganization')
                            }
                            href={
                              providerOrganizationName
                                ? `/administration/organizations/${agreement.organizationId}`
                                : null
                            }
                          />
                          {' · '}
                          <ResourceReference
                            label={providerFacilityName ?? t('Resources.unavailableFacility')}
                            href={
                              providerFacilityName
                                ? `/administration/facilities/${agreement.facilityId}`
                                : null
                            }
                          />
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AgreementStatusBadge status={agreement.status} />
                        <AgreementValidityBadge
                          validFrom={agreement.validFrom}
                          validUntil={agreement.validUntil ?? null}
                          today={today()}
                        />
                        <Badge variant="outline">
                          {t('ServiceAgreements.serviceCount', { count: services.length })}
                        </Badge>
                      </div>
                    </header>

                    {agreement.description ? (
                      <p className="rounded-md bg-background p-3 text-sm text-muted-foreground">
                        {agreement.description}
                      </p>
                    ) : null}

                    {canGenerateDocument ? (
                      <RHFActionForm
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
                          <NativeSelect
                            name="locale"
                            defaultValue={locale}
                            selectClassName="h-10 rounded-md border bg-card px-3"
                            className="w-full"
                          >
                            <option value="de">{t('Documents.languageOptions.german')}</option>
                            <option value="en">{t('Documents.languageOptions.english')}</option>
                          </NativeSelect>
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
                      </RHFActionForm>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {agreement.status === 'draft' && canActivate ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="activate"
                          label={t('ServiceAgreements.activate')}
                          confirmation={t('ServiceAgreements.activateConfirmation')}
                        />
                      ) : null}
                      {agreement.status === 'active' && canSuspend ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="suspend"
                          label={t('ServiceAgreements.suspend')}
                          confirmation={t('ServiceAgreements.suspendConfirmation')}
                        />
                      ) : null}
                      {agreement.status === 'suspended' && canActivate ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="resume"
                          label={t('ServiceAgreements.resume')}
                          confirmation={t('ServiceAgreements.resumeConfirmation')}
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
                        <summary className="cursor-pointer font-semibold text-primary">
                          {t('ServiceAgreements.generateVisits')}
                        </summary>
                        <p className="mt-2 text-sm text-muted-foreground">
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

                    <AgreementCostSummary
                      periodStart={agreement.validFrom}
                      periodEnd={agreement.validUntil ?? ''}
                    >
                      {agreement.status !== 'ended' && canUpdate ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-primary">
                            {t('ServiceAgreements.editPlanning')}
                          </summary>
                          <form action={updateServiceAgreementAction} className="mt-3 grid gap-4">
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="agreementId" value={agreement.id} />
                            <div className="grid gap-4 md:grid-cols-2">
                              <AgreementPeriodStartField
                                id={`agreement-${agreement.id}-from`}
                                label={t('ServiceAgreements.validFrom')}
                                required
                              />
                              <AgreementPeriodEndField
                                id={`agreement-${agreement.id}-until`}
                                label={t('ServiceAgreements.validUntilOptional')}
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
                        <AgreementCostSummaryPanel />
                        {serviceResult.error ? (
                          <p role="alert" className="text-sm text-destructive">
                            {t(errorMessageKey(serviceResult.error.code))}
                          </p>
                        ) : services.length ? (
                          <div className="grid gap-3">
                            {services.map((service) => (
                              <article
                                key={service.id}
                                className="grid gap-3 rounded-md border p-4"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <h5 className="font-medium">
                                      {hasClientPermission(
                                        permissions,
                                        'service.read',
                                        tenantId,
                                        agreement.organizationId,
                                        agreement.facilityId,
                                      ) ? (
                                        <Link
                                          className="text-primary underline-offset-4 hover:underline"
                                          href={`/services/${service.serviceDefinitionId}`}
                                        >
                                          {service.serviceName}
                                        </Link>
                                      ) : (
                                        service.serviceName
                                      )}
                                    </h5>
                                    <p className="text-sm text-muted-foreground">
                                      {service.serviceCode} · {t(unitLabelKey(service.serviceUnit))}
                                      {service.quantity !== null && service.quantity !== undefined
                                        ? ` · ${t(quantityUnitKey(service.serviceUnit), { count: Number(service.quantity) })}`
                                        : ''}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {cadenceLabel(service.scheduleRule)}
                                      {service.preferredTimeStart && service.preferredTimeEnd
                                        ? ` · ${t('ServiceAgreements.preferred')} ${service.preferredTimeStart}–${service.preferredTimeEnd}`
                                        : ''}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {formatDate(service.validFrom ?? agreement.validFrom, locale)}{' '}
                                      –{' '}
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
                                    <summary className="cursor-pointer text-sm font-semibold text-primary">
                                      {t('ServiceAgreements.editPlanning')}
                                    </summary>
                                    <ServiceFields
                                      action={updateAgreementServiceAction}
                                      clientId={client.id}
                                      agreementId={agreement.id}
                                      serviceId={service.id}
                                      service={{
                                        id: service.serviceDefinitionId,
                                        label: service.serviceName,
                                        unit: service.serviceUnit,
                                      }}
                                      provider={{
                                        organizationId: agreement.organizationId,
                                        facilityId: agreement.facilityId,
                                        agreementValidFrom: agreement.validFrom,
                                      }}
                                      validFrom={service.validFrom ?? agreement.validFrom}
                                      validUntil={service.validUntil ?? ''}
                                      quantity={service.quantity ?? ''}
                                      note={service.note ?? ''}
                                      scheduleRule={service.scheduleRule ?? null}
                                      preferredTimeStart={service.preferredTimeStart ?? ''}
                                      preferredTimeEnd={service.preferredTimeEnd ?? ''}
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
                                          confirmation={t(
                                            'ServiceAgreements.endServiceConfirmation',
                                          )}
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
                          <p className="rounded-md bg-background p-3 text-sm text-muted-foreground">
                            {t('ServiceAgreements.noServices')}
                          </p>
                        )}

                        {canManageServices && agreement.status !== 'ended' ? (
                          <div className="grid gap-3 rounded-md border border-dashed p-4">
                            <h5 className="font-medium">{t('ServiceAgreements.addService')}</h5>
                            <form
                              method="get"
                              action={`/clients/${client.id}/service-agreements`}
                              className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
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
                              <ServiceFields
                                action={addAgreementServiceAction}
                                clientId={client.id}
                                agreementId={agreement.id}
                                provider={{
                                  organizationId: agreement.organizationId,
                                  facilityId: agreement.facilityId,
                                  agreementValidFrom: agreement.validFrom,
                                }}
                                selectService={{
                                  organizationId: agreement.organizationId,
                                  facilityId: agreement.facilityId,
                                  validAt: selectedServiceFrom!,
                                }}
                                validFrom={selectedServiceFrom}
                                validUntil={selectedServiceUntil ?? ''}
                                submitLabel={t('ServiceAgreements.addService')}
                              />
                            ) : selectedAgreement?.id === agreement.id && !servicePeriodValid ? (
                              <p role="alert" className="text-sm text-destructive">
                                {t('ServiceAgreements.servicePeriodInvalid')}
                              </p>
                            ) : selectedAgreement?.id === agreement.id ? (
                              <p className="text-sm text-muted-foreground">
                                {t('ServiceAgreements.serviceSearchDenied')}
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                {t('ServiceAgreements.choosePeriod')}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </section>
                    </AgreementCostSummary>
                  </article>
                );
              }),
            )}
          </div>
        ) : (
          <p className="rounded-lg border bg-card p-5 text-muted-foreground">
            {t('ServiceAgreements.noAgreements')}
          </p>
        )}
        {agreementData ? (
          <DataPagination
            pathname={`/clients/${clientId}/service-agreements`}
            page={agreementData.page}
            pageSize={agreementData.pageSize}
            totalItems={agreementData.total}
            pageParam="agreementPage"
            pageSizeParam="agreementPageSize"
            controlId="client-agreement-page-size"
            filters={{
              error: query.error,
              findServicesFor: query.findServicesFor,
              serviceValidFrom: query.serviceValidFrom,
              serviceValidUntil: query.serviceValidUntil,
              generated: query.generated,
              existing: query.existing,
              placement: query.placement,
              agreementStatus: agreementStatus === 'all' ? undefined : agreementStatus,
              agreementValidAt,
              agreementSortBy,
              agreementSortOrder,
            }}
          />
        ) : null}
      </section>

      <section id="history" aria-labelledby="history-title" className="grid gap-3 scroll-mt-6">
        <h2 id="history-title" className="text-xl font-semibold">
          {t('ServiceAgreements.history')}
        </h2>
        {timeline.length ? (
          <ol className="grid gap-3 border-l-2 border-primary/20 pl-5">
            {timeline.map((entry) => (
              <li key={entry.id} className="rounded-lg border bg-card p-4">
                <p className="font-medium">{t(auditActionKey(entry.action))}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDateTime(entry.occurredAt, locale)} ·{' '}
                  {t('Clients.detail.editedBy', {
                    actor: t('Resources.unavailableUser'),
                  })}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border bg-card p-5 text-muted-foreground">
            {t('ServiceAgreements.noHistory')}
          </p>
        )}
        <p className="text-sm">
          <Link className="text-primary underline" href={`/clients/${client.id}#timeline`}>
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
  service,
  provider,
  selectService,
  validFrom,
  validUntil,
  quantity,
  note,
  scheduleRule,
  preferredTimeStart,
  preferredTimeEnd,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  agreementId: string;
  serviceId?: string;
  service?: { id: string; label: string; unit: 'occurrence' | 'minute' | 'hour' | 'day' };
  provider: { organizationId: string; facilityId: string; agreementValidFrom: string };
  selectService?: { organizationId: string; facilityId: string; validAt: string };
  validFrom: string | null | undefined;
  validUntil: string;
  quantity?: string;
  note?: string;
  scheduleRule?: ScheduleRule | null;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  submitLabel: string;
}) {
  return (
    <AgreementServiceFields
      action={action}
      clientId={clientId}
      agreementId={agreementId}
      {...(serviceId ? { serviceId } : {})}
      {...(service ? { service } : {})}
      provider={{
        organizationId: provider.organizationId,
        facilityId: provider.facilityId,
        agreementValidFrom: provider.agreementValidFrom,
        validAt: selectService?.validAt ?? provider.agreementValidFrom,
      }}
      validFrom={validFrom ?? null}
      validUntil={validUntil || null}
      quantity={quantity ?? ''}
      note={note ?? ''}
      scheduleRule={scheduleRule ?? null}
      preferredTimeStart={preferredTimeStart ?? ''}
      preferredTimeEnd={preferredTimeEnd ?? ''}
      submitLabel={submitLabel}
    />
  );
}

function StatusAction({
  clientId,
  agreementId,
  operation,
  label,
  confirmation,
}: {
  clientId: string;
  agreementId: string;
  operation: 'activate' | 'suspend' | 'resume';
  label: string;
  confirmation: string;
}) {
  return (
    <form action={changeServiceAgreementStatusAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="agreementId" value={agreementId} />
      <input type="hidden" name="operation" value={operation} />
      <ConfirmSubmitButton confirmation={confirmation} variant="secondary">
        {label}
      </ConfirmSubmitButton>
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

async function AgreementValidityBadge({
  validFrom,
  validUntil,
  today: referenceDate,
}: {
  validFrom: string;
  validUntil: string | null;
  today: string;
}) {
  const key =
    validFrom > referenceDate
      ? 'upcoming'
      : validUntil !== null && validUntil < referenceDate
        ? 'expired'
        : null;
  if (!key) return null;
  const t = await getTranslations();
  return <Badge variant="outline">{t(`ServiceAgreements.validityState.${key}`)}</Badge>;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
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
      <Textarea
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
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        selectClassName="h-10 rounded-md border bg-card px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
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

function agreementDetailHref(
  clientId: string,
  agreementId: string,
  filters: {
    page: number;
    pageSize: number;
    status: 'all' | 'draft' | 'active' | 'suspended' | 'ended';
    validAt?: string;
    sortBy: 'validFrom' | 'createdAt' | 'status';
    sortOrder: 'asc' | 'desc';
  },
): string {
  const query = new URLSearchParams({
    agreementPage: String(filters.page),
    agreementPageSize: String(filters.pageSize),
    agreementSortBy: filters.sortBy,
    agreementSortOrder: filters.sortOrder,
  });
  if (filters.status !== 'all') query.set('agreementStatus', filters.status);
  if (filters.validAt) query.set('agreementValidAt', filters.validAt);
  return `/clients/${clientId}/service-agreements?${query.toString()}#agreement-${agreementId}`;
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

function positivePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

function positivePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
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
