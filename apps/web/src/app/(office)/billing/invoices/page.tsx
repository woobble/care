import {
  EmptyState,
  ErrorNotice as Alert,
  SuccessNotice as Status,
} from '@app/web/components/page-patterns';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';
import { NativeSelect } from '@care/ui/components/native-select';
import { Input } from '@care/ui/components/input';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import type { components } from '@care/api-client';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { PageHeader } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';

type SearchParams = Promise<{
  page?: string;
  pageSize?: string;
  q?: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  status?: string;
  recipientType?: string;
  from?: string;
  until?: string;
  error?: string;
  updated?: string;
}>;

export default async function BillingInvoicesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
  const status =
    query.status === 'draft' || query.status === 'issued' || query.status === 'cancelled'
      ? query.status
      : undefined;
  const recipientType =
    query.recipientType === 'client' || query.recipientType === 'payer'
      ? query.recipientType
      : undefined;
  const q = validSearch(query.q);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const from = validDate(query.from);
  const until = validDate(query.until);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [result, permissions] = await Promise.all([
    api.GET('/api/v1/billing/invoices', {
      params: {
        query: {
          page,
          pageSize,
          ...(q ? { q } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(clientId ? { clientId } : {}),
          ...(status ? { status } : {}),
          ...(recipientType ? { recipientType } : {}),
          ...(from ? { from } : {}),
          ...(until ? { until } : {}),
        },
        header,
      },
    }),
    getPermissionGrants(api),
  ]);
  const data = result.data as unknown as
    | (components['schemas']['BillingInvoiceListResponseDto'] & { totalPages: number })
    | undefined;
  const error = result.error as { code?: string } | undefined;
  if (data) {
    redirectToValidPage(
      '/billing/invoices',
      invoiceFilters({
        q,
        organizationId,
        facilityId,
        clientId,
        status,
        recipientType,
        from,
        until,
      }),
      page,
      pageSize,
      data.total,
    );
  }
  const invoices = data?.items ?? [];
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const canReadClients = hasPermission(permissions, 'client.read');
  const [organizationResult, facilityResult, clientResult] = await Promise.all([
    organizationId && canReadOrganizations
      ? api.GET('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve({ data: undefined }),
    facilityId && canReadFacilities
      ? api.GET('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve({ data: undefined }),
    clientId && canReadClients
      ? api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
      : Promise.resolve({ data: undefined }),
  ]);
  const selectedOrganization = organizationResult.data;
  const selectedFacility = facilityResult.data;
  const selectedClient = clientResult.data;
  const tenantId = header['X-Tenant-Id'];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={t('section')}
        title={t('invoiceListTitle')}
        description={t('invoiceListDescription')}
      />
      <BillingNavigation permissions={permissions} />
      {(query.error ?? error?.code) ? (
        <Alert>{translate(errorMessageKey(query.error ?? error?.code ?? ''))}</Alert>
      ) : null}
      {query.updated === 'invoice' ? <Status>{t('invoiceListUpdated')}</Status> : null}
      <form method="get" className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-3">
        <label className="grid min-w-0 gap-2 text-sm">
          <span>{t('searchInvoices')}</span>
          <Input name="q" type="search" minLength={2} maxLength={120} defaultValue={q ?? ''} />
        </label>
        <label className="grid gap-2 text-sm">
          <span>{t('issueDateFrom')}</span>
          <Input name="from" type="date" defaultValue={from ?? ''} />
        </label>
        <label className="grid gap-2 text-sm">
          <span>{t('issueDateUntil')}</span>
          <Input name="until" type="date" defaultValue={until ?? ''} />
        </label>
        {canReadOrganizations ? (
          <AsyncEntityCombobox
            name="organizationId"
            label={t('organizationFilter')}
            entity="organizations"
            placeholder={t('allOrganizations')}
            {...(selectedOrganization?.id
              ? { initialOption: { id: selectedOrganization.id, label: selectedOrganization.name } }
              : {})}
          />
        ) : null}
        {canReadFacilities ? (
          <AsyncEntityCombobox
            name="facilityId"
            label={t('facilityFilter')}
            entity="facilities"
            {...(organizationId ? { organizationId } : {})}
            placeholder={t('allFacilities')}
            {...(selectedFacility?.id
              ? {
                  initialOption: {
                    id: selectedFacility.id,
                    label: `${selectedFacility.organizationName} · ${selectedFacility.name}`,
                  },
                }
              : {})}
          />
        ) : null}
        {canReadClients ? (
          <AsyncEntityCombobox
            name="clientId"
            label={t('clientFilter')}
            entity="clients"
            placeholder={t('allClients')}
            {...(selectedClient?.id
              ? {
                  initialOption: {
                    id: selectedClient.id,
                    label: `${selectedClient.preferredName || selectedClient.firstName} ${selectedClient.lastName}`,
                  },
                }
              : {})}
          />
        ) : null}
        <input type="hidden" name="pageSize" value={pageSize} />
        <label className="grid gap-2 text-sm">
          <span>{t('invoiceStatus')}</span>
          <NativeSelect
            name="status"
            defaultValue={status ?? ''}
            selectClassName="min-h-10 rounded-md border border-border bg-card px-3 py-2"
            className="w-full"
          >
            <option value="">{t('allInvoiceStatuses')}</option>
            <option value="draft">{t('status.draft')}</option>
            <option value="issued">{t('status.issued')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
          </NativeSelect>
        </label>
        <label className="grid gap-2 text-sm">
          <span>{t('recipientFilter')}</span>
          <NativeSelect
            name="recipientType"
            defaultValue={recipientType ?? ''}
            selectClassName="min-h-10 rounded-md border border-border bg-card px-3 py-2"
            className="w-full"
          >
            <option value="">{t('allRecipients')}</option>
            <option value="client">{t('recipientTypes.client')}</option>
            <option value="payer">{t('recipientTypes.insurance')}</option>
          </NativeSelect>
        </label>
        <div className="flex min-w-0 flex-wrap items-end gap-2 md:col-span-3">
          <Button type="submit">{t('applyFilters')}</Button>
          <Button asChild variant="secondary">
            <Link href="/billing/invoices">{t('clearFilters')}</Link>
          </Button>
        </div>
      </form>
      <section
        aria-labelledby="invoices-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="invoices-title" className="text-xl font-semibold">
          {t('invoices')}
        </h2>
        {invoices.length ? (
          <ul className="grid gap-3 lg:hidden">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="grid gap-2 rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    className="font-semibold text-primary underline"
                    href={`/billing/invoices/${invoice.id}`}
                  >
                    {invoice.invoiceNumber ?? t('draftIdentifier')}
                  </Link>
                  <span className="rounded-full border px-2 py-1 text-xs">
                    {t(`status.${invoice.status}`)}
                  </span>
                </div>
                <div className="grid gap-1 text-sm">
                  <span>
                    {hasClientPermission(
                      permissions,
                      'client.read',
                      tenantId,
                      invoice.organizationId,
                      invoice.facilityId,
                    ) ? (
                      <Link
                        className="text-primary underline"
                        href={`/clients/${invoice.clientId}/invoices`}
                      >
                        {invoice.clientName}
                      </Link>
                    ) : (
                      invoice.clientName
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {invoice.recipientName ??
                      t(invoice.recipientType === 'payer' ? 'payer' : 'client')}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{t('servicePeriod')}</dt>
                    <dd>{period(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('amount')}</dt>
                    <dd className="font-medium">{formatCents(invoice.grandTotalCents, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('paymentStatus')}</dt>
                    <dd>
                      {invoice.receivableStatus
                        ? t(`receivableStatus.${invoice.receivableStatus}`)
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
        {invoices.length ? (
          <div className="hidden overflow-x-auto lg:block">
            <ShadcnTable className="w-full min-w-[54rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-muted-foreground">
                  <ShadcnTableHead className="p-2">{t('invoiceNumber')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('client')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('recipient')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('servicePeriod')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('amount')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('invoiceStatus')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('paymentStatus')}</ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {invoices.map((invoice) => (
                  <ShadcnTableRow key={invoice.id} className="border-b last:border-0">
                    <ShadcnTableCell className="p-2 font-medium">
                      <Link
                        className="text-primary underline"
                        href={`/billing/invoices/${invoice.id}`}
                      >
                        {invoice.invoiceNumber ?? t('draftIdentifier')}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {hasClientPermission(
                        permissions,
                        'client.read',
                        tenantId,
                        invoice.organizationId,
                        invoice.facilityId,
                      ) ? (
                        <Link
                          className="text-primary underline"
                          href={`/clients/${invoice.clientId}/invoices`}
                        >
                          {invoice.clientName}
                        </Link>
                      ) : (
                        invoice.clientName
                      )}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {invoice.recipientName ??
                        t(invoice.recipientType === 'payer' ? 'payer' : 'client')}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {period(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {formatCents(invoice.grandTotalCents, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {t(`status.${invoice.status}`)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {invoice.receivableStatus
                        ? t(`receivableStatus.${invoice.receivableStatus}`)
                        : '—'}
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <EmptyState title={t('invoiceListEmpty')} />
        )}
        {data ? (
          <DataPagination
            pathname="/billing/invoices"
            page={data.page}
            pageSize={data.pageSize}
            totalItems={data.total}
            filters={invoiceFilters({
              q,
              organizationId,
              facilityId,
              clientId,
              status,
              recipientType,
              from,
              until,
            })}
          />
        ) : null}
      </section>
    </div>
  );
}

function period(from: string | null, until: string | null, locale: Locale): string {
  const start = formatDate(from, locale);
  const end = formatDate(until, locale);
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end ?? '—');
}

function positivePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

function positivePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
}

function validSearch(value: string | undefined): string | undefined {
  const search = value?.trim().slice(0, 120);
  return search && search.length >= 2 ? search : undefined;
}

function validDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function validUuid(value: string | undefined): string | undefined {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

function invoiceFilters(filters: {
  q?: string | undefined;
  organizationId?: string | undefined;
  facilityId?: string | undefined;
  clientId?: string | undefined;
  status?: string | undefined;
  recipientType?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
