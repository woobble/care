import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import type { Locale } from '../../../../i18n/config';
import { errorMessageKey } from '../../../../i18n/errors';
import { formatDate } from '../../../../i18n/format';
import { getApiClient, getPermissionGrants, getTenantHeader } from '../../../../lib/api';
import { BillingNavigation } from '../billing-nav';
import { formatCents } from '../format';

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
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('section')}
        </p>
        <h1 className="text-3xl font-semibold">{t('invoiceListTitle')}</h1>
        <p className="text-slate-700">{t('invoiceListDescription')}</p>
      </header>
      <BillingNavigation permissions={permissions} />
      {(query.error ?? error?.code) ? (
        <Alert>{translate(errorMessageKey(query.error ?? error?.code ?? ''))}</Alert>
      ) : null}
      {query.updated === 'invoice' ? <Status>{t('invoiceListUpdated')}</Status> : null}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="grid gap-2 text-sm">
          <span>{t('invoiceStatus')}</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">{t('allInvoiceStatuses')}</option>
            <option value="draft">{t('status.draft')}</option>
            <option value="issued">{t('status.issued')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
          </select>
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
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead>
                <tr className="border-b text-slate-600">
                  <th className="p-2">{t('invoiceNumber')}</th>
                  <th className="p-2">{t('client')}</th>
                  <th className="p-2">{t('recipient')}</th>
                  <th className="p-2">{t('servicePeriod')}</th>
                  <th className="p-2">{t('amount')}</th>
                  <th className="p-2">{t('invoiceStatus')}</th>
                  <th className="p-2">{t('paymentStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <td className="p-2 font-medium">
                      <Link
                        className="text-blue-900 underline"
                        href={`/billing/invoices/${invoice.id}`}
                      >
                        {invoice.invoiceNumber ??
                          t('draftIdentifier', { id: invoice.id.slice(0, 8) })}
                      </Link>
                    </td>
                    <td className="p-2">
                      <Link
                        className="text-blue-900 underline"
                        href={`/clients/${invoice.clientId}/invoices`}
                      >
                        {invoice.clientName}
                      </Link>
                    </td>
                    <td className="p-2">
                      {invoice.recipientName ??
                        t(invoice.recipientType === 'payer' ? 'payer' : 'client')}
                    </td>
                    <td className="p-2">
                      {period(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale)}
                    </td>
                    <td className="p-2">{formatCents(invoice.grandTotalCents, locale)}</td>
                    <td className="p-2">{t(`status.${invoice.status}`)}</td>
                    <td className="p-2">
                      {invoice.receivableStatus
                        ? t(`receivableStatus.${invoice.receivableStatus}`)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
