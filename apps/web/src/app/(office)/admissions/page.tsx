import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { FilterDisclosure } from '@app/web/components/filter-disclosure';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';

type SearchParams = Promise<Record<string, string | undefined>>;
type AdmissionRow = {
  id: string;
  firstName: string;
  lastName: string;
  stage: string;
  ownerEmployeeId: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  preferredStartDate: string | null;
  clientId: string | null;
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
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  }
  const page = validPage(query.page);
  const stage = enumValue(query.stage, stages);
  const readiness = enumValue(query.readiness, ['ready', 'blocked'] as const);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const ownerEmployeeId = validUuid(query.ownerEmployeeId);
  const search = query.search?.trim().slice(0, 120) || undefined;
  const createdFrom = validDate(query.createdFrom);
  const createdTo = validDate(query.createdTo);
  const overdue = query.overdue === 'true';
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const canReadEmployees = hasPermission(permissions, 'employee.read');
  const [result, organizationResult, facilityResult, employeeResult] = await Promise.all([
    api.GET('/api/v1/onboarding/cases', {
      params: {
        query: {
          page,
          pageSize: 25,
          ...(search ? { search } : {}),
          ...(stage ? { stage } : {}),
          ...(readiness ? { readiness } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(ownerEmployeeId ? { ownerEmployeeId } : {}),
          ...(createdFrom ? { createdFrom } : {}),
          ...(createdTo ? { createdTo } : {}),
          ...(overdue ? { overdue: 'true' as const } : {}),
        },
        header,
      },
    }),
    canReadOrganizations
      ? api.GET('/api/v1/organizations', { params: { query: { status: 'active' }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadFacilities
      ? api.GET('/api/v1/facilities', {
          params: { query: organizationId ? { organizationId } : {}, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadEmployees
      ? api.GET('/api/v1/employees', {
          params: {
            query: {
              status: 'active',
              page: 1,
              pageSize: 100,
              sortBy: 'lastName',
              sortOrder: 'asc',
              ...(organizationId ? { organizationId } : {}),
              ...(facilityId ? { facilityId } : {}),
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const resultData = result.data as unknown as
    | { items: AdmissionRow[]; total: number; page: number; pageSize: number }
    | undefined;
  const rows = resultData?.items ?? [];
  const total = resultData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const employees = employeeResult.data?.items ?? [];
  const employeeNames = new Map(
    employees.map((employee) => [
      employee.id,
      `${employee.preferredName || employee.firstName} ${employee.lastName}`,
    ]),
  );

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
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {result.error || organizationResult.error || facilityResult.error || employeeResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}

      <FilterDisclosure title={t('filters')}>
        <form method="get" className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field name="search" label={t('search')} type="search" defaultValue={search} />
          {canReadOrganizations ? (
            <SelectField
              name="organizationId"
              label={t('organization')}
              value={organizationId ?? ''}
            >
              <option value="">{t('allOrganizations')}</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {canReadFacilities ? (
            <SelectField name="facilityId" label={t('facility')} value={facilityId ?? ''}>
              <option value="">{t('allFacilities')}</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {canReadEmployees ? (
            <SelectField name="ownerEmployeeId" label={t('owner')} value={ownerEmployeeId ?? ''}>
              <option value="">{t('allOwners')}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.preferredName || employee.firstName} {employee.lastName}
                </option>
              ))}
            </SelectField>
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
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="overdue" value="true" defaultChecked={overdue} />
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
                <article key={row.id} className="grid min-w-0 gap-3 rounded-xl border bg-card p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        className="inline-flex min-h-11 items-center break-words font-semibold text-primary underline-offset-4 hover:underline"
                        href={`/admissions/${row.id}`}
                      >
                        {row.firstName} {row.lastName}
                      </Link>
                      {row.clientId ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('clientId')}: {row.clientId}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                      {t(
                        row.stage === 'assessment'
                          ? 'assessmentStage'
                          : (row.stage as (typeof stages)[number]),
                      )}
                    </span>
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
                        {row.ownerEmployeeId
                          ? (employeeNames.get(row.ownerEmployeeId) ?? row.ownerEmployeeId)
                          : '—'}
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
            <div className="hidden overflow-x-auto rounded-lg border bg-white lg:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-700">
                  <tr>
                    <th className="p-3">{t('caseDetails')}</th>
                    <th className="p-3">{t('stage')}</th>
                    <th className="p-3">{t('preferredStartDate')}</th>
                    <th className="p-3">{t('blockers')}</th>
                    <th className="p-3">{t('admissionAge')}</th>
                    <th className="p-3">{t('followUp')}</th>
                    <th className="p-3">{t('owner')}</th>
                    <th className="p-3">{t('lastActivity')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="p-3">
                        <Link
                          className="font-semibold text-blue-800 underline"
                          href={`/admissions/${row.id}`}
                        >
                          {row.firstName} {row.lastName}
                        </Link>
                        {row.clientId ? (
                          <span className="ml-2 text-xs text-slate-600">
                            {t('clientId')}: {row.clientId}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3">
                        {t(
                          row.stage === 'assessment'
                            ? 'assessmentStage'
                            : (row.stage as (typeof stages)[number]),
                        )}
                      </td>
                      <td className="p-3">
                        {formatDate(row.preferredStartDate, locale as Locale)}
                      </td>
                      <td className="p-3">
                        {row.readinessSummary?.blockerCount
                          ? t('blockerCount', { count: row.readinessSummary.blockerCount })
                          : t('noBlockers')}
                      </td>
                      <td className="p-3">
                        {t('ageInDays', {
                          count: admissionAgeInDays(row.createdAt),
                        })}
                      </td>
                      <td className="p-3">
                        {row.nextFollowUpAt
                          ? formatDateTime(row.nextFollowUpAt, locale as Locale)
                          : '—'}
                      </td>
                      <td className="p-3">
                        {row.ownerEmployeeId
                          ? (employeeNames.get(row.ownerEmployeeId) ?? row.ownerEmployeeId)
                          : '—'}
                      </td>
                      <td className="p-3">{formatDate(row.lastActivityAt, locale as Locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="p-5 text-slate-700">{t('noCases')}</p>
        )}
      </section>

      <nav aria-label={t('worklist')} className="flex items-center justify-between">
        <span className="text-sm text-slate-600">{total}</span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={pageHref(query, page - 1)}>{translate('Common.actions.previous')}</Link>
            </Button>
          ) : null}
          {page < totalPages ? (
            <Button asChild variant="secondary">
              <Link href={pageHref(query, page + 1)}>{translate('Common.actions.next')}</Link>
            </Button>
          ) : null}
        </div>
      </nav>
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
      <select
        className="h-10 w-full min-w-0 rounded-md border bg-white px-3 font-normal"
        name={name}
        defaultValue={value}
      >
        {children}
      </select>
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

function validUuid(value: string | undefined) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function pageHref(query: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value && key !== 'page') params.set(key, value);
  params.set('page', String(page));
  return `/admissions?${params.toString()}`;
}
