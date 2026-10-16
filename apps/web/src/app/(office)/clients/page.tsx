import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { FilterDisclosure } from '@app/web/components/filter-disclosure';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { formatDate } from '@app/web/i18n/format';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Card } from '@care/ui/components/card';
import { Input } from '@care/ui/components/input';
import { NativeSelect } from '@care/ui/components/native-select';
import { StatusBadge } from '@care/ui/components/status-badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@care/ui/components/table';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  organizationId?: string;
  facilityId?: string;
  pflegegrad?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: string;
  error?: string;
}>;
type ClientListItem = components['schemas']['ClientListItemResponseDto'];

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
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const parsedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(parsedPageSize) ? parsedPageSize : 20;
  const text = query.q?.trim().slice(0, 120) || undefined;

  const [api, header] = await Promise.all([getApiClient(), getTenantHeader()]);
  const get = api.GET;
  const [clientsResult, organizationResult, facilityResult, permissions] = await Promise.all([
    get('/api/v1/clients', {
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
          ...(pflegegrad ? { pflegegrad } : {}),
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
    getPermissionGrants(api),
  ]);
  const canCreateClient = hasPermission(permissions, 'client.create');
  const clientsErrorCode = (clientsResult.error as { code?: string } | undefined)?.code;
  const clients = clientsResult.data as unknown as
    | components['schemas']['ClientListResponseDto']
    | undefined;
  const selectedOrganization = organizationResult?.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult?.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  if (clients)
    redirectToValidPage('/clients', query, clients.page, clients.pageSize, clients.total);
  const filters = { q: text, status, organizationId, facilityId, pflegegrad, sortBy, sortOrder };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
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
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {query.error === 'INSUFFICIENT_PERMISSION'
            ? t('Clients.noAccess')
            : t('Clients.actionFailed')}
        </p>
      ) : null}
      {clientsResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {clientsErrorCode === 'INSUFFICIENT_PERMISSION'
            ? t('Clients.noAccess')
            : t('Clients.loadFailed')}
        </p>
      ) : null}

      <section aria-label={t('Clients.searchAndFilter')} className="grid min-w-0 grid-cols-1 gap-3">
        <FilterDisclosure title={t('Clients.searchAndFilter')}>
          <form method="get" className="grid min-w-0 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <input type="hidden" name="pageSize" value={pageSize} />
            <label className="grid min-w-0 gap-1 text-sm font-medium md:col-span-2">
              {t('Clients.searchName')}
              <Input type="search" name="q" maxLength={120} defaultValue={text} className="h-10" />
              <span className="text-xs font-normal text-muted-foreground">
                {t('Clients.searchFields')}
              </span>
            </label>
            <SelectFilter label={t('Common.fields.status')} name="status" value={status ?? ''}>
              <option value="">{t('Common.filters.allStatuses')}</option>
              <option value="pending">{t('Common.status.pending')}</option>
              <option value="active">{t('Common.status.active')}</option>
              <option value="archived">{t('Common.status.archived')}</option>
            </SelectFilter>
            <AsyncEntityCombobox
              name="organizationId"
              label={t('Common.fields.organization')}
              entity="organizations"
              browseOnEmpty
              className="h-10"
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
              browseOnEmpty
              className="h-10"
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
        </FilterDisclosure>
      </section>

      {clients?.items.length ? (
        <section aria-labelledby="client-list-title" className="grid min-w-0 grid-cols-1 gap-3">
          <h2 id="client-list-title" className="text-lg font-semibold">
            {t('Clients.resultCount', { count: clients.total })}
          </h2>
          <ul className="grid min-w-0 grid-cols-1 gap-2 lg:hidden">
            {clients.items.map((client) => (
              <li
                key={client.id}
                className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border bg-card p-4"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <Link
                    className="inline-flex min-h-11 min-w-0 items-center font-semibold break-words text-primary underline-offset-4 hover:underline"
                    href={`/clients/${client.id}`}
                  >
                    {client.preferredName || client.firstName} {client.lastName}
                  </Link>
                  <StatusBadge status={client.status} label={t(statusLabelKey(client.status))} />
                </div>
                <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t('Common.fields.dateOfBirth')}
                    </dt>
                    <dd className="mt-0.5 truncate">
                      {formatDate(client.dateOfBirth, locale) ?? '—'}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{t('Clients.careLevel')}</dt>
                    <dd className="mt-0.5 truncate">
                      {client.currentPflegegrad
                        ? t('Clients.careLevelNumber', { grade: client.currentPflegegrad })
                        : '—'}
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t('Clients.organizationFacility')}
                    </dt>
                    <dd className="mt-0.5 break-words">
                      <ClientProviderReferences
                        client={client}
                        unassigned={t('Common.empty.unassigned')}
                        organizationUnavailable={t('Resources.unavailableOrganization')}
                        facilityUnavailable={t('Resources.unavailableFacility')}
                      />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <Card className="hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
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
                          className="font-medium text-primary underline-offset-4 hover:underline"
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
                        <ClientProviderReferences
                          client={client}
                          unassigned={t('Common.empty.unassigned')}
                          organizationUnavailable={t('Resources.unavailableOrganization')}
                          facilityUnavailable={t('Resources.unavailableFacility')}
                        />
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
            </div>
          </Card>
          <DataPagination
            pathname="/clients"
            page={clients.page}
            pageSize={clients.pageSize}
            totalItems={clients.total}
            filters={filters}
          />
        </section>
      ) : !clientsResult.error ? (
        <div className="grid justify-items-center gap-3">
          <EmptyState title={t('Clients.notFound')} />
          <Button asChild variant="secondary">
            <Link href="/clients">{t('Common.actions.reset')}</Link>
          </Button>
        </div>
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
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 font-normal text-foreground"
        name={name}
        defaultValue={value}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

function ClientProviderReferences({
  client,
  unassigned,
  organizationUnavailable,
  facilityUnavailable,
}: Readonly<{
  client: ClientListItem;
  unassigned: string;
  organizationUnavailable: string;
  facilityUnavailable: string;
}>) {
  return (
    <>
      <ResourceReference
        label={
          client.organizationId ? (client.organizationName ?? organizationUnavailable) : unassigned
        }
        href={
          client.organizationId && client.organizationName
            ? `/administration/organizations/${client.organizationId}`
            : null
        }
      />{' '}
      /{' '}
      <ResourceReference
        label={client.primaryFacilityId ? (client.facilityName ?? facilityUnavailable) : unassigned}
        href={
          client.primaryFacilityId && client.facilityName
            ? `/administration/facilities/${client.primaryFacilityId}`
            : null
        }
      />
    </>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}
