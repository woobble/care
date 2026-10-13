import { NativeSelect } from '@care/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { dateRange, shiftDate, todayDateKey } from '@app/web/lib/care-date';
import { formatDateTime } from '@app/web/i18n/format';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';

type SearchParams = Promise<{
  from?: string;
  until?: string;
  clientQuery?: string;
  facilityId?: string;
  employeeId?: string;
  status?: 'draft' | 'missing';
  error?: string;
}>;

export default async function DocumentationWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const query = await searchParams;
  const today = todayDateKey();
  const fromDate = validDate(query.from) ? query.from : shiftDate(today, -30);
  const untilDate = validDate(query.until) ? query.until : today;
  let range: ReturnType<typeof dateRange>;
  try {
    range = dateRange(fromDate, untilDate);
  } catch {
    redirect('/documentation?error=CARE_DOCUMENTATION_INVALID_QUERY');
  }

  const api = await getApiClient();
  const get = api.GET;
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'care_documentation.review')) redirect('/');
  const header = await getTenantHeader();
  const [listResult, facilitiesResult, employeesResult] = await Promise.all([
    get('/api/v1/care-documentation', {
      params: {
        query: {
          from: range.from,
          until: range.until,
          incomplete: true,
          page: 1,
          pageSize: 100,
          ...(query.clientQuery?.trim() ? { clientQuery: query.clientQuery.trim() } : {}),
          ...(query.facilityId ? { facilityId: query.facilityId } : {}),
          ...(query.employeeId ? { employeeId: query.employeeId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        header,
      },
    }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/employees', {
      params: { query: { status: 'active', page: 1, pageSize: 100 }, header },
    }),
  ]);
  const items = listResult.data?.items ?? [];
  const facilities = facilitiesResult.data ?? [];
  const employees = employeesResult.data?.items ?? [];
  const tenantId = header['X-Tenant-Id'];

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('CareDocumentation.section')}
        title={t('CareDocumentation.worklistTitle')}
        description={t('CareDocumentation.worklistDescription')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/planning">{t('CareDocumentation.goToPlanning')}</Link>
          </Button>
        }
      />

      {query.error || listResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(query.error ?? listResult.error?.code ?? 'UNKNOWN'))}
        </p>
      ) : null}

      <form
        method="get"
        className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.from')}</span>
          <input
            name="from"
            type="date"
            defaultValue={fromDate}
            className="min-h-11 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.until')}</span>
          <input
            name="until"
            type="date"
            defaultValue={untilDate}
            className="min-h-11 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.client')}</span>
          <input
            name="clientQuery"
            type="search"
            maxLength={120}
            defaultValue={query.clientQuery ?? ''}
            placeholder={t('CareDocumentation.clientPlaceholder')}
            className="min-h-11 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.facility')}</span>
          <NativeSelect
            name="facilityId"
            defaultValue={query.facilityId ?? ''}
            selectClassName="min-h-11 rounded-md border bg-card px-3"
            className="w-full"
          >
            <option value="">{t('Common.filters.allFacilities')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.employee')}</span>
          <NativeSelect
            name="employeeId"
            defaultValue={query.employeeId ?? ''}
            selectClassName="min-h-11 rounded-md border bg-card px-3"
            className="w-full"
          >
            <option value="">{t('CareDocumentation.allEmployees')}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.preferredName || employee.firstName} {employee.lastName}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.status')}</span>
          <NativeSelect
            name="status"
            defaultValue={query.status ?? ''}
            selectClassName="min-h-11 rounded-md border bg-card px-3"
            className="w-full"
          >
            <option value="">{t('CareDocumentation.allStatuses')}</option>
            <option value="missing">{t('CareDocumentation.missingStatus')}</option>
            <option value="draft">{t('CareDocumentation.draftStatus')}</option>
          </NativeSelect>
        </label>
        <Button type="submit" className="min-h-11 w-fit">
          {t('CareDocumentation.applyFilters')}
        </Button>
      </form>

      <section className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {t('CareDocumentation.visitCount', { count: listResult.data?.total ?? 0 })}
        </p>
        {items.length ? (
          <ul className="grid gap-3">
            {items.map((item) => {
              const canReadVisit = hasClientPermission(
                permissions,
                'schedule.read',
                tenantId,
                item.organizationId,
                item.facilityId,
              );
              const canReadClient = hasClientPermission(
                permissions,
                'client.read',
                tenantId,
                item.organizationId,
                item.facilityId,
              );
              const content = (
                <>
                  <span className="grid gap-1">
                    <span className="text-lg font-semibold">
                      {canReadVisit ? (
                        item.clientDisplayName
                      ) : canReadClient ? (
                        <Link href={`/clients/${item.clientId}`} className="hover:underline">
                          {item.clientDisplayName}
                        </Link>
                      ) : (
                        item.clientDisplayName
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDateTime(item.plannedStart, locale, item.timezone)} ·{' '}
                      {item.employeeName ?? t('CareDocumentation.unassignedEmployee')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {item.missing
                        .map((missing) => t(missingRequirementKey(missing.code)))
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="w-fit rounded-full bg-warning-muted px-3 py-1 text-sm text-warning-foreground">
                    {item.documentationStatus === 'missing'
                      ? t('CareDocumentation.missingItem')
                      : t('CareDocumentation.draftStatus')}
                  </span>
                </>
              );
              const cardClassName =
                'grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-start';
              return (
                <li key={item.visitId}>
                  {canReadVisit ? (
                    <Link
                      href={`/visits/${item.visitId}`}
                      className={`${cardClassName} hover:border-primary/40`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={cardClassName}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title={t('CareDocumentation.noOpenItems')}
            description={t('CareDocumentation.noOpenItemsForRange')}
          />
        )}
      </section>
    </div>
  );
}

function validDate(value: string | undefined): value is string {
  return (
    value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function missingRequirementKey(
  code: string,
):
  | 'CareDocumentation.missingRequirements.documentation'
  | 'CareDocumentation.missingRequirements.execution'
  | 'CareDocumentation.missingRequirements.serviceEvidence'
  | 'CareDocumentation.missingRequirements.reason'
  | 'CareDocumentation.missingRequirements.explanation'
  | 'CareDocumentation.missingRequirements.unknown' {
  if (code === 'DOCUMENTATION_REQUIRED')
    return 'CareDocumentation.missingRequirements.documentation';
  if (code === 'VISIT_EXECUTION_REQUIRED') return 'CareDocumentation.missingRequirements.execution';
  if (code === 'SERVICE_EVIDENCE_REQUIRED')
    return 'CareDocumentation.missingRequirements.serviceEvidence';
  if (code === 'NOT_PERFORMED_REASON_REQUIRED')
    return 'CareDocumentation.missingRequirements.reason';
  if (code === 'PARTIAL_SERVICE_EXPLANATION_REQUIRED')
    return 'CareDocumentation.missingRequirements.explanation';
  return 'CareDocumentation.missingRequirements.unknown';
}
