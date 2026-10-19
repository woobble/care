import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  createPayerArrangementAction,
  updatePayerArrangementAction,
} from '@app/web/app/(office)/billing/actions';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
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
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  invoicePage?: string;
  invoicePageSize?: string;
  claimPage?: string;
  claimPageSize?: string;
}>;
type Invoice = components['schemas']['BillingInvoiceResponseDto'];
type PayerArrangement = components['schemas']['PayerArrangementResponseDto'];
type PayerDirectoryEntry = {
  id: string;
  name: string;
  payerIdentifier: string | null;
  status: 'active' | 'inactive';
};
type ClientClaim = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  payerName: string;
  amountCents: number;
  acceptedCents: number | null;
  paidCents: number;
  submittedAt: string | null;
  status: string;
};
type BillingTranslator = Awaited<ReturnType<typeof getTranslations<'Billing'>>>;

export default async function ClientInvoicesPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const invoicePage = positivePage(query.invoicePage);
  const invoicePageSize = positivePageSize(query.invoicePageSize);
  const claimPage = positivePage(query.claimPage);
  const claimPageSize = positivePageSize(query.claimPageSize);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [clientResult, permissions] = await Promise.all([
    api.GET('/api/v1/clients/{id}', { params: { path: { id }, header } }),
    getPermissionGrants(api),
  ]);
  if ((clientResult.error as { code?: string } | undefined)?.code === 'CLIENT_NOT_FOUND')
    notFound();
  const client = clientResult.data as components['schemas']['ClientResponseDto'];
  if (!client) notFound();

  const tenantId = header['X-Tenant-Id'];
  const canRead = hasClientPermission(
    permissions,
    'billing.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canManage = hasClientPermission(
    permissions,
    'billing.settings.manage',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadBenefits = hasClientPermission(
    permissions,
    'benefits.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadClaims = hasClientPermission(
    permissions,
    'claims.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );

  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6">
        <PageHeader
          eyebrow={<Link href={`/clients/${client.id}`}>{t('backToClient')}</Link>}
          title={t('clientInvoicesTitle')}
        />
        <Alert>{t('noBillingPermission')}</Alert>
      </div>
    );
  }

  const [invoiceResult, insuranceResult] = await Promise.all([
    api.GET('/api/v1/billing/invoices', {
      params: { query: { clientId: id, page: invoicePage, pageSize: invoicePageSize }, header },
    }),
    api.GET('/api/v1/clients/{clientId}/insurances', {
      params: { path: { clientId: id }, header },
    }),
  ]);
  const [arrangementResult, budgetResult, claimsResult] = await Promise.all([
    client.organizationId
      ? api.GET('/api/v1/billing/payer-arrangements', {
          params: { query: { clientId: id, organizationId: client.organizationId }, header },
        })
      : Promise.resolve(undefined),
    canReadBenefits
      ? api.GET('/api/v1/clients/{clientId}/budgets', {
          params: { path: { clientId: id }, header },
        })
      : Promise.resolve(undefined),
    canReadClaims
      ? api.GET('/api/v1/billing/claims', {
          params: { query: { clientId: id, page: claimPage, pageSize: claimPageSize }, header },
        })
      : Promise.resolve(undefined),
  ]);

  const invoiceData = invoiceResult.data as
    | {
        items: Invoice[];
        page: number;
        pageSize: number;
        total: number;
      }
    | undefined;
  const claimData = claimsResult?.data as
    | { items: ClientClaim[]; page: number; pageSize: number; total: number }
    | undefined;
  if (invoiceData) {
    redirectToValidPage(
      `/clients/${id}/invoices`,
      {
        claimPage: query.claimPage,
        claimPageSize: query.claimPageSize,
        error: query.error,
        updated: query.updated,
      },
      invoicePage,
      invoicePageSize,
      invoiceData.total,
      'invoicePage',
      'invoicePageSize',
    );
  }
  if (claimData) {
    redirectToValidPage(
      `/clients/${id}/invoices`,
      {
        invoicePage: query.invoicePage,
        invoicePageSize: query.invoicePageSize,
        error: query.error,
        updated: query.updated,
      },
      claimPage,
      claimPageSize,
      claimData.total,
      'claimPage',
      'claimPageSize',
    );
  }
  const invoices = invoiceData?.items ?? [];
  const claims = claimData?.items ?? [];
  const arrangements = ((
    arrangementResult?.data as components['schemas']['PayerArrangementListResponseDto'] | undefined
  )?.items ?? []) as PayerArrangement[];
  const insurances =
    (insuranceResult.data as components['schemas']['ClientInsuranceResponseDto'][] | undefined) ??
    [];
  const payerIds = [
    ...new Set(arrangements.map((arrangement) => arrangement.payerId).filter(isString)),
  ];
  const payerResult =
    client.organizationId && payerIds.length
      ? await api.GET('/api/v1/billing/payer-directory/lookup', {
          params: {
            query: { organizationId: client.organizationId, payerIds: payerIds.join(',') },
            header,
          },
        })
      : null;
  const payers = (payerResult?.data ?? []) as PayerDirectoryEntry[];
  const payerNames = new Map(payers.map((payer) => [payer.id, payer.name]));
  const fundingSources =
    (budgetResult?.data as components['schemas']['BenefitBudgetResponseDto'] | undefined)
      ?.fundingSources ?? [];
  const error =
    query.error ??
    (arrangementResult?.error as { code?: string } | undefined)?.code ??
    (payerResult?.error as { code?: string } | undefined)?.code;
  const updated = query.updated === 'PAYER_ARRANGEMENT_SAVED';

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={<Link href={`/clients/${client.id}`}>{t('backToClient')}</Link>}
        title={t('clientInvoicesTitle')}
        description={`${client.preferredName || client.firstName} ${client.lastName}`}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/clients/${client.id}`}>{t('backToClient')}</Link>
          </Button>
        }
      />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {updated ? <Status>{t('payerArrangementSaved')}</Status> : null}

      <section
        aria-labelledby="client-invoice-history"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <div>
          <h2 id="client-invoice-history" className="text-xl font-semibold">
            {t('invoiceHistory')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('clientInvoicesDescription')}</p>
        </div>
        {invoiceResult.error ? (
          <Alert>
            {translate(
              errorMessageKey(
                (invoiceResult.error as { code?: string } | undefined)?.code ?? 'INVALID_REQUEST',
              ),
            )}
          </Alert>
        ) : invoices.length ? (
          <div className="overflow-x-auto">
            <ShadcnTable className="w-full min-w-[58rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-muted-foreground">
                  <ShadcnTableHead className="p-2">{t('invoiceNumber')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('recipient')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('issueDate')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('servicePeriod')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('amount')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('outstandingAmount')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('paymentStatus')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('fundingSource')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('actions')}</ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {invoices.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} locale={locale} t={t} />
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('invoiceHistoryEmpty')}</p>
        )}
        {invoiceData ? (
          <DataPagination
            pathname={`/clients/${id}/invoices`}
            page={invoiceData.page}
            pageSize={invoiceData.pageSize}
            totalItems={invoiceData.total}
            pageParam="invoicePage"
            pageSizeParam="invoicePageSize"
            controlId="client-invoice-page-size"
            filters={{
              claimPage: query.claimPage,
              claimPageSize: query.claimPageSize,
              error: query.error,
              updated: query.updated,
            }}
          />
        ) : null}
      </section>

      {canReadClaims ? (
        <section
          aria-labelledby="client-claims-title"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <div>
            <h2 id="client-claims-title" className="text-xl font-semibold">
              {t('clientClaimHistory')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('clientClaimHistoryDescription')}
            </p>
          </div>
          {claimsResult?.error ? (
            <Alert>
              {translate(
                errorMessageKey(
                  (claimsResult.error as { code?: string } | undefined)?.code ?? 'INVALID_REQUEST',
                ),
              )}
            </Alert>
          ) : claims.length ? (
            <div className="overflow-x-auto">
              <ShadcnTable className="w-full min-w-[50rem] text-left text-sm">
                <ShadcnTableHeader>
                  <ShadcnTableRow className="border-b text-muted-foreground">
                    <ShadcnTableHead className="p-2">{t('claim')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('payer')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('invoiceNumber')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('claimStatusLabel')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('submissionDate')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('acceptedAmount')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('paymentReceived')}</ShadcnTableHead>
                  </ShadcnTableRow>
                </ShadcnTableHeader>
                <ShadcnTableBody>
                  {claims.map((claim) => (
                    <ShadcnTableRow key={claim.id} className="border-b last:border-0">
                      <ShadcnTableCell className="p-2">
                        <Link
                          className="text-primary underline"
                          href={'/billing/claims/' + claim.id}
                        >
                          {t('claim')}
                        </Link>
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">{claim.payerName}</ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        <Link
                          className="text-primary underline"
                          href={'/billing/invoices/' + claim.invoiceId}
                        >
                          {claim.invoiceNumber ?? t('draftIdentifier')}
                        </Link>
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {claimStatusLabel(t, claim.status)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {formatDateTime(claim.submittedAt, locale) ?? '—'}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {claim.acceptedCents === null
                          ? '—'
                          : formatCents(claim.acceptedCents, locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {formatCents(claim.paidCents, locale)}
                      </ShadcnTableCell>
                    </ShadcnTableRow>
                  ))}
                </ShadcnTableBody>
              </ShadcnTable>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('clientClaimHistoryEmpty')}</p>
          )}
          {claimData ? (
            <DataPagination
              pathname={`/clients/${id}/invoices`}
              page={claimData.page}
              pageSize={claimData.pageSize}
              totalItems={claimData.total}
              pageParam="claimPage"
              pageSizeParam="claimPageSize"
              controlId="client-claim-page-size"
              filters={{
                invoicePage: query.invoicePage,
                invoicePageSize: query.invoicePageSize,
                error: query.error,
                updated: query.updated,
              }}
            />
          ) : null}
        </section>
      ) : null}
      <section
        aria-labelledby="payer-arrangements-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <div>
          <h2 id="payer-arrangements-title" className="text-xl font-semibold">
            {t('payerArrangements')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('payerArrangementsDescription')}</p>
        </div>
        {arrangements.length ? (
          <ul className="grid gap-3">
            {arrangements.map((arrangement) => (
              <li key={arrangement.id} className="grid gap-3 rounded-md border p-4">
                <div className="grid gap-1">
                  <h3 className="font-medium">
                    {arrangement.recipientName ??
                      t(`recipientTypes.${recipientTypeKey(arrangement.recipientType)}`)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`payerTypes.${payerTypeKey(arrangement.payerType)}`)} ·{' '}
                    {t(`arrangementTypes.${arrangementTypeKey(arrangement.arrangementType)}`)} ·{' '}
                    {formatDate(arrangement.validFrom, locale)} –{' '}
                    {formatDate(arrangement.validUntil, locale) ?? '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('payerDirectoryEntry')}:{' '}
                    {payerNames.get(arrangement.payerId ?? '') ?? t('payerNotLinked')}
                  </p>
                  {arrangement.payerReference ? (
                    <p className="text-sm text-muted-foreground">
                      {t('payerReference')}: {arrangement.payerReference}
                    </p>
                  ) : null}
                  {arrangement.recipientAddress ? (
                    <p className="text-sm whitespace-pre-line text-muted-foreground">
                      {arrangement.recipientAddress}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <RHFActionForm
                    action={updatePayerArrangementAction}
                    className="grid gap-3 border-t pt-3 md:grid-cols-2"
                  >
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="arrangementId" value={arrangement.id} />
                    <input type="hidden" name="expectedVersion" value={arrangement.version} />
                    <AsyncEntityCombobox
                      name="payerId"
                      entity="payers"
                      label={t('payerDirectoryEntry')}
                      organizationId={client.organizationId ?? undefined}
                      initialOption={payerOption(payers, arrangement.payerId, t('payerNotLinked'))}
                      placeholder={t('selectPayerDirectoryEntry')}
                      required
                    />
                    <SelectField
                      id={`mandate-${arrangement.id}`}
                      name="mandateStatus"
                      label={t('mandateStatus')}
                      defaultValue={arrangement.mandateStatus}
                    >
                      <option value="authorized">{t('mandateStatuses.authorized')}</option>
                      <option value="pending">{t('mandateStatuses.pending')}</option>
                      <option value="revoked">{t('mandateStatuses.revoked')}</option>
                      <option value="not_applicable">{t('mandateStatuses.not_applicable')}</option>
                    </SelectField>
                    <Field
                      id={`valid-until-${arrangement.id}`}
                      name="validUntil"
                      label={t('validUntil')}
                      type="date"
                      defaultValue={arrangement.validUntil ?? ''}
                    />
                    <Field
                      id={`documented-source-${arrangement.id}`}
                      name="documentedSource"
                      label={t('documentedSource')}
                      defaultValue={arrangement.documentedSource ?? ''}
                    />
                    <Field
                      id={`documented-reference-${arrangement.id}`}
                      name="documentedReference"
                      label={t('documentedReference')}
                      defaultValue={arrangement.documentedReference ?? ''}
                    />
                    <Button type="submit" className="w-fit md:col-span-2">
                      {t('updatePayerArrangement')}
                    </Button>
                  </RHFActionForm>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t(`mandateStatuses.${mandateStatusKey(arrangement.mandateStatus)}`)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('payerArrangementsEmpty')}</p>
        )}
        {canManage && client.organizationId ? (
          <RHFActionForm
            action={createPayerArrangementAction}
            className="grid gap-3 border-t pt-4 md:grid-cols-2"
          >
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="organizationId" value={client.organizationId} />
            <h3 className="text-lg font-semibold md:col-span-2">{t('payerArrangementForm')}</h3>
            <AsyncEntityCombobox
              name="payerId"
              entity="payers"
              label={t('payerDirectoryEntry')}
              organizationId={client.organizationId ?? undefined}
              placeholder={t('selectPayerDirectoryEntry')}
              required
            />
            <SelectField
              id="payer-association"
              name="payerAssociation"
              label={t('fundingSourceRecord')}
              defaultValue=""
            >
              <option value="">{t('selectFundingSource')}</option>
              {fundingSources.map((source) => (
                <option key={`funding-${source.id}`} value={`funding:${source.id}`}>
                  {source.label ?? fundingSourceLabel(t, source.sourceType)}
                </option>
              ))}
              {insurances.map((insurance) => (
                <option key={`insurance-${insurance.id}`} value={`insurance:${insurance.id}`}>
                  {t('insuranceRecord')}: {insurance.insurerName}
                  {insurance.insuranceNumber ? ` · ${insurance.insuranceNumber}` : ''}
                </option>
              ))}
            </SelectField>
            <Field id="payer-reference" name="payerReference" label={t('payerReference')} />
            <SelectField
              id="payer-type"
              name="payerType"
              label={t('payerType')}
              defaultValue="statutory_insurance"
              required
            >
              <option value="statutory_insurance">{t('payerTypes.statutory_insurance')}</option>
              <option value="private_insurance">{t('payerTypes.private_insurance')}</option>
              <option value="other">{t('payerTypes.other')}</option>
            </SelectField>
            <SelectField
              id="arrangement-type"
              name="arrangementType"
              label={t('arrangementType')}
              defaultValue="reimbursement_to_client"
              required
            >
              <option value="reimbursement_to_client">
                {t('arrangementTypes.reimbursement_to_client')}
              </option>
              <option value="direct_payer_billing">
                {t('arrangementTypes.direct_payer_billing')}
              </option>
              <option value="other">{t('arrangementTypes.other')}</option>
            </SelectField>
            <SelectField
              id="recipient-type"
              name="recipientType"
              label={t('recipientType')}
              defaultValue="insurance"
              required
            >
              <option value="client">{t('recipientTypes.client')}</option>
              <option value="insurance">{t('recipientTypes.insurance')}</option>
              <option value="contact">{t('recipientTypes.contact')}</option>
              <option value="other">{t('recipientTypes.other')}</option>
            </SelectField>
            <Field id="recipient-name" name="recipientName" label={t('recipientName')} />
            <Field id="recipient-address" name="recipientAddress" label={t('recipientAddress')} />
            <SelectField
              id="mandate-status"
              name="mandateStatus"
              label={t('mandateStatus')}
              defaultValue="pending"
              required
            >
              <option value="pending">{t('mandateStatuses.pending')}</option>
              <option value="authorized">{t('mandateStatuses.authorized')}</option>
              <option value="revoked">{t('mandateStatuses.revoked')}</option>
              <option value="not_applicable">{t('mandateStatuses.not_applicable')}</option>
            </SelectField>
            <Field
              id="payer-valid-from"
              name="validFrom"
              label={t('validFrom')}
              type="date"
              defaultValue={today()}
              required
            />
            <Field id="payer-valid-until" name="validUntil" label={t('validUntil')} type="date" />
            <Field
              id="payer-document-source"
              name="documentedSource"
              label={t('documentedSource')}
            />
            <Field
              id="payer-document-reference"
              name="documentedReference"
              label={t('documentedReference')}
            />
            <p className="text-sm text-warning-foreground md:col-span-2">{t('payerMandateNote')}</p>
            <Button type="submit" className="w-fit md:col-span-2">
              {t('createPayerArrangement')}
            </Button>
          </RHFActionForm>
        ) : null}
        {canManage && !client.organizationId ? (
          <Alert>{t('clientOrganizationMissing')}</Alert>
        ) : null}
      </section>
    </div>
  );
}

function InvoiceRow({
  invoice,
  locale,
  t,
}: Readonly<{ invoice: Invoice; locale: Locale; t: BillingTranslator }>) {
  const funding = [
    ...new Set(
      invoice.lines
        .map((line) => line.fundingLabelSnapshot)
        .filter((label): label is string => Boolean(label)),
    ),
  ];
  return (
    <ShadcnTableRow className="border-b last:border-0">
      <ShadcnTableCell className="p-2 font-medium">
        <Link className="text-primary underline" href={`/billing/invoices/${invoice.id}`}>
          {invoice.invoiceNumber ?? t('draftIdentifier')}
        </Link>
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {invoice.recipientName ?? t(invoice.recipientType === 'payer' ? 'payer' : 'client')}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {formatDate(invoice.issueDate, locale) ?? '—'}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {datePeriod(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale)}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {formatCents(invoice.grandTotalCents, locale)}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {invoice.outstandingCents === null ? '—' : formatCents(invoice.outstandingCents, locale)}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {invoice.receivableStatus
          ? receivableStatusLabel(t, invoice.receivableStatus)
          : invoiceStatusLabel(t, invoice.status)}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        {funding.length ? funding.join(', ') : t('selfPay')}
      </ShadcnTableCell>
      <ShadcnTableCell className="p-2">
        <div className="flex flex-wrap gap-2">
          {invoice.status === 'issued' && invoice.pdfStatus === 'ready' ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/billing/invoices/${invoice.id}/pdf`}>{t('downloadPdf')}</Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary" size="sm">
            <Link href={`/billing/invoices/${invoice.id}`}>{t('openInvoice')}</Link>
          </Button>
        </div>
      </ShadcnTableCell>
    </ShadcnTableRow>
  );
}

function invoiceStatusLabel(t: BillingTranslator, status: string): string {
  if (status === 'draft') return t('status.draft');
  if (status === 'issued') return t('status.issued');
  if (status === 'cancelled') return t('status.cancelled');
  return status;
}

function receivableStatusLabel(t: BillingTranslator, status: string): string {
  if (status === 'unpaid') return t('receivableStatus.unpaid');
  if (status === 'partially_paid') return t('receivableStatus.partially_paid');
  if (status === 'paid') return t('receivableStatus.paid');
  if (status === 'overdue') return t('receivableStatus.overdue');
  if (status === 'corrected') return t('receivableStatus.corrected');
  return status;
}

function payerTypeKey(value: string): 'statutory_insurance' | 'private_insurance' | 'other' {
  if (value === 'private_insurance') return value;
  if (value === 'statutory_insurance') return value;
  return 'other';
}

function arrangementTypeKey(
  value: string,
): 'direct_payer_billing' | 'reimbursement_to_client' | 'other' {
  if (value === 'direct_payer_billing' || value === 'reimbursement_to_client') return value;
  return 'other';
}

function recipientTypeKey(value: string): 'client' | 'insurance' | 'contact' | 'other' {
  if (value === 'client' || value === 'insurance' || value === 'contact') return value;
  return 'other';
}

function mandateStatusKey(value: string): 'authorized' | 'pending' | 'revoked' | 'not_applicable' {
  if (value === 'authorized' || value === 'revoked' || value === 'not_applicable') return value;
  return 'pending';
}

function fundingSourceLabel(t: BillingTranslator, sourceType: string): string {
  if (sourceType === 'statutory_long_term_care_insurance')
    return t('fundingSourceTypes.statutory_long_term_care_insurance');
  if (sourceType === 'private_long_term_care_insurance')
    return t('fundingSourceTypes.private_long_term_care_insurance');
  if (sourceType === 'self_pay') return t('fundingSourceTypes.self_pay');
  return t('fundingSourceTypes.other');
}

function datePeriod(from: string | null, until: string | null, locale: Locale): string {
  const start = formatDate(from, locale);
  const end = formatDate(until, locale);
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end ?? '—');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function claimStatusLabel(t: BillingTranslator, status: string): string {
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
    default:
      return t('claimStatus.cancelled');
  }
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  required,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}>) {
  return (
    <label className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={defaultValue} required={required} />
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
        selectClassName="min-h-10 rounded-md border border-input bg-card px-3 py-2"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
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

function payerOption(
  payers: PayerDirectoryEntry[],
  payerId: string | null,
  fallbackLabel: string,
): { id: string; label: string } | undefined {
  if (!payerId) return undefined;
  const payer = payers.find((candidate) => candidate.id === payerId);
  return {
    id: payerId,
    label: payer ? [payer.name, payer.payerIdentifier].filter(Boolean).join(' · ') : fallbackLabel,
  };
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}
