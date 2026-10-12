import { Checkbox as ShadcnCheckbox } from '@care/ui';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import {
  cancelDraftInvoiceAction,
  correctInvoiceAction,
  issueInvoiceAction,
  regenerateInvoicePdfAction,
  updateDraftInvoiceAction,
} from '@app/web/app/(office)/billing/actions';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { euroInput, formatCents, lineAmountField } from '@app/web/app/(office)/billing/format';

type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function BillingInvoiceDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [{ data: invoice, error }, permissions] = await Promise.all([
    api.GET('/api/v1/billing/invoices/{id}', { params: { path: { id }, header } }),
    getPermissionGrants(api),
  ]);
  if (error?.code === 'INVOICE_NOT_FOUND') notFound();
  if (!invoice) notFound();
  const canEdit =
    hasClientPermission(permissions, 'billing.manage', header['X-Tenant-Id'], null, null) ||
    permissions.some(
      (grant) =>
        grant.permission === 'billing.manage' &&
        ((grant.scopeType === 'tenant' && grant.scopeId === header['X-Tenant-Id']) ||
          (grant.scopeType === 'organization' && grant.scopeId === invoice.organizationId) ||
          (grant.scopeType === 'facility' && grant.scopeId === invoice.facilityId)),
    );
  const canIssue = permissions.some(
    (grant) =>
      grant.permission === 'billing.issue' &&
      ((grant.scopeType === 'tenant' && grant.scopeId === header['X-Tenant-Id']) ||
        (grant.scopeType === 'organization' && grant.scopeId === invoice.organizationId) ||
        (grant.scopeType === 'facility' && grant.scopeId === invoice.facilityId)),
  );
  const canCorrect = permissions.some(
    (grant) =>
      grant.permission === 'billing.correct' &&
      ((grant.scopeType === 'tenant' && grant.scopeId === header['X-Tenant-Id']) ||
        (grant.scopeType === 'organization' && grant.scopeId === invoice.organizationId) ||
        (grant.scopeType === 'facility' && grant.scopeId === invoice.facilityId)),
  );
  const canManageClaims = hasClientPermission(
    permissions,
    'claims.manage',
    header['X-Tenant-Id'],
    invoice.organizationId,
    invoice.facilityId,
  );
  const candidateResult =
    invoice.status === 'draft'
      ? await api.GET('/api/v1/billing/candidates', {
          params: {
            query: {
              from: invoice.servicePeriodFrom ?? daysAgo(90),
              until: today(),
              organizationId: invoice.organizationId,
              facilityId: invoice.facilityId,
              clientId: invoice.clientId,
              ready: 'true',
            },
            header,
          },
        })
      : null;
  const candidates = (candidateResult?.data?.items ?? []).filter((candidate) => {
    if (!candidate.ready || candidate.remainingBillableAmountCents <= 0) return false;
    if (invoice.recipientType === 'payer') {
      return (
        candidate.recommendedRecipient === 'payer' &&
        candidate.recommendedPayerArrangementId === invoice.payerArrangementId
      );
    }
    return true;
  });
  const existingKeys = new Set(
    invoice.lines.map((line) => `${line.performedServiceId}:${line.sourceKey}`),
  );
  const addableCandidates = candidates.filter(
    (candidate) => !existingKeys.has(`${candidate.performedServiceId}:${candidate.sourceKey}`),
  );
  const updated =
    query.updated === 'draft' ||
    query.updated === 'issued' ||
    query.updated === 'cancelled' ||
    query.updated === 'corrected'
      ? query.updated
      : null;
  const detailError = query.error ?? candidateResult?.error?.code;
  const issuer = invoice.issuerSnapshot ?? {};
  const recipient = invoice.recipientSnapshot ?? {};

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/billing/invoices">{t('invoices')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">
            {invoice.invoiceNumber ?? t('draftIdentifier', { id: invoice.id.slice(0, 8) })}
          </h1>
          <p className="text-slate-700">
            {invoice.clientName} ·{' '}
            {snapshotString(recipient, 'name') ??
              invoice.recipientName ??
              t(invoice.recipientType === 'payer' ? 'payer' : 'client')}{' '}
            · {t(`status.${invoice.status}`)}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/clients/${invoice.clientId}/invoices`}>{t('clientInvoiceHistory')}</Link>
        </Button>
      </header>
      <BillingNavigation permissions={permissions} />
      {detailError ? <Alert>{translate(errorMessageKey(detailError))}</Alert> : null}
      {updated ? <Status>{t(`invoiceUpdated.${updated}`)}</Status> : null}
      {invoice.evidenceDiscrepancy ? <Warning>{t('evidenceDiscrepancy')}</Warning> : null}

      <section
        aria-labelledby="invoice-summary-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="invoice-summary-title" className="text-xl font-semibold">
          {t('invoiceSummary')}
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Metric label={t('client')} value={invoice.clientName} />
          <Metric
            label={t('recipient')}
            value={snapshotString(recipient, 'name') ?? invoice.recipientName ?? '—'}
          />
          <Metric
            label={t('recipientAddress')}
            value={snapshotString(recipient, 'address') ?? invoice.recipientAddress ?? '—'}
          />
          <Metric label={t('issueDate')} value={formatDate(invoice.issueDate, locale) ?? '—'} />
          <Metric
            label={t('servicePeriod')}
            value={period(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale)}
          />
          <Metric label={t('dueDate')} value={formatDate(invoice.dueDate, locale) ?? '—'} />
          <Metric label={t('netAmount')} value={formatCents(invoice.subtotalCents, locale)} />
          <Metric label={t('taxAmount')} value={formatCents(invoice.taxTotalCents, locale)} />
          <Metric label={t('amount')} value={formatCents(invoice.grandTotalCents, locale)} />
          {invoice.outstandingCents !== null ? (
            <Metric
              label={t('outstandingAmount')}
              value={formatCents(invoice.outstandingCents, locale)}
            />
          ) : null}
          {invoice.receivableStatus ? (
            <Metric
              label={t('paymentStatus')}
              value={t(`receivableStatus.${invoice.receivableStatus}`)}
            />
          ) : null}
          <Metric
            label={t('pdfStatusLabel')}
            value={invoice.pdfStatus ? t(`pdfStatus.${invoice.pdfStatus}`) : '—'}
          />
          {invoice.status === 'issued' ? (
            <Metric
              label={t('issuer')}
              value={
                snapshotString(issuer, 'legalName') ?? snapshotString(issuer, 'tradingName') ?? '—'
              }
            />
          ) : null}
        </dl>
        {invoice.status === 'issued' ? (
          <div className="flex flex-wrap gap-2">
            {canManageClaims ? (
              <Button asChild variant="secondary">
                <Link href={'/billing/claims/new?invoiceId=' + invoice.id}>{t('createClaim')}</Link>
              </Button>
            ) : null}
            {invoice.pdfStatus === 'ready' ? (
              <Button asChild>
                <Link href={`/billing/invoices/${invoice.id}/pdf`}>{t('downloadPdf')}</Link>
              </Button>
            ) : null}
            {invoice.pdfStatus === 'failed' || invoice.pdfStatus === null ? (
              canIssue ? (
                <form action={regenerateInvoicePdfAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <Button type="submit" variant="secondary">
                    {t('regeneratePdf')}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-amber-900">{t('pdfUnavailable')}</p>
              )
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="lines-title" className="grid gap-3 rounded-lg border bg-white p-5">
        <h2 id="lines-title" className="text-xl font-semibold">
          {t('invoiceLines')}
        </h2>
        {invoice.lines.length ? (
          <div className="overflow-x-auto">
            <ShadcnTable className="w-full min-w-[52rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-slate-600">
                  <ShadcnTableHead className="p-2">{t('service')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('serviceDate')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('quantity')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('unitPrice')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('fundingSource')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('taxTreatment')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('amount')}</ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {invoice.lines.map((line) => (
                  <ShadcnTableRow key={line.id} className="border-b last:border-0">
                    <ShadcnTableCell className="p-2">
                      {line.serviceNameSnapshot}
                      <span className="block text-xs text-slate-600">
                        {line.serviceCodeSnapshot}
                      </span>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {formatDate(line.serviceDate, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {line.quantity} {t(`unit.${line.unit}`)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {formatCents(line.unitPriceCents, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {line.fundingLabelSnapshot ?? t('selfPay')}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {t(`taxTreatments.${line.taxTreatment}`)}
                      {line.taxRateBasisPoints
                        ? ` · ${(line.taxRateBasisPoints / 100).toFixed(2)}%`
                        : ''}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2 font-medium">
                      {formatCents(line.grossCents, locale)}
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="text-sm text-slate-700">{t('noInvoiceLines')}</p>
        )}
      </section>

      {invoice.status === 'draft' ? (
        <section
          aria-labelledby="draft-actions-title"
          className="grid gap-4 rounded-lg border bg-white p-5"
        >
          <div>
            <h2 id="draft-actions-title" className="text-xl font-semibold">
              {t('editDraft')}
            </h2>
            <p className="mt-1 text-sm text-slate-700">{t('editDraftDescription')}</p>
          </div>
          {canEdit ? (
            <div className="grid gap-4">
              <RHFActionForm action={updateDraftInvoiceAction} className="grid gap-4">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="expectedVersion" value={invoice.version} />
                <input type="hidden" name="organizationId" value={invoice.organizationId} />
                <input type="hidden" name="facilityId" value={invoice.facilityId} />
                <input type="hidden" name="clientId" value={invoice.clientId} />
                <input type="hidden" name="recipientType" value={invoice.recipientType} />
                {invoice.payerArrangementId ? (
                  <input
                    type="hidden"
                    name="payerArrangementId"
                    value={invoice.payerArrangementId}
                  />
                ) : null}
                <ul className="grid gap-3">
                  {invoice.lines.map((line) => (
                    <li
                      key={line.id}
                      className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_14rem]"
                    >
                      <div>
                        <p className="font-medium">{line.serviceNameSnapshot}</p>
                        <p className="text-sm text-slate-700">
                          {formatDate(line.serviceDate, locale)} ·{' '}
                          {line.fundingLabelSnapshot ?? t('selfPay')} ·{' '}
                          {formatCents(line.grossCents, locale)}
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <ShadcnCheckbox
                            name="selectedLine"
                            value={`${line.performedServiceId}|${line.fundingAllocationId ?? ''}`}
                            defaultChecked
                          />
                          {t('keepDraftLine')}
                        </label>
                        <Field
                          id={`draft-line-${line.id}`}
                          name={lineAmountField(line.performedServiceId, line.fundingAllocationId)}
                          label={t('invoiceAmount')}
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={euroInput(line.amountCents)}
                          required
                        />
                      </div>
                    </li>
                  ))}
                  {addableCandidates.map((candidate) => (
                    <li
                      key={candidate.id}
                      className="grid gap-3 rounded-md border border-dashed p-4 md:grid-cols-[1fr_14rem]"
                    >
                      <div>
                        <p className="font-medium">
                          {t('availableService')}: {candidate.serviceName}
                        </p>
                        <p className="text-sm text-slate-700">
                          {formatDate(candidate.serviceDate, locale)} ·{' '}
                          {candidate.fundingLabel ?? t('selfPay')} ·{' '}
                          {formatCents(candidate.remainingBillableAmountCents, locale)}
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <ShadcnCheckbox
                            name="selectedLine"
                            value={`${candidate.performedServiceId}|${candidate.fundingAllocationId ?? ''}`}
                          />
                          {t('addDraftLine')}
                        </label>
                        <Field
                          id={`add-line-${candidate.id}`}
                          name={lineAmountField(
                            candidate.performedServiceId,
                            candidate.fundingAllocationId,
                          )}
                          label={t('invoiceAmount')}
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={euroInput(candidate.remainingBillableAmountCents)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {addableCandidates.length === 0 ? (
                  <p className="text-sm text-slate-700">{t('noAdditionalServices')}</p>
                ) : null}
                <Button type="submit" className="w-fit">
                  {t('saveDraft')}
                </Button>
              </RHFActionForm>
              <div className="flex flex-wrap gap-2">
                {canIssue ? (
                  <form action={issueInvoiceAction}>
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <input type="hidden" name="expectedVersion" value={invoice.version} />
                    <Button type="submit">{t('issueInvoice')}</Button>
                  </form>
                ) : null}
                <form action={cancelDraftInvoiceAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <Button type="submit" variant="secondary">
                    {t('cancelDraft')}
                  </Button>
                </form>
                <Button asChild variant="secondary">
                  <Link href="/billing">{t('returnToWorklist')}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-700">{t('noManagePermission')}</p>
          )}
        </section>
      ) : null}

      {invoice.status === 'issued' ? (
        <>
          <section
            aria-labelledby="corrections-title"
            className="grid gap-3 rounded-lg border bg-white p-5"
          >
            <h2 id="corrections-title" className="text-xl font-semibold">
              {t('corrections')}
            </h2>
            {invoice.corrections.length ? (
              <ul className="grid gap-2">
                {invoice.corrections.map((correction) => (
                  <li
                    key={correction.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                  >
                    <span>
                      <strong>{correction.correctionNumber}</strong> ·{' '}
                      {formatCents(correction.amountCents, locale)} · {correction.reason} ·{' '}
                      {formatDateTime(correction.createdAt, locale)}
                    </span>
                    <Button asChild variant="secondary" size="sm">
                      <Link
                        href={`/billing/invoices/${invoice.id}/corrections/${correction.id}/pdf`}
                      >
                        {t('downloadCorrectionPdf')}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-700">{t('correctionsEmpty')}</p>
            )}
          </section>
          {canCorrect && invoice.outstandingCents !== null && invoice.outstandingCents > 0 ? (
            <section
              aria-labelledby="create-correction-title"
              className="grid gap-3 rounded-lg border bg-white p-5"
            >
              <h2 id="create-correction-title" className="text-xl font-semibold">
                {t('createCorrection')}
              </h2>
              <RHFActionForm action={correctInvoiceAction} className="grid gap-3">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <Field
                  id="correction-reason"
                  name="reason"
                  label={t('correctionReason')}
                  required
                />
                <ul className="grid gap-2">
                  {invoice.lines.map((line) => (
                    <li
                      key={line.id}
                      className="grid gap-3 rounded border p-3 md:grid-cols-[1fr_14rem]"
                    >
                      <p className="text-sm">
                        {line.serviceNameSnapshot} · {formatCents(line.grossCents, locale)}
                      </p>
                      <div className="grid gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <ShadcnCheckbox name="selectedCorrectionLine" value={line.id} />
                          {t('correctLine')}
                        </label>
                        <Field
                          id={`correction-amount-${line.id}`}
                          name={`correctionAmount-${line.id}`}
                          label={t('correctionAmount')}
                          type="number"
                          min="0.01"
                          max={euroInput(invoice.outstandingCents)}
                          step="0.01"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-slate-700">
                  {t('correctionOutstandingLimit', {
                    amount: formatCents(invoice.outstandingCents, locale),
                  })}
                </p>
                <Button type="submit" className="w-fit">
                  {t('createCorrection')}
                </Button>
              </RHFActionForm>
            </section>
          ) : null}
          <section
            aria-labelledby="payment-history-title"
            className="grid gap-3 rounded-lg border bg-white p-5"
          >
            <h2 id="payment-history-title" className="text-xl font-semibold">
              {t('paymentHistory')}
            </h2>
            {invoice.paymentHistory.length ? (
              <ul className="grid gap-2">
                {invoice.paymentHistory.map((payment) => (
                  <li key={payment.allocationId} className="rounded border p-3 text-sm">
                    {formatDateTime(payment.receivedAt, locale)} ·{' '}
                    {payment.payerNameSnapshot ?? t('unknownPayer')} ·{' '}
                    {formatCents(payment.amountCents, locale)} ·{' '}
                    {t(`paymentMethods.${payment.method}`)}
                    {payment.reversedAt
                      ? ` · ${t('allocationReversed')}: ${payment.reversalReason ?? ''}`
                      : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-700">{t('noPaymentAllocations')}</p>
            )}
            <Button asChild variant="secondary">
              <Link href={`/billing/payments?invoiceId=${invoice.id}`}>
                {t('recordOrAllocatePayment')}
              </Link>
            </Button>
          </section>
        </>
      ) : null}
    </div>
  );
}

function snapshotString(snapshot: Record<string, unknown>, field: string): string | null {
  const value = snapshot[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function period(from: string | null, until: string | null, locale: Locale): string {
  const start = formatDate(from, locale);
  const end = formatDate(until, locale);
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end ?? '—');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
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
function Warning({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
      {children}
    </p>
  );
}
function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
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
        min={min}
        max={max}
        step={step}
        required={required}
      />
    </label>
  );
}
