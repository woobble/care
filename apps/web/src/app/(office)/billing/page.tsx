import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import type { components } from '@care/api-client';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
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
  from?: string;
  until?: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  clientSearch?: string;
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
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const fundingSourceId = validUuid(query.fundingSourceId);
  const ready = query.ready === 'true' || query.ready === 'false' ? query.ready : undefined;
  const evidenceStatus = query.evidenceStatus?.trim().slice(0, 80) || undefined;
  const clientSearch = query.clientSearch?.trim().slice(0, 100) || undefined;
  const candidateResult = await get('/api/v1/billing/candidates', {
    params: {
      query: {
        ...(from ? { from } : {}),
        ...(until ? { until } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(facilityId ? { facilityId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(fundingSourceId ? { fundingSourceId } : {}),
        ...(ready ? { ready } : {}),
        ...(evidenceStatus ? { evidenceStatus } : {}),
      },
      header,
    },
  });
  const [organizationResult, facilityResult, clientResult] = await Promise.all([
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', {
      params: { query: organizationId ? { organizationId } : {}, header },
    }),
    get('/api/v1/clients', {
      params: {
        query: { page: 1, pageSize: 100, ...(clientSearch ? { q: clientSearch } : {}) },
        header,
      },
    }),
  ]);
  const clients = (clientResult.data?.items ?? []).map(
    ({ id, preferredName, firstName, lastName }) => ({ id, preferredName, firstName, lastName }),
  );
  if (clientId && !clients.some((client) => client.id === clientId)) {
    const selectedClient = await get('/api/v1/clients/{id}', {
      params: { path: { id: clientId }, header },
    });
    if (selectedClient.data) {
      clients.unshift({
        id: selectedClient.data.id,
        preferredName: selectedClient.data.preferredName,
        firstName: selectedClient.data.firstName,
        lastName: selectedClient.data.lastName,
      });
    }
  }
  const candidates = candidateResult.data?.items ?? [];
  const groups = await candidateGroups(api, candidates);
  const canManage = hasPermission(permissions, 'billing.manage');
  const canExport =
    hasPermission(permissions, 'documents.exports.read') &&
    hasPermission(permissions, 'billing.read');
  const updated = query.updated === 'draft';
  const error = query.error ?? candidateResult.error?.code;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('section')}
        </p>
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-slate-700">{t('description')}</p>
      </header>
      <BillingNavigation permissions={permissions} />
      {error ? <Alert>{translate(errorMessageKey(error))}</Alert> : null}
      {updated ? <Status>{t('draftCreated')}</Status> : null}

      <section aria-labelledby="worklist-title" id="worklist" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="worklist-title" className="text-xl font-semibold">
              {t('worklistTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-700">{t('worklistDescription')}</p>
          </div>
          <p className="text-sm text-slate-600">
            {t('candidateCount', { count: candidates.length })}
          </p>
        </div>
        <form method="get" className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-3">
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
          <SelectField
            id="billing-organization"
            name="organizationId"
            label={t('organizationFilter')}
            defaultValue={organizationId ?? ''}
          >
            <option value="">{t('allOrganizations')}</option>
            {(organizationResult.data ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="billing-facility"
            name="facilityId"
            label={t('facilityFilter')}
            defaultValue={facilityId ?? ''}
          >
            <option value="">{t('allFacilities')}</option>
            {(facilityResult.data ?? []).map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-2">
            <Field
              id="client-search"
              name="clientSearch"
              label={t('clientSearch')}
              defaultValue={clientSearch ?? ''}
            />
            <SelectField
              id="billing-client"
              name="clientId"
              label={t('clientFilter')}
              defaultValue={clientId ?? ''}
            >
              <option value="">{t('allClients')}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.preferredName || client.firstName} {client.lastName}
                </option>
              ))}
            </SelectField>
          </div>
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
          <div className="flex items-end gap-2 md:col-span-3">
            <Button type="submit">{t('applyFilters')}</Button>
            <Button asChild variant="secondary">
              <Link href="/billing">{t('clearFilters')}</Link>
            </Button>
          </div>
        </form>

        {canExport ? (
          <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-4">
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
              <p className="text-sm text-slate-700">{t('exportNeedsFilters')}</p>
            )}
          </section>
        ) : null}

        {candidates.length === 0 ? (
          <p className="rounded-lg border bg-white p-5 text-sm text-slate-700">
            {t('worklistEmpty')}
          </p>
        ) : (
          <div className="grid gap-4">
            {groups.map((group) => (
              <section key={groupKey(group)} className="grid gap-3 rounded-lg border bg-white p-5">
                <header className="grid gap-1">
                  <h3 className="text-lg font-semibold">{group.clientName}</h3>
                  <p className="text-sm text-slate-700">
                    {group.organizationName} · {group.facilityName} ·{' '}
                    {t(group.recipientType === 'payer' ? 'payerInvoice' : 'clientInvoice')}
                    {group.recipientName ? ` · ${group.recipientName}` : ''}
                  </p>
                </header>
                {canManage ? (
                  <form action={createDraftInvoiceAction} className="grid gap-3">
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
                    <ul className="grid gap-3">
                      {group.candidates.map((candidate) => (
                        <li
                          key={candidate.id}
                          className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_auto]"
                        >
                          <div className="grid gap-1">
                            <p className="font-medium">
                              {candidate.serviceName} · {formatDate(candidate.serviceDate, locale)}
                            </p>
                            <p className="text-sm text-slate-700">
                              {candidate.quantity} {t(`unit.${candidate.unit}`)} ·{' '}
                              {candidate.fundingLabel ?? t('selfPay')} · {candidate.evidenceStatus}
                            </p>
                            <p className="text-sm text-slate-700">
                              {t('unitPrice')}: {formatCents(candidate.unitPriceCents, locale)} ·{' '}
                              {t('remainingBillable')}:{' '}
                              {formatCents(candidate.remainingBillableAmountCents, locale)}
                            </p>
                            {candidate.blockers.length ? (
                              <ul className="mt-1 grid gap-1 text-sm text-amber-900">
                                {candidate.blockers.map((blocker) => (
                                  <li key={blocker}>{blockerLabel(t, blocker)}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div className="grid content-start gap-2 md:min-w-52">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
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
                  </form>
                ) : (
                  <p className="text-sm text-slate-700">{t('noManagePermission')}</p>
                )}
              </section>
            ))}
          </div>
        )}
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
      const { data } = await api.GET('/api/v1/billing/payer-arrangements', {
        params: { query: { clientId, organizationId }, header: await getTenantHeader() },
      });
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
  inputMode,
  min,
  step,
  disabled,
  required,
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
}>) {
  return (
    <label className="grid gap-2 text-sm">
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
    <label className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2"
      >
        {children}
      </select>
    </label>
  );
}
