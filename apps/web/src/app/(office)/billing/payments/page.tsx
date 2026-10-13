import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { formatDateTime } from '@app/web/i18n/format';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents, euroInput } from '@app/web/app/(office)/billing/format';
import {
  allocatePaymentAction,
  recordPaymentAction,
  reversePaymentAllocationAction,
} from '@app/web/app/(office)/billing/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';

type SearchParams = Promise<{
  invoiceId?: string;
  page?: string;
  pageSize?: string;
  error?: string;
  updated?: string;
}>;

export default async function BillingPaymentsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const invoiceId = validUuid(query.invoiceId);
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [paymentResult, selectedInvoiceResult, permissions] = await Promise.all([
    api.GET('/api/v1/billing/payments', { params: { query: { page, pageSize }, header } }),
    invoiceId
      ? api.GET('/api/v1/billing/invoices/{id}', { params: { path: { id: invoiceId }, header } })
      : Promise.resolve(null),
    getPermissionGrants(api),
  ]);
  const paymentData = paymentResult.data as unknown as
    | (components['schemas']['BillingPaymentListResponseDto'] & { totalPages: number })
    | undefined;
  const selectedInvoice = selectedInvoiceResult?.data as
    | components['schemas']['BillingInvoiceResponseDto']
    | undefined;
  const payments = paymentData?.items ?? [];
  const canManage = hasPermission(permissions, 'billing.payments.manage');
  const updated =
    query.updated === 'payment' || query.updated === 'allocation' || query.updated === 'reversal'
      ? query.updated
      : null;
  const paymentError = paymentResult.error as { code?: string } | undefined;
  const error = query.error ?? paymentError?.code;
  if (paymentData) {
    redirectToValidPage(
      '/billing/payments',
      invoiceId ? { invoiceId } : {},
      page,
      pageSize,
      paymentData.total,
    );
  }
  const selectedInvoiceOption =
    selectedInvoice?.invoiceNumber || selectedInvoice?.clientName
      ? {
          id: selectedInvoice.id,
          label: [
            selectedInvoice.invoiceNumber ?? t('draftIdentifier'),
            selectedInvoice.clientName,
            typeof selectedInvoice.outstandingCents === 'number'
              ? euroInput(selectedInvoice.outstandingCents)
              : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : undefined;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={t('section')}
        title={t('payments')}
        description={t('paymentsDescription')}
      />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {updated ? <Status>{t(`paymentUpdated.${updated}`)}</Status> : null}

      {canManage ? (
        <section
          aria-labelledby="record-payment-title"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="record-payment-title" className="text-xl font-semibold">
            {t('recordPayment')}
          </h2>
          <RHFActionForm
            action={recordPaymentAction}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            <AsyncEntityCombobox
              name="organizationId"
              label={t('organization')}
              entity="organizations"
              placeholder={t('selectOrganization')}
              required
            />
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
          </RHFActionForm>
        </section>
      ) : null}

      <section
        aria-labelledby="payments-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="payments-title" className="text-xl font-semibold">
          {t('paymentHistory')}
        </h2>
        {payments.length ? (
          <ul className="grid gap-4">
            {payments.map((payment) => {
              return (
                <li key={payment.id} className="grid gap-3 rounded-md border p-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div className="grid gap-1">
                      <h3 className="font-semibold">
                        {payment.payerNameSnapshot ?? payment.payerReference ?? t('unknownPayer')}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(payment.receivedAt, locale)} ·{' '}
                        {t(`paymentMethods.${payment.method}`)}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </p>
                    </div>
                    <dl className="grid gap-1 text-right text-sm">
                      <dt className="text-muted-foreground">{t('amount')}</dt>
                      <dd className="font-medium">{formatCents(payment.amountCents, locale)}</dd>
                      <dt className="text-muted-foreground">{t('unallocatedAmount')}</dt>
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
                              className="text-primary underline"
                              href={`/billing/invoices/${allocation.invoiceId}`}
                            >
                              {allocation.invoiceNumber ?? t('draftIdentifier')}
                            </Link>
                            {' · '}
                            {formatCents(allocation.amountCents, locale)}
                            {allocation.reversedAt
                              ? ` · ${t('allocationReversed')}: ${allocation.reversalReason ?? ''}`
                              : ''}
                          </p>
                          {!allocation.reversedAt && canManage ? (
                            <RHFActionForm
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
                            </RHFActionForm>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('noPaymentAllocations')}</p>
                  )}
                  {payment.remainingCents > 0 && canManage ? (
                    <RHFActionForm
                      action={allocatePaymentAction}
                      className="grid gap-3 rounded-md bg-background p-4 md:grid-cols-[1fr_12rem_auto]"
                    >
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <AsyncEntityCombobox
                        name="invoiceId"
                        label={t('allocateToInvoice')}
                        entity="receivables"
                        organizationId={payment.organizationId}
                        placeholder={t('selectInvoice')}
                        {...(selectedInvoice?.organizationId === payment.organizationId &&
                        selectedInvoiceOption
                          ? { initialOption: selectedInvoiceOption }
                          : {})}
                        required
                      />
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
                    </RHFActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('paymentsEmpty')}</p>
        )}
        {paymentData ? (
          <DataPagination
            pathname="/billing/payments"
            page={paymentData.page}
            pageSize={paymentData.pageSize}
            totalItems={paymentData.total}
            filters={invoiceId ? { invoiceId } : {}}
          />
        ) : null}
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

function positivePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

function positivePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
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
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        selectClassName="min-h-10 rounded-md border border-border bg-card px-3 py-2"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
