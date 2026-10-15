import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';
import { NativeSelect } from '@care/ui/components/native-select';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
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
import { PageHeader, EmptyState } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import type { ReactNode } from 'react';

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
type ClaimGroup =
  | 'preparation'
  | 'ready_to_submit'
  | 'awaiting_response'
  | 'requires_action'
  | 'resolved';
type ClaimListItem = {
  id: string;
  clientId: string;
  clientName: string;
  organizationId: string;
  facilityId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  payerId: string;
  payerName: string | null;
  amountCents: number;
  acceptedCents: number | null;
  paidCents: number;
  submittedAt: string | null;
  status: ClaimStatus;
  createdAt: string;
};
type ClaimSummary = {
  needsPreparation: number;
  readyToSubmit: number;
  awaitingResponse: number;
  requiresAction: number;
  resolved: number;
};
type Organization = { id: string; name: string };
type Facility = { id: string; name: string; organizationName: string };
type Payer = { id: string; name: string; payerIdentifier: string | null };
type SearchParams = Promise<{
  q?: string;
  status?: string;
  group?: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  payerId?: string;
  submissionFrom?: string;
  submissionUntil?: string;
  sort?: string;
  sortOrder?: string;
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
const groups: ClaimGroup[] = [
  'preparation',
  'ready_to_submit',
  'awaiting_response',
  'requires_action',
  'resolved',
];

export default async function ClaimsWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const status = statuses.find((candidate) => candidate === query.status);
  const group = groups.find((candidate) => candidate === query.group);
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
  const search = query.q?.trim().slice(0, 120) ?? '';
  const organizationId = validUuid(query.organizationId) ? query.organizationId : undefined;
  const facilityId = validUuid(query.facilityId) ? query.facilityId : undefined;
  const clientId = validUuid(query.clientId) ? query.clientId : undefined;
  const payerId = validUuid(query.payerId) ? query.payerId : undefined;
  const submissionFrom = validDate(query.submissionFrom) ? query.submissionFrom : undefined;
  const submissionUntil = validDate(query.submissionUntil) ? query.submissionUntil : undefined;
  const sort = ['date', 'amount', 'status'].includes(query.sort ?? '') ? query.sort! : 'date';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  const filters: Record<string, string> = {
    ...(search ? { q: search } : {}),
    ...(status ? { status } : {}),
    ...(group ? { group } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(facilityId ? { facilityId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(payerId ? { payerId } : {}),
    ...(submissionFrom ? { submissionFrom } : {}),
    ...(submissionUntil ? { submissionUntil } : {}),
    sort,
    sortOrder,
  };

  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [permissions, result, organizationResult, facilityResult, payerResult, clientResult] =
    await Promise.all([
      getPermissionGrants(api),
      api.GET('/api/v1/billing/claims', {
        params: {
          query: {
            page,
            pageSize,
            sort,
            sortOrder,
            ...(search ? { q: search } : {}),
            ...(status ? { status } : {}),
            ...(group ? { group } : {}),
            ...(organizationId ? { organizationId } : {}),
            ...(facilityId ? { facilityId } : {}),
            ...(clientId ? { clientId } : {}),
            ...(payerId ? { payerId } : {}),
            ...(submissionFrom ? { submissionFrom } : {}),
            ...(submissionUntil ? { submissionUntil } : {}),
          },
          header,
        },
      }),
      organizationId
        ? api.GET('/api/v1/organizations/{id}', {
            params: { path: { id: organizationId }, header },
          })
        : Promise.resolve(null),
      facilityId
        ? api.GET('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
        : Promise.resolve(null),
      organizationId && payerId
        ? api.GET('/api/v1/billing/payer-directory/lookup', {
            params: { query: { organizationId, payerIds: payerId }, header },
          })
        : Promise.resolve(null),
      clientId
        ? api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
        : Promise.resolve(null),
    ]);
  const canRead = hasPermission(permissions, 'claims.read');
  const response = result.data as
    | {
        items?: ClaimListItem[];
        page: number;
        pageSize: number;
        total: number;
        summary?: ClaimSummary;
      }
    | undefined;
  if (response) {
    redirectToValidPage('/billing/claims', filters, page, pageSize, response.total);
  }
  const claims = canRead ? (response?.items ?? []) : [];
  const summary = response?.summary;
  const organization = organizationResult?.data as Organization | undefined;
  const facility = facilityResult?.data as Facility | undefined;
  const payer = (payerResult?.data as Payer[] | undefined)?.[0];
  const selectedClient = clientResult?.data;
  const canReadClients = hasPermission(permissions, 'client.read');
  const resultError = result.error as { code?: string } | undefined;
  const error = query.error ?? resultError?.code;
  const groupHref = (nextGroup: ClaimGroup) => {
    const params = new URLSearchParams(filters);
    params.delete('status');
    params.set('group', nextGroup);
    params.delete('page');
    return `/billing/claims?${params.toString()}`;
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6">
      <PageHeader eyebrow={t('section')} title={t('claims')} description={t('claimsDescription')} />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {query.updated === 'created' ? <Status>{t('claimCreated')}</Status> : null}
      {!canRead ? <Alert>{t('noClaimsPermission')}</Alert> : null}

      {canRead && summary ? (
        <section
          aria-label={t('claimsOverview')}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <SummaryLink
            href={groupHref('preparation')}
            label={t('claimGroups.preparation')}
            value={summary.needsPreparation}
            tone="muted"
          />
          <SummaryLink
            href={groupHref('ready_to_submit')}
            label={t('claimGroups.ready_to_submit')}
            value={summary.readyToSubmit}
            tone="success"
          />
          <SummaryLink
            href={groupHref('awaiting_response')}
            label={t('claimGroups.awaiting_response')}
            value={summary.awaitingResponse}
            tone="primary"
          />
          <SummaryLink
            href={groupHref('requires_action')}
            label={t('claimGroups.requires_action')}
            value={summary.requiresAction}
            tone="warning"
          />
        </section>
      ) : null}

      <section
        aria-labelledby="claims-worklist-title"
        className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5"
      >
        <div>
          <h2 id="claims-worklist-title" className="text-xl font-semibold">
            {t('claimsWorklist')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('claimsWorklistDescription')}</p>
        </div>
        <form
          action="/billing/claims"
          method="get"
          className="grid gap-3 rounded-md border bg-background/50 p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input type="hidden" name="pageSize" value={pageSize} />
          <label className="grid gap-1 text-sm sm:col-span-2" htmlFor="claim-search">
            {t('claimsSearch')}
            <input
              id="claim-search"
              name="q"
              type="search"
              defaultValue={search}
              maxLength={120}
              className="min-h-11 rounded-md border bg-card px-3"
            />
          </label>
          <label className="grid gap-1 text-sm" htmlFor="claim-status-filter">
            {t('claimStatusLabel')}
            <NativeSelect
              id="claim-status-filter"
              name="status"
              defaultValue={status ?? ''}
              selectClassName="min-h-11 rounded-md border bg-card px-3"
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
          <label className="grid gap-1 text-sm" htmlFor="claim-group-filter">
            {t('claimsQueue')}
            <NativeSelect
              id="claim-group-filter"
              name="group"
              defaultValue={group ?? ''}
              selectClassName="min-h-11 rounded-md border bg-card px-3"
              className="w-full"
            >
              <option value="">{t('allClaimGroups')}</option>
              {groups.map((claimGroup) => (
                <option key={claimGroup} value={claimGroup}>
                  {t(`claimGroups.${claimGroup}`)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <AsyncEntityCombobox
            name="organizationId"
            entity="organizations"
            label={translate('Common.fields.organization')}
            placeholder={translate('Common.fields.organization')}
            initialOption={
              organization ? { id: organization.id, label: organization.name } : undefined
            }
          />
          <AsyncEntityCombobox
            name="facilityId"
            entity="facilities"
            label={translate('Common.fields.facility')}
            placeholder={translate('Common.fields.facility')}
            {...(organizationId ? { organizationId } : {})}
            initialOption={
              facility
                ? {
                    id: facility.id,
                    label: [facility.name, facility.organizationName].filter(Boolean).join(' · '),
                  }
                : undefined
            }
          />
          {canReadClients ? (
            <AsyncEntityCombobox
              name="clientId"
              entity="clients"
              label={t('client')}
              placeholder={translate('Common.fields.all')}
              initialOption={
                selectedClient
                  ? {
                      id: selectedClient.id,
                      label: `${selectedClient.preferredName || selectedClient.firstName} ${selectedClient.lastName}`,
                    }
                  : undefined
              }
            />
          ) : null}
          {organizationId ? (
            <AsyncEntityCombobox
              name="payerId"
              entity="payers"
              label={t('payer')}
              placeholder={t('searchPayers')}
              minQueryLength={2}
              organizationId={organizationId}
              initialOption={
                payer
                  ? {
                      id: payer.id,
                      label: [payer.name, payer.payerIdentifier].filter(Boolean).join(' · '),
                    }
                  : undefined
              }
            />
          ) : (
            <label className="grid gap-1 text-sm">
              {t('payer')}
              <span className="flex min-h-11 items-center rounded-md border bg-muted/40 px-3 text-muted-foreground">
                {t('selectOrganizationFirst')}
              </span>
            </label>
          )}
          <label className="grid gap-1 text-sm" htmlFor="claim-submission-from">
            {t('claimSubmissionFrom')}
            <input
              id="claim-submission-from"
              name="submissionFrom"
              type="date"
              defaultValue={submissionFrom ?? ''}
              className="min-h-11 rounded-md border bg-card px-3"
            />
          </label>
          <label className="grid gap-1 text-sm" htmlFor="claim-submission-until">
            {t('claimSubmissionUntil')}
            <input
              id="claim-submission-until"
              name="submissionUntil"
              type="date"
              defaultValue={submissionUntil ?? ''}
              className="min-h-11 rounded-md border bg-card px-3"
            />
          </label>
          <label className="grid gap-1 text-sm" htmlFor="claim-sort">
            {t('claimSort')}
            <NativeSelect
              id="claim-sort"
              name="sort"
              defaultValue={sort}
              selectClassName="min-h-11 rounded-md border bg-card px-3"
              className="w-full"
            >
              <option value="date">{t('claimSortOptions.date')}</option>
              <option value="amount">{t('claimSortOptions.amount')}</option>
              <option value="status">{t('claimSortOptions.status')}</option>
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm" htmlFor="claim-sort-order">
            {t('claimSortOrder')}
            <NativeSelect
              id="claim-sort-order"
              name="sortOrder"
              defaultValue={sortOrder}
              selectClassName="min-h-11 rounded-md border bg-card px-3"
              className="w-full"
            >
              <option value="desc">{translate('Common.filters.descending')}</option>
              <option value="asc">{translate('Common.filters.ascending')}</option>
            </NativeSelect>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" className="min-h-11">
              {t('applyClaimFilter')}
            </Button>
            <Button asChild variant="secondary" className="min-h-11">
              <Link href="/billing/claims">{t('clearClaimFilters')}</Link>
            </Button>
          </div>
        </form>

        {claims.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <ShadcnTable className="w-full min-w-[66rem] text-left text-sm">
                <ShadcnTableHeader>
                  <ShadcnTableRow className="border-b text-muted-foreground">
                    <ShadcnTableHead className="p-3">{t('claimReference')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('client')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('payer')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('invoiceNumber')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('claimAmount')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('claimStatusLabel')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('claimSubmittedAt')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-3">{t('claimCreatedAt')}</ShadcnTableHead>
                  </ShadcnTableRow>
                </ShadcnTableHeader>
                <ShadcnTableBody>
                  {claims.map((claim) => (
                    <ShadcnTableRow key={claim.id} className="border-b last:border-0">
                      <ShadcnTableCell className="p-3 font-medium">
                        <Link
                          className="text-primary underline"
                          href={`/billing/claims/${claim.id}`}
                        >
                          {claimReference(claim.id)}
                        </Link>
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
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
                      <ShadcnTableCell className="p-3">
                        <ResourceReference
                          label={claim.payerName ?? t('payer')}
                          href={
                            hasPermission(permissions, 'claims.read')
                              ? `/billing/claims/settings?organizationId=${claim.organizationId}&q=${encodeURIComponent(claim.payerName ?? '')}`
                              : null
                          }
                        />
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
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
                      <ShadcnTableCell className="p-3">
                        {formatCents(claim.amountCents, locale as Locale)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        <StatusBadge status={claim.status} label={statusLabel(t, claim.status)} />
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {claim.submittedAt
                          ? (formatDateTime(claim.submittedAt, locale as Locale) ?? '—')
                          : '—'}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-3">
                        {formatDateTime(claim.createdAt, locale as Locale) ?? '—'}
                      </ShadcnTableCell>
                    </ShadcnTableRow>
                  ))}
                </ShadcnTableBody>
              </ShadcnTable>
            </div>
            <ul className="grid gap-3 md:hidden">
              {claims.map((claim) => (
                <li key={claim.id} className="grid gap-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/billing/claims/${claim.id}`}
                    >
                      {claimReference(claim.id)}
                    </Link>
                    <StatusBadge status={claim.status} label={statusLabel(t, claim.status)} />
                  </div>
                  <dl className="grid gap-2 text-sm">
                    <MobileMetric
                      label={t('client')}
                      value={
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
                      }
                    />
                    <MobileMetric label={t('payer')} value={claim.payerName ?? t('payer')} />
                    <MobileMetric
                      label={t('invoiceNumber')}
                      value={claim.invoiceNumber ?? t('draftIdentifier')}
                    />
                    <MobileMetric
                      label={t('claimAmount')}
                      value={formatCents(claim.amountCents, locale as Locale)}
                    />
                    <MobileMetric
                      label={t('claimSubmittedAt')}
                      value={
                        claim.submittedAt
                          ? (formatDateTime(claim.submittedAt, locale as Locale) ?? '—')
                          : '—'
                      }
                    />
                  </dl>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-sm">
                    {hasClientPermission(
                      permissions,
                      'billing.read',
                      header['X-Tenant-Id'],
                      claim.organizationId,
                      claim.facilityId,
                    ) ? (
                      <Link
                        className="text-primary underline"
                        href={`/billing/invoices/${claim.invoiceId}`}
                      >
                        {t('openInvoice')}
                      </Link>
                    ) : null}
                    <Link
                      className="text-primary underline"
                      href={`/billing/claims/settings?organizationId=${claim.organizationId}&q=${encodeURIComponent(claim.payerName ?? '')}`}
                    >
                      {t('openPayerRecord')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            title={result.error ? t('claimsUnavailable') : t('claimsEmpty')}
            {...(search || status || group || organizationId || facilityId || payerId
              ? { description: t('claimsNoFilterResults') }
              : {})}
          />
        )}
        {canRead && response ? (
          <DataPagination
            pathname="/billing/claims"
            page={response.page}
            pageSize={response.pageSize}
            totalItems={response.total}
            filters={filters}
          />
        ) : null}
      </section>
    </div>
  );
}

function SummaryLink({
  href,
  label,
  value,
  tone,
}: Readonly<{
  href: string;
  label: string;
  value: number;
  tone: 'muted' | 'success' | 'primary' | 'warning';
}>) {
  const toneClass = {
    muted: 'border-border bg-card',
    success: 'border-success/30 bg-success-muted',
    primary: 'border-primary/30 bg-accent',
    warning: 'border-warning/40 bg-warning-muted',
  }[tone];
  return (
    <Link
      href={href}
      className={`grid gap-1 rounded-lg border p-4 transition-colors hover:bg-muted/60 ${toneClass}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </Link>
  );
}

function StatusBadge({ status, label }: Readonly<{ status: ClaimStatus; label: string }>) {
  const color =
    status === 'ready' || status === 'accepted'
      ? 'bg-success-muted text-success-foreground'
      : status === 'rejected' ||
          status === 'clarification_required' ||
          status === 'partially_accepted'
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

function MobileMetric({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

function claimReference(id: string): string {
  return `CLM-${id.replaceAll('-', '').slice(-8).toUpperCase()}`;
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

function validUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
