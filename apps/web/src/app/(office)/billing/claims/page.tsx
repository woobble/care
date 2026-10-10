import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';

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
type ClaimListItem = {
  id: string;
  clientId: string;
  clientName: string;
  invoiceId: string;
  invoiceNumber: string | null;
  payerName: string;
  amountCents: number;
  status: ClaimStatus;
  createdAt: string;
};
type SearchParams = Promise<{ status?: string; error?: string; updated?: string }>;
const statuses: ClaimStatus[] = [
  'draft',
  'ready',
  'submitted',
  'accepted',
  'partially_accepted',
  'rejected',
  'clarification_required',
  'resubmitted',
  'cancelled',
];

export default async function ClaimsWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const status = statuses.find((candidate) => candidate === query.status);
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [permissions, result] = await Promise.all([
    getPermissionGrants(api),
    api.GET('/api/v1/billing/claims', {
      params: { query: { page: 1, pageSize: 50, ...(status ? { status } : {}) }, header },
    }),
  ]);
  const canRead = hasPermission(permissions, 'claims.read');
  const response = result.data as { items?: ClaimListItem[]; hasMore?: boolean } | undefined;
  const claims = canRead ? (response?.items ?? []) : [];
  const error = query.error ?? result.error?.code;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('section')}
        </p>
        <h1 className="text-3xl font-semibold">{t('claims')}</h1>
        <p className="text-slate-700">{t('claimsDescription')}</p>
      </header>
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {query.updated === 'created' ? <Status>{t('claimCreated')}</Status> : null}
      {!canRead ? <Alert>{t('noClaimsPermission')}</Alert> : null}
      <section
        aria-labelledby="claims-worklist-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="claims-worklist-title" className="text-xl font-semibold">
              {t('claimsWorklist')}
            </h2>
            <p className="mt-1 text-sm text-slate-700">{t('claimsWorklistDescription')}</p>
          </div>
          <form action="/billing/claims" className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm" htmlFor="claim-status-filter">
              {t('claimStatusLabel')}
              <select
                id="claim-status-filter"
                name="status"
                defaultValue={status ?? ''}
                className="h-10 rounded-md border px-3"
              >
                <option value="">{t('allClaimStatuses')}</option>
                {statuses.map((claimStatus) => (
                  <option key={claimStatus} value={claimStatus}>
                    {statusLabel(t, claimStatus)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              {t('applyClaimFilter')}
            </Button>
          </form>
        </div>
        {claims.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead>
                <tr className="border-b text-slate-600">
                  <th className="p-2">{t('claim')}</th>
                  <th className="p-2">{t('client')}</th>
                  <th className="p-2">{t('payer')}</th>
                  <th className="p-2">{t('invoiceNumber')}</th>
                  <th className="p-2">{t('amount')}</th>
                  <th className="p-2">{t('claimStatusLabel')}</th>
                  <th className="p-2">{t('claimCreatedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id} className="border-b last:border-0">
                    <td className="p-2 font-medium">
                      <Link
                        className="text-blue-900 underline"
                        href={'/billing/claims/' + claim.id}
                      >
                        {claim.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="p-2">
                      <Link
                        className="text-blue-900 underline"
                        href={'/clients/' + claim.clientId + '/invoices'}
                      >
                        {claim.clientName || claim.clientId.slice(0, 8)}
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
                    <td className="p-2">{formatCents(claim.amountCents, locale as Locale)}</td>
                    <td className="p-2">{statusLabel(t, claim.status)}</td>
                    <td className="p-2">
                      {formatDateTime(claim.createdAt, locale as Locale) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-700">
            {result.error ? t('claimsUnavailable') : t('claimsEmpty')}
          </p>
        )}
        {response?.hasMore ? (
          <p className="text-sm text-slate-600">{t('claimsFirstPageOnly')}</p>
        ) : null}
      </section>
    </div>
  );
}

function statusLabel(
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
