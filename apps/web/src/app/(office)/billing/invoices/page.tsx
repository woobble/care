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
} from '@app/web/lib/api';
import type { components } from '@care/api-client';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { PageHeader } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';

type SearchParams = Promise<{
  page?: string;
  pageSize?: string;
  status?: string;
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
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const result = await api.GET('/api/v1/billing/invoices', {
    params: { query: { page, pageSize, ...(status ? { status } : {}) }, header },
  });
  const data = result.data as unknown as
    | (components['schemas']['BillingInvoiceListResponseDto'] & { totalPages: number })
    | undefined;
  const error = result.error as { code?: string } | undefined;
  if (data) {
    redirectToValidPage('/billing/invoices', status ? { status } : {}, page, pageSize, data.total);
  }
  const invoices = data?.items ?? [];
  const permissions = await getPermissionGrants(api);
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
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
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
        <Button type="submit">{t('applyFilters')}</Button>
        <Button asChild variant="secondary">
          <Link href="/billing/invoices">{t('clearFilters')}</Link>
        </Button>
      </form>
      <section
        aria-labelledby="invoices-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="invoices-title" className="text-xl font-semibold">
          {t('invoices')}
        </h2>
        {invoices.length ? (
          <div className="overflow-x-auto">
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
            filters={status ? { status } : {}}
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
