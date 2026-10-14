import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui/components/table';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { searchStructurePage } from '@app/web/lib/structure-search';
import type { components } from '@care/api-client';
import { ResourceReference } from '@app/web/components/resource-reference';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { StatusBadge } from '@care/ui/components/status-badge';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createTeamAction } from '@app/web/app/(office)/administration/actions';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  organizationId?: string;
  facilityId?: string;
  q?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}>;

export default async function TeamsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const search = query.q?.trim().slice(0, 120) ?? '';
  const status =
    query.status === 'active' || query.status === 'archived' ? query.status : undefined;
  const parsedPage = Number(query.page);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const parsedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(parsedPageSize) ? parsedPageSize : 20;
  const [organizationResult, facilityResult, teamsResult] = await Promise.all([
    organizationId &&
    hasClientPermission(permissions, 'organization.read', tenantId, organizationId, null)
      ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    facilityId &&
    hasClientPermission(permissions, 'facility.read', tenantId, organizationId ?? null, facilityId)
      ? get('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    searchStructurePage<components['schemas']['TeamResponseDto']>('teams', {
      page,
      pageSize,
      ...(search ? { q: search } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(facilityId ? { facilityId } : {}),
      ...(status ? { status } : {}),
    }),
  ]);
  if (!teamsResult.failed)
    redirectToValidPage('/administration/teams', query, page, pageSize, teamsResult.total);
  const selectedOrganization = organizationResult.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href="/administration/organizations">{t('Teams.section')}</Link>}
        title={t('Teams.title')}
      />
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationResult.error || facilityResult.error || teamsResult.failed ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('Teams.loadFailed')}
        </p>
      ) : null}
      <section
        aria-labelledby="team-create-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="team-create-title" className="text-xl font-semibold">
          {t('Teams.createTitle')}
        </h2>
        <RHFActionForm action={createTeamAction} className="grid gap-4 md:grid-cols-3">
          <AsyncEntityCombobox
            name="organizationId"
            label={t('Teams.organization')}
            entity="organizations"
            required
            placeholder={t('Teams.selectOrganization')}
            {...(selectedOrganization
              ? { initialOption: { id: selectedOrganization.id, label: selectedOrganization.name } }
              : {})}
          />
          <AsyncEntityCombobox
            name="facilityId"
            label={t('Teams.facilityOptional')}
            entity="facilities"
            {...(organizationId ? { organizationId } : {})}
            placeholder={t('Teams.organizationWide')}
            {...(selectedFacility
              ? {
                  initialOption: {
                    id: selectedFacility.id,
                    label: `${selectedFacility.organizationName} · ${selectedFacility.name}`,
                  },
                }
              : {})}
          />
          <div className="grid gap-2">
            <Label htmlFor="name">{t('Teams.name')}</Label>
            <Input id="name" name="name" required maxLength={160} />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">{t('Teams.createTitle')}</Button>
          </div>
        </RHFActionForm>
      </section>
      <section aria-labelledby="team-list-title" className="grid gap-3">
        <h2 id="team-list-title" className="text-xl font-semibold">
          {t('Teams.listTitle')}
        </h2>
        <form
          method="get"
          className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"
        >
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="pageSize" value={pageSize} />
          <label className="grid gap-1 text-sm">
            <span>{t('Teams.listTitle')}</span>
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
              label={t('Teams.organization')}
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
          {hasPermission(permissions, 'facility.read') ? (
            <AsyncEntityCombobox
              name="facilityId"
              label={t('Teams.facilityOptional')}
              entity="facilities"
              {...(organizationId ? { organizationId } : {})}
              placeholder={t('Teams.organizationWide')}
              {...(selectedFacility
                ? {
                    initialOption: {
                      id: selectedFacility.id,
                      label: `${selectedFacility.organizationName} · ${selectedFacility.name}`,
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
        {!teamsResult.failed && teamsResult.items.length ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">{t('Teams.caption')}</ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Teams.team')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Teams.organizationField')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Teams.facility')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {teamsResult.items.map((team) => (
                  <ShadcnTableRow key={team.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3">
                      <Link
                        className="font-medium text-primary underline"
                        href={`/administration/teams/${team.id}`}
                      >
                        {team.name}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <ResourceReference
                        label={
                          hasClientPermission(
                            permissions,
                            'organization.read',
                            tenantId,
                            team.organizationId,
                            null,
                            team.id,
                          )
                            ? team.organizationName
                            : t('Resources.unavailableOrganization')
                        }
                        href={
                          hasClientPermission(
                            permissions,
                            'organization.read',
                            tenantId,
                            team.organizationId,
                            null,
                          )
                            ? `/administration/organizations/${team.organizationId}`
                            : null
                        }
                      />
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {team.facilityId ? (
                        <ResourceReference
                          label={
                            hasClientPermission(
                              permissions,
                              'facility.read',
                              tenantId,
                              team.organizationId,
                              team.facilityId,
                              team.id,
                            )
                              ? (team.facilityName ?? t('Resources.unavailableFacility'))
                              : t('Resources.unavailableFacility')
                          }
                          href={
                            hasClientPermission(
                              permissions,
                              'facility.read',
                              tenantId,
                              team.organizationId,
                              team.facilityId,
                            )
                              ? `/administration/facilities/${team.facilityId}`
                              : null
                          }
                        />
                      ) : (
                        t('Teams.organizationWide')
                      )}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <StatusBadge status={team.status} label={t(statusLabelKey(team.status))} />
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : teamsResult.failed ? null : (
          <EmptyState title={t('Teams.empty')} />
        )}
        {!teamsResult.failed ? (
          <DataPagination
            pathname="/administration/teams"
            page={teamsResult.page}
            pageSize={teamsResult.pageSize}
            totalItems={teamsResult.total}
            filters={{ q: search, organizationId, facilityId, status }}
          />
        ) : null}
      </section>
    </div>
  );
}

function validUuid(value?: string): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}
