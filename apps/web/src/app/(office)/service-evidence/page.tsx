import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui';
import { NativeSelect } from '@care/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { components } from '@care/api-client';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { acknowledgementCapacityKey, evidenceStatusKey } from '@app/web/i18n/evidence';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatNumber } from '@app/web/i18n/format';
import { dateRange, shiftDate, todayDateKey, formatVisitDateTime } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';

type Status = components['schemas']['ServiceEvidenceWorklistItemDto']['status'];
type SignatoryType = 'client' | 'representative' | 'other_authorized_person';
type SearchParams = Promise<{
  from?: string;
  until?: string;
  clientQuery?: string;
  facilityId?: string;
  organizationId?: string;
  employeeId?: string;
  status?: Status;
  signatoryType?: SignatoryType;
  page?: string;
  error?: string;
}>;

export default async function ServiceEvidenceWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const today = todayDateKey();
  const fromDate = validDate(query.from) ? query.from : shiftDate(today, -30);
  const untilDate = validDate(query.until) ? query.until : today;
  let range: ReturnType<typeof dateRange>;
  try {
    range = dateRange(fromDate, untilDate);
  } catch {
    redirect('/service-evidence?error=SERVICE_EVIDENCE_INVALID_QUERY');
  }
  const page = parsePage(query.page);
  const status = validStatus(query.status) ? query.status : undefined;
  const signatoryType = validSignatoryType(query.signatoryType) ? query.signatoryType : undefined;

  const api = await getApiClient();
  const get = api.GET;
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'service_evidence.read')) redirect('/');
  const header = await getTenantHeader();
  const [listResult, facilitiesResult, organizationsResult, employeesResult] = await Promise.all([
    get('/api/v1/service-evidence', {
      params: {
        query: {
          from: range.from,
          until: range.until,
          page,
          pageSize: 50,
          ...(query.clientQuery?.trim() ? { clientQuery: query.clientQuery.trim() } : {}),
          ...(validUuid(query.facilityId) ? { facilityId: query.facilityId } : {}),
          ...(validUuid(query.organizationId) ? { organizationId: query.organizationId } : {}),
          ...(validUuid(query.employeeId) ? { employeeId: query.employeeId } : {}),
          ...(status ? { status } : {}),
          ...(signatoryType ? { signatoryType } : {}),
        },
        header,
      },
    }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/employees', {
      params: { query: { status: 'active', page: 1, pageSize: 100 }, header },
    }),
  ]);
  const result = listResult.data;
  const items = result?.items ?? [];
  const facilities = facilitiesResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const employees = employeesResult.data?.items ?? [];
  const filterValues = {
    from: fromDate,
    until: untilDate,
    clientQuery: query.clientQuery?.trim() ?? '',
    facilityId: validUuid(query.facilityId) ? query.facilityId : '',
    organizationId: validUuid(query.organizationId) ? query.organizationId : '',
    employeeId: validUuid(query.employeeId) ? query.employeeId : '',
    status: status ?? '',
    signatoryType: signatoryType ?? '',
  };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('ServiceEvidence.office.section')}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{t('ServiceEvidence.office.title')}</h1>
          <p className="mt-2 text-slate-600">{t('ServiceEvidence.office.description')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/documentation">{t('ServiceEvidence.office.documentationLink')}</Link>
        </Button>
      </header>

      {query.error || listResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(query.error ?? listResult.error?.code ?? ''))}
        </p>
      ) : null}

      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.from')}</span>
          <input
            name="from"
            type="date"
            defaultValue={filterValues.from}
            className="min-h-11 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.until')}</span>
          <input
            name="until"
            type="date"
            defaultValue={filterValues.until}
            className="min-h-11 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.clientSearch')}</span>
          <input
            name="clientQuery"
            defaultValue={filterValues.clientQuery}
            maxLength={120}
            className="min-h-11 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.status')}</span>
          <NativeSelect
            name="status"
            defaultValue={filterValues.status}
            selectClassName="min-h-11 rounded-md border bg-white px-3"
            className="w-full"
          >
            <option value="">{t('ServiceEvidence.office.allStatuses')}</option>
            <option value="awaiting_acknowledgement">
              {t(evidenceStatusKey('awaiting_acknowledgement'))}
            </option>
            <option value="acknowledged">{t(evidenceStatusKey('acknowledged'))}</option>
            <option value="declined">{t(evidenceStatusKey('declined'))}</option>
            <option value="revoked">{t(evidenceStatusKey('revoked'))}</option>
            <option value="outdated">{t(evidenceStatusKey('outdated'))}</option>
            <option value="superseded">{t(evidenceStatusKey('superseded'))}</option>
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.organization')}</span>
          <NativeSelect
            name="organizationId"
            defaultValue={filterValues.organizationId}
            selectClassName="min-h-11 rounded-md border bg-white px-3"
            className="w-full"
          >
            <option value="">{t('ServiceEvidence.office.allOrganizations')}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.facility')}</span>
          <NativeSelect
            name="facilityId"
            defaultValue={filterValues.facilityId}
            selectClassName="min-h-11 rounded-md border bg-white px-3"
            className="w-full"
          >
            <option value="">{t('ServiceEvidence.office.allFacilities')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.employees')}</span>
          <NativeSelect
            name="employeeId"
            defaultValue={filterValues.employeeId}
            selectClassName="min-h-11 rounded-md border bg-white px-3"
            className="w-full"
          >
            <option value="">{t('ServiceEvidence.office.allEmployees')}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.preferredName ?? `${employee.firstName} ${employee.lastName}`}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.signatory')}</span>
          <NativeSelect
            name="signatoryType"
            defaultValue={filterValues.signatoryType}
            selectClassName="min-h-11 rounded-md border bg-white px-3"
            className="w-full"
          >
            <option value="">{t('ServiceEvidence.office.allSignatories')}</option>
            <option value="client">{t('ServiceEvidence.office.signatoryTypes.client')}</option>
            <option value="representative">
              {t('ServiceEvidence.office.signatoryTypes.representative')}
            </option>
            <option value="other_authorized_person">
              {t('ServiceEvidence.office.signatoryTypes.other')}
            </option>
          </NativeSelect>
        </label>
        <div className="flex items-end gap-2 lg:col-span-4">
          <Button type="submit" className="min-h-11">
            {t('ServiceEvidence.office.filter')}
          </Button>
          <Button asChild variant="secondary" className="min-h-11">
            <Link href="/service-evidence">{t('ServiceEvidence.office.reset')}</Link>
          </Button>
        </div>
      </form>

      <section className="grid gap-3">
        <p className="text-sm text-slate-600">
          {result
            ? t('ServiceEvidence.office.resultCount', { count: result.total })
            : t('ServiceEvidence.office.noRecords')}{' '}
          · {t('ServiceEvidence.office.page', { page: formatNumber(result?.page ?? page, locale) })}
        </p>
        {items.length ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <ShadcnTable className="w-full min-w-[44rem] text-left text-sm">
              <ShadcnTableHeader className="border-b bg-slate-50 text-slate-700">
                <ShadcnTableRow>
                  <ShadcnTableHead className="p-3 font-semibold">
                    {t('ServiceEvidence.office.visit')}
                  </ShadcnTableHead>
                  <ShadcnTableHead className="p-3 font-semibold">
                    {t('ServiceEvidence.office.client')}
                  </ShadcnTableHead>
                  <ShadcnTableHead className="p-3 font-semibold">
                    {t('ServiceEvidence.office.status')}
                  </ShadcnTableHead>
                  <ShadcnTableHead className="p-3 font-semibold">
                    {t('ServiceEvidence.office.signatory')}
                  </ShadcnTableHead>
                  <ShadcnTableHead className="p-3 font-semibold">
                    {t('ServiceEvidence.office.version')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {items.map((item) => (
                  <ShadcnTableRow
                    key={`${item.evidencePackageId ?? item.visitId}-${item.packageVersion ?? 'none'}`}
                    className="border-b last:border-0"
                  >
                    <ShadcnTableCell className="p-3">
                      {formatVisitDateTime(item.plannedStart, item.timezone, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-3 font-medium">
                      <Link
                        href={
                          item.evidencePackageId
                            ? `/service-evidence/${item.evidencePackageId}`
                            : `/visits/${item.visitId}`
                        }
                        className="text-blue-900 underline"
                      >
                        {item.clientName}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-3">
                      {t(evidenceStatusKey(item.status))}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-3">
                      {item.signatoryName
                        ? `${item.signatoryName} · ${item.capacity ? t(acknowledgementCapacityKey(item.capacity)) : ''}`
                        : '–'}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-3">
                      {item.packageVersion ?? t('ServiceEvidence.office.notCreated')}
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            {t('ServiceEvidence.office.noResults')}
          </p>
        )}
        <div className="flex justify-between">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={pageUrl(filterValues, page - 1)}>
                {t('ServiceEvidence.office.previous')}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {result && page * result.pageSize < result.total ? (
            <Button asChild variant="secondary">
              <Link href={pageUrl(filterValues, page + 1)}>{t('ServiceEvidence.office.next')}</Link>
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function validUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function parsePage(value: string | undefined): number {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function validStatus(value: string | undefined): value is Status {
  return [
    'awaiting_acknowledgement',
    'acknowledged',
    'declined',
    'revoked',
    'outdated',
    'superseded',
  ].includes(value ?? '');
}

function validSignatoryType(value: string | undefined): value is SignatoryType {
  return ['client', 'representative', 'other_authorized_person'].includes(value ?? '');
}

function pageUrl(
  filters: {
    from: string;
    until: string;
    clientQuery: string;
    facilityId: string;
    organizationId: string;
    employeeId: string;
    status: string;
    signatoryType: string;
  },
  page: number,
): string {
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `/service-evidence?${params.toString()}`;
}
