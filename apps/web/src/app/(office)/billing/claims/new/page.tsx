import { ErrorNotice as Alert } from '@app/web/components/page-patterns';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import type { Locale } from '@app/web/i18n/config';
import type { components } from '@care/api-client';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { createClaimAction } from '@app/web/app/(office)/billing/actions';

type Arrangement = {
  id: string;
  payerId: string | null;
  arrangementType: string;
  validFrom: string;
  validUntil: string | null;
  mandateStatus: string;
};
type Payer = { id: string; name: string };
type PayerProfile = {
  id: string;
  payerId: string;
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
  if ((invoiceResult.error as { code?: string } | undefined)?.code === 'INVOICE_NOT_FOUND')
    notFound();
  const invoice = invoiceResult.data as components['schemas']['BillingInvoiceResponseDto'];
  if (!invoice) notFound();
  const canManage = hasClientPermission(
    permissions,
    'claims.manage',
    header['X-Tenant-Id'],
    invoice.organizationId,
    invoice.facilityId,
  );
  const canReadClient = hasClientPermission(
    permissions,
    'client.read',
    header['X-Tenant-Id'],
    invoice.organizationId,
    invoice.facilityId,
  );
  const arrangementResult = invoice.organizationId
    ? await api.GET('/api/v1/billing/payer-arrangements', {
        params: {
          query: { clientId: invoice.clientId, organizationId: invoice.organizationId },
          header,
        },
      })
    : null;
  const arrangements = ((
    arrangementResult?.data as components['schemas']['PayerArrangementListResponseDto'] | undefined
  )?.items ?? []) as Arrangement[];
  const arrangementPayerIds = [
    ...new Set(arrangements.map((arrangement) => arrangement.payerId).filter(isString)),
  ];
  const payerResult =
    invoice.organizationId && arrangementPayerIds.length
      ? await api.GET('/api/v1/billing/payer-directory/lookup', {
          params: {
            query: {
              organizationId: invoice.organizationId,
              payerIds: arrangementPayerIds.join(','),
            },
            header,
          },
        })
      : null;
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
  const eligiblePayerIds = [
    ...new Set(eligibleArrangements.map((arrangement) => arrangement.payerId).filter(isString)),
  ];
  const profileResult =
    invoice.organizationId && eligiblePayerIds.length
      ? await api.GET('/api/v1/billing/payer-directory/profiles', {
          params: {
            query: { organizationId: invoice.organizationId, payerIds: eligiblePayerIds.join(',') },
            header,
          },
        })
      : null;
  const profiles = (profileResult?.data ?? []) as PayerProfile[];
  const error =
    query.error ??
    (arrangementResult?.error as { code?: string } | undefined)?.code ??
    (payerResult?.error as { code?: string } | undefined)?.code ??
    (profileResult?.error as { code?: string } | undefined)?.code;
  const canCreate = canManage && invoice.status === 'issued' && invoice.lines.length > 0;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        eyebrow={<Link href="/billing/claims">{t('claims')}</Link>}
        title={t('createClaim')}
        description={`${invoice.invoiceNumber ?? t('draftIdentifier')} · ${invoice.clientName}`}
      />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {!canManage ? <Alert>{t('noClaimsManagePermission')}</Alert> : null}
      {invoice.status !== 'issued' ? <Alert>{t('claimRequiresIssuedInvoice')}</Alert> : null}
      {invoice.status === 'issued' && !eligibleArrangements.length ? (
        <Alert>
          {t('claimNeedsPayerArrangement')}{' '}
          {canReadClient ? (
            <Link
              className="font-medium underline"
              href={'/clients/' + invoice.clientId + '/invoices'}
            >
              {t('managePayerArrangements')}
            </Link>
          ) : null}
        </Alert>
      ) : null}
      {canCreate && eligibleArrangements.length ? (
        <RHFActionForm
          action={createClaimAction}
          className="grid gap-5 rounded-lg border bg-card p-5"
        >
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="expectedInvoiceVersion" value={invoice.version} />
          <label className="grid gap-1 text-sm" htmlFor="payer-arrangement">
            {t('claimPayerArrangement')}
            <NativeSelect
              id="payer-arrangement"
              name="payerArrangementId"
              required
              defaultValue={eligibleArrangements.length === 1 ? eligibleArrangements[0]!.id : ''}
              selectClassName="h-10 rounded-md border px-3"
              className="w-full"
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
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm" htmlFor="payer-profile">
            {t('payerRequirementsProfile')}
            <NativeSelect
              id="payer-profile"
              name="payerBillingProfileId"
              defaultValue=""
              selectClassName="h-10 rounded-md border px-3"
              className="w-full"
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
            </NativeSelect>
          </label>
          <p className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground">
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
                  <p className="text-sm text-muted-foreground">
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
        </RHFActionForm>
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
