import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { dateRange, shiftDate, todayDateKey } from '@app/web/lib/care-date';
import { formatDateTime } from '@app/web/i18n/format';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
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

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('CareDocumentation.section')}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{t('CareDocumentation.worklistTitle')}</h1>
          <p className="mt-2 text-slate-600">{t('CareDocumentation.worklistDescription')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/planning">{t('CareDocumentation.goToPlanning')}</Link>
        </Button>
      </header>

      {query.error || listResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(query.error ?? listResult.error?.code ?? 'UNKNOWN'))}
        </p>
      ) : null}

      <form
        method="get"
        className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
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
          <select
            name="facilityId"
            defaultValue={query.facilityId ?? ''}
            className="min-h-11 rounded-md border bg-white px-3"
          >
            <option value="">{t('Common.filters.allFacilities')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.employee')}</span>
          <select
            name="employeeId"
            defaultValue={query.employeeId ?? ''}
            className="min-h-11 rounded-md border bg-white px-3"
          >
            <option value="">{t('CareDocumentation.allEmployees')}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.preferredName || employee.firstName} {employee.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('Common.fields.status')}</span>
          <select
            name="status"
            defaultValue={query.status ?? ''}
            className="min-h-11 rounded-md border bg-white px-3"
          >
            <option value="">{t('CareDocumentation.allStatuses')}</option>
            <option value="missing">{t('CareDocumentation.missingStatus')}</option>
            <option value="draft">{t('CareDocumentation.draftStatus')}</option>
          </select>
        </label>
        <Button type="submit" className="min-h-11 w-fit">
          {t('CareDocumentation.applyFilters')}
        </Button>
      </form>

      <section className="grid gap-3">
        <p className="text-sm text-slate-600">
          {t('CareDocumentation.visitCount', { count: listResult.data?.total ?? 0 })}
        </p>
        {items.length ? (
          <ul className="grid gap-3">
            {items.map((item) => (
              <li key={item.visitId}>
                <Link
                  href={`/visits/${item.visitId}`}
                  className="grid gap-3 rounded-lg border bg-white p-4 hover:border-blue-400 sm:grid-cols-[1fr_auto] sm:items-start"
                >
                  <span className="grid gap-1">
                    <span className="text-lg font-semibold">{item.clientDisplayName}</span>
                    <span className="text-sm text-slate-600">
                      {formatDateTime(item.plannedStart, locale, item.timezone)} ·{' '}
                      {item.employeeName ?? t('CareDocumentation.unassignedEmployee')}
                    </span>
                    <span className="text-sm text-slate-700">
                      {item.missing
                        .map((missing) => t(missingRequirementKey(missing.code)))
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-950">
                    {item.documentationStatus === 'missing'
                      ? t('CareDocumentation.missingItem')
                      : t('CareDocumentation.draftStatus')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border bg-white p-6">
            <h2 className="font-semibold">{t('CareDocumentation.noOpenItems')}</h2>
            <p className="mt-1 text-slate-600">{t('CareDocumentation.noOpenItemsForRange')}</p>
          </div>
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
