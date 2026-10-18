import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { formatDate, formatNumber } from '@app/web/i18n/format';
import { statusLabelKey, unitLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasTenantPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
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

import {
  archiveServiceCategoryAction,
  createServiceCategoryAction,
  updateServiceCategoryAction,
} from './actions';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
  categoryId?: string;
  organizationId?: string;
  facilityId?: string;
  validAt?: string;
  page?: string;
  pageSize?: string;
  error?: string;
  updated?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export default async function ServicesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 120) || undefined;
  const status =
    query.status === 'all' ? 'all' : query.status === 'archived' ? 'archived' : 'active';
  const sortBy = ['name', 'category', 'status', 'code'].includes(query.sortBy ?? '')
    ? (query.sortBy as 'name' | 'category' | 'status' | 'code')
    : 'code';
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
  const categoryId = validUuid(query.categoryId);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const validAt = query.validAt && datePattern.test(query.validAt) ? query.validAt : today();
  const pageNumber = Number(query.page);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, 100_000) : 1;
  const pageSizeNumber = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(pageSizeNumber) ? pageSizeNumber : 20;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canCreateService = hasTenantPermission(permissions, 'service.create', tenantId);
  const canManageCategories = hasTenantPermission(
    permissions,
    'service.manage_categories',
    tenantId,
  );
  const get = api.GET;
  const [servicesResult, categoriesResult, organizationResult, facilityResult] = await Promise.all([
    get('/api/v1/services', {
      params: {
        query: {
          page,
          pageSize,
          status,
          sortBy,
          sortOrder,
          validAt,
          ...(q ? { q } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
        },
        header,
      },
    }),
    get('/api/v1/service-categories', { params: { query: { includeArchived: true }, header } }),
    organizationId
      ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve(null),
    facilityId
      ? get('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve(null),
  ]);
  const services = servicesResult.data as unknown as
    | components['schemas']['ServiceListResponseDto']
    | undefined;
  if (services)
    redirectToValidPage('/services', query, services.page, services.pageSize, services.total);
  const categories =
    (categoriesResult.data as unknown as
      | components['schemas']['ServiceCategoryResponseDto'][]
      | undefined) ?? [];
  const selectedOrganization = organizationResult?.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult?.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const filters = { q, status, categoryId, organizationId, facilityId, validAt, sortBy, sortOrder };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('Services.section')}
        title={t('Services.catalogTitle')}
        description={t('Services.catalogDescription')}
        actions={
          canCreateService ? (
            <Button asChild>
              <Link href="/services/new">{t('Services.create')}</Link>
            </Button>
          ) : undefined
        }
      />

      <ActionNotice error={query.error} updated={query.updated} />
      {servicesResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('Errors.generic')}
        </p>
      ) : null}

      <section aria-labelledby="service-search-title" className="grid gap-3">
        <h2 id="service-search-title" className="text-lg font-semibold">
          {t('Services.searchAndFilter')}
        </h2>
        <form
          method="get"
          className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-3 lg:grid-cols-4"
        >
          <input type="hidden" name="pageSize" value={pageSize} />
          <Field label={t('Services.searchText')} name="q" defaultValue={q ?? ''} maxLength={120} />
          <SelectField label={t('Common.fields.status')} name="status" defaultValue={status}>
            <option value="all">{t('Common.filters.allStatuses')}</option>
            <option value="active">{t('Common.status.active')}</option>
            <option value="archived">{t('Common.status.archived')}</option>
          </SelectField>
          <SelectField label={t('Services.sortBy')} name="sortBy" defaultValue={sortBy}>
            <option value="name">{t('Services.name')}</option>
            <option value="category">{t('Services.category')}</option>
            <option value="status">{t('Common.fields.status')}</option>
            <option value="code">{t('Services.code')}</option>
          </SelectField>
          <SelectField label={t('Common.fields.order')} name="sortOrder" defaultValue={sortOrder}>
            <option value="asc">{t('Common.filters.ascending')}</option>
            <option value="desc">{t('Common.filters.descending')}</option>
          </SelectField>
          <SelectField
            label={t('Services.category')}
            name="categoryId"
            defaultValue={categoryId ?? ''}
          >
            <option value="">{t('Services.allCategories')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <AsyncEntityCombobox
            name="organizationId"
            label={t('Common.fields.organization')}
            entity="organizations"
            placeholder={t('Common.filters.allOrganizations')}
            {...(selectedOrganization
              ? {
                  initialOption: {
                    id: selectedOrganization.id,
                    label: selectedOrganization.name,
                  },
                }
              : {})}
          />
          <AsyncEntityCombobox
            name="facilityId"
            label={t('Common.fields.facility')}
            entity="facilities"
            {...(organizationId ? { organizationId } : {})}
            placeholder={t('Common.filters.allFacilities')}
            {...(selectedFacility
              ? {
                  initialOption: {
                    id: selectedFacility.id,
                    label: `${selectedFacility.organizationName} · ${selectedFacility.name}`,
                  },
                }
              : {})}
          />
          <Field label={t('Services.validOn')} name="validAt" type="date" defaultValue={validAt} />
          <div className="flex items-end gap-2">
            <Button type="submit">{t('Common.actions.apply')}</Button>
            <Button asChild variant="secondary">
              <Link href="/services">{t('Common.actions.reset')}</Link>
            </Button>
          </div>
        </form>
      </section>

      {services?.items.length ? (
        <section aria-labelledby="service-list-title" className="grid gap-3">
          <h2 id="service-list-title" className="text-lg font-semibold">
            {t('Services.resultCount', { count: services.total })}
          </h2>
          <ul className="grid gap-3 lg:hidden" aria-label={t('Services.listCaption')}>
            {services.items.map((service) => (
              <li key={service.id} className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <Link
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                      href={`/services/${service.id}`}
                    >
                      {service.name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">{service.code}</span>
                  </div>
                  <StatusBadge status={service.status} label={t(statusLabelKey(service.status))} />
                </div>
                {service.description ? (
                  <p className="text-sm text-muted-foreground">{service.description}</p>
                ) : null}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{t('Services.category')}</dt>
                    <dd>{service.categoryName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('Services.unit')}</dt>
                    <dd>{t(unitLabelKey(service.unit))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('Services.availability')}</dt>
                    <dd>{formatNumber(service.availabilityCount, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('Services.validity')}</dt>
                    <dd>
                      {formatDate(service.validFrom, locale)} –{' '}
                      {formatDate(service.validUntil, locale) ?? t('Services.openEnded')}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border bg-card shadow-sm lg:block">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Services.listCaption')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.code')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.name')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.category')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.unit')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.duration')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.availability')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Services.validity')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {services.items.map((service) => (
                  <ShadcnTableRow key={service.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3 font-mono text-xs">
                      {service.code}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        href={`/services/${service.id}`}
                      >
                        {service.name}
                      </Link>
                      {service.description ? (
                        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                          {service.description}
                        </p>
                      ) : null}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">{service.categoryName}</ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {t(unitLabelKey(service.unit))}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {service.defaultDurationMinutes
                        ? t('Common.units.minutes', { count: service.defaultDurationMinutes })
                        : '—'}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {formatNumber(service.availabilityCount, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {formatDate(service.validFrom, locale)} –{' '}
                      {formatDate(service.validUntil, locale) ?? t('Services.openEnded')}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <StatusBadge
                        status={service.status}
                        label={t(statusLabelKey(service.status))}
                      />
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
          <DataPagination
            pathname="/services"
            page={services.page}
            pageSize={services.pageSize}
            totalItems={services.total}
            filters={filters}
          />
        </section>
      ) : !servicesResult.error ? (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">
          {t('Services.noResults')}
        </p>
      ) : null}

      <section
        aria-labelledby="service-categories-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <div>
          <h2 id="service-categories-title" className="text-xl font-semibold">
            {t('Services.categories')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Services.categoriesDescription')}</p>
        </div>
        {canManageCategories ? (
          <RHFActionForm
            action={createServiceCategoryAction}
            className="grid gap-3 rounded-md bg-background p-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <Field label={t('Common.fields.name')} name="name" required maxLength={120} />
            <Field label={t('Services.optionalCode')} name="code" maxLength={40} />
            <Field
              label={t('Services.optionalSortOrder')}
              name="sortOrder"
              type="number"
              min={0}
              max={10000}
            />
            <Field label={t('Services.optionalDescription')} name="description" maxLength={1000} />
            <div className="md:col-span-4">
              <Button type="submit">{t('Services.categoryCreate')}</Button>
            </div>
          </RHFActionForm>
        ) : null}
        {categories.length ? (
          <ul className="grid gap-3">
            {categories.map((category) => (
              <li key={category.id} className="grid gap-3 rounded-md border p-4">
                {canManageCategories ? (
                  <>
                    <RHFActionForm
                      action={updateServiceCategoryAction}
                      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                    >
                      <input type="hidden" name="categoryId" value={category.id} />
                      <Field
                        label={t('Common.fields.name')}
                        name="name"
                        defaultValue={category.name}
                        required
                        maxLength={120}
                      />
                      <Field
                        label={t('Services.code')}
                        name="code"
                        defaultValue={category.code ?? ''}
                        maxLength={40}
                      />
                      <Field
                        label={t('Services.sortOrder')}
                        name="sortOrder"
                        type="number"
                        min={0}
                        max={10000}
                        defaultValue={category.sortOrder?.toString() ?? ''}
                      />
                      <Field
                        label={t('Common.fields.description')}
                        name="description"
                        defaultValue={category.description ?? ''}
                        maxLength={1000}
                      />
                      <div className="flex items-center gap-3 md:col-span-4">
                        <StatusBadge
                          status={category.status}
                          label={t(statusLabelKey(category.status))}
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          {t('Services.categorySave')}
                        </Button>
                      </div>
                    </RHFActionForm>
                    {category.status === 'active' ? (
                      <form action={archiveServiceCategoryAction}>
                        <input type="hidden" name="categoryId" value={category.id} />
                        <Button type="submit" size="sm" variant="link">
                          {t('Services.categoryArchive')}
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{category.name}</h3>
                      {category.description ? (
                        <p className="text-sm text-muted-foreground">{category.description}</p>
                      ) : null}
                    </div>
                    <StatusBadge
                      status={category.status}
                      label={t(statusLabelKey(category.status))}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : categoriesResult.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('Services.categoryLoadFailed')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Services.noCategories')}</p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  maxLength,
  required,
  min,
  max,
}: Readonly<{
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  required?: boolean;
  min?: number;
  max?: number;
}>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-md border bg-card px-3 font-normal"
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        min={min}
        max={max}
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  children,
}: Readonly<{ label: string; name: string; defaultValue: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-card px-3 font-normal"
        name={name}
        defaultValue={defaultValue}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
