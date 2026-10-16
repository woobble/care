import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import {
  allocatePaymentAction,
  cancelClaimAction,
  prepareClaimAction,
  recordClaimDecisionAction,
  resubmitClaimAction,
  submitClaimAction,
} from '@app/web/app/(office)/billing/actions';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { DataPagination } from '@app/web/components/data-pagination';
import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
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
    fundingSourceType: string;
    status: ClaimStatus;
    version: number;
    supersedesClaimId: string | null;
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
    evidencePackageId: string;
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
    submittedBy: string;
  }>;
  decisions: Array<{
    id: string;
    decision: string;
    decisionDate: string;
    acceptedCents: number;
    rejectedCents: number;
    reasonCode: string | null;
    protectedExplanation: string | null;
    externalReference: string | null;
    recordedBy: string;
    createdAt: string;
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
  const canReadClient = hasClientPermission(
    permissions,
    'client.read',
    header['X-Tenant-Id'],
    claim.organizationId,
    claim.facilityId,
  );
  const canReadEvidence = hasClientPermission(
    permissions,
    'service_evidence.read',
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
  const latestDecision = detail.decisions.at(-1);
  const invoiceTotalCents = snapshotNumber(claim.invoiceSnapshot, 'grandTotalCents');
  const arrangementStatus = snapshotText(claim.arrangementSnapshot, 'mandateStatus');
  const profileConfigured = claim.profileSnapshot.configured === true;

  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 grid-cols-1 gap-6">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/billing/claims">{t('claims')}</Link>
            <span aria-hidden="true">·</span>
            <span>{claimReference(claim.id)}</span>
          </span>
        }
        title={`${t('claim')} · ${invoiceNumber}`}
        description={`${clientName} · ${payerName}`}
        meta={<StatusBadge status={claim.status} label={claimStatus(t, claim.status)} />}
        actions={
          <div className="flex flex-wrap gap-2">
            {canReadInvoice ? (
              <Button asChild variant="secondary">
                <Link href={'/billing/invoices/' + claim.invoiceId}>{t('openInvoice')}</Link>
              </Button>
            ) : null}
            {canReadClient ? (
              <Button asChild variant="secondary">
                <Link href={`/clients/${claim.clientId}/invoices`}>{t('client')}</Link>
              </Button>
            ) : null}
          </div>
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
          <Metric label={t('claimReference')} value={claimReference(claim.id)} />
          <Metric label={t('client')} value={clientName} />
          <Metric label={t('payer')} value={payerName} />
          <Metric label={t('invoiceNumber')} value={invoiceNumber} />
          <Metric
            label={t('invoiceTotal')}
            value={
              invoiceTotalCents === null ? '—' : formatCents(invoiceTotalCents, locale as Locale)
            }
          />
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
          <Metric
            label={t('claimPackageHash')}
            value={claim.packageHash ?? '—'}
            valueClassName="break-all"
          />
        </dl>
        <p className="rounded-md border border-primary/20 bg-accent p-3 text-sm text-primary">
          {t('manualSubmissionNotice')}
        </p>
      </section>

      <section
        aria-labelledby="claim-payer-context"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <div>
          <h2 id="claim-payer-context" className="text-xl font-semibold">
            {t('claimPayerAndMandate')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('claimPayerContextDescription')}</p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label={t('payerIdentifier')}
            value={snapshotText(claim.payerSnapshot, 'payerIdentifier') ?? '—'}
          />
          <Metric
            label={t('claimArrangementType')}
            value={arrangementTypeLabel(
              t,
              snapshotText(claim.arrangementSnapshot, 'arrangementType'),
            )}
          />
          <Metric
            label={t('claimMandateStatus')}
            value={mandateStatusLabel(t, arrangementStatus)}
          />
          <Metric
            label={t('claimMandateValidity')}
            value={formatValidity(
              snapshotText(claim.arrangementSnapshot, 'validFrom'),
              snapshotText(claim.arrangementSnapshot, 'validUntil'),
              locale as Locale,
            )}
          />
          <Metric
            label={t('claimMandateSource')}
            value={snapshotText(claim.arrangementSnapshot, 'documentedSource') ?? '—'}
          />
          <Metric
            label={t('claimMandateReference')}
            value={snapshotText(claim.arrangementSnapshot, 'documentedReference') ?? '—'}
          />
          <Metric
            label={t('fundingSource')}
            value={fundingSourceLabel(t, claim.fundingSourceType)}
          />
          <Metric
            label={t('payerRequirementsProfile')}
            value={
              profileConfigured
                ? `${snapshotText(claim.profileSnapshot, 'sourceName') ?? t('claimConfigured')} · ${snapshotText(claim.profileSnapshot, 'sourceVersion') ?? ''}`
                : t('unconfiguredPayerRequirements')
            }
          />
          <Metric label={t('claimChannel')} value={channelLabel(t, claim.channel)} />
        </dl>
        {claim.supersedesClaimId ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            {t('claimReplacesPrevious')}{' '}
            <Link
              className="font-medium text-primary underline"
              href={`/billing/claims/${claim.supersedesClaimId}`}
            >
              {claimReference(claim.supersedesClaimId)}
            </Link>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {canReadClient ? (
            <Button asChild variant="secondary">
              <Link href={`/clients/${claim.clientId}/invoices`}>
                {t('managePayerArrangements')}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link
              href={`/billing/claims/settings?organizationId=${claim.organizationId}&q=${encodeURIComponent(payerName)}`}
            >
              {t('payerDirectoryEntry')}
            </Link>
          </Button>
        </div>
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
                <strong>{readinessFieldLabel(t, blocker.field)}</strong>: {blocker.detail}
                {readinessHref(
                  blocker.field,
                  detail.lines,
                  claim,
                  canReadClient,
                  canReadInvoice,
                  canReadEvidence,
                ) ? (
                  <Link
                    className="mt-2 block font-medium underline"
                    href={readinessHref(
                      blocker.field,
                      detail.lines,
                      claim,
                      canReadClient,
                      canReadInvoice,
                      canReadEvidence,
                    )!}
                  >
                    {readinessActionLabel(t, blocker.field)}
                  </Link>
                ) : null}
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
                <ConfirmSubmitButton confirmation={t('confirmCancelClaim')} variant="secondary">
                  {t('cancelClaim')}
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="claim-lines" className="grid gap-3 rounded-lg border bg-card p-5">
        <h2 id="claim-lines" className="text-xl font-semibold">
          {t('claimLines')}
        </h2>
        <div className="hidden overflow-x-auto md:block">
          <ShadcnTable className="w-full min-w-[48rem] text-left text-sm">
            <ShadcnTableHeader>
              <ShadcnTableRow className="border-b text-muted-foreground">
                <ShadcnTableHead className="p-2">{t('service')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('serviceDate')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('fundingSource')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('claimAmount')}</ShadcnTableHead>
                <ShadcnTableHead className="p-2">{t('claimEvidence')}</ShadcnTableHead>
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
                  <ShadcnTableCell className="p-2">
                    {canReadEvidence ? (
                      <Link
                        className="text-primary underline"
                        href={`/service-evidence/${line.evidencePackageId}`}
                      >
                        {t('openEvidencePackage')}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </ShadcnTableCell>
                </ShadcnTableRow>
              ))}
            </ShadcnTableBody>
          </ShadcnTable>
        </div>
        <ul className="grid gap-2 md:hidden">
          {detail.lines.map((line) => (
            <li key={line.id} className="grid gap-2 rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <strong>
                  {line.serviceNameSnapshot || translate('Resources.unavailableService')}
                </strong>
                <span className="shrink-0 font-medium">
                  {formatCents(line.amountCents, locale as Locale)}
                </span>
              </div>
              <p className="text-muted-foreground">
                {formatDate(line.serviceDate, locale as Locale) ?? line.serviceDate} ·{' '}
                {line.fundingLabelSnapshot ?? '—'}
              </p>
              {canReadEvidence ? (
                <Link
                  className="w-fit text-primary underline"
                  href={`/service-evidence/${line.evidencePackageId}`}
                >
                  {t('openEvidencePackage')}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
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
                    <p className="text-xs break-all text-muted-foreground">
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

      <section
        aria-labelledby="claim-submission-history"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="claim-submission-history" className="text-xl font-semibold">
          {t('claimSubmissionHistory')}
        </h2>
        {detail.submissions.length ? (
          <ol className="grid gap-3">
            {detail.submissions.map((submission) => (
              <li key={submission.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                <Metric
                  label={t('claimSubmissionNumber')}
                  value={String(submission.submissionNumber)}
                />
                <Metric
                  label={t('claimSubmittedAt')}
                  value={formatDateTime(submission.submittedAt, locale as Locale) ?? '—'}
                />
                <Metric label={t('claimChannel')} value={channelLabel(t, submission.channel)} />
                <Metric
                  label={t('claimPackageVersion')}
                  value={String(submission.packageVersion)}
                />
                <Metric
                  label={t('externalReference')}
                  value={submission.externalReference ?? '—'}
                />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t('claimNoSubmissionRecorded')}</p>
        )}
        <p className="rounded-md border border-primary/20 bg-accent p-3 text-sm text-primary">
          {t('manualSubmissionNotice')}
        </p>
      </section>

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
            <div className="md:col-span-2">
              <ConfirmSubmitButton confirmation={t('confirmRecordSubmission')} variant="default">
                {t('recordSubmission')}
              </ConfirmSubmitButton>
            </div>
          </RHFActionForm>
        </section>
      ) : null}

      {latestDecision ? (
        <section
          aria-labelledby="claim-latest-response"
          className={`grid gap-3 rounded-lg border p-5 ${
            ['rejected', 'partially_accepted', 'clarification_required'].includes(
              latestDecision.decision,
            )
              ? 'border-warning/40 bg-warning-muted'
              : 'bg-card'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="claim-latest-response" className="text-xl font-semibold">
              {t('latestPayerResponse')}
            </h2>
            <StatusBadge
              status={latestDecision.decision as ClaimStatus}
              label={claimStatus(t, latestDecision.decision as ClaimStatus)}
            />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label={t('decisionDate')}
              value={
                formatDate(latestDecision.decisionDate, locale as Locale) ??
                latestDecision.decisionDate
              }
            />
            <Metric
              label={t('acceptedAmount')}
              value={formatCents(latestDecision.acceptedCents, locale as Locale)}
            />
            <Metric
              label={t('rejectedAmount')}
              value={formatCents(latestDecision.rejectedCents, locale as Locale)}
            />
            <Metric label={t('reasonCode')} value={latestDecision.reasonCode ?? '—'} />
            <Metric
              label={t('externalReference')}
              value={latestDecision.externalReference ?? '—'}
            />
          </dl>
          {latestDecision.protectedExplanation ? (
            <p className="rounded-md border bg-card p-3 text-sm">
              {latestDecision.protectedExplanation}
            </p>
          ) : ['rejected', 'partially_accepted', 'clarification_required'].includes(
              latestDecision.decision,
            ) ? (
            <p className="text-sm">{t('payerResponseNeedsReview')}</p>
          ) : null}
          {['rejected', 'partially_accepted', 'clarification_required'].includes(
            latestDecision.decision,
          ) ? (
            <p className="text-sm">{t('claimCorrectionContext')}</p>
          ) : null}
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
            <ConfirmSubmitButton confirmation={t('confirmRecordPayerResponse')} variant="default">
              {t('savePayerDecision')}
            </ConfirmSubmitButton>
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
            <ConfirmSubmitButton confirmation={t('confirmResubmission')} variant="default">
              {t('createResubmission')}
            </ConfirmSubmitButton>
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
                    <ConfirmSubmitButton confirmation={t('confirmLinkPayment')} variant="default">
                      {t('linkPayment')}
                    </ConfirmSubmitButton>
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

function snapshotNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const value = snapshot[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function claimReference(id: string): string {
  return `CLM-${id.replaceAll('-', '').slice(-8).toUpperCase()}`;
}

function formatValidity(from: string | null, until: string | null, locale: Locale): string {
  const start = from ? (formatDate(from, locale) ?? from) : '—';
  const end = until ? (formatDate(until, locale) ?? until) : '∞';
  return `${start} – ${end}`;
}

function arrangementTypeLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  arrangementType: string | null,
): string {
  switch (arrangementType) {
    case 'direct_payer_billing':
      return t('directPayerBilling');
    case 'reimbursement_to_client':
      return t('customerReimbursement');
    default:
      return '—';
  }
}

function mandateStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  status: string | null,
): string {
  if (
    status === 'authorized' ||
    status === 'pending' ||
    status === 'revoked' ||
    status === 'not_applicable'
  ) {
    return t(`mandateStatuses.${status}`);
  }
  return t('claimMandateUnknown');
}

function readinessFieldLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  field: string,
): string {
  if (field.startsWith('lines.')) return t('readinessFields.evidence');
  switch (field) {
    case 'invoiceId':
    case 'invoicePdf':
      return t('readinessFields.invoice');
    case 'payerId':
      return t('readinessFields.payer');
    case 'payerArrangementId':
      return t('readinessFields.payerArrangement');
    case 'payerBillingProfileId':
      return t('readinessFields.payerProfile');
    case 'payerIdentifier':
      return t('readinessFields.payerIdentifier');
    case 'insuranceNumber':
      return t('readinessFields.insurance');
    case 'mandateDocumentArtifactId':
      return t('readinessFields.mandateDocument');
    case 'providerRecognition':
    case 'fundingSource':
      return t('readinessFields.funding');
    case 'lines':
      return t('readinessFields.evidence');
    default:
      return t('readinessFields.other');
  }
}

function fundingSourceLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  fundingSourceType: string,
): string {
  switch (fundingSourceType) {
    case 'statutory_long_term_care_insurance':
      return t('fundingSourceTypes.statutory_long_term_care_insurance');
    case 'private_long_term_care_insurance':
      return t('fundingSourceTypes.private_long_term_care_insurance');
    case 'self_pay':
      return t('fundingSourceTypes.self_pay');
    case 'other':
      return t('fundingSourceTypes.other');
    default:
      return t('claimMandateUnknown');
  }
}

function readinessActionLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  field: string,
): string {
  if (field.startsWith('lines.')) return t('openEvidencePackage');
  if (field === 'invoiceId' || field === 'invoicePdf') return t('openInvoice');
  if (field === 'payerId' || field === 'payerBillingProfileId' || field === 'payerIdentifier') {
    return t('payerDirectoryEntry');
  }
  if (field === 'providerRecognition' || field === 'fundingSource') {
    return t('openBenefitsWorkspace');
  }
  if (field === 'mandateDocumentArtifactId') return t('openClaimDocuments');
  return t('managePayerArrangements');
}

function readinessHref(
  field: string,
  lines: ClaimDetail['lines'],
  claim: ClaimDetail['claim'],
  canReadClient: boolean,
  canReadInvoice: boolean,
  canReadEvidence: boolean,
): string | null {
  if (field.startsWith('lines.')) {
    const lineId = field.slice('lines.'.length);
    const line = lines.find((candidate) => candidate.id === lineId);
    return canReadEvidence && line ? `/service-evidence/${line.evidencePackageId}` : null;
  }
  if (field === 'invoiceId' || field === 'invoicePdf') {
    return canReadInvoice ? `/billing/invoices/${claim.invoiceId}` : null;
  }
  if (field === 'payerId' || field === 'payerBillingProfileId' || field === 'payerIdentifier') {
    const payerName = snapshotText(claim.payerSnapshot, 'name') ?? '';
    return `/billing/claims/settings?organizationId=${claim.organizationId}&q=${encodeURIComponent(payerName)}`;
  }
  if (field === 'providerRecognition' || field === 'fundingSource') {
    return canReadClient ? `/clients/${claim.clientId}/benefits` : null;
  }
  if (field === 'mandateDocumentArtifactId' && claim.packageVersion > 0) {
    return '#claim-documents';
  }
  return canReadClient ? `/clients/${claim.clientId}/invoices` : null;
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

function Metric({
  label,
  value,
  valueClassName,
}: Readonly<{ label: string; value: string; valueClassName?: string }>) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium break-words ${valueClassName ?? ''}`}>{value}</dd>
    </div>
  );
}

function StatusBadge({ status, label }: Readonly<{ status: ClaimStatus; label: string }>) {
  const color =
    status === 'ready' || status === 'accepted'
      ? 'bg-success-muted text-success-foreground'
      : ['rejected', 'partially_accepted', 'clarification_required'].includes(status)
        ? 'bg-warning-muted text-warning-foreground'
        : status === 'submitted' || status === 'resubmitted'
          ? 'bg-accent text-primary'
          : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      {label}
    </span>
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
