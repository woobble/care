import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, StatusBadge } from '@care/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { statusLabelKey } from '@app/web/i18n/status';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  page?: string;
  sortBy?: string;
  sortOrder?: string;
  error?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function EmployeesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
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
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const text = query.q?.trim().slice(0, 120) || undefined;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [employeesResult, organizationsResult, facilitiesResult, teamsResult] = await Promise.all([
    get('/api/v1/employees', {
      params: {
        query: {
          page,
          pageSize: 25,
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
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/teams', { params: { header } }),
  ]);
  const employees = employeesResult.data;
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
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Errors.generic')}
        </p>
      ) : null}
      {employeesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Employees.loadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="employee-filter-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="employee-filter-title" className="text-lg font-semibold">
          {t('Employees.searchAndFilter')}
        </h2>
        <form method="get" className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
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
          <SelectFilter
            name="organizationId"
            label={t('Common.fields.organization')}
            value={organizationId ?? ''}
          >
            <option value="">{t('Common.filters.allOrganizations')}</option>
            {(organizationsResult.data ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter
            name="facilityId"
            label={t('Common.fields.facility')}
            value={facilityId ?? ''}
          >
            <option value="">{t('Common.filters.allFacilities')}</option>
            {(facilitiesResult.data ?? []).map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.organizationName} — {facility.name}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter name="teamId" label={t('Common.fields.team')} value={teamId ?? ''}>
            <option value="">{t('Common.filters.allTeams')}</option>
            {(teamsResult.data ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.organizationName} — {team.name}
              </option>
            ))}
          </SelectFilter>
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
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{t('Employees.listCaption')}</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t('Common.fields.name')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Common.fields.organization')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Employees.personnelNumber')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.items.map((employee) => (
                  <tr key={employee.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-900 underline-offset-4 hover:underline"
                        href={`/employees/${employee.id}`}
                      >
                        {employee.preferredName || employee.firstName} {employee.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{employee.organizationName ?? '—'}</td>
                    <td className="px-4 py-3">{employee.personnelNumber ?? '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={employee.status}
                        label={t(statusLabelKey(employee.status))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {t('Common.pagination', {
                page: new Intl.NumberFormat(locale).format(employees.page),
                pages: new Intl.NumberFormat(locale).format(
                  Math.max(1, Math.ceil(employees.total / employees.pageSize)),
                ),
              })}
            </p>
            <div className="flex gap-2">
              {employees.page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, employees.page - 1)}>
                    {t('Common.actions.previous')}
                  </Link>
                </Button>
              ) : null}
              {employees.page * employees.pageSize < employees.total ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, employees.page + 1)}>
                    {t('Common.actions.next')}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : !employeesResult.error ? (
        <p className="rounded-lg border bg-white p-6 text-slate-700">{t('Employees.notFound')}</p>
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
      <select className="h-10 rounded-md border bg-white px-3" name={name} defaultValue={value}>
        {children}
      </select>
    </label>
  );
}

function pageHref(filters: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
  params.set('page', String(page));
  return `/employees?${params.toString()}`;
}
