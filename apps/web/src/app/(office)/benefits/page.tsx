import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
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
import { createProviderRecognitionAction, allocatePerformedServiceAction } from './actions';

type SearchParams = Promise<{ page?: string; error?: string; updated?: string }>;

export default async function BenefitsWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = positivePage(query.page);
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
  const { data: worklist, error: worklistError } = await get('/api/v1/benefits/worklist', {
    params: { query: { page, pageSize: 25 }, header },
  });
  const organizationResult = hasPermission(permissions, 'benefits.manage')
    ? await get('/api/v1/organizations', { params: { header } })
    : null;
  const organizations = organizationResult?.data ?? [];
  const serviceItems = worklist?.unallocatedServices.items ?? [];
  const clientIds = [...new Set(serviceItems.map((service) => service.clientId))];
  const budgetResults = await Promise.all(
    clientIds.map(async (clientId) => {
      const result = await get('/api/v1/clients/{clientId}/budgets', {
        params: { path: { clientId }, header },
      });
      return [clientId, result.data ?? null] as const;
    }),
  );
  const budgetByClient = new Map(budgetResults);
  const error = query.error ?? worklistError?.code;
  const updated = query.updated === 'allocation' || query.updated === 'recognition';

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('Navigation.office')}
        </p>
        <h1 className="text-3xl font-semibold">{t('Benefits.worklistTitle')}</h1>
        <p className="text-slate-700">{t('Benefits.description')}</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t(
            query.updated === 'allocation'
              ? 'Benefits.allocationSaved'
              : 'Benefits.recognitionSaved',
          )}
        </p>
      ) : null}

      <section
        aria-labelledby="clients-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="clients-title" className="text-xl font-semibold">
            {t('Benefits.worklistTitle')}
          </h2>
          {worklist?.clients ? (
            <p className="text-sm text-slate-600">{worklist.clients.total}</p>
          ) : null}
        </div>
        {worklistError ? null : worklist?.clients.items.length ? (
          <ul className="grid gap-3">
            {worklist.clients.items.map((client) => {
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
                      <Link
                        className="font-semibold text-blue-900 underline"
                        href={`/clients/${client.clientId}/benefits`}
                      >
                        {client.clientName}
                      </Link>
                      <p className="text-sm text-slate-700">
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
                              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950"
                            >
                              {flag}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-600">
                            {t('Benefits.noReviewNeeded')}
                          </span>
                        )}
                      </div>
                    </div>
                    <dl className="grid gap-1 text-sm sm:text-right">
                      <dt className="text-slate-600">{t('Benefits.estimatedRemaining')}</dt>
                      <dd className="font-medium">
                        {money(client.recordedRemainingCents, locale)}
                      </dd>
                      {client.expiringCarryoverCents > 0 ? (
                        <>
                          <dt className="text-slate-600">{t('Benefits.expiringCarryover')}</dt>
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
          <p className="text-sm text-slate-600">{t('Benefits.worklistEmpty')}</p>
        )}
        {worklist?.clients && worklist.clients.total > worklist.clients.pageSize ? (
          <div className="flex justify-end gap-2">
            {page > 1 ? (
              <Button asChild variant="secondary">
                <Link href={worklistHref(page - 1)}>{t('Common.actions.previous')}</Link>
              </Button>
            ) : null}
            {page * worklist.clients.pageSize < worklist.clients.total ? (
              <Button asChild variant="secondary">
                <Link href={worklistHref(page + 1)}>{t('Common.actions.next')}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="services-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="services-title" className="text-xl font-semibold">
          {t('Benefits.serviceWorklistTitle')}
        </h2>
        {worklistError ? null : serviceItems.length ? (
          <ul className="grid gap-4">
            {serviceItems.map((service) => {
              const budget = budgetByClient.get(service.clientId);
              const canAllocate = hasClientPermission(
                permissions,
                'benefits.allocate',
                tenantId,
                service.organizationId,
                service.facilityId,
              );
              const options = (budget?.entitlements ?? []).filter(
                (entitlement) =>
                  ['confirmed', 'provisional'].includes(entitlement.status) &&
                  entitlement.validFrom <= service.serviceDate &&
                  (entitlement.validUntil === null ||
                    entitlement.validUntil >= service.serviceDate),
              );
              return (
                <li key={service.performedServiceId} className="grid gap-3 rounded-md border p-4">
                  <div className="grid gap-1">
                    <h3 className="font-semibold">
                      {service.serviceName} · {service.clientName}
                    </h3>
                    <p className="text-sm text-slate-700">
                      {formatDate(service.serviceDate, locale)} · {t('Benefits.actualQuantity')}:{' '}
                      {service.actualQuantity ?? '—'} {service.unit} ·{' '}
                      {categoryLabel(benefitT, service.serviceCategory)}
                    </p>
                    <p className="text-sm text-slate-700">
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
                    <form
                      action={allocatePerformedServiceAction}
                      className="grid gap-3 rounded-md bg-slate-50 p-4"
                    >
                      <input
                        type="hidden"
                        name="performedServiceId"
                        value={service.performedServiceId}
                      />
                      {service.serviceAmountCents === null ? (
                        <Field
                          id={`service-amount-${service.performedServiceId}`}
                          name="manualServiceAmount"
                          label={t('Benefits.serviceAmount')}
                          defaultValue=""
                          required
                        />
                      ) : null}
                      <p className="text-sm font-medium">{t('Benefits.allocationRows')}</p>
                      <div className="grid gap-3 lg:grid-cols-3">
                        {[0, 1, 2].map((index) => (
                          <div
                            key={index}
                            className="grid content-start gap-2 rounded border bg-white p-3"
                          >
                            <input
                              type="hidden"
                              name={`allocation-${index}-key`}
                              value={randomUUID()}
                            />
                            <SelectField
                              id={`allocation-${index}-selection-${service.performedServiceId}`}
                              name={`allocation-${index}-selection`}
                              label={t('Benefits.fundingSource')}
                            >
                              <option value="">{t('Benefits.selectFundingSource')}</option>
                              {options.map((entitlement) => {
                                const source = budget?.fundingSources.find(
                                  (item) => item.id === entitlement.fundingSourceId,
                                );
                                const title =
                                  source?.label ??
                                  sourceLabel(benefitT, source?.sourceType ?? 'other');
                                return (
                                  <option
                                    key={entitlement.id}
                                    value={`${entitlement.fundingSourceId}|${entitlement.id}`}
                                  >
                                    {title} · {benefitTypeLabel(benefitT, entitlement.benefitType)}
                                  </option>
                                );
                              })}
                            </SelectField>
                            <Field
                              id={`allocation-${index}-amount-${service.performedServiceId}`}
                              name={`allocation-${index}-amount`}
                              label={t('Benefits.allocationAmount')}
                              inputMode="decimal"
                            />
                            <SelectField
                              id={`allocation-${index}-status-${service.performedServiceId}`}
                              name={`allocation-${index}-status`}
                              label={t('Benefits.allocationStatus')}
                              defaultValue="provisional"
                            >
                              <option value="provisional">
                                {t('Benefits.provisionalAllocation')}
                              </option>
                              <option value="confirmed">{t('Benefits.confirmedAllocation')}</option>
                            </SelectField>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm text-slate-600">{t('Benefits.allocationNote')}</p>
                      <Button type="submit" className="w-fit">
                        {t('Benefits.allocateService')}
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm text-slate-700">
                      {canAllocate
                        ? t('Benefits.noEligibleEntitlement')
                        : t('Benefits.noAllocationPermission')}{' '}
                      <Link
                        className="font-medium text-blue-900 underline"
                        href={`/clients/${service.clientId}/benefits`}
                      >
                        {t('Benefits.openClientBudget')}
                      </Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('Benefits.servicesEmpty')}</p>
        )}
        {worklist?.unallocatedServices &&
        worklist.unallocatedServices.total > worklist.unallocatedServices.pageSize ? (
          <div className="flex justify-end gap-2">
            {page > 1 ? (
              <Button asChild variant="secondary">
                <Link href={worklistHref(page - 1)}>{t('Common.actions.previous')}</Link>
              </Button>
            ) : null}
            {page * worklist.unallocatedServices.pageSize < worklist.unallocatedServices.total ? (
              <Button asChild variant="secondary">
                <Link href={worklistHref(page + 1)}>{t('Common.actions.next')}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      {hasPermission(permissions, 'benefits.manage') ? (
        <section
          aria-labelledby="recognition-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <h2 id="recognition-title" className="text-xl font-semibold">
            {t('Benefits.recognitionTitle')}
          </h2>
          <p className="text-sm text-slate-700">{t('Benefits.recognitionDescription')}</p>
          {organizationResult?.error ? (
            <p role="alert" className="text-sm text-red-800">
              {t(errorMessageKey(organizationResult.error.code))}
            </p>
          ) : null}
          {organizations.length ? (
            <form action={createProviderRecognitionAction} className="grid gap-3 md:grid-cols-2">
              <SelectField
                id="recognition-organization"
                name="organizationId"
                label={t('Benefits.recognitionOrganization')}
                required
              >
                <option value="">{t('Benefits.selectOrganization')}</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </SelectField>
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
            </form>
          ) : (
            <p className="text-sm text-slate-600">{t('Benefits.noOrganizations')}</p>
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

function SelectField({
  id,
  name,
  label,
  defaultValue,
  required,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="min-h-10 rounded-md border bg-white px-3 py-2"
      >
        {children}
      </select>
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function worklistHref(page: number): string {
  return `/benefits?page=${page}`;
}
