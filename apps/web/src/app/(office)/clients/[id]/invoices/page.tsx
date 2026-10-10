import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import type { components } from '@care/api-client';
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
import { formatCents } from '@app/web/app/(office)/billing/format';
import {
  createPayerArrangementAction,
  updatePayerArrangementAction,
} from '@app/web/app/(office)/billing/actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;
type Invoice = components['schemas']['BillingInvoiceResponseDto'];
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
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();
  const client = clientResult.data;
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
        <header className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href={`/clients/${client.id}`}>{t('backToClient')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">{t('clientInvoicesTitle')}</h1>
        </header>
        <Alert>{t('noBillingPermission')}</Alert>
      </div>
    );
  }

  const [invoiceResult, insuranceResult, payerResult] = await Promise.all([
    api.GET('/api/v1/billing/invoices', {
      params: { query: { clientId: id, page: 1, pageSize: 100 }, header },
    }),
    api.GET('/api/v1/clients/{clientId}/insurances', {
      params: { path: { clientId: id }, header },
    }),
    client.organizationId
      ? api.GET('/api/v1/billing/payers', {
          params: { query: { organizationId: client.organizationId }, header },
        })
      : Promise.resolve({ data: [], error: undefined }),
  ]);
  const arrangementResult = client.organizationId
    ? await api.GET('/api/v1/billing/payer-arrangements', {
        params: { query: { clientId: id, organizationId: client.organizationId }, header },
      })
    : undefined;
  const budgetResult = canReadBenefits
    ? await api.GET('/api/v1/clients/{clientId}/budgets', {
        params: { path: { clientId: id }, header },
      })
    : undefined;
  const claimsResult = canReadClaims
    ? await api.GET('/api/v1/billing/claims', {
        params: { query: { clientId: id, page: 1, pageSize: 100 }, header },
      })
    : undefined;

  const invoices = invoiceResult.data?.items ?? [];
  const claims = (claimsResult?.data as { items?: ClientClaim[] } | undefined)?.items ?? [];
  const arrangements = arrangementResult?.data?.items ?? [];
  const insurances = insuranceResult.data ?? [];
  const payers = (payerResult.data ?? []) as Array<{
    id: string;
    name: string;
    payerIdentifier: string | null;
    status: 'active' | 'inactive';
  }>;
  const payerNames = new Map(payers.map((payer) => [payer.id, payer.name]));
  const fundingSources = budgetResult?.data?.fundingSources ?? [];
  const error =
    query.error ??
    invoiceResult.error?.code ??
    arrangementResult?.error?.code ??
    payerResult.error?.code ??
    claimsResult?.error?.code;
  const updated = query.updated === 'PAYER_ARRANGEMENT_SAVED';

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href={`/clients/${client.id}`}>{t('backToClient')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">{t('clientInvoicesTitle')}</h1>
          <p className="text-slate-700">
            {client.preferredName || client.firstName} {client.lastName}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/clients/${client.id}`}>{t('backToClient')}</Link>
        </Button>
      </header>
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {updated ? <Status>{t('payerArrangementSaved')}</Status> : null}

      <section
        aria-labelledby="client-invoice-history"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="client-invoice-history" className="text-xl font-semibold">
            {t('invoiceHistory')}
          </h2>
          <p className="mt-1 text-sm text-slate-700">{t('clientInvoicesDescription')}</p>
        </div>
        {invoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-left text-sm">
              <thead>
                <tr className="border-b text-slate-600">
                  <th className="p-2">{t('invoiceNumber')}</th>
                  <th className="p-2">{t('recipient')}</th>
                  <th className="p-2">{t('issueDate')}</th>
                  <th className="p-2">{t('servicePeriod')}</th>
                  <th className="p-2">{t('amount')}</th>
                  <th className="p-2">{t('outstandingAmount')}</th>
                  <th className="p-2">{t('paymentStatus')}</th>
                  <th className="p-2">{t('fundingSource')}</th>
                  <th className="p-2">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} locale={locale} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-700">{t('invoiceHistoryEmpty')}</p>
        )}
      </section>

      {canReadClaims ? (
        <section
          aria-labelledby="client-claims-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <div>
            <h2 id="client-claims-title" className="text-xl font-semibold">
              {t('clientClaimHistory')}
            </h2>
            <p className="mt-1 text-sm text-slate-700">{t('clientClaimHistoryDescription')}</p>
          </div>
          {claimsResult?.error ? (
            <Alert>{translate(errorMessageKey(claimsResult.error.code))}</Alert>
          ) : claims.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[50rem] text-left text-sm">
                <thead>
                  <tr className="border-b text-slate-600">
                    <th className="p-2">{t('claim')}</th>
                    <th className="p-2">{t('payer')}</th>
                    <th className="p-2">{t('invoiceNumber')}</th>
                    <th className="p-2">{t('claimStatusLabel')}</th>
                    <th className="p-2">{t('submissionDate')}</th>
                    <th className="p-2">{t('acceptedAmount')}</th>
                    <th className="p-2">{t('paymentReceived')}</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id} className="border-b last:border-0">
                      <td className="p-2">
                        <Link
                          className="text-blue-900 underline"
                          href={'/billing/claims/' + claim.id}
                        >
                          {claim.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="p-2">{claim.payerName}</td>
                      <td className="p-2">
                        <Link
                          className="text-blue-900 underline"
                          href={'/billing/invoices/' + claim.invoiceId}
                        >
                          {claim.invoiceNumber ?? claim.invoiceId.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="p-2">{claimStatusLabel(t, claim.status)}</td>
                      <td className="p-2">{formatDateTime(claim.submittedAt, locale) ?? '—'}</td>
                      <td className="p-2">
                        {claim.acceptedCents === null
                          ? '—'
                          : formatCents(claim.acceptedCents, locale)}
                      </td>
                      <td className="p-2">{formatCents(claim.paidCents, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-700">{t('clientClaimHistoryEmpty')}</p>
          )}
        </section>
      ) : null}
      <section
        aria-labelledby="payer-arrangements-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="payer-arrangements-title" className="text-xl font-semibold">
            {t('payerArrangements')}
          </h2>
          <p className="mt-1 text-sm text-slate-700">{t('payerArrangementsDescription')}</p>
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
                  <p className="text-sm text-slate-700">
                    {t(`payerTypes.${payerTypeKey(arrangement.payerType)}`)} ·{' '}
                    {t(`arrangementTypes.${arrangementTypeKey(arrangement.arrangementType)}`)} ·{' '}
                    {formatDate(arrangement.validFrom, locale)} –{' '}
                    {formatDate(arrangement.validUntil, locale) ?? '—'}
                  </p>
                  <p className="text-sm text-slate-700">
                    {t('payerDirectoryEntry')}:{' '}
                    {payerNames.get(arrangement.payerId ?? '') ?? t('payerNotLinked')}
                  </p>
                  {arrangement.payerReference ? (
                    <p className="text-sm text-slate-700">
                      {t('payerReference')}: {arrangement.payerReference}
                    </p>
                  ) : null}
                  {arrangement.recipientAddress ? (
                    <p className="whitespace-pre-line text-sm text-slate-700">
                      {arrangement.recipientAddress}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <form
                    action={updatePayerArrangementAction}
                    className="grid gap-3 border-t pt-3 md:grid-cols-2"
                  >
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="arrangementId" value={arrangement.id} />
                    <input type="hidden" name="expectedVersion" value={arrangement.version} />
                    <SelectField
                      id={'directory-payer-' + arrangement.id}
                      name="payerId"
                      label={t('payerDirectoryEntry')}
                      defaultValue={arrangement.payerId ?? ''}
                      required
                    >
                      <option value="">{t('selectPayerDirectoryEntry')}</option>
                      {payers
                        .filter((payer) => payer.status === 'active')
                        .map((payer) => (
                          <option key={payer.id} value={payer.id}>
                            {payer.name}
                            {payer.payerIdentifier ? ' · ' + payer.payerIdentifier : ''}
                          </option>
                        ))}
                    </SelectField>
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
                  </form>
                ) : (
                  <p className="text-sm text-slate-700">
                    {t(`mandateStatuses.${mandateStatusKey(arrangement.mandateStatus)}`)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-700">{t('payerArrangementsEmpty')}</p>
        )}
        {canManage && client.organizationId ? (
          <form
            action={createPayerArrangementAction}
            className="grid gap-3 border-t pt-4 md:grid-cols-2"
          >
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="organizationId" value={client.organizationId} />
            <h3 className="text-lg font-semibold md:col-span-2">{t('payerArrangementForm')}</h3>
            <SelectField
              id="directory-payer"
              name="payerId"
              label={t('payerDirectoryEntry')}
              defaultValue=""
              required
            >
              <option value="">{t('selectPayerDirectoryEntry')}</option>
              {payers
                .filter((payer) => payer.status === 'active')
                .map((payer) => (
                  <option key={payer.id} value={payer.id}>
                    {payer.name}
                    {payer.payerIdentifier ? ' · ' + payer.payerIdentifier : ''}
                  </option>
                ))}
            </SelectField>
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
            <p className="text-sm text-amber-900 md:col-span-2">{t('payerMandateNote')}</p>
            <Button type="submit" className="w-fit md:col-span-2">
              {t('createPayerArrangement')}
            </Button>
          </form>
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
    <tr className="border-b last:border-0">
      <td className="p-2 font-medium">
        <Link className="text-blue-900 underline" href={`/billing/invoices/${invoice.id}`}>
          {invoice.invoiceNumber ?? t('draftIdentifier', { id: invoice.id.slice(0, 8) })}
        </Link>
      </td>
      <td className="p-2">
        {invoice.recipientName ?? t(invoice.recipientType === 'payer' ? 'payer' : 'client')}
      </td>
      <td className="p-2">{formatDate(invoice.issueDate, locale) ?? '—'}</td>
      <td className="p-2">
        {datePeriod(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale)}
      </td>
      <td className="p-2">{formatCents(invoice.grandTotalCents, locale)}</td>
      <td className="p-2">
        {invoice.outstandingCents === null ? '—' : formatCents(invoice.outstandingCents, locale)}
      </td>
      <td className="p-2">
        {invoice.receivableStatus
          ? receivableStatusLabel(t, invoice.receivableStatus)
          : invoiceStatusLabel(t, invoice.status)}
      </td>
      <td className="p-2">{funding.length ? funding.join(', ') : t('selfPay')}</td>
      <td className="p-2">
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
      </td>
    </tr>
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
