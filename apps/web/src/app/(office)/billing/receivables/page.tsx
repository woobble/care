import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { ErrorNotice as Alert } from '@app/web/components/page-patterns';
import { PageHeader } from '@app/web/components/page-patterns';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { NativeSelect } from '@care/ui/components/native-select';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';

type SearchParams = Promise<{
  page?: string;
  pageSize?: string;
  q?: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  recipientType?: string;
  status?: string;
  from?: string;
  until?: string;
  error?: string;
}>;

export default async function BillingReceivablesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
  const q = validSearch(query.q);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const recipientType =
    query.recipientType === 'client' || query.recipientType === 'payer'
      ? query.recipientType
      : undefined;
  const status = validReceivableStatus(query.status);
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
    api.GET('/api/v1/billing/receivables', {
      params: {
        query: {
          page,
          pageSize,
          status,
          ...(q ? { q } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(clientId ? { clientId } : {}),
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
      '/billing/receivables',
      receivableFilters({
        q,
        organizationId,
        facilityId,
        clientId,
        recipientType,
        status,
        from,
        until,
      }),
      page,
      pageSize,
      data.total,
    );
  }
  const items = data?.items ?? [];
  const tenantId = header['X-Tenant-Id'];
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

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={t('section')}
        title={t('receivables')}
        description={t('receivablesDescription')}
      />
      <BillingNavigation permissions={permissions} />
      {(query.error ?? error?.code) ? (
        <Alert>{translate(errorMessageKey(query.error ?? error?.code ?? ''))}</Alert>
      ) : null}
      <form method="get" className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-3">
        <label className="grid min-w-0 gap-2 text-sm">
          <span>{t('searchInvoices')}</span>
          <Input name="q" type="search" minLength={2} maxLength={120} defaultValue={q ?? ''} />
        </label>
        <label className="grid gap-2 text-sm">
          <span>{t('dueDateFrom')}</span>
          <Input name="from" type="date" defaultValue={from ?? ''} />
        </label>
        <label className="grid gap-2 text-sm">
          <span>{t('dueDateUntil')}</span>
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
            <option value="payer">{t('payer')}</option>
          </NativeSelect>
        </label>
        <label className="grid gap-2 text-sm">
          <span>{t('receivableStatusFilter')}</span>
          <NativeSelect
            name="status"
            defaultValue={status}
            selectClassName="min-h-10 rounded-md border border-border bg-card px-3 py-2"
            className="w-full"
          >
            <option value="open">{t('openReceivables')}</option>
            <option value="unpaid">{t('receivableStatus.unpaid')}</option>
            <option value="partially_paid">{t('receivableStatus.partially_paid')}</option>
            <option value="paid">{t('receivableStatus.paid')}</option>
            <option value="overdue">{t('receivableStatus.overdue')}</option>
            <option value="corrected">{t('receivableStatus.corrected')}</option>
          </NativeSelect>
        </label>
        <input type="hidden" name="pageSize" value={pageSize} />
        <div className="flex min-w-0 flex-wrap items-end gap-2 md:col-span-3">
          <Button type="submit">{t('applyFilters')}</Button>
          <Button asChild variant="secondary">
            <Link href="/billing/receivables">{t('clearFilters')}</Link>
          </Button>
        </div>
      </form>
      <section
        aria-labelledby="receivables-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="receivables-title" className="text-xl font-semibold">
          {t('receivablesListTitle')}
        </h2>
        {items.length ? (
          <>
            <ul className="grid gap-3 lg:hidden">
              {items.map((invoice) => {
                const outstandingCents = invoice.outstandingCents ?? 0;
                return (
                  <li key={invoice.id} className="grid gap-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <Link
                          className="font-semibold text-primary underline"
                          href={`/billing/invoices/${invoice.id}`}
                        >
                          {invoice.invoiceNumber ?? t('draftIdentifier')}
                        </Link>
                        <span className="text-sm">
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
                        <span className="text-sm text-muted-foreground">
                          {invoice.recipientName ??
                            t(invoice.recipientType === 'payer' ? 'payer' : 'client')}
                        </span>
                      </div>
                      {invoice.receivableStatus ? (
                        <span className="rounded-full border px-2 py-1 text-xs">
                          {t(`receivableStatus.${invoice.receivableStatus}`)}
                        </span>
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-muted-foreground">{t('issueDate')}</dt>
                        <dd>{formatDate(invoice.issueDate, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('dueDate')}</dt>
                        <dd>{formatDate(invoice.dueDate, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('amount')}</dt>
                        <dd>{formatCents(invoice.grandTotalCents, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('paidAmount')}</dt>
                        <dd>{formatCents(invoice.paidCents ?? 0, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('outstandingAmount')}</dt>
                        <dd className="font-medium">{formatCents(outstandingCents, locale)}</dd>
                      </div>
                    </dl>
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link
                        href={
                          outstandingCents > 0
                            ? `/billing/payments?invoiceId=${invoice.id}`
                            : `/billing/invoices/${invoice.id}`
                        }
                      >
                        {outstandingCents > 0 ? t('recordOrAllocatePayment') : t('viewInvoice')}
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto lg:block">
              <ShadcnTable className="w-full min-w-[54rem] text-left text-sm">
                <ShadcnTableHeader>
                  <ShadcnTableRow className="border-b text-muted-foreground">
                    <ShadcnTableHead className="p-2">{t('invoiceNumber')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('client')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('recipient')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('issueDate')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('dueDate')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('amount')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('paidAmount')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('outstandingAmount')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('paymentStatus')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('actions')}</ShadcnTableHead>
                  </ShadcnTableRow>
                </ShadcnTableHeader>
                <ShadcnTableBody>
                  {items.map((invoice) => (
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
                        {formatDate(invoice.issueDate, locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {formatDate(invoice.dueDate, locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {formatCents(invoice.grandTotalCents, locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {formatCents(invoice.paidCents ?? 0, locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2 font-medium">
                        {formatCents(invoice.outstandingCents ?? 0, locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {invoice.receivableStatus
                          ? t(`receivableStatus.${invoice.receivableStatus}`)
                          : '—'}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        <Button asChild variant="secondary" size="sm">
                          <Link
                            href={
                              (invoice.outstandingCents ?? 0) > 0
                                ? `/billing/payments?invoiceId=${invoice.id}`
                                : `/billing/invoices/${invoice.id}`
                            }
                          >
                            {(invoice.outstandingCents ?? 0) > 0
                              ? t('recordOrAllocatePayment')
                              : t('viewInvoice')}
                          </Link>
                        </Button>
                      </ShadcnTableCell>
                    </ShadcnTableRow>
                  ))}
                </ShadcnTableBody>
              </ShadcnTable>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('receivablesEmpty')}</p>
        )}
        {data ? (
          <DataPagination
            pathname="/billing/receivables"
            page={data.page}
            pageSize={data.pageSize}
            totalItems={data.total}
            filters={receivableFilters({
              q,
              organizationId,
              facilityId,
              clientId,
              recipientType,
              status,
              from,
              until,
            })}
          />
        ) : null}
      </section>
    </div>
  );
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

function validReceivableStatus(
  value: string | undefined,
): 'open' | 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'corrected' {
  return value === 'unpaid' ||
    value === 'partially_paid' ||
    value === 'paid' ||
    value === 'overdue' ||
    value === 'corrected'
    ? value
    : 'open';
}

function receivableFilters(filters: {
  q?: string | undefined;
  organizationId?: string | undefined;
  facilityId?: string | undefined;
  clientId?: string | undefined;
  recipientType?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
