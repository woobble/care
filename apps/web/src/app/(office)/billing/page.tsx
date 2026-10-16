import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { FilterDisclosure } from '@app/web/components/filter-disclosure';
import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';

import { createDraftInvoiceAction } from './actions';
import { BillingNavigation } from './billing-nav';
import { euroInput, formatCents, lineAmountField } from './format';

type Candidate = components['schemas']['BillingCandidateResponseDto'];
type CandidateGroup = {
  organizationId: string;
  facilityId: string;
  clientId: string;
  clientName: string;
  organizationName: string;
  facilityName: string;
  recipientType: 'client' | 'payer';
  payerArrangementId: string | null;
  recipientName: string | null;
  candidates: Candidate[];
};
type SearchParams = Promise<{
  page?: string;
  pageSize?: string;
  q?: string;
  from?: string;
  until?: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  fundingSourceId?: string;
  ready?: string;
  evidenceStatus?: string;
  error?: string;
  updated?: string;
}>;

export default async function BillingWorklistPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const from = validDate(query.from);
  const until = validDate(query.until);
  const page = positivePage(query.page);
  const pageSize = positivePageSize(query.pageSize);
  const q = validSearch(query.q);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const fundingSourceId = validUuid(query.fundingSourceId);
  const ready = query.ready === 'true' || query.ready === 'false' ? query.ready : undefined;
  const evidenceStatus = query.evidenceStatus?.trim().slice(0, 80) || undefined;
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const canReadClients = hasPermission(permissions, 'client.read');
  const candidateResult = await get('/api/v1/billing/candidates', {
    params: {
      query: {
        ...(from ? { from } : {}),
        ...(until ? { until } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(facilityId ? { facilityId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(fundingSourceId ? { fundingSourceId } : {}),
        ...(q ? { q } : {}),
        page,
        pageSize,
        ...(ready ? { ready } : {}),
        ...(evidenceStatus ? { evidenceStatus } : {}),
      },
      header,
    },
  });
  const [organizationResult, facilityResult, clientResult] = await Promise.all([
    organizationId && canReadOrganizations
      ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    facilityId && canReadFacilities
      ? get('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    clientId && canReadClients
      ? get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const candidateData = candidateResult.data as unknown as
    | (components['schemas']['BillingCandidateListResponseDto'] & {
        page: number;
        pageSize: number;
        totalServices: number;
        totalPages: number;
      })
    | undefined;
  const selectedOrganization = organizationResult.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedClient = clientResult.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const candidateError = candidateResult.error as { code?: string } | undefined;
  const organizationError = organizationResult.error as { code?: string } | undefined;
  const facilityError = facilityResult.error as { code?: string } | undefined;
  const clientError = clientResult.error as { code?: string } | undefined;
  const candidates = candidateData?.items ?? [];
  if (candidateData) {
    redirectToValidPage(
      '/billing',
      candidateFilters({
        q,
        from,
        until,
        organizationId,
        facilityId,
        clientId,
        fundingSourceId,
        ready,
        evidenceStatus,
      }),
      page,
      pageSize,
      candidateData.totalServices,
    );
  }
  const groups = await candidateGroups(api, candidates);
  const canManage = hasPermission(permissions, 'billing.manage');
  const canExport =
    hasPermission(permissions, 'documents.exports.read') &&
    hasPermission(permissions, 'billing.read');
  const updated = query.updated === 'draft';
  const error =
    query.error ??
    candidateError?.code ??
    organizationError?.code ??
    facilityError?.code ??
    clientError?.code;

  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader eyebrow={t('section')} title={t('title')} description={t('description')} />
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {updated ? <Status>{t('draftCreated')}</Status> : null}

      <section aria-labelledby="worklist-title" id="worklist" className="grid min-w-0 gap-4">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="worklist-title" className="text-xl font-semibold">
              {t('worklistTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('worklistDescription')}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('candidateCount', { count: candidates.length })}
          </p>
        </div>
        <FilterDisclosure title={t('filters')}>
          <form method="get" className="grid min-w-0 gap-3 md:grid-cols-3">
            <input type="hidden" name="page" value="1" />
            <input type="hidden" name="pageSize" value={pageSize} />
            <Field
              id="candidate-search"
              name="q"
              label={t('searchBillingServices')}
              defaultValue={q ?? ''}
              minLength={2}
              maxLength={120}
            />
            <Field
              id="billing-from"
              name="from"
              label={t('from')}
              type="date"
              defaultValue={from ?? ''}
            />
            <Field
              id="billing-until"
              name="until"
              label={t('until')}
              type="date"
              defaultValue={until ?? ''}
            />
            {canReadOrganizations ? (
              <AsyncEntityCombobox
                name="organizationId"
                label={t('organizationFilter')}
                entity="organizations"
                placeholder={t('allOrganizations')}
                {...(selectedOrganization
                  ? {
                      initialOption: {
                        id: selectedOrganization.id,
                        label: selectedOrganization.name,
                      },
                    }
                  : {})}
              />
            ) : null}
            {canReadFacilities ? (
              <AsyncEntityCombobox
                name="facilityId"
                label={t('facilityFilter')}
                entity="facilities"
                {...(organizationId ? { organizationId } : {})}
                placeholder={t('allFacilities')}
                {...(selectedFacility
                  ? {
                      initialOption: {
                        id: selectedFacility.id,
                        label: `${selectedFacility.organizationName} · ${selectedFacility.name}`,
                      },
                    }
                  : {})}
              />
            ) : null}
            {canReadClients ? (
              <AsyncEntityCombobox
                name="clientId"
                label={t('clientFilter')}
                entity="clients"
                placeholder={t('allClients')}
                {...(selectedClient
                  ? {
                      initialOption: {
                        id: selectedClient.id,
                        label: `${selectedClient.preferredName || selectedClient.firstName} ${selectedClient.lastName}`,
                      },
                    }
                  : {})}
              />
            ) : null}
            <Field
              id="funding-source"
              name="fundingSourceId"
              label={t('fundingSourceFilter')}
              defaultValue={fundingSourceId ?? ''}
            />
            <SelectField
              id="candidate-readiness"
              name="ready"
              label={t('readinessFilter')}
              defaultValue={ready ?? ''}
            >
              <option value="">{t('allReadiness')}</option>
              <option value="true">{t('ready')}</option>
              <option value="false">{t('blocked')}</option>
            </SelectField>
            <Field
              id="candidate-evidence"
              name="evidenceStatus"
              label={t('evidenceFilter')}
              defaultValue={evidenceStatus ?? ''}
            />
            <div className="flex min-w-0 flex-wrap items-end gap-2 md:col-span-3">
              <Button type="submit">{t('applyFilters')}</Button>
              <Button asChild variant="secondary">
                <Link href="/billing">{t('clearFilters')}</Link>
              </Button>
            </div>
          </form>
        </FilterDisclosure>

        {canExport ? (
          <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-4">
            {organizationId && from && until ? (
              <>
                <Button asChild variant="secondary">
                  <Link
                    href={billingExportHref(
                      'invoices',
                      from,
                      until,
                      organizationId,
                      facilityId,
                      clientId,
                    )}
                  >
                    {t('exportInvoices')}
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link
                    href={billingExportHref(
                      'invoice-lines',
                      from,
                      until,
                      organizationId,
                      facilityId,
                      clientId,
                    )}
                  >
                    {t('exportInvoiceLines')}
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link
                    href={billingExportHref(
                      'receivables',
                      from,
                      until,
                      organizationId,
                      facilityId,
                      clientId,
                    )}
                  >
                    {t('exportReceivables')}
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('exportNeedsFilters')}</p>
            )}
          </section>
        ) : null}

        {candidates.length === 0 ? (
          <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
            {candidateData && candidateData.totalServices > 0
              ? t('candidatePageEmpty')
              : t('worklistEmpty')}
          </p>
        ) : (
          <div className="grid min-w-0 gap-4">
            {groups.map((group) => (
              <section
                key={groupKey(group)}
                className="grid min-w-0 gap-3 rounded-lg border bg-card p-5"
              >
                <header className="grid min-w-0 gap-1">
                  <h3 className="text-lg font-semibold break-words">{group.clientName}</h3>
                  <p className="text-sm break-words text-muted-foreground">
                    {group.organizationName} · {group.facilityName} ·{' '}
                    {t(group.recipientType === 'payer' ? 'payerInvoice' : 'clientInvoice')}
                    {group.recipientName ? ` · ${group.recipientName}` : ''}
                  </p>
                </header>
                {canManage ? (
                  <RHFActionForm action={createDraftInvoiceAction} className="grid gap-3">
                    <input type="hidden" name="organizationId" value={group.organizationId} />
                    <input type="hidden" name="facilityId" value={group.facilityId} />
                    <input type="hidden" name="clientId" value={group.clientId} />
                    <input type="hidden" name="recipientType" value={group.recipientType} />
                    {group.payerArrangementId ? (
                      <input
                        type="hidden"
                        name="payerArrangementId"
                        value={group.payerArrangementId}
                      />
                    ) : null}
                    <ul className="grid min-w-0 gap-3">
                      {group.candidates.map((candidate) => (
                        <li
                          key={candidate.id}
                          className="grid min-w-0 gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="grid min-w-0 gap-1">
                            <p className="font-medium break-words">
                              {candidate.serviceName} · {formatDate(candidate.serviceDate, locale)}
                            </p>
                            <p className="text-sm break-words text-muted-foreground">
                              {candidate.quantity} {t(`unit.${candidate.unit}`)} ·{' '}
                              {candidate.fundingLabel ?? t('selfPay')} · {candidate.evidenceStatus}
                            </p>
                            <p className="text-sm break-words text-muted-foreground">
                              {t('unitPrice')}: {formatCents(candidate.unitPriceCents, locale)} ·{' '}
                              {t('remainingBillable')}:{' '}
                              {formatCents(candidate.remainingBillableAmountCents, locale)}
                            </p>
                            {candidate.blockers.length ? (
                              <ul className="mt-1 grid min-w-0 gap-1 text-sm text-warning-foreground">
                                {candidate.blockers.map((blocker) => (
                                  <li key={blocker}>{blockerLabel(t, blocker)}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div className="grid min-w-0 content-start gap-2 md:min-w-52">
                            <label className="flex items-center gap-2 text-sm">
                              <ShadcnCheckbox
                                name="selectedLine"
                                value={`${candidate.performedServiceId}|${candidate.fundingAllocationId ?? ''}`}
                                disabled={
                                  !candidate.ready || candidate.remainingBillableAmountCents <= 0
                                }
                              />
                              {t('includeService')}
                            </label>
                            <Field
                              id={`line-amount-${candidate.performedServiceId}-${candidate.fundingAllocationId ?? 'self'}`}
                              name={lineAmountField(
                                candidate.performedServiceId,
                                candidate.fundingAllocationId,
                              )}
                              label={t('invoiceAmount')}
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="0.01"
                              defaultValue={euroInput(candidate.remainingBillableAmountCents)}
                              disabled={
                                !candidate.ready || candidate.remainingBillableAmountCents <= 0
                              }
                              required={
                                candidate.ready && candidate.remainingBillableAmountCents > 0
                              }
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="submit"
                      className="w-fit"
                      disabled={
                        !group.candidates.some(
                          (candidate) =>
                            candidate.ready && candidate.remainingBillableAmountCents > 0,
                        )
                      }
                    >
                      {t('createDraft')}
                    </Button>
                  </RHFActionForm>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noManagePermission')}</p>
                )}
              </section>
            ))}
          </div>
        )}
        {candidateData ? (
          <DataPagination
            pathname="/billing"
            page={candidateData.page}
            pageSize={candidateData.pageSize}
            totalPages={candidateData.totalPages}
            summaryLabel={t('candidateServicesPage', {
              page: candidateData.page,
              pageCount: Math.max(1, candidateData.totalPages),
              total: candidateData.totalServices,
            })}
            filters={candidateFilters({
              q,
              from,
              until,
              organizationId,
              facilityId,
              clientId,
              fundingSourceId,
              ready,
              evidenceStatus,
            })}
          />
        ) : null}
      </section>
    </div>
  );
}

async function candidateGroups(
  api: Awaited<ReturnType<typeof getApiClient>>,
  candidates: Candidate[],
): Promise<CandidateGroup[]> {
  const groups = new Map<string, CandidateGroup>();
  const payerIds = new Set<string>();
  for (const candidate of candidates) {
    const recipientType =
      candidate.recommendedRecipient === 'payer' && candidate.recommendedPayerArrangementId
        ? 'payer'
        : 'client';
    const payerArrangementId =
      recipientType === 'payer' ? candidate.recommendedPayerArrangementId : null;
    const key = [
      candidate.organizationId,
      candidate.facilityId,
      candidate.clientId,
      recipientType,
      payerArrangementId ?? '',
    ].join('|');
    const existing = groups.get(key);
    if (existing) existing.candidates.push(candidate);
    else {
      groups.set(key, {
        organizationId: candidate.organizationId,
        facilityId: candidate.facilityId,
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        organizationName: candidate.organizationName,
        facilityName: candidate.facilityName,
        recipientType,
        payerArrangementId,
        recipientName: null,
        candidates: [candidate],
      });
    }
    if (payerArrangementId)
      payerIds.add(`${candidate.clientId}|${candidate.organizationId}|${payerArrangementId}`);
  }
  const lookups = await Promise.all(
    [...payerIds].map(async (key) => {
      const [clientId, organizationId, arrangementId] = key.split('|');
      if (!clientId || !organizationId || !arrangementId) return [key, null] as const;
      const arrangementResult = await api.GET('/api/v1/billing/payer-arrangements', {
        params: { query: { clientId, organizationId }, header: await getTenantHeader() },
      });
      const data = arrangementResult.data as unknown as
        | components['schemas']['PayerArrangementListResponseDto']
        | undefined;
      return [
        key,
        data?.items.find((arrangement) => arrangement.id === arrangementId)?.recipientName ?? null,
      ] as const;
    }),
  );
  const payerNames = new Map(lookups);
  for (const group of groups.values()) {
    if (group.payerArrangementId) {
      group.recipientName =
        payerNames.get(`${group.clientId}|${group.organizationId}|${group.payerArrangementId}`) ??
        null;
    }
  }
  return [...groups.values()];
}

function groupKey(group: CandidateGroup): string {
  return [
    group.organizationId,
    group.facilityId,
    group.clientId,
    group.recipientType,
    group.payerArrangementId ?? 'client',
  ].join('|');
}

const blockerKeys = {
  PRICE_UNAVAILABLE: 'blockers.PRICE_UNAVAILABLE',
  SERVICE_QUANTITY_MISSING: 'blockers.SERVICE_QUANTITY_MISSING',
  PRICE_UNIT_MISMATCH: 'blockers.PRICE_UNIT_MISMATCH',
  EXECUTION_INCOMPLETE: 'blockers.EXECUTION_INCOMPLETE',
  DOCUMENTATION_INCOMPLETE: 'blockers.DOCUMENTATION_INCOMPLETE',
  EVIDENCE_MISSING: 'blockers.EVIDENCE_MISSING',
  EVIDENCE_OUTDATED: 'blockers.EVIDENCE_OUTDATED',
  ACKNOWLEDGEMENT_REQUIRED: 'blockers.ACKNOWLEDGEMENT_REQUIRED',
  INVOICE_ISSUER_INCOMPLETE: 'blockers.INVOICE_ISSUER_INCOMPLETE',
  INVOICE_FORMAT_UNSUPPORTED: 'blockers.INVOICE_FORMAT_UNSUPPORTED',
  FUNDING_ALLOCATION_EXCEEDS_SERVICE: 'blockers.FUNDING_ALLOCATION_EXCEEDS_SERVICE',
  FUNDING_ALLOCATION_PROVISIONAL: 'blockers.FUNDING_ALLOCATION_PROVISIONAL',
  BILLING_FUNDING_NOT_RESOLVED: 'blockers.BILLING_FUNDING_NOT_RESOLVED',
  BILLING_SERVICE_ALREADY_INVOICED: 'blockers.BILLING_SERVICE_ALREADY_INVOICED',
  INVOICE_RECIPIENT_INVALID: 'blockers.INVOICE_RECIPIENT_INVALID',
} as const;

function blockerLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  blocker: string,
): string {
  const key = blockerKeys[blocker as keyof typeof blockerKeys];
  return key ? t(key) : blocker;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function validSearch(value: string | undefined): string | undefined {
  const search = value?.trim().slice(0, 120);
  return search && search.length >= 2 ? search : undefined;
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

function candidateFilters(filters: {
  q?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
  organizationId?: string | undefined;
  facilityId?: string | undefined;
  clientId?: string | undefined;
  fundingSourceId?: string | undefined;
  ready?: string | undefined;
  evidenceStatus?: string | undefined;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function billingExportHref(
  type: 'invoices' | 'invoice-lines' | 'receivables',
  from: string,
  until: string,
  organizationId: string,
  facilityId: string | undefined,
  clientId: string | undefined,
): string {
  const query = new URLSearchParams({ from, until, organizationId });
  if (facilityId) query.set('facilityId', facilityId);
  if (clientId) query.set('clientId', clientId);
  return `/exports/${type}?${query.toString()}`;
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  inputMode,
  min,
  step,
  disabled,
  required,
  minLength,
  maxLength,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  inputMode?: 'decimal' | 'numeric';
  min?: string;
  step?: string;
  disabled?: boolean;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}>) {
  return (
    <label className="grid min-w-0 gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        inputMode={inputMode}
        min={min}
        step={step}
        disabled={disabled}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
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
  defaultValue?: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid min-w-0 gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        selectClassName="min-h-10 w-full min-w-0 max-w-full rounded-md border border-border bg-card px-3 py-2"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
