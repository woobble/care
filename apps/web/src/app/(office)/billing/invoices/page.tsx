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
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import { getApiClient, getPermissionGrants, getTenantHeader } from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { PageHeader } from '@app/web/components/page-patterns';

type SearchParams = Promise<{ page?: string; status?: string; error?: string; updated?: string }>;

export default async function BillingInvoicesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = positivePage(query.page);
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
  const { data, error } = await api.GET('/api/v1/billing/invoices', {
    params: { query: { page, pageSize: 50, ...(status ? { status } : {}) }, header },
  });
  const invoices = data?.items ?? [];
  const permissions = await getPermissionGrants(api);

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
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="grid gap-2 text-sm">
          <span>{t('invoiceStatus')}</span>
          <NativeSelect
            name="status"
            defaultValue={status ?? ''}
            selectClassName="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2"
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
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="invoices-title" className="text-xl font-semibold">
          {t('invoices')}
        </h2>
        {invoices.length ? (
          <div className="overflow-x-auto">
            <ShadcnTable className="w-full min-w-[54rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-slate-600">
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
                        className="text-blue-900 underline"
                        href={`/billing/invoices/${invoice.id}`}
                      >
                        {invoice.invoiceNumber ??
                          t('draftIdentifier', { id: invoice.id.slice(0, 8) })}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      <Link
                        className="text-blue-900 underline"
                        href={`/clients/${invoice.clientId}/invoices`}
                      >
                        {invoice.clientName}
                      </Link>
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
          <p className="text-sm text-slate-700">{t('invoiceListEmpty')}</p>
        )}
        <div className="flex justify-end gap-2">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={invoiceListHref(page - 1, status)}>{t('previous')}</Link>
            </Button>
          ) : null}
          {invoices.length === 50 ? (
            <Button asChild variant="secondary">
              <Link href={invoiceListHref(page + 1, status)}>{t('next')}</Link>
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function period(from: string | null, until: string | null, locale: Locale): string {
  const start = formatDate(from, locale);
  const end = formatDate(until, locale);
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end ?? '—');
}

function invoiceListHref(page: number, status?: string): string {
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  return `/billing/invoices?${query}`;
}

function positivePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

function Alert({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
      {children}
    </p>
  );
}

function Status({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900">
      {children}
    </p>
  );
}
