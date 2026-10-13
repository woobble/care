import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui';
import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { formatCents } from '@app/web/app/(office)/billing/format';
import {
  allocatePaymentAction,
  cancelClaimAction,
  prepareClaimAction,
  recordClaimDecisionAction,
  resubmitClaimAction,
  submitClaimAction,
} from '@app/web/app/(office)/billing/actions';

type ClaimStatus =
  | 'draft'
  | 'ready'
  | 'submitted'
  | 'accepted'
  | 'partially_accepted'
  | 'rejected'
  | 'clarification_required'
  | 'resubmitted'
  | 'cancelled';
type ClaimDetail = {
  claim: {
    id: string;
    organizationId: string;
    facilityId: string;
    clientId: string;
    invoiceId: string;
    amountCents: number;
    status: ClaimStatus;
    version: number;
    channel: string | null;
    packageVersion: number;
    packageHash: string | null;
    payerSnapshot: Record<string, unknown>;
    invoiceSnapshot: Record<string, unknown>;
    arrangementSnapshot: Record<string, unknown>;
    profileSnapshot: Record<string, unknown>;
    createdAt: string;
    preparedAt: string | null;
  };
  lines: Array<{
    id: string;
    invoiceLineId: string;
    amountCents: number;
    serviceDate: string;
    serviceNameSnapshot: string;
    fundingLabelSnapshot: string | null;
  }>;
  submissions: Array<{
    id: string;
    submissionNumber: number;
    channel: string;
    submittedAt: string;
    externalReference: string | null;
    packageVersion: number;
    packageHash: string;
  }>;
  decisions: Array<{
    id: string;
    decision: string;
    decisionDate: string;
    acceptedCents: number;
    rejectedCents: number;
    reasonCode: string | null;
    externalReference: string | null;
    lines: Array<{ claimLineId: string; acceptedCents: number; rejectedCents: number }>;
  }>;
  packageDocuments: Array<{
    id: string;
    documentKind: string;
    fileName: string;
    sha256: string;
    packageVersion: number;
    sourceVersion: string;
  }>;
};
type Readiness = {
  ready: boolean;
  blockers: Array<{ code: string; field: string; detail: string; blocking: boolean }>;
};
type PaymentSummary = {
  acceptedCents: number;
  paidCents: number;
  unpaidCents: number;
  allocations: Array<{
    allocationId: string;
    paymentId: string;
    paymentReference: string | null;
    amountCents: number;
    allocatedAt: string;
    reversedAt: string | null;
  }>;
};
type History = { entries: Array<{ type: string; at: string; [key: string]: unknown }> };
type Payment = {
  id: string;
  organizationId: string;
  receivedAt: string;
  reference: string | null;
  remainingCents: number;
  method: string;
};
type SearchParams = Promise<{
  error?: string;
  updated?: string;
  paymentPage?: string;
  paymentPageSize?: string;
}>;

export default async function ClaimDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const paymentPage = positiveInteger(query.paymentPage, 1, 100_000, 1);
  const paymentPageSize = positiveInteger(query.paymentPageSize, 10, 100, 20);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [detailResult, readinessResult, historyResult, paymentResult, permissions] =
    await Promise.all([
      api.GET('/api/v1/billing/claims/{id}', { params: { path: { id }, header } }),
      api.GET('/api/v1/billing/claims/{id}/readiness', { params: { path: { id }, header } }),
      api.GET('/api/v1/billing/claims/{id}/history', { params: { path: { id }, header } }),
      api.GET('/api/v1/billing/claims/{id}/payment-summary', {
        params: { path: { id }, header },
      }),
      getPermissionGrants(api),
    ]);
  if (detailResult.error?.code === 'CLAIM_NOT_FOUND') notFound();
  const detail = detailResult.data as ClaimDetail | undefined;
  if (!detail?.claim) notFound();
  const claim = detail.claim;
  const canManage = hasClientPermission(
    permissions,
    'claims.manage',
    header['X-Tenant-Id'],
    claim.organizationId,
    claim.facilityId,
  );
  const canReadInvoice = hasClientPermission(
    permissions,
    'billing.read',
    header['X-Tenant-Id'],
    claim.organizationId,
    claim.facilityId,
  );
  const canSubmit = hasClientPermission(
    permissions,
    'claims.submit',
    header['X-Tenant-Id'],
    claim.organizationId,
    claim.facilityId,
  );
  const canRecordDecision = hasClientPermission(
    permissions,
    'claims.record_decision',
    header['X-Tenant-Id'],
    claim.organizationId,
    claim.facilityId,
  );
  const canReconcile =
    hasClientPermission(
      permissions,
      'claims.reconcile',
      header['X-Tenant-Id'],
      claim.organizationId,
      claim.facilityId,
    ) &&
    hasClientPermission(
      permissions,
      'billing.payments.manage',
      header['X-Tenant-Id'],
      claim.organizationId,
      claim.facilityId,
    );
  const readiness = readinessResult.data as Readiness | undefined;
  const payment = paymentResult.data as PaymentSummary | undefined;
  const history = historyResult.data as History | undefined;
  const paymentsResult =
    canReconcile && payment && payment.unpaidCents > 0 && claim.status !== 'submitted'
      ? await api.GET('/api/v1/billing/payments', {
          params: {
            query: {
              organizationId: claim.organizationId,
              remainingOnly: 'true',
              page: paymentPage,
              pageSize: paymentPageSize,
            },
            header,
          },
        })
      : null;
  const paymentData = paymentsResult?.data as
    | { items: Payment[]; page: number; pageSize: number; total: number }
    | undefined;
  const payments = paymentData?.items ?? [];
  if (paymentData) {
    redirectToValidPage(
      `/billing/claims/${claim.id}`,
      query,
      paymentPage,
      paymentData.pageSize,
      paymentData.total,
      'paymentPage',
      'paymentPageSize',
    );
  }
  const error =
    query.error ??
    detailResult.error?.code ??
    readinessResult.error?.code ??
    historyResult.error?.code ??
    paymentResult.error?.code ??
    paymentsResult?.error?.code;
  const invoiceNumber =
    snapshotText(claim.invoiceSnapshot, 'invoiceNumber') ?? t('draftIdentifier');
  const payerName = snapshotText(claim.payerSnapshot, 'name') ?? t('payer');
  const clientName =
    snapshotText(claim.invoiceSnapshot, 'clientName') ?? translate('Resources.unavailableClient');
  const canDecide = canRecordDecision && claim.status === 'submitted';
  const canPrepare = canManage && claim.status === 'draft';
  const canSubmitNow = canSubmit && claim.status === 'ready';
  const canResubmit =
    canManage &&
    ['partially_accepted', 'rejected', 'clarification_required'].includes(claim.status);
  const canCancel = canManage && ['draft', 'ready'].includes(claim.status);
  const showPaymentForm =
    canReconcile &&
    payment !== undefined &&
    payment.unpaidCents > 0 &&
    ['accepted', 'partially_accepted', 'resubmitted'].includes(claim.status);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={<Link href="/billing/claims">{t('claims')}</Link>}
        title={`${t('claim')} · ${invoiceNumber}`}
        description={`${clientName} · ${payerName} · ${claimStatus(t, claim.status)}`}
        actions={
          canReadInvoice ? (
            <Button asChild variant="secondary">
              <Link href={'/billing/invoices/' + claim.invoiceId}>{t('openInvoice')}</Link>
            </Button>
          ) : undefined
        }
      />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {query.updated ? <Status>{updatedLabel(t, query.updated)}</Status> : null}

      <section aria-labelledby="claim-summary" className="grid gap-4 rounded-lg border bg-card p-5">
        <h2 id="claim-summary" className="text-xl font-semibold">
          {t('claimSummary')}
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Metric label={t('client')} value={clientName} />
          <Metric label={t('payer')} value={payerName} />
          <Metric label={t('invoiceNumber')} value={invoiceNumber} />
          <Metric
            label={t('claimAmount')}
            value={formatCents(claim.amountCents, locale as Locale)}
          />
          <Metric label={t('claimStatusLabel')} value={claimStatus(t, claim.status)} />
          <Metric label={t('claimChannel')} value={channelLabel(t, claim.channel)} />
          <Metric
            label={t('claimCreatedAt')}
            value={formatDateTime(claim.createdAt, locale as Locale) ?? '—'}
          />
          <Metric
            label={t('claimPackageVersion')}
            value={claim.packageVersion ? String(claim.packageVersion) : '—'}
          />
          <Metric label={t('claimPackageHash')} value={claim.packageHash ?? '—'} />
        </dl>
        <p className="rounded-md border border-primary/20 bg-accent p-3 text-sm text-primary">
          {t('manualSubmissionNotice')}
        </p>
      </section>

      <section
        aria-labelledby="claim-readiness"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="claim-readiness" className="text-xl font-semibold">
          {t('claimReadiness')}
        </h2>
        {readiness?.ready ? (
          <p className="text-sm text-success-foreground">{t('claimReady')}</p>
        ) : readiness?.blockers.length ? (
          <ul className="grid gap-2">
            {readiness.blockers.map((blocker, index) => (
              <li
                key={blocker.code + '-' + index}
                className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground"
              >
                <strong>{blocker.field}</strong>: {blocker.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('claimReadinessUnavailable')}</p>
        )}
        {canPrepare || canCancel ? (
          <div className="flex flex-wrap gap-2">
            {canPrepare ? (
              <form action={prepareClaimAction}>
                <input type="hidden" name="claimId" value={claim.id} />
                <input type="hidden" name="expectedVersion" value={claim.version} />
                <Button type="submit" disabled={!readiness?.ready}>
                  {t('prepareClaimPackage')}
                </Button>
              </form>
            ) : null}
            {canCancel ? (
              <form action={cancelClaimAction}>
                <input type="hidden" name="claimId" value={claim.id} />
                <input type="hidden" name="expectedVersion" value={claim.version} />
                <Button type="submit" variant="secondary">
                  {t('cancelClaim')}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="claim-lines" className="grid gap-3 rounded-lg border bg-card p-5">
        <h2 id="claim-lines" className="text-xl font-semibold">
          {t('claimLines')}
        </h2>
        <div className="overflow-x-auto">
          <ShadcnTable className="w-full min-w-[40rem] text-left text-sm">
            <ShadcnTableHeader>
              <ShadcnTableRow className="border-b text-muted-foreground">
                <ShadcnTableHead className="p-2">{t('service')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('serviceDate')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('fundingSource')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('claimAmount')}</ShadcnTableHead>
              </ShadcnTableRow>
            </ShadcnTableHeader>
            <ShadcnTableBody>
              {detail.lines.map((line) => (
                <ShadcnTableRow key={line.id} className="border-b last:border-0">
                  <ShadcnTableCell className="p-2">
                    {line.serviceNameSnapshot || translate('Resources.unavailableService')}
                  </ShadcnTableCell>
                  <ShadcnTableCell className="p-2">
                    {formatDate(line.serviceDate, locale as Locale) ?? line.serviceDate}
                  </ShadcnTableCell>
                  <ShadcnTableCell className="p-2">
                    {line.fundingLabelSnapshot ?? '—'}
                  </ShadcnTableCell>
                  <ShadcnTableCell className="p-2">
                    {formatCents(line.amountCents, locale as Locale)}
                  </ShadcnTableCell>
                </ShadcnTableRow>
              ))}
            </ShadcnTableBody>
          </ShadcnTable>
        </div>
      </section>

      {claim.packageVersion > 0 ? (
        <section
          aria-labelledby="claim-documents"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="claim-documents" className="text-xl font-semibold">
            {t('claimPackage')}
          </h2>
          {detail.packageDocuments.length ? (
            <ul className="grid gap-2">
              {detail.packageDocuments.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">{document.fileName}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t('claimDocumentMetadata', {
                        kind: document.documentKind,
                        version: document.packageVersion,
                        hash: document.sha256,
                      })}
                    </p>
                  </div>
                  <Button asChild variant="secondary">
                    <Link href={'/billing/claims/' + claim.id + '/documents/' + document.id}>
                      {t('downloadClaimDocument')}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('claimPackageEmpty')}</p>
          )}
        </section>
      ) : null}

      {canSubmitNow ? (
        <section
          aria-labelledby="claim-submit"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="claim-submit" className="text-xl font-semibold">
            {t('recordManualSubmission')}
          </h2>
          <RHFActionForm action={submitClaimAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="claimId" value={claim.id} />
            <input type="hidden" name="expectedVersion" value={claim.version} />
            <Field
              id="submission-reference"
              name="externalReference"
              label={t('externalReference')}
            />
            <Field id="submission-note" name="protectedNote" label={t('protectedNote')} />
            <Button type="submit" className="w-fit md:col-span-2">
              {t('recordSubmission')}
            </Button>
          </RHFActionForm>
        </section>
      ) : null}

      {canDecide ? (
        <section
          aria-labelledby="claim-decision"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="claim-decision" className="text-xl font-semibold">
            {t('recordPayerDecision')}
          </h2>
          <RHFActionForm action={recordClaimDecisionAction} className="grid gap-4">
            <input type="hidden" name="claimId" value={claim.id} />
            <input type="hidden" name="expectedVersion" value={claim.version} />
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                id="decision"
                name="decision"
                label={t('decision')}
                defaultValue="accepted"
              >
                <option value="accepted">{claimStatus(t, 'accepted')}</option>
                <option value="partially_accepted">{claimStatus(t, 'partially_accepted')}</option>
                <option value="rejected">{claimStatus(t, 'rejected')}</option>
                <option value="clarification_required">
                  {claimStatus(t, 'clarification_required')}
                </option>
              </SelectField>
              <Field
                id="decision-date"
                name="decisionDate"
                label={t('decisionDate')}
                type="date"
                defaultValue={today()}
                required
              />
              <Field
                id="decision-reference"
                name="externalReference"
                label={t('externalReference')}
              />
              <Field id="reason-code" name="reasonCode" label={t('reasonCode')} />
              <Field
                id="decision-explanation"
                name="protectedExplanation"
                label={t('protectedExplanation')}
              />
            </div>
            <p className="text-sm text-muted-foreground">{t('claimDecisionLinesNote')}</p>
            <div className="grid gap-2">
              {detail.lines.map((line) => (
                <div
                  key={line.id}
                  className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_10rem_10rem]"
                >
                  <input type="hidden" name="claimLineId" value={line.id} />
                  <p className="self-center text-sm">
                    {line.serviceNameSnapshot || translate('Resources.unavailableService')} ·{' '}
                    {formatCents(line.amountCents, locale as Locale)}
                  </p>
                  <Field
                    id={'accepted-' + line.id}
                    name={'accepted-' + line.id}
                    label={t('acceptedAmount')}
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={(line.amountCents / 100).toFixed(2)}
                  />
                  <Field
                    id={'rejected-' + line.id}
                    name={'rejected-' + line.id}
                    label={t('rejectedAmount')}
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue="0.00"
                  />
                </div>
              ))}
            </div>
            <Button type="submit" className="w-fit">
              {t('savePayerDecision')}
            </Button>
          </RHFActionForm>
        </section>
      ) : null}

      {canResubmit ? (
        <section
          aria-labelledby="claim-resubmit"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="claim-resubmit" className="text-xl font-semibold">
            {t('resubmission')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('resubmissionDescription')}</p>
          <form action={resubmitClaimAction}>
            <input type="hidden" name="claimId" value={claim.id} />
            <input type="hidden" name="expectedVersion" value={claim.version} />
            <Button type="submit">{t('createResubmission')}</Button>
          </form>
        </section>
      ) : null}

      {payment ? (
        <section
          aria-labelledby="claim-payment"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="claim-payment" className="text-xl font-semibold">
            {t('claimPaymentReconciliation')}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Metric
              label={t('acceptedAmount')}
              value={formatCents(payment.acceptedCents, locale as Locale)}
            />
            <Metric
              label={t('paymentReceived')}
              value={formatCents(payment.paidCents, locale as Locale)}
            />
            <Metric
              label={t('unpaidAcceptedAmount')}
              value={formatCents(payment.unpaidCents, locale as Locale)}
            />
          </dl>
          {payment.allocations.length ? (
            <ul className="grid gap-2">
              {payment.allocations.map((allocation) => (
                <li key={allocation.allocationId} className="rounded-md border p-3 text-sm">
                  {allocation.paymentReference ?? t('paymentReceived')} ·{' '}
                  {formatCents(allocation.amountCents, locale as Locale)} ·{' '}
                  {formatDateTime(allocation.allocatedAt, locale as Locale) ?? '—'}
                  {allocation.reversedAt ? ' · ' + t('allocationReversed') : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {showPaymentForm ? (
            payments.length ? (
              <div className="grid gap-3 border-t pt-3">
                <h3 className="font-semibold">{t('matchIncomingPayment')}</h3>
                {payments.map((paymentItem) => (
                  <RHFActionForm
                    key={paymentItem.id}
                    action={allocatePaymentAction}
                    className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_12rem_auto]"
                  >
                    <input type="hidden" name="claimId" value={claim.id} />
                    <input type="hidden" name="invoiceId" value={claim.invoiceId} />
                    <input type="hidden" name="paymentId" value={paymentItem.id} />
                    <p className="self-center text-sm">
                      {paymentItem.reference ?? t('paymentReceived')} ·{' '}
                      {formatDateTime(paymentItem.receivedAt, locale as Locale) ?? '—'} ·{' '}
                      {t('paymentRemaining')}:{' '}
                      {formatCents(paymentItem.remainingCents, locale as Locale)}
                    </p>
                    <Field
                      id={'claim-payment-' + paymentItem.id}
                      name="amount"
                      label={t('paymentAmount')}
                      type="number"
                      min="0.01"
                      max={String(Math.min(paymentItem.remainingCents, payment.unpaidCents) / 100)}
                      step="0.01"
                      defaultValue={(
                        Math.min(paymentItem.remainingCents, payment.unpaidCents) / 100
                      ).toFixed(2)}
                      required
                    />
                    <Button type="submit" className="self-end">
                      {t('linkPayment')}
                    </Button>
                  </RHFActionForm>
                ))}
                {paymentData ? (
                  <DataPagination
                    pathname={`/billing/claims/${claim.id}`}
                    page={paymentData.page}
                    pageSize={paymentData.pageSize}
                    totalItems={paymentData.total}
                    pageParam="paymentPage"
                    pageSizeParam="paymentPageSize"
                    controlId="claim-payment-page-size"
                    filters={{ error: query.error, updated: query.updated }}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noUnallocatedPayments')}</p>
            )
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="claim-history" className="grid gap-3 rounded-lg border bg-card p-5">
        <h2 id="claim-history" className="text-xl font-semibold">
          {t('claimHistory')}
        </h2>
        {history?.entries.length ? (
          <ol className="grid gap-2">
            {history.entries.map((entry, index) => (
              <li key={entry.type + '-' + index} className="rounded-md border p-3 text-sm">
                <strong>{historyLabel(t, entry.type)}</strong> ·{' '}
                {formatDateTime(entry.at, locale as Locale) ?? entry.at}
                {typeof entry.submissionNumber === 'number' ? ' · #' + entry.submissionNumber : ''}
                {typeof entry.decision === 'string'
                  ? ' · ' + claimStatus(t, entry.decision as ClaimStatus)
                  : ''}
                {typeof entry.externalReference === 'string' ? ' · ' + entry.externalReference : ''}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t('claimHistoryEmpty')}</p>
        )}
      </section>
    </div>
  );
}

function snapshotText(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function positiveInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function claimStatus(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  status: ClaimStatus,
): string {
  switch (status) {
    case 'draft':
      return t('claimStatus.draft');
    case 'ready':
      return t('claimStatus.ready');
    case 'submitted':
      return t('claimStatus.submitted');
    case 'accepted':
      return t('claimStatus.accepted');
    case 'partially_accepted':
      return t('claimStatus.partially_accepted');
    case 'rejected':
      return t('claimStatus.rejected');
    case 'clarification_required':
      return t('claimStatus.clarification_required');
    case 'resubmitted':
      return t('claimStatus.resubmitted');
    case 'cancelled':
      return t('claimStatus.cancelled');
  }
}

function channelLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  channel: string | null,
): string {
  switch (channel) {
    case 'manual_portal':
      return t('claimChannels.manual_portal');
    case 'manual_email':
      return t('claimChannels.manual_email');
    case 'postal':
      return t('claimChannels.postal');
    case 'customer_reimbursement':
      return t('claimChannels.customer_reimbursement');
    default:
      return '—';
  }
}

function updatedLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  updated: string,
): string {
  switch (updated) {
    case 'created':
      return t('claimCreated');
    case 'prepared':
      return t('claimPrepared');
    case 'submitted':
      return t('claimSubmitted');
    case 'decision':
      return t('claimDecisionSaved');
    case 'resubmitted':
      return t('claimResubmitted');
    case 'cancelled':
      return t('claimCancelled');
    case 'payment':
      return t('claimPaymentSaved');
    default:
      return t('claimUpdated');
  }
}

function historyLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  type: string,
): string {
  switch (type) {
    case 'created':
      return t('claimCreatedAt');
    case 'prepared':
      return t('claimPrepared');
    case 'submitted':
      return t('submission');
    case 'decision':
      return t('payerDecision');
    case 'cancelled':
      return t('claimStatus.cancelled');
    default:
      return type;
  }
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
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
  required = false,
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
    <label className="grid gap-1 text-sm" htmlFor={id}>
      {label}
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

function SelectField({
  id,
  name,
  label,
  defaultValue,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={id}>
      {label}
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        selectClassName="h-10 rounded-md border px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
