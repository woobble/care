import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui';
import { NativeSelect } from '@care/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, StatusBadge } from '@care/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { statusLabelKey } from '@app/web/i18n/status';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import type { components } from '@care/api-client';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: string;
  error?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function EmployeesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const t = await getTranslations();
  const query = await searchParams;
  const status = ['active', 'inactive', 'archived'].includes(query.status ?? '')
    ? (query.status as 'active' | 'inactive' | 'archived')
    : undefined;
  const organizationId =
    query.organizationId && uuidPattern.test(query.organizationId)
      ? query.organizationId
      : undefined;
  const facilityId =
    query.facilityId && uuidPattern.test(query.facilityId) ? query.facilityId : undefined;
  const teamId = query.teamId && uuidPattern.test(query.teamId) ? query.teamId : undefined;
  const sortBy = ['lastName', 'firstName', 'createdAt'].includes(query.sortBy ?? '')
    ? (query.sortBy as 'lastName' | 'firstName' | 'createdAt')
    : 'lastName';
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
  const parsedPage = Number(query.page ?? '1');
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const parsedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(parsedPageSize) ? parsedPageSize : 20;
  const text = query.q?.trim().slice(0, 120) || undefined;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [employeesResult, organizationResult, facilityResult, teamResult] = await Promise.all([
    get('/api/v1/employees', {
      params: {
        query: {
          page,
          pageSize,
          sortBy,
          sortOrder,
          ...(text ? { q: text } : {}),
          ...(status ? { status } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(teamId ? { teamId } : {}),
        },
        header,
      },
    }),
    organizationId
      ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve(null),
    facilityId
      ? get('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve(null),
    teamId
      ? get('/api/v1/teams/{id}', { params: { path: { id: teamId }, header } })
      : Promise.resolve(null),
  ]);
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const employees = employeesResult.data as unknown as
    | components['schemas']['EmployeeListResponseDto']
    | undefined;
  const selectedOrganization = organizationResult?.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult?.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedTeam = teamResult?.data as components['schemas']['TeamResponseDto'] | undefined;
  if (employees)
    redirectToValidPage('/employees', query, employees.page, employees.pageSize, employees.total);
  const filters = { q: text, status, organizationId, facilityId, teamId, sortBy, sortOrder };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('Employees.section')}
        title={t('Employees.title')}
        actions={
          <Button asChild>
            <Link href="/employees/new">{t('Employees.create')}</Link>
          </Button>
        }
      />
      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('Errors.generic')}
        </p>
      ) : null}
      {employeesResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('Employees.loadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="employee-filter-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="employee-filter-title" className="text-lg font-semibold">
          {t('Employees.searchAndFilter')}
        </h2>
        <form method="get" className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <input type="hidden" name="pageSize" value={pageSize} />
          <label className="grid gap-1 text-sm">
            {t('Employees.searchNameOrNumber')}
            <input
              className="h-10 rounded-md border px-3"
              name="q"
              defaultValue={text ?? ''}
              maxLength={120}
            />
          </label>
          <SelectFilter name="status" label={t('Common.fields.status')} value={status ?? ''}>
            <option value="">{t('Common.filters.allStatuses')}</option>
            <option value="active">{t('Common.status.active')}</option>
            <option value="inactive">{t('Common.status.inactive')}</option>
            <option value="archived">{t('Common.status.archived')}</option>
          </SelectFilter>
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
          <AsyncEntityCombobox
            name="teamId"
            label={t('Common.fields.team')}
            entity="teams"
            {...(organizationId ? { organizationId } : {})}
            placeholder={t('Common.filters.allTeams')}
            {...(selectedTeam
              ? {
                  initialOption: {
                    id: selectedTeam.id,
                    label: `${selectedTeam.organizationName} · ${selectedTeam.name}`,
                  },
                }
              : {})}
          />
          <SelectFilter name="sortBy" label={t('Common.fields.sortBy')} value={sortBy}>
            <option value="lastName">{t('Common.fields.lastName')}</option>
            <option value="firstName">{t('Common.fields.firstName')}</option>
            <option value="createdAt">{t('Common.fields.created')}</option>
          </SelectFilter>
          <SelectFilter name="sortOrder" label={t('Common.fields.order')} value={sortOrder}>
            <option value="asc">{t('Common.filters.ascending')}</option>
            <option value="desc">{t('Common.filters.descending')}</option>
          </SelectFilter>
          <div className="flex items-end">
            <Button type="submit">{t('Common.actions.apply')}</Button>
          </div>
        </form>
      </section>

      {employees?.items.length ? (
        <section aria-labelledby="employee-list-title" className="grid gap-3">
          <h2 id="employee-list-title" className="text-lg font-semibold">
            {t('Employees.resultCount', { count: employees.total })}
          </h2>
          <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Employees.listCaption')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.name')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.organization')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Employees.personnelNumber')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {employees.items.map((employee) => (
                  <ShadcnTableRow key={employee.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        href={`/employees/${employee.id}`}
                      >
                        {employee.preferredName || employee.firstName} {employee.lastName}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {employee.organizationName ? (
                        <ResourceReference
                          label={employee.organizationName}
                          href={
                            employee.organizationId &&
                            hasClientPermission(
                              permissions,
                              'organization.read',
                              tenantId,
                              employee.organizationId,
                              null,
                            )
                              ? `/administration/organizations/${employee.organizationId}`
                              : null
                          }
                        />
                      ) : (
                        '—'
                      )}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {employee.personnelNumber ?? '—'}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <StatusBadge
                        status={employee.status}
                        label={t(statusLabelKey(employee.status))}
                      />
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
          <DataPagination
            pathname="/employees"
            page={employees.page}
            pageSize={employees.pageSize}
            totalItems={employees.total}
            filters={filters}
          />
        </section>
      ) : !employeesResult.error ? (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">
          {t('Employees.notFound')}
        </p>
      ) : null}
    </div>
  );
}

function SelectFilter({
  name,
  label,
  value,
  children,
}: Readonly<{ name: string; label: string; value: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-card px-3"
        name={name}
        defaultValue={value}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
