import { ErrorNotice as Alert } from '@app/web/components/page-patterns';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';

type SearchParams = Promise<{ page?: string; pageSize?: string; error?: string }>;

export default async function BillingReceivablesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [result, permissions] = await Promise.all([
    api.GET('/api/v1/billing/receivables', {
      params: { query: { page, pageSize }, header },
    }),
    getPermissionGrants(api),
  ]);
  const data = result.data as unknown as
    | (components['schemas']['BillingInvoiceListResponseDto'] & { totalPages: number })
    | undefined;
  const error = result.error as { code?: string } | undefined;
  if (data) {
    redirectToValidPage('/billing/receivables', {}, page, pageSize, data.total);
  }
  const items = data?.items ?? [];
  const tenantId = header['X-Tenant-Id'];

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
      <section
        aria-labelledby="receivables-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="receivables-title" className="text-xl font-semibold">
          {t('openReceivables')}
        </h2>
        {items.length ? (
          <div className="overflow-x-auto">
            <ShadcnTable className="w-full min-w-[54rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-muted-foreground">
                  <ShadcnTableHead className="p-2">{t('invoiceNumber')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('client')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('recipient')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('dueDate')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('amount')}</ShadcnTableHead>
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
                      {formatDate(invoice.dueDate, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {formatCents(invoice.grandTotalCents, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2 font-medium">
                      {formatCents(invoice.outstandingCents, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {invoice.receivableStatus
                        ? t(`receivableStatus.${invoice.receivableStatus}`)
                        : '—'}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/billing/payments?invoiceId=${invoice.id}`}>
                          {t('recordOrAllocatePayment')}
                        </Link>
                      </Button>
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('receivablesEmpty')}</p>
        )}
        {data ? (
          <DataPagination
            pathname="/billing/receivables"
            page={data.page}
            pageSize={data.pageSize}
            totalItems={data.total}
            filters={{}}
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
