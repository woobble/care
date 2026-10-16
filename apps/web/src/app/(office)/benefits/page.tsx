import { randomUUID } from 'node:crypto';

import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatCurrency, formatDate } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';

import { createProviderRecognitionAction, allocatePerformedServiceAction } from './actions';
import { AllocationEditor } from './allocation-editor';

type SearchParams = Promise<{
  page?: string;
  pageSize?: string;
  clientPage?: string;
  clientPageSize?: string;
  servicePage?: string;
  servicePageSize?: string;
  search?: string;
  benefitType?: string;
  period?: string;
  error?: string;
  updated?: string;
}>;

export default async function BenefitsWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const benefitTypes = [
    'entlastungsbetrag_45b',
    'umwandlungsanspruch_45a_4',
    'private',
    'other',
  ] as const;
  const clientPage = positivePage(query.clientPage ?? query.page);
  const servicePage = positivePage(query.servicePage ?? query.page);
  const clientPageSize = positivePageSize(query.clientPageSize ?? query.pageSize);
  const servicePageSize = positivePageSize(query.servicePageSize ?? query.pageSize);
  const search = query.search?.trim().slice(0, 120) ?? '';
  const benefitType = benefitTypes.find((value) => value === query.benefitType);
  const period = validMonth(query.period);
  const [t, benefitT, locale] = await Promise.all([
    getTranslations(),
    getTranslations('Benefits'),
    getLocale(),
  ]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const worklistResult = await get('/api/v1/benefits/worklist', {
    params: {
      query: {
        clientPage,
        clientPageSize,
        servicePage,
        servicePageSize,
        ...(search ? { search } : {}),
        ...(benefitType ? { benefitType } : {}),
        ...(period ? { period } : {}),
      },
      header,
    },
  });
  const worklist = worklistResult.data as unknown as
    | components['schemas']['BenefitWorklistResponseDto']
    | undefined;
  const worklistError = worklistResult.error as { code?: string } | undefined;
  if (worklist && !worklistError) {
    redirectToValidPage(
      '/benefits',
      query,
      clientPage,
      clientPageSize,
      worklist.clients.total,
      'clientPage',
      'clientPageSize',
    );
    redirectToValidPage(
      '/benefits',
      query,
      servicePage,
      servicePageSize,
      worklist.unallocatedServices.total,
      'servicePage',
      'servicePageSize',
    );
  }
  const serviceItems = worklist?.unallocatedServices.items ?? [];
  const allocationOptionsByService = new Map(
    (worklist?.allocationOptions ?? []).map(({ performedServiceId, items }) => [
      performedServiceId,
      items,
    ]),
  );
  const error = query.error ?? worklistError?.code;
  const updated = query.updated === 'allocation' || query.updated === 'recognition';

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={t('Navigation.office')}
        title={t('Benefits.worklistTitle')}
        description={t('Benefits.description')}
      />

      {worklist ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 rounded-lg border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{t('Benefits.clientsInView')}</dt>
            <dd className="text-2xl font-semibold">
              {new Intl.NumberFormat(locale).format(worklist.clients.total)}
            </dd>
          </div>
          <div className="grid gap-1 rounded-lg border bg-card p-4">
            <dt className="text-sm text-muted-foreground">
              {t('Benefits.servicesAwaitingAllocation')}
            </dt>
            <dd className="text-2xl font-semibold">
              {new Intl.NumberFormat(locale).format(worklist.unallocatedServices.total)}
            </dd>
          </div>
        </dl>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t(
            query.updated === 'allocation'
              ? 'Benefits.allocationSaved'
              : 'Benefits.recognitionSaved',
          )}
        </p>
      ) : null}

      <form
        method="get"
        action="/benefits"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(12rem,0.8fr)_minmax(10rem,0.6fr)_auto_auto] lg:items-end"
      >
        <input type="hidden" name="clientPage" value="1" />
        <input type="hidden" name="servicePage" value="1" />
        <input type="hidden" name="clientPageSize" value={clientPageSize} />
        <input type="hidden" name="servicePageSize" value={servicePageSize} />
        <label className="grid gap-2">
          <Label htmlFor="benefits-funding-type">{t('Benefits.filterFundingType')}</Label>
          <NativeSelect
            id="benefits-funding-type"
            name="benefitType"
            defaultValue={benefitType ?? ''}
            selectClassName="min-h-10 rounded-md border bg-card px-3"
          >
            <option value="">{t('Benefits.allFundingTypes')}</option>
            {benefitTypes.map((value) => (
              <option key={value} value={value}>
                {benefitTypeLabel(benefitT, value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-2">
          <Label htmlFor="benefits-period">{t('Benefits.fundingPeriod')}</Label>
          <Input id="benefits-period" type="month" name="period" defaultValue={period ?? ''} />
        </label>
        <label className="grid gap-2">
          <Label htmlFor="benefits-client-search">{t('Benefits.searchClients')}</Label>
          <Input
            id="benefits-client-search"
            type="search"
            name="search"
            defaultValue={search}
            placeholder={t('Benefits.searchClientsPlaceholder')}
            autoComplete="off"
          />
        </label>
        <Button type="submit">{t('Benefits.search')}</Button>
        {search || benefitType || period ? (
          <Button asChild variant="secondary">
            <Link
              href={`/benefits?clientPage=1&servicePage=1&clientPageSize=${clientPageSize}&servicePageSize=${servicePageSize}`}
            >
              {t('Benefits.clearFilters')}
            </Link>
          </Button>
        ) : null}
      </form>

      <section aria-labelledby="clients-title" className="grid gap-3 rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="clients-title" className="text-xl font-semibold">
            {t('Benefits.clientWorklistTitle')}
          </h2>
          {worklist?.clients ? (
            <p className="text-sm text-muted-foreground">{worklist.clients.total}</p>
          ) : null}
        </div>
        {worklistError ? null : worklist?.clients.items.length ? (
          <ul className="grid gap-3">
            {worklist.clients.items.map((client) => {
              const canReadClient = hasClientPermission(
                permissions,
                'client.read',
                tenantId,
                client.organizationId,
                client.facilityId,
              );
              const canReadBenefits = hasClientPermission(
                permissions,
                'benefits.read',
                tenantId,
                client.organizationId,
                client.facilityId,
              );
              const clientHref = canReadClient
                ? canReadBenefits
                  ? `/clients/${client.clientId}/benefits`
                  : `/clients/${client.clientId}`
                : null;
              const flags = [
                ...(client.expiringCarryoverCents > 0 ? [t('Benefits.expiringCarryover')] : []),
                ...(client.lowRecordedBalance ? [t('Benefits.lowBalance')] : []),
                ...(client.missingEntitlement ? [t('Benefits.missingEntitlement')] : []),
                ...(client.missingPflegegrad ? [t('Benefits.missingPflegegrad')] : []),
                ...(client.unverifiedOpeningBalance ? [t('Benefits.unverifiedBalance')] : []),
              ];
              return (
                <li key={client.clientId} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-2">
                      <ResourceReference
                        className="font-semibold"
                        label={client.clientName}
                        href={clientHref}
                      />
                      <p className="text-sm text-muted-foreground">
                        {client.careGrade === null
                          ? t('Benefits.missingPflegegrad')
                          : t('Benefits.currentCareGrade', {
                              date: formatDate(today(), locale) ?? today(),
                            }) + `: ${client.careGrade}`}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {flags.length ? (
                          flags.map((flag) => (
                            <span
                              key={flag}
                              className="rounded-full border border-warning/40 bg-warning-muted px-2 py-1 text-xs text-warning-foreground"
                            >
                              {flag}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {t('Benefits.noReviewNeeded')}
                          </span>
                        )}
                      </div>
                    </div>
                    <dl className="grid gap-1 text-sm sm:text-right">
                      <dt className="text-muted-foreground">{t('Benefits.estimatedRemaining')}</dt>
                      <dd className="font-medium">
                        {money(client.recordedRemainingCents, locale)}
                      </dd>
                      {client.expiringCarryoverCents > 0 ? (
                        <>
                          <dt className="text-muted-foreground">
                            {t('Benefits.expiringCarryover')}
                          </dt>
                          <dd className="font-medium">
                            {money(client.expiringCarryoverCents, locale)}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t('Benefits.worklistEmpty')} />
        )}
        {worklist?.clients && !worklistError ? (
          <DataPagination
            pathname="/benefits"
            page={worklist.clients.page}
            pageSize={worklist.clients.pageSize}
            totalItems={worklist.clients.total}
            filters={{
              search,
              benefitType,
              period,
              servicePage,
              servicePageSize,
            }}
            pageParam="clientPage"
            pageSizeParam="clientPageSize"
            controlId="benefit-clients-page-size"
          />
        ) : null}
      </section>

      <section
        aria-labelledby="services-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="services-title" className="text-xl font-semibold">
          {t('Benefits.serviceWorklistTitle')}
        </h2>
        {worklistError ? null : serviceItems.length ? (
          <ul className="grid gap-4">
            {serviceItems.map((service) => {
              const options = allocationOptionsByService.get(service.performedServiceId) ?? [];
              const canReadClient = hasClientPermission(
                permissions,
                'client.read',
                tenantId,
                service.clientOrganizationId,
                service.clientFacilityId,
              );
              const canReadBenefits = hasClientPermission(
                permissions,
                'benefits.read',
                tenantId,
                service.clientOrganizationId,
                service.clientFacilityId,
              );
              const canAllocate = hasClientPermission(
                permissions,
                'benefits.allocate',
                tenantId,
                service.organizationId,
                service.facilityId,
              );
              return (
                <li key={service.performedServiceId} className="grid gap-3 rounded-md border p-4">
                  <div className="grid gap-1">
                    <h3 className="font-semibold">
                      {service.serviceName} ·{' '}
                      <ResourceReference
                        label={service.clientName}
                        href={canReadClient ? `/clients/${service.clientId}` : null}
                      />
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(service.serviceDate, locale)} · {t('Benefits.actualQuantity')}:{' '}
                      {service.actualQuantity ?? '—'} {service.unit} ·{' '}
                      {categoryLabel(benefitT, service.serviceCategory)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('Benefits.serviceAmount')}:{' '}
                      {service.serviceAmountCents === null
                        ? t('Benefits.priceUnknown')
                        : money(service.serviceAmountCents, locale)}{' '}
                      · {t('Benefits.remainingToAllocate')}:{' '}
                      {service.remainingCents === null
                        ? t('Benefits.priceUnknown')
                        : money(service.remainingCents, locale)}
                    </p>
                  </div>
                  {canAllocate && options.length ? (
                    <RHFActionForm
                      action={allocatePerformedServiceAction}
                      errorMessage={t('Benefits.allocationSaveFailed')}
                      className="grid gap-3 rounded-md bg-background p-4"
                    >
                      <input
                        type="hidden"
                        name="performedServiceId"
                        value={service.performedServiceId}
                      />
                      <AllocationEditor
                        performedServiceId={service.performedServiceId}
                        amountCents={service.serviceAmountCents}
                        previouslyAllocatedCents={service.allocatedCents}
                        initialIdempotencyKey={randomUUID()}
                        locale={locale}
                        options={options.map((entitlement) => {
                          const title =
                            entitlement.fundingSourceLabel ??
                            sourceLabel(benefitT, entitlement.fundingSourceType);
                          return {
                            value: `${entitlement.fundingSourceId}|${entitlement.entitlementId}`,
                            label: `${title} · ${benefitTypeLabel(benefitT, entitlement.benefitType)}`,
                          };
                        })}
                      />
                      <p className="text-sm text-muted-foreground">
                        {t('Benefits.allocationNote')}
                      </p>
                      <Button type="submit" className="w-fit">
                        {t('Benefits.allocateService')}
                      </Button>
                    </RHFActionForm>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {canAllocate
                        ? t('Benefits.noEligibleEntitlement')
                        : t('Benefits.noAllocationPermission')}{' '}
                      {canReadClient && canReadBenefits ? (
                        <Link
                          className="font-medium text-primary underline"
                          href={`/clients/${service.clientId}/benefits`}
                        >
                          {t('Benefits.openClientBudget')}
                        </Link>
                      ) : null}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t('Benefits.servicesEmpty')} />
        )}
        {worklist?.unallocatedServices && !worklistError ? (
          <DataPagination
            pathname="/benefits"
            page={worklist.unallocatedServices.page}
            pageSize={worklist.unallocatedServices.pageSize}
            totalItems={worklist.unallocatedServices.total}
            filters={{
              search,
              benefitType,
              period,
              clientPage,
              clientPageSize,
            }}
            pageParam="servicePage"
            pageSizeParam="servicePageSize"
            controlId="benefit-services-page-size"
          />
        ) : null}
      </section>

      {hasPermission(permissions, 'benefits.manage') ? (
        <section
          aria-labelledby="recognition-title"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="recognition-title" className="text-xl font-semibold">
            {t('Benefits.recognitionTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Benefits.recognitionDescription')}</p>
          {hasPermission(permissions, 'organization.read') ? (
            <RHFActionForm
              action={createProviderRecognitionAction}
              className="grid gap-3 md:grid-cols-2"
            >
              <AsyncEntityCombobox
                name="organizationId"
                label={t('Benefits.recognitionOrganization')}
                entity="organizations"
                placeholder={t('Benefits.selectOrganization')}
                required
              />
              <Field
                id="recognized-offering"
                name="recognizedOffering"
                label={t('Benefits.recognizedOffering')}
                required
              />
              <Field
                id="recognition-valid-from"
                name="validFrom"
                label={t('Benefits.recognitionValidFrom')}
                type="date"
                defaultValue={today()}
                required
              />
              <Field
                id="recognition-valid-until"
                name="validUntil"
                label={t('Benefits.recognitionValidUntil')}
                type="date"
              />
              <Field
                id="recognition-reference"
                name="reference"
                label={t('Benefits.recognitionReference')}
              />
              <Button type="submit" className="w-fit">
                {t('Benefits.createRecognition')}
              </Button>
            </RHFActionForm>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Benefits.noOrganizations')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

type BenefitTranslator = Awaited<ReturnType<typeof getTranslations<'Benefits'>>>;

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  required,
  inputMode,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  inputMode?: 'decimal' | 'numeric';
}>) {
  return (
    <label className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        inputMode={inputMode}
      />
    </label>
  );
}

function money(cents: number, locale: Locale): string {
  return formatCurrency(cents / 100, locale);
}

function benefitTypeLabel(t: BenefitTranslator, type: string): string {
  switch (type) {
    case 'entlastungsbetrag_45b':
      return t('benefitTypes.entlastungsbetrag_45b');
    case 'umwandlungsanspruch_45a_4':
      return t('benefitTypes.umwandlungsanspruch_45a_4');
    case 'private':
      return t('benefitTypes.private');
    default:
      return t('benefitTypes.other');
  }
}

function sourceLabel(t: BenefitTranslator, type: string): string {
  switch (type) {
    case 'statutory_long_term_care_insurance':
      return t('sourceTypes.statutory_long_term_care_insurance');
    case 'private_long_term_care_insurance':
      return t('sourceTypes.private_long_term_care_insurance');
    case 'self_pay':
      return t('sourceTypes.self_pay');
    default:
      return t('sourceTypes.other');
  }
}

function categoryLabel(t: BenefitTranslator, category: string): string {
  switch (category) {
    case 'recognized_support':
      return t('recognizedSupport');
    case 'clinical_nursing':
      return t('clinicalNursing');
    default:
      return t('otherService');
  }
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function positivePageSize(value: string | undefined): number {
  const parsed = Number(value ?? '20');
  return [10, 20, 50, 100].includes(parsed) ? parsed : 20;
}

function validMonth(value: string | undefined): string | undefined {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
