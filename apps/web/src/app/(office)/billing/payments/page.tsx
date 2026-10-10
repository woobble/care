import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { formatDateTime } from '../../../../i18n/format';
import { errorMessageKey } from '../../../../i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../../lib/api';
import { BillingNavigation } from '../billing-nav';
import { formatCents, euroInput } from '../format';
import {
  allocatePaymentAction,
  recordPaymentAction,
  reversePaymentAllocationAction,
} from '../actions';

type SearchParams = Promise<{ invoiceId?: string; error?: string; updated?: string }>;

export default async function BillingPaymentsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const invoiceId = validUuid(query.invoiceId);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [paymentResult, receivableResult, organizationResult, permissions] = await Promise.all([
    api.GET('/api/v1/billing/payments', { params: { query: { page: 1, pageSize: 50 }, header } }),
    api.GET('/api/v1/billing/receivables', {
      params: { query: { page: 1, pageSize: 100 }, header },
    }),
    api.GET('/api/v1/organizations', { params: { header } }),
    getPermissionGrants(api),
  ]);
  const payments = paymentResult.data?.items ?? [];
  const invoices = receivableResult.data?.items ?? [];
  const organizations = organizationResult.data ?? [];
  const canManage = hasPermission(permissions, 'billing.payments.manage');
  const updated =
    query.updated === 'payment' || query.updated === 'allocation' || query.updated === 'reversal'
      ? query.updated
      : null;
  const error = query.error ?? paymentResult.error?.code ?? receivableResult.error?.code;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('section')}
        </p>
        <h1 className="text-3xl font-semibold">{t('payments')}</h1>
        <p className="text-slate-700">{t('paymentsDescription')}</p>
      </header>
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {updated ? <Status>{t(`paymentUpdated.${updated}`)}</Status> : null}

      {canManage ? (
        <section
          aria-labelledby="record-payment-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <h2 id="record-payment-title" className="text-xl font-semibold">
            {t('recordPayment')}
          </h2>
          <form action={recordPaymentAction} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <SelectField
              id="payment-organization"
              name="organizationId"
              label={t('organization')}
              required
            >
              <option value="">{t('selectOrganization')}</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </SelectField>
            <Field id="payment-payer" name="payerName" label={t('payerName')} />
            <Field id="payment-payer-reference" name="payerReference" label={t('payerReference')} />
            <Field
              id="payment-amount"
              name="amount"
              label={t('amount')}
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              required
            />
            <Field
              id="payment-received-at"
              name="receivedAt"
              label={t('receivedAtBerlin')}
              type="datetime-local"
              defaultValue={berlinDateTimeValue()}
              required
            />
            <SelectField id="payment-method" name="method" label={t('paymentMethod')} required>
              <option value="bank_transfer">{t('paymentMethods.bank_transfer')}</option>
              <option value="cash">{t('paymentMethods.cash')}</option>
              <option value="other">{t('paymentMethods.other')}</option>
            </SelectField>
            <Field id="payment-reference" name="reference" label={t('paymentReference')} />
            <div className="flex items-end">
              <Button type="submit">{t('recordPayment')}</Button>
            </div>
          </form>
        </section>
      ) : null}

      <section
        aria-labelledby="payments-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="payments-title" className="text-xl font-semibold">
          {t('paymentHistory')}
        </h2>
        {payments.length ? (
          <ul className="grid gap-4">
            {payments.map((payment) => {
              const eligibleInvoices = invoices.filter(
                (invoice) =>
                  invoice.organizationId === payment.organizationId &&
                  invoice.outstandingCents &&
                  invoice.outstandingCents > 0,
              );
              const selectedInvoice = eligibleInvoices.find((invoice) => invoice.id === invoiceId);
              return (
                <li key={payment.id} className="grid gap-3 rounded-md border p-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div className="grid gap-1">
                      <h3 className="font-semibold">
                        {payment.payerNameSnapshot ?? payment.payerReference ?? t('unknownPayer')}
                      </h3>
                      <p className="text-sm text-slate-700">
                        {formatDateTime(payment.receivedAt, locale)} ·{' '}
                        {t(`paymentMethods.${payment.method}`)}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </p>
                    </div>
                    <dl className="grid gap-1 text-right text-sm">
                      <dt className="text-slate-600">{t('amount')}</dt>
                      <dd className="font-medium">{formatCents(payment.amountCents, locale)}</dd>
                      <dt className="text-slate-600">{t('unallocatedAmount')}</dt>
                      <dd className="font-medium">{formatCents(payment.remainingCents, locale)}</dd>
                    </dl>
                  </div>
                  {payment.allocationHistory.length ? (
                    <div className="grid gap-2 border-t pt-3">
                      <h4 className="font-medium">{t('paymentAllocations')}</h4>
                      {payment.allocationHistory.map((allocation) => (
                        <div
                          key={allocation.allocationId}
                          className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
                        >
                          <p>
                            <Link
                              className="text-blue-900 underline"
                              href={`/billing/invoices/${allocation.invoiceId}`}
                            >
                              {allocation.invoiceNumber ??
                                t('draftIdentifier', { id: allocation.invoiceId.slice(0, 8) })}
                            </Link>
                            {' · '}
                            {formatCents(allocation.amountCents, locale)}
                            {allocation.reversedAt
                              ? ` · ${t('allocationReversed')}: ${allocation.reversalReason ?? ''}`
                              : ''}
                          </p>
                          {!allocation.reversedAt && canManage ? (
                            <form
                              action={reversePaymentAllocationAction}
                              className="flex flex-wrap items-end gap-2"
                            >
                              <input
                                type="hidden"
                                name="allocationId"
                                value={allocation.allocationId}
                              />
                              <Field
                                id={`reverse-reason-${allocation.allocationId}`}
                                name="reason"
                                label={t('reversalReason')}
                                required
                              />
                              <Button type="submit" variant="secondary">
                                {t('reverseAllocation')}
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">{t('noPaymentAllocations')}</p>
                  )}
                  {payment.remainingCents > 0 && eligibleInvoices.length && canManage ? (
                    <form
                      action={allocatePaymentAction}
                      className="grid gap-3 rounded-md bg-slate-50 p-4 md:grid-cols-[1fr_12rem_auto]"
                    >
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <SelectField
                        id={`invoice-${payment.id}`}
                        name="invoiceId"
                        label={t('allocateToInvoice')}
                        required
                        defaultValue={selectedInvoice?.id ?? ''}
                      >
                        <option value="">{t('selectInvoice')}</option>
                        {eligibleInvoices.map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoice.invoiceNumber ??
                              t('draftIdentifier', { id: invoice.id.slice(0, 8) })}{' '}
                            · {invoice.clientName} · {formatCents(invoice.outstandingCents, locale)}
                          </option>
                        ))}
                      </SelectField>
                      <Field
                        id={`allocation-amount-${payment.id}`}
                        name="amount"
                        label={t('amount')}
                        type="number"
                        min="0.01"
                        max={euroInput(payment.remainingCents)}
                        step="0.01"
                        inputMode="decimal"
                        defaultValue={euroInput(payment.remainingCents)}
                        required
                      />
                      <div className="flex items-end">
                        <Button type="submit">{t('allocatePayment')}</Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-700">{t('paymentsEmpty')}</p>
        )}
      </section>
    </div>
  );
}

function berlinDateTimeValue(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function validUuid(value: string | undefined): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
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

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  inputMode,
  min,
  max,
  step,
  required,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  inputMode?: 'decimal' | 'numeric';
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
}>) {
  return (
    <label className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        required={required}
      />
    </label>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  required,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2"
      >
        {children}
      </select>
    </label>
  );
}
