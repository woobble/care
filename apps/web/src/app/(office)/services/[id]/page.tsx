import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { formatCurrency, formatDate } from '../../../../i18n/format';
import { statusLabelKey, unitLabelKey } from '../../../../i18n/status';
import { todayDateKey } from '../../../../lib/care-date';
import { ActionNotice } from '../../administration/action-notice';
import {
  archiveServiceAction,
  recordServicePriceAction,
  setServiceAvailabilityAction,
  updateServiceAction,
} from '../actions';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
  hasTenantPermission,
} from '../../../../lib/api';

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
  const [
    serviceResult,
    categoriesResult,
    availabilityResult,
    organizationsResult,
    facilitiesResult,
  ] = await Promise.all([
    get('/api/v1/services/{id}', { params: { path: { id }, header } }),
    get('/api/v1/service-categories', { params: { query: { includeArchived: true }, header } }),
    get('/api/v1/services/{id}/availability', { params: { path: { id }, header } }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  if (serviceResult.error || !serviceResult.data) notFound();
  const service = serviceResult.data;
  const categories = categoriesResult.data ?? [];
  const availability = availabilityResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const priceOrganizationId =
    query.priceOrganizationId && uuidPattern.test(query.priceOrganizationId)
      ? query.priceOrganizationId
      : organizations[0]?.id;
  const priceFacilityId =
    query.priceFacilityId && uuidPattern.test(query.priceFacilityId)
      ? query.priceFacilityId
      : undefined;
  const priceDate =
    query.priceDate && /^\d{4}-\d{2}-\d{2}$/.test(query.priceDate)
      ? query.priceDate
      : todayDateKey();
  const pricesResult = priceOrganizationId
    ? await get('/api/v1/services/{serviceId}/prices', {
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
    : null;
  const prices = pricesResult?.data?.items ?? [];
  const activeAvailability = availability.filter((item) => item.active);
  const selectedOrganizations = new Set(
    activeAvailability
      .filter((item) => item.facilityId === null)
      .map((item) => item.organizationId),
  );
  const selectedFacilities = new Set(
    activeAvailability.flatMap((item) => (item.facilityId ? [item.facilityId] : [])),
  );

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/services">{t('Services.catalogTitle')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">{service.name}</h1>
          <p className="font-mono text-sm text-slate-600">{service.code}</p>
        </div>
        <StatusBadge status={service.status} label={t(statusLabelKey(service.status))} />
      </header>

      <ActionNotice error={query.error} updated={query.updated} />
      {categoriesResult.error || organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Services.detail.categoriesUnavailable')}
        </p>
      ) : null}

      <section className="grid gap-5 rounded-lg border bg-white p-5 shadow-sm">
        {canUpdate ? (
          <form action={updateServiceAction} className="grid gap-5">
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
                <textarea
                  id="description"
                  name="description"
                  className="min-h-24 rounded-md border px-3 py-2"
                  maxLength={2000}
                  defaultValue={service.description ?? ''}
                />
              </label>
            </div>
            <Button type="submit">{t('Common.actions.save')}</Button>
          </form>
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
          <span className="text-sm text-slate-600">{t('Services.detail.archiveHistory')}</span>
        </div>
      </section>

      <section
        aria-labelledby="pricing-title"
        className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm"
      >
        <div>
          <h2 id="pricing-title" className="text-xl font-semibold">
            {t('Services.pricing.title')}
          </h2>
          <p className="text-sm text-slate-600">{t('Services.pricing.description')}</p>
        </div>
        {query.updated === 'price' ? (
          <p
            role="status"
            className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
          >
            {t('Services.pricing.saved')}
          </p>
        ) : null}
        <form method="get" className="grid gap-3 rounded-md border p-4 md:grid-cols-4">
          <label className="grid gap-2">
            <Label htmlFor="priceOrganizationId">{t('Common.fields.organization')}</Label>
            <select
              id="priceOrganizationId"
              name="priceOrganizationId"
              className="h-10 rounded-md border bg-white px-3"
              defaultValue={priceOrganizationId ?? ''}
              required
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <Label htmlFor="priceFacilityId">{t('Common.fields.facility')}</Label>
            <select
              id="priceFacilityId"
              name="priceFacilityId"
              className="h-10 rounded-md border bg-white px-3"
              defaultValue={priceFacilityId ?? ''}
            >
              <option value="">{t('Services.pricing.organizationDefault')}</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.organizationName} — {facility.name}
                </option>
              ))}
            </select>
          </label>
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
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
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
                <span className="block text-slate-600">
                  {price.facilityId
                    ? (facilities.find((facility) => facility.id === price.facilityId)?.name ??
                      t('Services.pricing.facilityPrice'))
                    : t('Services.pricing.organizationDefault')}
                  {' · '}
                  {formatDate(price.validFrom, locale)} –{' '}
                  {formatDate(price.validUntil, locale) ?? t('Services.openEnded')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('Services.pricing.noneForDate')}</p>
        )}
        {canManagePricing ? (
          <form action={recordServicePriceAction} className="grid gap-4 border-t pt-4">
            <input type="hidden" name="serviceId" value={service.id} />
            <h3 className="font-semibold">{t('Services.pricing.addTitle')}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <Label htmlFor="newPriceOrganizationId">{t('Common.fields.organization')}</Label>
                <select
                  id="newPriceOrganizationId"
                  name="organizationId"
                  className="h-10 rounded-md border bg-white px-3"
                  defaultValue={priceOrganizationId ?? ''}
                  required
                >
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <Label htmlFor="newPriceFacilityId">{t('Common.fields.facility')}</Label>
                <select
                  id="newPriceFacilityId"
                  name="facilityId"
                  className="h-10 rounded-md border bg-white px-3"
                  defaultValue=""
                >
                  <option value="">{t('Services.pricing.organizationDefault')}</option>
                  {facilities.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.organizationName} — {facility.name}
                    </option>
                  ))}
                </select>
              </label>
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
                <select
                  id="pricingUnit"
                  name="pricingUnit"
                  className="h-10 rounded-md border bg-white px-3"
                  required
                >
                  <option value="hour">{t('Services.pricing.units.hour')}</option>
                  <option value="minute">{t('Services.pricing.units.minute')}</option>
                  <option value="visit">{t('Services.pricing.units.visit')}</option>
                  <option value="fixed">{t('Services.pricing.units.fixed')}</option>
                </select>
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
            <p className="text-sm text-slate-600">{t('Services.pricing.priceHistoryNote')}</p>
            <Button
              type="submit"
              className="w-fit"
              disabled={!organizations.length || service.status === 'archived'}
            >
              {t('Services.pricing.record')}
            </Button>
          </form>
        ) : null}
      </section>

      <section
        aria-labelledby="availability-title"
        className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm"
      >
        <div>
          <h2 id="availability-title" className="text-xl font-semibold">
            {t('Services.detail.organizationalAvailability')}
          </h2>
          <p className="text-sm text-slate-600">{t('Services.detail.availabilityDescription')}</p>
        </div>
        {availabilityResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
            {t('Services.detail.availabilityLoadFailed')}
          </p>
        ) : null}
        {canManageAvailability ? (
          <form action={setServiceAvailabilityAction} className="grid gap-4">
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
              {organizations.length ? (
                organizations.map((organization) => (
                  <label key={organization.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="organizationIds"
                      value={organization.id}
                      defaultChecked={selectedOrganizations.has(organization.id)}
                    />
                    {organization.name}
                  </label>
                ))
              ) : (
                <p className="text-sm text-slate-600">{t('Services.detail.noOrganizations')}</p>
              )}
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="font-medium">{t('Services.detail.facilities')}</legend>
              {facilities.length ? (
                facilities.map((facility) => (
                  <label key={facility.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="facilityIds"
                      value={facility.id}
                      defaultChecked={selectedFacilities.has(facility.id)}
                    />
                    {facility.organizationName} — {facility.name}
                  </label>
                ))
              ) : (
                <p className="text-sm text-slate-600">{t('Services.detail.noFacilities')}</p>
              )}
            </fieldset>
            <div>
              <Button type="submit" disabled={service.status === 'archived'}>
                {t('Services.detail.saveAvailability')}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-slate-600">{t('Services.detail.readAvailability')}</p>
        )}
        {activeAvailability.length ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('Services.detail.currentAssignments')}</caption>
              <thead className="border-b bg-slate-100">
                <tr>
                  <th className="px-3 py-2">{t('Services.detail.area')}</th>
                  <th className="px-3 py-2">{t('Services.form.validFrom')}</th>
                  <th className="px-3 py-2">{t('Services.form.validUntil')}</th>
                </tr>
              </thead>
              <tbody>
                {activeAvailability.map((item) => {
                  const facility = facilities.find((candidate) => candidate.id === item.facilityId);
                  const organization = organizations.find(
                    (candidate) => candidate.id === item.organizationId,
                  );
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {item.facilityId
                          ? (facility?.name ?? t('Services.detail.defaultFacility'))
                          : (organization?.name ?? t('Services.detail.defaultOrganization'))}
                        {item.facilityId
                          ? ` (${organization?.name ?? ''})`
                          : ` — ${t('Services.detail.allFacilities')}`}
                      </td>
                      <td className="px-3 py-2">{formatDate(item.validFrom, locale) ?? '—'}</td>
                      <td className="px-3 py-2">
                        {formatDate(item.validUntil, locale) ?? t('Services.openEnded')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t('Services.detail.noAvailability')}</p>
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
      <select
        id={id}
        name={name}
        className="h-10 rounded-md border bg-white px-3"
        defaultValue={defaultValue}
        required={required}
      >
        {children}
      </select>
    </div>
  );
}

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
