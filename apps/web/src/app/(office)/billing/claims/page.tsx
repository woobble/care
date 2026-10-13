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
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { formatCents } from '@app/web/app/(office)/billing/format';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';

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
  organizationId: string;
  facilityId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  payerName: string;
  amountCents: number;
  status: ClaimStatus;
  createdAt: string;
};
type SearchParams = Promise<{
  status?: string;
  page?: string;
  pageSize?: string;
  error?: string;
  updated?: string;
}>;
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
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
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
      params: { query: { page, pageSize, ...(status ? { status } : {}) }, header },
    }),
  ]);
  const canRead = hasPermission(permissions, 'claims.read');
  const response = result.data as
    | {
        items?: ClaimListItem[];
        page: number;
        pageSize: number;
        total: number;
      }
    | undefined;
  if (response) {
    redirectToValidPage(
      '/billing/claims',
      status ? { status } : {},
      page,
      pageSize,
      response.total,
    );
  }
  const claims = canRead ? (response?.items ?? []) : [];
  const resultError = result.error as { code?: string } | undefined;
  const error = query.error ?? resultError?.code;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader eyebrow={t('section')} title={t('claims')} description={t('claimsDescription')} />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {query.updated === 'created' ? <Status>{t('claimCreated')}</Status> : null}
      {!canRead ? <Alert>{t('noClaimsPermission')}</Alert> : null}
      <section
        aria-labelledby="claims-worklist-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="claims-worklist-title" className="text-xl font-semibold">
              {t('claimsWorklist')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('claimsWorklistDescription')}</p>
          </div>
          <form action="/billing/claims" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="pageSize" value={pageSize} />
            <label className="grid gap-1 text-sm" htmlFor="claim-status-filter">
              {t('claimStatusLabel')}
              <NativeSelect
                id="claim-status-filter"
                name="status"
                defaultValue={status ?? ''}
                selectClassName="h-10 rounded-md border px-3"
                className="w-full"
              >
                <option value="">{t('allClaimStatuses')}</option>
                {statuses.map((claimStatus) => (
                  <option key={claimStatus} value={claimStatus}>
                    {statusLabel(t, claimStatus)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" variant="secondary">
              {t('applyClaimFilter')}
            </Button>
          </form>
        </div>
        {claims.length ? (
          <div className="overflow-x-auto">
            <ShadcnTable className="w-full min-w-[54rem] text-left text-sm">
              <ShadcnTableHeader>
                <ShadcnTableRow className="border-b text-muted-foreground">
                  <ShadcnTableHead className="p-2">{t('claim')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('client')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('payer')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('invoiceNumber')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('amount')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('claimStatusLabel')}</ShadcnTableHead>
                  <ShadcnTableHead className="p-2">{t('claimCreatedAt')}</ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {claims.map((claim) => (
                  <ShadcnTableRow key={claim.id} className="border-b last:border-0">
                    <ShadcnTableCell className="p-2 font-medium">
                      <Link className="text-primary underline" href={'/billing/claims/' + claim.id}>
                        {t('claim')}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      <ResourceReference
                        label={claim.clientName || translate('Resources.unavailableClient')}
                        href={
                          claim.clientName &&
                          hasClientPermission(
                            permissions,
                            'client.read',
                            header['X-Tenant-Id'],
                            claim.organizationId,
                            claim.facilityId,
                          )
                            ? `/clients/${claim.clientId}/invoices`
                            : null
                        }
                      />
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">{claim.payerName}</ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      <ResourceReference
                        label={claim.invoiceNumber ?? t('draftIdentifier')}
                        href={
                          hasClientPermission(
                            permissions,
                            'billing.read',
                            header['X-Tenant-Id'],
                            claim.organizationId,
                            claim.facilityId,
                          )
                            ? `/billing/invoices/${claim.invoiceId}`
                            : null
                        }
                      />
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {formatCents(claim.amountCents, locale as Locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {statusLabel(t, claim.status)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="p-2">
                      {formatDateTime(claim.createdAt, locale as Locale) ?? '—'}
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {result.error ? t('claimsUnavailable') : t('claimsEmpty')}
          </p>
        )}
        {canRead && response ? (
          <DataPagination
            pathname="/billing/claims"
            page={response.page}
            pageSize={response.pageSize}
            totalItems={response.total}
            filters={status ? { status } : {}}
          />
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

function positivePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

function positivePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
}
