import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';
import { NativeSelect } from '@care/ui/components/native-select';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { components } from '@care/api-client';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { acknowledgementCapacityKey, evidenceStatusKey } from '@app/web/i18n/evidence';
import { errorMessageKey } from '@app/web/i18n/errors';
import { dateRange, shiftDate, todayDateKey, formatVisitDateTime } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';

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
  pageSize?: string;
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
  const pageSize = parsePageSize(query.pageSize);
  const status = validStatus(query.status) ? query.status : undefined;
  const signatoryType = validSignatoryType(query.signatoryType) ? query.signatoryType : undefined;
  const organizationId = validUuid(query.organizationId) ? query.organizationId : undefined;
  const facilityId = validUuid(query.facilityId) ? query.facilityId : undefined;
  const employeeId = validUuid(query.employeeId) ? query.employeeId : undefined;

  const api = await getApiClient();
  const get = api.GET;
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'service_evidence.read')) redirect('/');
  const header = await getTenantHeader();
  const [listResult, organizationResult, facilityResult, employeeResult] = await Promise.all([
    get('/api/v1/service-evidence', {
      params: {
        query: {
          from: range.from,
          until: range.until,
          page,
          pageSize,
          ...(query.clientQuery?.trim() ? { clientQuery: query.clientQuery.trim() } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(employeeId ? { employeeId } : {}),
          ...(status ? { status } : {}),
          ...(signatoryType ? { signatoryType } : {}),
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
    employeeId
      ? get('/api/v1/employees/{id}', { params: { path: { id: employeeId }, header } })
      : Promise.resolve(null),
  ]);
  const result = listResult.data as unknown as
    | components['schemas']['ServiceEvidenceWorklistDto']
    | undefined;
  const listError = listResult.error as { code?: string } | undefined;
  const items = result?.items ?? [];
  const selectedOrganization = organizationResult?.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult?.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedEmployee = employeeResult?.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;
  if (result) {
    redirectToValidPage(
      '/service-evidence',
      {
        from: range.from,
        until: range.until,
        clientQuery: query.clientQuery?.trim(),
        organizationId,
        facilityId,
        employeeId,
        status,
        signatoryType,
      },
      page,
      pageSize,
      result.total,
    );
  }
  const filterValues = {
    from: fromDate,
    until: untilDate,
    clientQuery: query.clientQuery?.trim() ?? '',
    facilityId: facilityId ?? '',
    organizationId: organizationId ?? '',
    employeeId: employeeId ?? '',
    status: status ?? '',
    signatoryType: signatoryType ?? '',
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('ServiceEvidence.office.section')}
        title={t('ServiceEvidence.office.title')}
        description={t('ServiceEvidence.office.description')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/documentation">{t('ServiceEvidence.office.documentationLink')}</Link>
          </Button>
        }
      />

      {query.error || listError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(query.error ?? listError?.code ?? ''))}
        </p>
      ) : null}

      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input type="hidden" name="pageSize" value={pageSize} />
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
            selectClassName="min-h-11 rounded-md border bg-card px-3"
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
        <AsyncEntityCombobox
          name="organizationId"
          label={t('ServiceEvidence.office.organization')}
          entity="organizations"
          placeholder={t('ServiceEvidence.office.allOrganizations')}
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
          label={t('ServiceEvidence.office.facility')}
          entity="facilities"
          {...(organizationId ? { organizationId } : {})}
          placeholder={t('ServiceEvidence.office.allFacilities')}
          {...(selectedFacility
            ? {
                initialOption: {
                  id: selectedFacility.id,
                  label: [selectedFacility.name, selectedFacility.organizationName]
                    .filter(Boolean)
                    .join(' · '),
                },
              }
            : {})}
        />
        <AsyncEntityCombobox
          name="employeeId"
          label={t('ServiceEvidence.office.employees')}
          entity="employees"
          placeholder={t('ServiceEvidence.office.allEmployees')}
          {...(selectedEmployee
            ? {
                initialOption: {
                  id: selectedEmployee.id,
                  label: `${selectedEmployee.preferredName || selectedEmployee.firstName} ${selectedEmployee.lastName}`,
                },
              }
            : {})}
        />
        <label className="grid gap-1 text-sm">
          <span>{t('ServiceEvidence.office.signatory')}</span>
          <NativeSelect
            name="signatoryType"
            defaultValue={filterValues.signatoryType}
            selectClassName="min-h-11 rounded-md border bg-card px-3"
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
        <p className="text-sm text-muted-foreground">
          {t('ServiceEvidence.office.resultCount', { count: result?.total ?? 0 })}
        </p>
        {items.length ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <ShadcnTable className="w-full min-w-[44rem] text-left text-sm">
              <ShadcnTableHeader className="border-b bg-background text-muted-foreground">
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
                        className="text-primary underline"
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
          <EmptyState title={t('ServiceEvidence.office.noResults')} />
        )}
        {result ? (
          <DataPagination
            pathname="/service-evidence"
            page={result.page}
            pageSize={result.pageSize}
            totalItems={result.total}
            filters={filterValues}
          />
        ) : null}
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
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : 1;
}

function parsePageSize(value: string | undefined): number {
  const parsed = Number(value);
  return [10, 20, 50, 100].includes(parsed) ? parsed : 20;
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
