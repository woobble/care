import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input } from '@care/ui';
import type { Locale } from '../../../../../i18n/config';
import { errorMessageKey } from '../../../../../i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '../../../../../lib/api';
import { BillingNavigation } from '../../billing-nav';
import { formatCents } from '../../format';
import { createClaimAction } from '../../actions';

type Arrangement = {
  id: string;
  payerId: string | null;
  arrangementType: string;
  validFrom: string;
  validUntil: string | null;
  mandateStatus: string;
};
type Payer = { id: string; name: string; payerType: string; status: 'active' | 'inactive' };
type PayerProfile = {
  id: string;
  channel: string;
  fundingSourceType: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  sourceName: string;
  sourceVersion: string;
};
type SearchParams = Promise<{ invoiceId?: string; error?: string }>;

export default async function NewClaimPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  if (!query.invoiceId || !isUuid(query.invoiceId)) notFound();
  const invoiceId = query.invoiceId;
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [invoiceResult, permissions] = await Promise.all([
    api.GET('/api/v1/billing/invoices/{id}', {
      params: { path: { id: invoiceId }, header },
    }),
    getPermissionGrants(api),
  ]);
  if (invoiceResult.error?.code === 'INVOICE_NOT_FOUND') notFound();
  const invoice = invoiceResult.data;
  if (!invoice) notFound();
  const canManage = hasClientPermission(
    permissions,
    'claims.manage',
    header['X-Tenant-Id'],
    invoice.organizationId,
    invoice.facilityId,
  );
  const [arrangementResult, payerResult] = invoice.organizationId
    ? await Promise.all([
        api.GET('/api/v1/billing/payer-arrangements', {
          params: {
            query: { clientId: invoice.clientId, organizationId: invoice.organizationId },
            header,
          },
        }),
        api.GET('/api/v1/billing/payers', {
          params: { query: { organizationId: invoice.organizationId }, header },
        }),
      ])
    : [null, null];
  const arrangements = (arrangementResult?.data?.items ?? []) as Arrangement[];
  const payers = (payerResult?.data ?? []) as Payer[];
  const payerNames = new Map(payers.map((payer) => [payer.id, payer.name]));
  const eligibleArrangements = arrangements.filter((arrangement) => {
    if (!arrangement.payerId || !payerNames.has(arrangement.payerId)) return false;
    if (invoice.recipientType === 'payer') {
      return (
        arrangement.arrangementType === 'direct_payer_billing' &&
        arrangement.id === invoice.payerArrangementId
      );
    }
    return arrangement.arrangementType === 'reimbursement_to_client';
  });
  const profileResults = await Promise.all(
    [
      ...new Set(eligibleArrangements.map((arrangement) => arrangement.payerId).filter(isString)),
    ].map(async (payerId) => {
      const result = await api.GET('/api/v1/billing/payers/{id}/profiles', {
        params: { path: { id: payerId }, header },
      });
      return [payerId, (result.data ?? []) as PayerProfile[], result.error?.code] as const;
    }),
  );
  const profiles = profileResults.flatMap(([payerId, payerProfiles]) =>
    payerProfiles.map((profile) => ({ ...profile, payerId })),
  );
  const error =
    query.error ??
    arrangementResult?.error?.code ??
    payerResult?.error?.code ??
    profileResults.find(([, , code]) => code)?.[2];
  const canCreate = canManage && invoice.status === 'issued' && invoice.lines.length > 0;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/billing/claims">{t('claims')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('createClaim')}</h1>
        <p className="text-slate-700">
          {invoice.invoiceNumber ?? invoice.id.slice(0, 8)} · {invoice.clientName}
        </p>
      </header>
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {!canManage ? <Alert>{t('noClaimsManagePermission')}</Alert> : null}
      {invoice.status !== 'issued' ? <Alert>{t('claimRequiresIssuedInvoice')}</Alert> : null}
      {invoice.status === 'issued' && !eligibleArrangements.length ? (
        <Alert>
          {t('claimNeedsPayerArrangement')}{' '}
          <Link
            className="font-medium underline"
            href={'/clients/' + invoice.clientId + '/invoices'}
          >
            {t('managePayerArrangements')}
          </Link>
        </Alert>
      ) : null}
      {canCreate && eligibleArrangements.length ? (
        <form action={createClaimAction} className="grid gap-5 rounded-lg border bg-white p-5">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="expectedInvoiceVersion" value={invoice.version} />
          <label className="grid gap-1 text-sm" htmlFor="payer-arrangement">
            {t('claimPayerArrangement')}
            <select
              id="payer-arrangement"
              name="payerArrangementId"
              required
              defaultValue={eligibleArrangements.length === 1 ? eligibleArrangements[0]!.id : ''}
              className="h-10 rounded-md border px-3"
            >
              <option value="">{t('selectPayerArrangement')}</option>
              {eligibleArrangements.map((arrangement) => (
                <option key={arrangement.id} value={arrangement.id}>
                  {payerNames.get(arrangement.payerId ?? '') ?? t('payer')} ·{' '}
                  {arrangement.arrangementType === 'direct_payer_billing'
                    ? t('directPayerBilling')
                    : t('customerReimbursement')}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm" htmlFor="payer-profile">
            {t('payerRequirementsProfile')}
            <select
              id="payer-profile"
              name="payerBillingProfileId"
              defaultValue=""
              className="h-10 rounded-md border px-3"
            >
              <option value="">{t('unconfiguredPayerRequirements')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {t('payerProfileOption', {
                    payer: payerNames.get(profile.payerId) ?? t('payer'),
                    fundingType: fundingTypeLabel(t, profile.fundingSourceType),
                    channel: channelLabel(t, profile.channel),
                    version: profile.version,
                    sourceName: profile.sourceName,
                    sourceVersion: profile.sourceVersion,
                  })}
                </option>
              ))}
            </select>
          </label>
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            {t('claimProfileReadinessNote')}
          </p>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-lg font-semibold">{t('invoiceLines')}</legend>
            {invoice.lines.map((line) => (
              <div
                key={line.id}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_12rem]"
              >
                <input type="hidden" name="invoiceLineId" value={line.id} />
                <div className="grid gap-1">
                  <p className="font-medium">{line.serviceNameSnapshot}</p>
                  <p className="text-sm text-slate-700">
                    {line.serviceDate} · {line.fundingLabelSnapshot ?? t('fundingSource')} ·{' '}
                    {formatCents(line.grossCents, locale as Locale)}
                  </p>
                </div>
                <label className="grid gap-1 text-sm" htmlFor={'claimAmount-' + line.id}>
                  {t('claimLineAmount')}
                  <Input
                    id={'claimAmount-' + line.id}
                    name={'claimAmount-' + line.id}
                    type="number"
                    min="0"
                    max={String(line.grossCents / 100)}
                    step="0.01"
                    defaultValue={(line.grossCents / 100).toFixed(2)}
                    required
                  />
                </label>
              </div>
            ))}
          </fieldset>
          <Button type="submit" className="w-fit">
            {t('createClaimDraft')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function channelLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  channel: string,
): string {
  switch (channel) {
    case 'manual_portal':
      return t('claimChannels.manual_portal');
    case 'manual_email':
      return t('claimChannels.manual_email');
    case 'postal':
      return t('claimChannels.postal');
    default:
      return t('claimChannels.customer_reimbursement');
  }
}

function fundingTypeLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  type: string,
): string {
  switch (type) {
    case 'statutory_long_term_care_insurance':
      return t('fundingSourceTypes.statutory_long_term_care_insurance');
    case 'private_long_term_care_insurance':
      return t('fundingSourceTypes.private_long_term_care_insurance');
    case 'self_pay':
      return t('fundingSourceTypes.self_pay');
    default:
      return t('fundingSourceTypes.other');
  }
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}

function Alert({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
      {children}
    </p>
  );
}
