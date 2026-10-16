import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { FilterDisclosure } from '@app/web/components/filter-disclosure';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Badge } from '@care/ui/components/badge';
import { Button } from '@care/ui/components/button';
import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { NativeSelect } from '@care/ui/components/native-select';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';

type SearchParams = Promise<Record<string, string | undefined>>;
type AdmissionRow = {
  id: string;
  firstName: string;
  lastName: string;
  stage: string;
  ownerEmployeeId: string | null;
  ownerEmployeeName?: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  preferredStartDate: string | null;
  clientId: string | null;
  clientName?: string | null;
  readinessSummary?: { canAdmit: boolean; blockerCount: number; warningCount: number };
};
const stages = [
  'inquiry',
  'assessment',
  'preparation',
  'ready_for_admission',
  'admitted',
  'declined',
  'withdrawn',
] as const;

export default async function AdmissionsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, translate, locale] = await Promise.all([
    getTranslations('Onboarding'),
    getTranslations(),
    getLocale(),
  ]);
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canRead = hasPermission(permissions, 'onboarding.read');
  const canCreate = hasPermission(permissions, 'onboarding.create');
  const canManageTemplates = hasPermission(permissions, 'onboarding.templates.manage');
  if (!canRead) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }
  const page = validPage(query.page);
  const parsedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(parsedPageSize) ? parsedPageSize : 20;
  const stage = enumValue(query.stage, stages);
  const readiness = enumValue(query.readiness, ['ready', 'blocked'] as const);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const ownerEmployeeId = validUuid(query.ownerEmployeeId);
  const search = query.search?.trim().slice(0, 120) || undefined;
  const createdFrom = validDate(query.createdFrom);
  const createdTo = validDate(query.createdTo);
  const overdue = query.overdue === 'true';
  const sortBy =
    enumValue(query.sortBy, ['createdAt', 'lastActivityAt', 'name', 'nextFollowUpAt'] as const) ??
    'lastActivityAt';
  const sortDirection = enumValue(query.sortDirection, ['asc', 'desc'] as const) ?? 'desc';
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const canReadEmployees = hasPermission(permissions, 'employee.read');
  const [result, organizationResult, facilityResult, selectedOwnerResult] = await Promise.all([
    api.GET('/api/v1/onboarding/cases', {
      params: {
        query: {
          page,
          pageSize,
          ...(search ? { search } : {}),
          ...(stage ? { stage } : {}),
          ...(readiness ? { readiness } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(ownerEmployeeId ? { ownerEmployeeId } : {}),
          ...(createdFrom ? { createdFrom } : {}),
          ...(createdTo ? { createdTo } : {}),
          ...(overdue ? { overdue: 'true' as const } : {}),
          sortBy,
          sortDirection,
        },
        header,
      },
    }),
    canReadOrganizations && organizationId
      ? api.GET('/api/v1/organizations/{id}', {
          params: { path: { id: organizationId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadFacilities && facilityId
      ? api.GET('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadEmployees && ownerEmployeeId
      ? api.GET('/api/v1/employees/{id}', {
          params: { path: { id: ownerEmployeeId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const resultData = result.data as unknown as
    | { items: AdmissionRow[]; total: number; page: number; pageSize: number }
    | undefined;
  if (resultData)
    redirectToValidPage(
      '/admissions',
      query,
      resultData.page,
      resultData.pageSize,
      resultData.total,
    );
  const rows = resultData?.items ?? [];
  const total = resultData?.total ?? 0;
  const selectedOrganization = organizationResult.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedOwner = selectedOwnerResult.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('worklist')}
        description={t('subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            {canManageTemplates ? (
              <Button asChild variant="secondary">
                <Link href="/admissions/templates">{t('manageTemplates')}</Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild>
                <Link href="/admissions/new">{t('newCase')}</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {result.error || organizationResult.error || facilityResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}

      <FilterDisclosure title={t('filters')}>
        <form method="get" className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <input type="hidden" name="pageSize" value={pageSize} />
          <Field name="search" label={t('search')} type="search" defaultValue={search} />
          {canReadOrganizations ? (
            <AsyncEntityCombobox
              name="organizationId"
              label={t('organization')}
              entity="organizations"
              placeholder={t('allOrganizations')}
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
          {canReadFacilities ? (
            <AsyncEntityCombobox
              name="facilityId"
              label={t('facility')}
              entity="facilities"
              {...(organizationId ? { organizationId } : {})}
              placeholder={t('allFacilities')}
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
          {canReadEmployees ? (
            <AsyncEntityCombobox
              name="ownerEmployeeId"
              label={t('owner')}
              entity="employees"
              placeholder={t('allOwners')}
              {...(selectedOwner
                ? {
                    initialOption: {
                      id: selectedOwner.id,
                      label: `${selectedOwner.preferredName || selectedOwner.firstName} ${selectedOwner.lastName}`,
                    },
                  }
                : {})}
            />
          ) : null}
          <SelectField name="stage" label={t('stage')} value={stage ?? ''}>
            <option value="">{t('allStages')}</option>
            {stages.map((value) => (
              <option key={value} value={value}>
                {t(value === 'assessment' ? 'assessmentStage' : value)}
              </option>
            ))}
          </SelectField>
          <SelectField name="readiness" label={t('readiness')} value={readiness ?? ''}>
            <option value="">{t('allReadiness')}</option>
            <option value="ready">{t('ready')}</option>
            <option value="blocked">{t('blocked')}</option>
          </SelectField>
          <Field
            name="createdFrom"
            label={t('createdFrom')}
            type="date"
            defaultValue={createdFrom}
          />
          <Field name="createdTo" label={t('createdTo')} type="date" defaultValue={createdTo} />
          <SelectField name="sortBy" label={t('sortBy')} value={sortBy}>
            <option value="lastActivityAt">{t('sortLastActivity')}</option>
            <option value="createdAt">{t('sortCreatedAt')}</option>
            <option value="name">{t('sortName')}</option>
            <option value="nextFollowUpAt">{t('sortFollowUp')}</option>
          </SelectField>
          <SelectField name="sortDirection" label={t('sortDirection')} value={sortDirection}>
            <option value="desc">{t('newestFirst')}</option>
            <option value="asc">{t('oldestFirst')}</option>
          </SelectField>
          <label className="flex items-center gap-2 text-sm font-medium">
            <ShadcnCheckbox name="overdue" value="true" defaultChecked={overdue} />
            {t('overdue')}
          </label>
          <div className="flex gap-2 md:col-span-3">
            <Button type="submit">{translate('Common.actions.apply')}</Button>
            <Button asChild variant="secondary">
              <Link href="/admissions">{translate('Common.actions.reset')}</Link>
            </Button>
          </div>
        </form>
      </FilterDisclosure>

      <section aria-label={t('worklist')} className="min-w-0">
        {rows.length ? (
          <>
            <div className="grid gap-3 lg:hidden">
              {rows.map((row) => (
                <article
                  key={row.id}
                  className={`grid min-w-0 gap-3 rounded-xl border bg-card p-4 ${isOverdue(row) ? 'border-warning/70' : ''}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        className="inline-flex min-h-11 items-center font-semibold break-words text-primary underline-offset-4 hover:underline"
                        href={`/admissions/${row.id}`}
                      >
                        {row.firstName} {row.lastName}
                      </Link>
                      {row.clientId ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <ResourceReference
                            label={row.clientName ?? translate('Resources.unavailableClient')}
                            href={row.clientName ? `/clients/${row.clientId}` : null}
                          />
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <Badge variant={stageBadgeVariant(row.stage)}>
                        {t(
                          row.stage === 'assessment'
                            ? 'assessmentStage'
                            : (row.stage as (typeof stages)[number]),
                        )}
                      </Badge>
                      {isOverdue(row) ? <Badge variant="warning">{t('overdue')}</Badge> : null}
                    </div>
                  </div>
                  <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('preferredStartDate')}</dt>
                      <dd className="mt-0.5 break-words">
                        {formatDate(row.preferredStartDate, locale as Locale)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('blockers')}</dt>
                      <dd className="mt-0.5 break-words">
                        {row.readinessSummary?.blockerCount
                          ? t('blockerCount', { count: row.readinessSummary.blockerCount })
                          : t('noBlockers')}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('admissionAge')}</dt>
                      <dd className="mt-0.5 break-words">
                        {t('ageInDays', { count: admissionAgeInDays(row.createdAt) })}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('followUp')}</dt>
                      <dd className="mt-0.5 break-words">
                        {row.nextFollowUpAt
                          ? formatDateTime(row.nextFollowUpAt, locale as Locale)
                          : '—'}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('owner')}</dt>
                      <dd className="mt-0.5 break-words">
                        {row.ownerEmployeeId ? (
                          <ResourceReference
                            label={
                              row.ownerEmployeeName ?? translate('Resources.unavailableEmployee')
                            }
                            href={
                              row.ownerEmployeeName ? `/employees/${row.ownerEmployeeId}` : null
                            }
                          />
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('lastActivity')}</dt>
                      <dd className="mt-0.5 break-words">
                        {formatDate(row.lastActivityAt, locale as Locale)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border bg-card lg:block">
              <ShadcnTable className="w-full min-w-[900px] text-left text-sm">
                <ShadcnTableHeader className="border-b bg-background text-muted-foreground">
                  <ShadcnTableRow>
                    <ShadcnTableHead className="p-3">{t('caseDetails')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('stage')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('preferredStartDate')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('blockers')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('admissionAge')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('followUp')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('owner')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('lastActivity')}</ShadcnTableHead>
                  </ShadcnTableRow>
                </ShadcnTableHeader>
                <ShadcnTableBody className="divide-y">
                  {rows.map((row) => (
                    <ShadcnTableRow
                      key={row.id}
                      className={isOverdue(row) ? 'bg-warning-muted/30' : undefined}
                    >
                      <ShadcnTableCell className="p-3">
                        <Link
                          className="font-semibold text-primary underline"
                          href={`/admissions/${row.id}`}
                        >
                          {row.firstName} {row.lastName}
                        </Link>
                        {row.clientId ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            <ResourceReference
                              label={row.clientName ?? translate('Resources.unavailableClient')}
                              href={row.clientName ? `/clients/${row.clientId}` : null}
                            />
                          </span>
                        ) : null}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={stageBadgeVariant(row.stage)}>
                            {t(
                              row.stage === 'assessment'
                                ? 'assessmentStage'
                                : (row.stage as (typeof stages)[number]),
                            )}
                          </Badge>
                          {isOverdue(row) ? <Badge variant="warning">{t('overdue')}</Badge> : null}
                        </div>
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {formatDate(row.preferredStartDate, locale as Locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {row.readinessSummary?.blockerCount
                          ? t('blockerCount', { count: row.readinessSummary.blockerCount })
                          : t('noBlockers')}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {t('ageInDays', {
                          count: admissionAgeInDays(row.createdAt),
                        })}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {row.nextFollowUpAt
                          ? formatDateTime(row.nextFollowUpAt, locale as Locale)
                          : '—'}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {row.ownerEmployeeId
                          ? (row.ownerEmployeeName ?? translate('Resources.unavailableEmployee'))
                          : '—'}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {formatDate(row.lastActivityAt, locale as Locale)}
                      </ShadcnTableCell>
                    </ShadcnTableRow>
                  ))}
                </ShadcnTableBody>
              </ShadcnTable>
            </div>
          </>
        ) : (
          <EmptyState title={t('noCases')} />
        )}
      </section>

      {resultData ? (
        <DataPagination
          pathname="/admissions"
          page={resultData.page}
          pageSize={resultData.pageSize}
          totalItems={total}
          filters={{
            search,
            stage,
            readiness,
            organizationId,
            facilityId,
            ownerEmployeeId,
            createdFrom,
            createdTo,
            overdue: overdue ? 'true' : undefined,
            sortBy,
            sortDirection,
          }}
        />
      ) : null}
    </div>
  );
}

function Field({
  name,
  label,
  type = 'text',
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | undefined;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 w-full min-w-0 rounded-md border px-3 font-normal"
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={120}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 w-full min-w-0 rounded-md border bg-card px-3 font-normal"
        name={name}
        defaultValue={value}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

function enumValue<const T extends readonly string[]>(
  value: string | undefined,
  options: T,
): T[number] | undefined {
  return value && (options as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

function validPage(value?: string) {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 1;
}

function validDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function admissionAgeInDays(createdAt: string): number {
  // oxlint-disable-next-line react/purity -- Admission age is measured at request time.
  return Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000));
}

function isOverdue(row: AdmissionRow) {
  return Boolean(
    row.nextFollowUpAt &&
    Date.parse(row.nextFollowUpAt) <= Date.now() &&
    ['inquiry', 'assessment', 'preparation', 'ready_for_admission'].includes(row.stage),
  );
}

function stageBadgeVariant(stage: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (stage === 'ready_for_admission' || stage === 'admitted') return 'success';
  if (stage === 'declined' || stage === 'withdrawn') return 'secondary';
  if (stage === 'preparation') return 'warning';
  return 'secondary';
}

function validUuid(value: string | undefined) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}
