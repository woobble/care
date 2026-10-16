import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createFacilityAction } from '@app/web/app/(office)/administration/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { searchStructurePage } from '@app/web/lib/structure-search';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
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

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  organizationId?: string;
  q?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}>;

export default async function FacilitiesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const permissions = await getPermissionGrants(api);
  const organizationId =
    query.organizationId && /^[0-9a-f-]{36}$/i.test(query.organizationId)
      ? query.organizationId
      : undefined;
  const search = query.q?.trim().slice(0, 120) ?? '';
  const status =
    query.status === 'active' || query.status === 'archived' ? query.status : undefined;
  const parsedPage = Number(query.page);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const parsedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(parsedPageSize) ? parsedPageSize : 20;
  const [organizationResult, facilitiesResult] = await Promise.all([
    organizationId &&
    hasClientPermission(
      permissions,
      'organization.read',
      header['X-Tenant-Id'],
      organizationId,
      null,
    )
      ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    searchStructurePage<components['schemas']['FacilityResponseDto']>('facilities', {
      page,
      pageSize,
      ...(search ? { q: search } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(status ? { status } : {}),
    }),
  ]);
  if (!facilitiesResult.failed)
    redirectToValidPage(
      '/administration/facilities',
      query,
      page,
      pageSize,
      facilitiesResult.total,
    );
  const selectedOrganization = organizationResult.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const tenantId = header['X-Tenant-Id'];

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href="/administration/organizations">{t('Facilities.section')}</Link>}
        title={t('Facilities.title')}
      />
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationResult.error || facilitiesResult.failed ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('Facilities.loadFailed')}
        </p>
      ) : null}
      <section
        aria-labelledby="facility-create-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="facility-create-title" className="text-xl font-semibold">
          {t('Facilities.createTitle')}
        </h2>
        <RHFActionForm action={createFacilityAction} className="grid gap-4 md:grid-cols-2">
          <AsyncEntityCombobox
            name="organizationId"
            label={t('Facilities.organization')}
            entity="organizations"
            required
            placeholder={t('Facilities.selectOrganization')}
          />
          <Field id="name" name="name" label={t('Common.fields.name')} required maxLength={160} />
          <Field id="code" name="code" label={t('Common.fields.code')} maxLength={40} />
          <Field
            id="email"
            name="email"
            label={t('Common.fields.email')}
            type="email"
            maxLength={320}
          />
          <Field
            id="phone"
            name="phone"
            label={t('Common.fields.phone')}
            type="tel"
            maxLength={40}
          />
          <Field id="address" name="address" label={t('Common.fields.address')} maxLength={500} />
          <Field
            id="timezone"
            name="timezone"
            label={t('Facilities.timezoneLabel')}
            maxLength={100}
          />
          <p className="text-sm text-muted-foreground md:col-span-2">
            {t('Facilities.timezoneHint')}
          </p>
          <div className="md:col-span-2">
            <Button type="submit">{t('Facilities.createTitle')}</Button>
          </div>
        </RHFActionForm>
      </section>
      <section aria-labelledby="facility-list-title" className="grid gap-3">
        <h2 id="facility-list-title" className="text-xl font-semibold">
          {t('Facilities.listTitle')}
        </h2>
        <form
          method="get"
          className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="pageSize" value={pageSize} />
          <label className="grid gap-1 text-sm">
            <span>{t('Facilities.listTitle')}</span>
            <Input type="search" name="q" maxLength={120} defaultValue={search} />
          </label>
          <label className="grid gap-1 text-sm">
            {t('Common.fields.status')}
            <select
              name="status"
              defaultValue={status ?? ''}
              className="h-10 rounded-md border bg-card px-3"
            >
              <option value="">{t('Common.filters.allStatuses')}</option>
              <option value="active">{t('Common.status.active')}</option>
              <option value="archived">{t('Common.status.archived')}</option>
            </select>
          </label>
          {hasPermission(permissions, 'organization.read') ? (
            <AsyncEntityCombobox
              name="organizationId"
              label={t('Facilities.organization')}
              entity="organizations"
              placeholder={t('Common.actions.apply')}
              {...(selectedOrganization
                ? {
                    initialOption: {
                      id: selectedOrganization.id,
                      label: selectedOrganization.name,
                    },
                  }
                : {})}
            />
          ) : null}
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              {t('Common.actions.apply')}
            </Button>
          </div>
        </form>
        {!facilitiesResult.failed && facilitiesResult.items.length ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Facilities.listCaption')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Facilities.facility')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Facilities.organizationField')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {facilitiesResult.items.map((facility) => (
                  <ShadcnTableRow key={facility.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3">
                      <Link
                        className="font-medium text-primary underline"
                        href={`/administration/facilities/${facility.id}`}
                      >
                        {facility.name}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <ResourceReference
                        label={
                          hasClientPermission(
                            permissions,
                            'organization.read',
                            tenantId,
                            facility.organizationId,
                            null,
                          )
                            ? facility.organizationName
                            : t('Resources.unavailableOrganization')
                        }
                        href={
                          hasClientPermission(
                            permissions,
                            'organization.read',
                            tenantId,
                            facility.organizationId,
                            null,
                          )
                            ? `/administration/organizations/${facility.organizationId}`
                            : null
                        }
                      />
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <StatusBadge
                        status={facility.status}
                        label={t(statusLabelKey(facility.status))}
                      />
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : facilitiesResult.failed ? null : (
          <EmptyState title={t('Facilities.empty')} />
        )}
        {!facilitiesResult.failed ? (
          <DataPagination
            pathname="/administration/facilities"
            page={facilitiesResult.page}
            pageSize={facilitiesResult.pageSize}
            totalItems={facilitiesResult.total}
            filters={{ q: search, organizationId, status }}
          />
        ) : null}
      </section>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength: number;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} maxLength={maxLength} required={required} />
    </div>
  );
}
