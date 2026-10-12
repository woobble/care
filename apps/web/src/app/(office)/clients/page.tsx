import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  Button,
  Card,
  Input,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@care/ui';
import { formatDate } from '@app/web/i18n/format';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  organizationId?: string;
  facilityId?: string;
  pflegegrad?: string;
  page?: string;
  sortBy?: string;
  sortOrder?: string;
  error?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ClientsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const query = await searchParams;
  const status = ['pending', 'active', 'archived'].includes(query.status ?? '')
    ? (query.status as 'pending' | 'active' | 'archived')
    : undefined;
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const parsedGrade = Number(query.pflegegrad);
  const pflegegrad =
    Number.isInteger(parsedGrade) && parsedGrade >= 1 && parsedGrade <= 5 ? parsedGrade : undefined;
  const sortBy = ['lastName', 'firstName', 'createdAt', 'dateOfBirth'].includes(query.sortBy ?? '')
    ? (query.sortBy as 'lastName' | 'firstName' | 'createdAt' | 'dateOfBirth')
    : 'lastName';
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
  const parsedPage = Number(query.page ?? '1');
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const text = query.q?.trim().slice(0, 120) || undefined;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canCreateClient = hasPermission(permissions, 'client.create');
  const get = api.GET;
  const [clientsResult, organizationsResult, facilitiesResult] = await Promise.all([
    get('/api/v1/clients', {
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
          ...(pflegegrad ? { pflegegrad } : {}),
        },
        header,
      },
    }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  const clients = clientsResult.data;
  const filters = { q: text, status, organizationId, facilityId, pflegegrad, sortBy, sortOrder };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('Clients.section')}
        title={t('Clients.title')}
        actions={
          canCreateClient ? (
            <Button asChild>
              <Link href="/clients/new">{t('Clients.create')}</Link>
            </Button>
          ) : null
        }
      />
      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Clients.actionFailed')}
        </p>
      ) : null}
      {clientsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Clients.loadFailed')}
        </p>
      ) : null}

      <section aria-labelledby="client-filter-title" className="grid gap-3">
        <h2 id="client-filter-title" className="text-lg font-semibold">
          {t('Clients.searchAndFilter')}
        </h2>
        <Card>
          <form method="get" className="grid gap-3 p-4 md:grid-cols-4">
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              {t('Clients.searchName')}
              <Input type="search" name="q" maxLength={120} defaultValue={text} />
            </label>
            <SelectFilter label={t('Common.fields.status')} name="status" value={status ?? ''}>
              <option value="">{t('Common.filters.allStatuses')}</option>
              <option value="pending">{t('Common.status.pending')}</option>
              <option value="active">{t('Common.status.active')}</option>
              <option value="archived">{t('Common.status.archived')}</option>
            </SelectFilter>
            <SelectFilter
              label={t('Common.fields.organization')}
              name="organizationId"
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
              label={t('Common.fields.facility')}
              name="facilityId"
              value={facilityId ?? ''}
            >
              <option value="">{t('Common.filters.allFacilities')}</option>
              {(facilitiesResult.data ?? []).map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </SelectFilter>
            <SelectFilter
              label={t('Clients.careLevel')}
              name="pflegegrad"
              value={pflegegrad?.toString() ?? ''}
            >
              <option value="">{t('Clients.allCareLevels')}</option>
              {[1, 2, 3, 4, 5].map((grade) => (
                <option key={grade} value={grade}>
                  {t('Clients.careLevelNumber', { grade })}
                </option>
              ))}
            </SelectFilter>
            <SelectFilter label={t('Common.fields.sortBy')} name="sortBy" value={sortBy}>
              <option value="lastName">{t('Common.fields.lastName')}</option>
              <option value="firstName">{t('Common.fields.firstName')}</option>
              <option value="createdAt">{t('Common.fields.created')}</option>
              <option value="dateOfBirth">{t('Common.fields.dateOfBirth')}</option>
            </SelectFilter>
            <SelectFilter label={t('Common.fields.order')} name="sortOrder" value={sortOrder}>
              <option value="asc">{t('Common.filters.ascending')}</option>
              <option value="desc">{t('Common.filters.descending')}</option>
            </SelectFilter>
            <div className="flex items-end gap-2">
              <Button type="submit">{t('Common.actions.apply')}</Button>
              <Button asChild variant="secondary">
                <Link href="/clients">{t('Common.actions.reset')}</Link>
              </Button>
            </div>
          </form>
        </Card>
      </section>

      {clients?.items.length ? (
        <section aria-labelledby="client-list-title" className="grid gap-3">
          <h2 id="client-list-title" className="text-lg font-semibold">
            {t('Clients.resultCount', { count: clients.total })}
          </h2>
          <Card className="overflow-hidden">
            <Table className="min-w-[720px] text-left">
              <TableCaption className="sr-only">{t('Clients.listCaption')}</TableCaption>
              <TableHeader className="bg-muted text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">{t('Common.fields.name')}</TableHead>
                  <TableHead scope="col">{t('Common.fields.dateOfBirth')}</TableHead>
                  <TableHead scope="col">{t('Clients.careLevel')}</TableHead>
                  <TableHead scope="col">{t('Clients.organizationFacility')}</TableHead>
                  <TableHead scope="col">{t('Common.fields.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.items.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-blue-900 underline-offset-4 hover:underline"
                        href={`/clients/${client.id}`}
                      >
                        {client.preferredName || client.firstName} {client.lastName}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(client.dateOfBirth, locale) ?? '—'}</TableCell>
                    <TableCell>
                      {client.currentPflegegrad
                        ? t('Clients.careLevelNumber', { grade: client.currentPflegegrad })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {client.organizationName && client.facilityName ? (
                        <>
                          {client.organizationName} / {client.facilityName}
                        </>
                      ) : (
                        <span className="font-medium text-amber-800">
                          {t('Common.empty.unassigned')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={client.status}
                        label={t(statusLabelKey(client.status))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {t('Common.pagination', {
                page: new Intl.NumberFormat(locale).format(clients.page),
                pages: new Intl.NumberFormat(locale).format(
                  Math.max(1, Math.ceil(clients.total / clients.pageSize)),
                ),
              })}
            </p>
            <div className="flex gap-2">
              {clients.page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, clients.page - 1)}>
                    {t('Common.actions.previous')}
                  </Link>
                </Button>
              ) : null}
              {clients.page * clients.pageSize < clients.total ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, clients.page + 1)}>{t('Common.actions.next')}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : !clientsResult.error ? (
        <EmptyState title={t('Clients.notFound')} />
      ) : null}
    </div>
  );
}

function SelectFilter({
  label,
  name,
  value,
  children,
}: Readonly<{
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="h-11 rounded-md border border-input bg-background px-3 font-normal text-foreground"
        name={name}
        defaultValue={value}
      >
        {children}
      </select>
    </label>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function pageHref(filters: Record<string, string | number | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `/clients?${params.toString()}`;
}
