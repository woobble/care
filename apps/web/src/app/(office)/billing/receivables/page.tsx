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
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import { getApiClient, getPermissionGrants, getTenantHeader } from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';

type SearchParams = Promise<{ page?: string; error?: string }>;

export default async function BillingReceivablesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = positivePage(query.page);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [{ data, error }, permissions] = await Promise.all([
    api.GET('/api/v1/billing/receivables', {
      params: { query: { page, pageSize: 50 }, header },
    }),
    getPermissionGrants(api),
  ]);
  const items = data?.items ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('section')}
        </p>
        <h1 className="text-3xl font-semibold">{t('receivables')}</h1>
        <p className="text-slate-700">{t('receivablesDescription')}</p>
      </header>
      <BillingNavigation permissions={permissions} />
      {(query.error ?? error?.code) ? (
        <Alert>{translate(errorMessageKey(query.error ?? error?.code ?? ''))}</Alert>
      ) : null}
      <section
        aria-labelledby="receivables-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="receivables-title" className="text-xl font-semibold">
          {t('openReceivables')}
        </h2>
        {items.length ? (
          <div className="overflow-x-auto">
            <ShadcnTable className="w-full min-w-[54rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-slate-600">
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
          <p className="text-sm text-slate-700">{t('receivablesEmpty')}</p>
        )}
        <div className="flex justify-end gap-2">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={`/billing/receivables?page=${page - 1}`}>{t('previous')}</Link>
            </Button>
          ) : null}
          {items.length === 50 ? (
            <Button asChild variant="secondary">
              <Link href={`/billing/receivables?page=${page + 1}`}>{t('next')}</Link>
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
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
