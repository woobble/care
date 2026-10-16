import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import {
  archiveServiceAction,
  recordServicePriceAction,
  setServiceAvailabilityAction,
  updateServiceAction,
} from '@app/web/app/(office)/services/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { formatCurrency, formatDate } from '@app/web/i18n/format';
import { statusLabelKey, unitLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
  hasClientPermission,
  hasTenantPermission,
} from '@app/web/lib/api';
import { todayDateKey } from '@app/web/lib/care-date';
import { getFacilitiesByIds } from '@app/web/lib/facility-lookup';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { StatusBadge } from '@care/ui/components/status-badge';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui/components/table';
import { Textarea } from '@care/ui/components/textarea';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function ServiceDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    updated?: string;
    priceOrganizationId?: string;
    priceFacilityId?: string;
    priceDate?: string;
  }>;
}>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canUpdate = hasTenantPermission(permissions, 'service.update', tenantId);
  const canArchive = hasTenantPermission(permissions, 'service.archive', tenantId);
  const canManageAvailability = hasTenantPermission(
    permissions,
    'service.manage_availability',
    tenantId,
  );
  const canManagePricing = hasPermission(permissions, 'service.manage_pricing');
  const get = api.GET;
  const [serviceResult, categoriesResult, availabilityResult] = await Promise.all([
    get('/api/v1/services/{id}', { params: { path: { id }, header } }),
    get('/api/v1/service-categories', { params: { query: { includeArchived: true }, header } }),
    get('/api/v1/services/{id}/availability', { params: { path: { id }, header } }),
  ]);
  const service = serviceResult.data as components['schemas']['ServiceResponseDto'] | undefined;
  if (serviceResult.error || !service) notFound();
  const categories = (categoriesResult.data ??
    []) as components['schemas']['ServiceCategoryResponseDto'][];
  const availability = (availabilityResult.data ??
    []) as components['schemas']['ServiceAvailabilityResponseDto'][];
  const priceOrganizationId =
    query.priceOrganizationId && uuidPattern.test(query.priceOrganizationId)
      ? query.priceOrganizationId
      : undefined;
  const priceFacilityId =
    query.priceFacilityId && uuidPattern.test(query.priceFacilityId)
      ? query.priceFacilityId
      : undefined;
  const priceDate =
    query.priceDate && /^\d{4}-\d{2}-\d{2}$/.test(query.priceDate)
      ? query.priceDate
      : todayDateKey();
  const activeAvailability = availability.filter((item) => item.active);
  const selectedOrganizations = new Set(
    activeAvailability
      .filter((item) => item.facilityId === null)
      .map((item) => item.organizationId),
  );
  const selectedFacilities = new Set(
    activeAvailability.flatMap((item) => (item.facilityId ? [item.facilityId] : [])),
  );
  const organizationIds = [
    ...new Set([
      ...activeAvailability.map((item) => item.organizationId),
      ...(priceOrganizationId ? [priceOrganizationId] : []),
    ]),
  ];
  const [organizationLookup, pricesResult] = await Promise.all([
    getOrganizationsByIds(organizationIds),
    priceOrganizationId
      ? get('/api/v1/services/{serviceId}/prices', {
          params: {
            path: { serviceId: id },
            query: {
              organizationId: priceOrganizationId,
              validAt: priceDate,
              ...(priceFacilityId ? { facilityId: priceFacilityId } : {}),
            },
            header,
          },
        })
      : Promise.resolve(null),
  ]);
  const prices =
    (pricesResult?.data as components['schemas']['ServicePriceListResponseDto'] | undefined)
      ?.items ?? [];
  const facilityIds = [
    ...new Set([
      ...activeAvailability.flatMap((item) => (item.facilityId ? [item.facilityId] : [])),
      ...(priceFacilityId ? [priceFacilityId] : []),
      ...prices.flatMap((price) => (price.facilityId ? [price.facilityId] : [])),
    ]),
  ];
  const facilityLookup = await getFacilitiesByIds(facilityIds);
  const organizationsById = new Map(organizationLookup.items.map((item) => [item.id, item]));
  const facilitiesById = new Map(facilityLookup.items.map((item) => [item.id, item]));
  const selectedOrganizationOptions = [...selectedOrganizations].flatMap((selectedId) => {
    const selected = organizationsById.get(selectedId);
    return selected ? [{ id: selectedId, label: selected.name }] : [];
  });
  const selectedFacilityOptions = [...selectedFacilities].flatMap((selectedId) => {
    const selected = facilitiesById.get(selectedId);
    return selected
      ? [{ id: selectedId, label: `${selected.organizationName} · ${selected.name}` }]
      : [];
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={<Link href="/services">{t('Services.catalogTitle')}</Link>}
        title={service.name}
        description={<span className="font-mono">{service.code}</span>}
        meta={<StatusBadge status={service.status} label={t(statusLabelKey(service.status))} />}
      />

      <ActionNotice error={query.error} updated={query.updated} />
      {categoriesResult.error ||
      availabilityResult.error ||
      organizationLookup.failed ||
      facilityLookup.failed ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('Services.detail.categoriesUnavailable')}
        </p>
      ) : null}

      <section className="grid gap-5 rounded-lg border bg-card p-5 shadow-sm">
        {canUpdate ? (
          <RHFActionForm action={updateServiceAction} className="grid gap-5">
            <input type="hidden" name="id" value={service.id} />
            <h2 className="text-xl font-semibold">{t('Services.detail.definition')}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="code"
                name="code"
                label={t('Services.form.code')}
                defaultValue={service.code}
                required
                maxLength={64}
              />
              <Field
                id="name"
                name="name"
                label={t('Services.form.name')}
                defaultValue={service.name}
                required
                maxLength={160}
              />
              <SelectField
                id="categoryId"
                name="categoryId"
                label={t('Services.form.category')}
                defaultValue={service.categoryId}
                required
              >
                {categories.map((category) => (
                  <option
                    key={category.id}
                    value={category.id}
                    disabled={category.status === 'archived' && category.id !== service.categoryId}
                  >
                    {category.name}
                    {category.status === 'archived'
                      ? ` ${t('Services.detail.archivedSuffix')}`
                      : ''}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="unit"
                name="unit"
                label={t('Services.form.unit')}
                defaultValue={service.unit}
                required
              >
                <option value="occurrence">{t('Common.units.occurrence')}</option>
                <option value="minute">{t('Common.units.minute')}</option>
                <option value="hour">{t('Common.units.hour')}</option>
                <option value="day">{t('Common.units.day')}</option>
              </SelectField>
              <SelectField
                id="benefitCategory"
                name="benefitCategory"
                label={t('Services.form.benefitCategory')}
                defaultValue={service.benefitCategory}
                required
              >
                <option value="other">{t('Services.benefitCategory.other')}</option>
                <option value="recognized_support">
                  {t('Services.benefitCategory.recognizedSupport')}
                </option>
                <option value="clinical_nursing">
                  {t('Services.benefitCategory.clinicalNursing')}
                </option>
              </SelectField>
              <Field
                id="defaultDurationMinutes"
                name="defaultDurationMinutes"
                label={t('Services.form.defaultDuration')}
                type="number"
                min={1}
                max={1440}
                defaultValue={service.defaultDurationMinutes?.toString() ?? ''}
              />
              <Field
                id="validFrom"
                name="validFrom"
                label={t('Services.form.validFrom')}
                type="date"
                defaultValue={service.validFrom}
                required
              />
              <Field
                id="validUntil"
                name="validUntil"
                label={t('Services.form.validUntilOptional')}
                type="date"
                defaultValue={service.validUntil ?? ''}
              />
              <label className="grid gap-2 md:col-span-2">
                <Label htmlFor="description">{t('Services.form.descriptionOptional')}</Label>
                <Textarea
                  id="description"
                  name="description"
                  className="min-h-24 rounded-md border px-3 py-2"
                  maxLength={2000}
                  defaultValue={service.description ?? ''}
                />
              </label>
            </div>
            <Button type="submit">{t('Common.actions.save')}</Button>
          </RHFActionForm>
        ) : (
          <div className="grid gap-3">
            <h2 className="text-xl font-semibold">{t('Services.detail.definition')}</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label={t('Services.form.name')} value={service.name} />
              <ReadOnlyField
                label={t('Services.form.category')}
                value={
                  categories.find((category) => category.id === service.categoryId)?.name ?? '—'
                }
              />
              <ReadOnlyField
                label={t('Services.form.unit')}
                value={t(unitLabelKey(service.unit))}
              />
              <ReadOnlyField
                label={t('Services.form.benefitCategory')}
                value={t(
                  `Services.benefitCategory.${
                    service.benefitCategory === 'recognized_support'
                      ? 'recognizedSupport'
                      : service.benefitCategory === 'clinical_nursing'
                        ? 'clinicalNursing'
                        : 'other'
                  }`,
                )}
              />
              <ReadOnlyField
                label={t('Services.detail.standardDuration')}
                value={
                  service.defaultDurationMinutes
                    ? t('Common.units.minutes', { count: service.defaultDurationMinutes })
                    : '—'
                }
              />
              <ReadOnlyField
                label={t('Services.validity')}
                value={`${formatDate(service.validFrom, locale)} – ${formatDate(service.validUntil, locale) ?? t('Services.openEnded')}`}
              />
              <ReadOnlyField
                label={t('Common.fields.description')}
                value={service.description ?? '—'}
              />
            </dl>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {canArchive && service.status === 'active' ? (
            <form action={archiveServiceAction}>
              <input type="hidden" name="id" value={service.id} />
              <Button type="submit" variant="secondary">
                {t('Services.detail.archive')}
              </Button>
            </form>
          ) : null}
          <span className="text-sm text-muted-foreground">
            {t('Services.detail.archiveHistory')}
          </span>
        </div>
      </section>

      <section
        aria-labelledby="pricing-title"
        className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm"
      >
        <div>
          <h2 id="pricing-title" className="text-xl font-semibold">
            {t('Services.pricing.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Services.pricing.description')}</p>
        </div>
        {query.updated === 'price' ? (
          <p
            role="status"
            className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
          >
            {t('Services.pricing.saved')}
          </p>
        ) : null}
        <form method="get" className="grid gap-3 rounded-md border p-4 md:grid-cols-4">
          <AsyncEntityCombobox
            name="priceOrganizationId"
            entity="organizations"
            label={t('Common.fields.organization')}
            initialOption={
              priceOrganizationId && organizationsById.has(priceOrganizationId)
                ? {
                    id: priceOrganizationId,
                    label: organizationsById.get(priceOrganizationId)!.name,
                  }
                : undefined
            }
          />
          <AsyncEntityCombobox
            name="priceFacilityId"
            entity="facilities"
            label={t('Common.fields.facility')}
            organizationId={priceOrganizationId}
            placeholder={t('Services.pricing.organizationDefault')}
            initialOption={
              priceFacilityId && facilitiesById.has(priceFacilityId)
                ? {
                    id: priceFacilityId,
                    label: `${facilitiesById.get(priceFacilityId)!.organizationName} · ${facilitiesById.get(priceFacilityId)!.name}`,
                  }
                : undefined
            }
          />
          <Field
            id="priceDate"
            name="priceDate"
            label={t('Services.pricing.effectiveOn')}
            type="date"
            defaultValue={priceDate}
            required
          />
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              {t('Common.actions.apply')}
            </Button>
          </div>
        </form>
        {pricesResult?.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
          >
            {t('Services.pricing.loadFailed')}
          </p>
        ) : prices.length ? (
          <ul className="grid gap-2">
            {prices.map((price) => (
              <li key={price.id} className="rounded-md border p-3 text-sm">
                <span className="font-medium">
                  {formatCurrency(price.priceCents / 100, locale)}
                </span>
                <span> / {t(`Services.pricing.units.${price.pricingUnit}`)}</span>
                <span className="block text-muted-foreground">
                  {price.facilityId
                    ? (() => {
                        const facility = facilitiesById.get(price.facilityId);
                        return facility ? (
                          <ResourceReference
                            label={facility.name}
                            href={
                              hasClientPermission(
                                permissions,
                                'facility.read',
                                tenantId,
                                facility.organizationId,
                                facility.id,
                              )
                                ? `/administration/facilities/${facility.id}`
                                : null
                            }
                          />
                        ) : (
                          t('Services.pricing.facilityPrice')
                        );
                      })()
                    : t('Services.pricing.organizationDefault')}
                  {' · '}
                  {formatDate(price.validFrom, locale)} –{' '}
                  {formatDate(price.validUntil, locale) ?? t('Services.openEnded')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Services.pricing.noneForDate')}</p>
        )}
        {canManagePricing ? (
          <RHFActionForm action={recordServicePriceAction} className="grid gap-4 border-t pt-4">
            <input type="hidden" name="serviceId" value={service.id} />
            <h3 className="font-semibold">{t('Services.pricing.addTitle')}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <AsyncEntityCombobox
                name="organizationId"
                entity="organizations"
                label={t('Common.fields.organization')}
                required
                initialOption={
                  priceOrganizationId && organizationsById.has(priceOrganizationId)
                    ? {
                        id: priceOrganizationId,
                        label: organizationsById.get(priceOrganizationId)!.name,
                      }
                    : undefined
                }
              />
              <AsyncEntityCombobox
                name="facilityId"
                entity="facilities"
                label={t('Common.fields.facility')}
                organizationId={priceOrganizationId}
                placeholder={t('Services.pricing.organizationDefault')}
              />
              <Field
                id="price"
                name="price"
                label={t('Services.pricing.amount')}
                type="text"
                defaultValue=""
                required
              />
              <label className="grid gap-2">
                <Label htmlFor="pricingUnit">{t('Services.pricing.unit')}</Label>
                <NativeSelect
                  id="pricingUnit"
                  name="pricingUnit"
                  selectClassName="h-10 rounded-md border bg-card px-3"
                  required
                  className="w-full"
                >
                  <option value="hour">{t('Services.pricing.units.hour')}</option>
                  <option value="minute">{t('Services.pricing.units.minute')}</option>
                  <option value="visit">{t('Services.pricing.units.visit')}</option>
                  <option value="fixed">{t('Services.pricing.units.fixed')}</option>
                </NativeSelect>
              </label>
              <Field
                id="priceValidFrom"
                name="validFrom"
                label={t('Services.form.validFrom')}
                type="date"
                defaultValue={priceDate}
                required
              />
              <Field
                id="priceValidUntil"
                name="validUntil"
                label={t('Services.form.validUntilOptional')}
                type="date"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('Services.pricing.priceHistoryNote')}
            </p>
            <Button type="submit" className="w-fit" disabled={service.status === 'archived'}>
              {t('Services.pricing.record')}
            </Button>
          </RHFActionForm>
        ) : null}
      </section>

      <section
        aria-labelledby="availability-title"
        className="grid gap-4 rounded-lg border bg-card p-5 shadow-sm"
      >
        <div>
          <h2 id="availability-title" className="text-xl font-semibold">
            {t('Services.detail.organizationalAvailability')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('Services.detail.availabilityDescription')}
          </p>
        </div>
        {availabilityResult.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
          >
            {t('Services.detail.availabilityLoadFailed')}
          </p>
        ) : null}
        {canManageAvailability ? (
          <RHFActionForm action={setServiceAvailabilityAction} className="grid gap-4">
            <input type="hidden" name="id" value={service.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="availabilityValidFrom"
                name="validFrom"
                label={t('Services.form.validFromOptional')}
                type="date"
              />
              <Field
                id="availabilityValidUntil"
                name="validUntil"
                label={t('Services.form.validUntilOptional')}
                type="date"
              />
            </div>
            <fieldset className="grid gap-3">
              <legend className="font-medium">{t('Services.detail.organizations')}</legend>
              <AsyncEntityCombobox
                name="organizationIds"
                entity="organizations"
                label={t('Services.detail.organizations')}
                multiple
                initialOptions={selectedOrganizationOptions}
              />
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="font-medium">{t('Services.detail.facilities')}</legend>
              <AsyncEntityCombobox
                name="facilityIds"
                entity="facilities"
                label={t('Services.detail.facilities')}
                multiple
                initialOptions={selectedFacilityOptions}
              />
            </fieldset>
            <div>
              <Button type="submit" disabled={service.status === 'archived'}>
                {t('Services.detail.saveAvailability')}
              </Button>
            </div>
          </RHFActionForm>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Services.detail.readAvailability')}</p>
        )}
        {activeAvailability.length ? (
          <div className="overflow-x-auto rounded-md border">
            <ShadcnTable className="w-full text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Services.detail.currentAssignments')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted">
                <ShadcnTableRow>
                  <ShadcnTableHead className="px-3 py-2">
                    {t('Services.detail.area')}
                  </ShadcnTableHead>
                  <ShadcnTableHead className="px-3 py-2">
                    {t('Services.form.validFrom')}
                  </ShadcnTableHead>
                  <ShadcnTableHead className="px-3 py-2">
                    {t('Services.form.validUntil')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {activeAvailability.map((item) => {
                  const facility = item.facilityId
                    ? facilitiesById.get(item.facilityId)
                    : undefined;
                  const organization = organizationsById.get(item.organizationId);
                  return (
                    <ShadcnTableRow key={item.id} className="border-b last:border-0">
                      <ShadcnTableCell className="px-3 py-2">
                        {item.facilityId && facility ? (
                          <ResourceReference
                            label={facility.name}
                            href={
                              hasClientPermission(
                                permissions,
                                'facility.read',
                                tenantId,
                                item.organizationId,
                                facility.id,
                              )
                                ? `/administration/facilities/${facility.id}`
                                : null
                            }
                          />
                        ) : item.facilityId ? (
                          t('Services.detail.defaultFacility')
                        ) : organization ? (
                          <ResourceReference
                            label={organization.name}
                            href={
                              hasClientPermission(
                                permissions,
                                'organization.read',
                                tenantId,
                                organization.id,
                                null,
                              )
                                ? `/administration/organizations/${organization.id}`
                                : null
                            }
                          />
                        ) : (
                          t('Services.detail.defaultOrganization')
                        )}
                        {item.facilityId ? (
                          organization ? (
                            <>
                              {' '}
                              (
                              <ResourceReference
                                label={organization.name}
                                href={
                                  hasClientPermission(
                                    permissions,
                                    'organization.read',
                                    tenantId,
                                    organization.id,
                                    null,
                                  )
                                    ? `/administration/organizations/${organization.id}`
                                    : null
                                }
                              />
                              )
                            </>
                          ) : (
                            ''
                          )
                        ) : (
                          ` — ${t('Services.detail.allFacilities')}`
                        )}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="px-3 py-2">
                        {formatDate(item.validFrom, locale) ?? '—'}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="px-3 py-2">
                        {formatDate(item.validUntil, locale) ?? t('Services.openEnded')}
                      </ShadcnTableCell>
                    </ShadcnTableRow>
                  );
                })}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Services.detail.noAvailability')}</p>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  maxLength,
  required = false,
  min,
  max,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  required?: boolean;
  min?: number;
  max?: number;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        min={min}
        max={max}
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
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        selectClassName="h-10 rounded-md border bg-card px-3"
        defaultValue={defaultValue}
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
