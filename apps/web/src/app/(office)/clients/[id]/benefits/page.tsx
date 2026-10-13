import { ErrorNotice as Alert } from '@app/web/components/page-patterns';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatCurrency, formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import {
  createEntitlementAction,
  createFundingSourceAction,
  recordBenefitAdjustmentAction,
} from '@app/web/app/(office)/benefits/actions';
import { generateDocumentAction } from '@app/web/app/(office)/documents/actions';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const historyEntryTypes = [
  'entitlement_allocated',
  'opening_balance_adjusted',
  'external_consumption_recorded',
  'service_consumption_allocated',
  'service_consumption_reversed',
  'manual_adjustment',
  'benefit_expired',
] as const;
const benefitTypes = [
  'entlastungsbetrag_45b',
  'umwandlungsanspruch_45a_4',
  'private',
  'other',
] as const;
const verificationStatuses = [
  'estimated',
  'client_reported',
  'provider_reported',
  'payer_confirmed',
] as const;

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  month?: string;
  fundingSourceId?: string;
  entryType?: string;
  reference?: string;
  page?: string;
}>;

export default async function ClientBenefitsPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, benefitT, locale] = await Promise.all([
    getTranslations(),
    getTranslations('Benefits'),
    getLocale(),
  ]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const month = validMonth(query.month);
  const fundingSourceId = validUuid(query.fundingSourceId);
  const entryType = historyEntryTypes.find((value) => value === query.entryType);
  const reference = query.reference?.trim().slice(0, 500) || undefined;
  const page = positivePage(query.page);
  const monthRange = month ? monthDates(month) : null;
  const [clientResult, budgetResult, insuranceResult, gradesResult, rulesResult, historyResult] =
    await Promise.all([
      get('/api/v1/clients/{id}', { params: { path: { id }, header } }),
      get('/api/v1/clients/{clientId}/budgets', { params: { path: { clientId: id }, header } }),
      get('/api/v1/clients/{clientId}/insurances', { params: { path: { clientId: id }, header } }),
      get('/api/v1/clients/{clientId}/pflegegrade', { params: { path: { clientId: id }, header } }),
      get('/api/v1/benefit-rules', { params: { header } }),
      get('/api/v1/clients/{clientId}/budget-history', {
        params: {
          path: { clientId: id },
          query: {
            ...(monthRange ? { from: monthRange.from, until: monthRange.until } : {}),
            ...(fundingSourceId ? { fundingSourceId } : {}),
            ...(entryType ? { entryType } : {}),
            ...(reference ? { reference } : {}),
            page,
            pageSize: 25,
          },
          header,
        },
      }),
    ]);
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();
  const client = clientResult.data;
  const budget = budgetResult.data;
  const insurances = insuranceResult.data ?? [];
  const grades = gradesResult.data ?? [];
  const rules = rulesResult.data?.items ?? [];
  const history = historyResult.data;
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canManage = client
    ? hasClientPermission(
        permissions,
        'benefits.manage',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const canAdjust = client
    ? hasClientPermission(
        permissions,
        'benefits.adjust',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const canGenerateDocument = client
    ? hasClientPermission(
        permissions,
        'documents.generate',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const canExportAllocations = client
    ? hasClientPermission(
        permissions,
        'documents.exports.read',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      ) &&
      hasClientPermission(
        permissions,
        'benefits.read',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const currentDate = today();
  const insuranceById = new Map(insurances.map((insurance) => [insurance.id, insurance]));
  const sourceById = new Map((budget?.fundingSources ?? []).map((source) => [source.id, source]));
  const error = query.error ?? budgetResult.error?.code ?? insuranceResult.error?.code;
  const updated =
    query.updated === 'funding_source' ||
    query.updated === 'entitlement' ||
    query.updated === 'adjustment'
      ? query.updated
      : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        eyebrow={
          <Link href={client ? `/clients/${client.id}` : '/clients'}>{t('Clients.title')}</Link>
        }
        title={t('Benefits.budgetTitle')}
        description={
          client ? `${client.preferredName || client.firstName} ${client.lastName}` : undefined
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={client ? `/clients/${client.id}` : '/clients'}>
              {t('Benefits.backToClient')}
            </Link>
          </Button>
        }
      />

      {client && budget && (canGenerateDocument || canExportAllocations) ? (
        <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          {canGenerateDocument ? (
            <RHFActionForm
              action={generateDocumentAction}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="sourceType" value="benefit_overview" />
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="asOf" value={budget.asOf} />
              <input type="hidden" name="returnTo" value={`/clients/${client.id}/benefits`} />
              <label className="grid gap-1 text-sm font-medium">
                <span>{t('Documents.language')}</span>
                <NativeSelect
                  name="locale"
                  defaultValue={locale}
                  selectClassName="h-10 rounded-md border bg-card px-3"
                  className="w-full"
                >
                  <option value="de">{t('Documents.languageOptions.german')}</option>
                  <option value="en">{t('Documents.languageOptions.english')}</option>
                </NativeSelect>
              </label>
              <Button type="submit">{t('Documents.generateBudget')}</Button>
            </RHFActionForm>
          ) : null}
          {canExportAllocations && client.organizationId ? (
            <Button asChild variant="secondary">
              <Link
                href={benefitAllocationExportHref(
                  client.id,
                  client.organizationId,
                  client.primaryFacilityId,
                  budget.currentPeriod,
                )}
              >
                {t('Documents.exportAllocations')}
              </Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      {error ? <Alert>{t(errorMessageKey(error))}</Alert> : null}
      {updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('Benefits.saved')}
        </p>
      ) : null}
      {!client || !budget ? (
        <Alert>{t('Benefits.loadFailed')}</Alert>
      ) : (
        <>
          <section
            aria-labelledby="summary-title"
            className="grid gap-3 rounded-lg border bg-card p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="summary-title" className="text-xl font-semibold">
                {t('Benefits.budgetProjection')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('Benefits.currentPeriod')}: {budget.currentPeriod.slice(0, 7)} ·{' '}
                {formatDate(budget.asOf, locale)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {budget.careGrade === null
                ? t('Benefits.missingCareGrade')
                : t('Benefits.currentCareGrade', {
                    date: formatDate(budget.asOf, locale) ?? budget.asOf,
                  }) + `: ${budget.careGrade}`}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {budget.entitlementBudgets.length ? (
                budget.entitlementBudgets.map((line) => {
                  const source = sourceById.get(line.fundingSourceId);
                  const insurance = source?.clientInsuranceId
                    ? insuranceById.get(source.clientInsuranceId)
                    : null;
                  return (
                    <article key={line.entitlementId} className="grid gap-3 rounded-md border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold">
                            {benefitTypeLabel(benefitT, line.benefitType)}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {sourceTypeLabel(benefitT, source?.sourceType ?? 'other')}
                            {insurance
                              ? ` · ${insurance.insurerName}`
                              : source?.label
                                ? ` · ${source.label}`
                                : ''}
                          </p>
                        </div>
                        <span className="rounded-full border px-2 py-1 text-xs">
                          {t(`Benefits.entitlementStatus.${line.entitlementStatus}`)}
                        </span>
                      </div>
                      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                        <Metric
                          label={t('Benefits.currentAllocation')}
                          value={money(line.currentAllocationCents, locale)}
                        />
                        <Metric
                          label={t('Benefits.carryover')}
                          value={money(line.carryoverCents, locale)}
                        />
                        <Metric
                          label={t('Benefits.estimatedRemaining')}
                          value={moneyOrUnknown(
                            line.estimatedRemainingCents,
                            locale,
                            t('Benefits.unknownBalance'),
                          )}
                        />
                        <Metric
                          label={t('Benefits.confirmedRemaining')}
                          value={moneyOrUnknown(
                            line.confirmedRemainingCents,
                            locale,
                            t('Benefits.unknownBalance'),
                          )}
                        />
                        <Metric
                          label={t('Benefits.actualConsumption')}
                          value={money(line.actualConsumptionCents, locale)}
                        />
                        <Metric
                          label={t('Benefits.nextExpiry')}
                          value={
                            line.nextExpiry
                              ? (formatDate(line.nextExpiry, locale) ?? line.nextExpiry)
                              : t('Benefits.noExpiry')
                          }
                        />
                      </dl>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        <span>{t('Benefits.verification')}:</span>
                        {line.verificationStatuses.length ? (
                          line.verificationStatuses.map((status) => (
                            <span key={status} className="rounded border px-2 py-1">
                              {verificationLabel(benefitT, status)}
                            </span>
                          ))
                        ) : (
                          <span>{t('Benefits.unknownBalance')}</span>
                        )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">{t('Benefits.noEntitlements')}</p>
              )}
            </div>
            <div className="rounded-md bg-accent p-3 text-sm text-primary">
              <p>
                <strong>{t('Benefits.plannedEligible')}:</strong>{' '}
                {money(budget.plannedEligible45bCents, locale)}
              </p>
              <p>{t('Benefits.plannedNotReserved')}</p>
            </div>
          </section>

          <section
            aria-labelledby="sources-title"
            className="grid gap-3 rounded-lg border bg-card p-5"
          >
            <h2 id="sources-title" className="text-xl font-semibold">
              {t('Benefits.fundingSources')}
            </h2>
            {budget.fundingSources.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {budget.fundingSources.map((source) => {
                  const insurance = source.clientInsuranceId
                    ? insuranceById.get(source.clientInsuranceId)
                    : null;
                  return (
                    <li key={source.id} className="rounded-md border p-3">
                      <p className="font-medium">
                        {sourceTypeLabel(benefitT, source.sourceType)}
                        {insurance
                          ? ` · ${insurance.insurerName}`
                          : source.label
                            ? ` · ${source.label}`
                            : ''}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {source.status === 'active'
                          ? t('Common.status.active')
                          : t('Benefits.entitlementStatus.ended')}
                        {source.unlimited ? ` · ${t('Benefits.unlimited')}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('Benefits.noFundingSources')}</p>
            )}
          </section>

          <section
            aria-labelledby="entitlements-title"
            className="grid gap-3 rounded-lg border bg-card p-5"
          >
            <h2 id="entitlements-title" className="text-xl font-semibold">
              {t('Benefits.entitlements')}
            </h2>
            {budget.entitlements.length ? (
              <div className="overflow-x-auto">
                <ShadcnTable className="w-full min-w-[42rem] text-left text-sm">
                  <ShadcnTableHeader>
                    <ShadcnTableRow className="border-b text-muted-foreground">
                      <ShadcnTableHead className="p-2">{t('Benefits.benefitType')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">
                        {t('Benefits.fundingSource')}
                      </ShadcnTableHead>
                      <ShadcnTableHead className="p-2">{t('Common.fields.from')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">{t('Common.fields.until')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">{t('Common.fields.status')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">
                        {t('Benefits.entitlementSource')}
                      </ShadcnTableHead>
                    </ShadcnTableRow>
                  </ShadcnTableHeader>
                  <ShadcnTableBody>
                    {budget.entitlements.map((entitlement) => (
                      <ShadcnTableRow key={entitlement.id} className="border-b last:border-0">
                        <ShadcnTableCell className="p-2">
                          {benefitTypeLabel(benefitT, entitlement.benefitType)}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {sourceById.get(entitlement.fundingSourceId)?.label ??
                            sourceTypeLabel(
                              benefitT,
                              sourceById.get(entitlement.fundingSourceId)?.sourceType ?? 'other',
                            )}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {formatDate(entitlement.validFrom, locale)}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {formatDate(entitlement.validUntil, locale) ?? '—'}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {t(`Benefits.entitlementStatus.${entitlement.status}`)}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {sourceLabel(benefitT, entitlement.source)}
                        </ShadcnTableCell>
                      </ShadcnTableRow>
                    ))}
                  </ShadcnTableBody>
                </ShadcnTable>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('Benefits.noEntitlements')}</p>
            )}
            {grades.length ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">
                  {t('Clients.detail.insuranceTab')}
                </summary>
                <ul className="mt-3 grid gap-2 text-sm">
                  {grades.map((grade) => (
                    <li key={grade.id}>
                      {t('Clients.careLevelNumber', { grade: grade.grade })} ·{' '}
                      {formatDate(grade.validFrom, locale)} –{' '}
                      {formatDate(grade.validUntil, locale) ?? '—'} ·{' '}
                      {t(`Common.status.${grade.status}`)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {rules.length ? (
            <section
              aria-labelledby="rules-title"
              className="grid gap-3 rounded-lg border bg-card p-5"
            >
              <h2 id="rules-title" className="text-xl font-semibold">
                {t('Benefits.ruleTitle')}
              </h2>
              <ul className="grid gap-2 text-sm">
                {rules.map((rule) => (
                  <li key={rule.id} className="rounded-md border p-3">
                    <p className="font-medium">
                      {benefitTypeLabel(benefitT, rule.benefitType)} ·{' '}
                      {formatDate(rule.effectiveFrom, locale)}
                      {rule.effectiveUntil ? ` – ${formatDate(rule.effectiveUntil, locale)}` : ''}
                    </p>
                    <p>
                      {rule.monthlyAmountCents === null
                        ? t('Benefits.unknownBalance')
                        : `${money(rule.monthlyAmountCents, locale)} / ${t('Common.units.month')}`}
                    </p>
                    <p className="text-muted-foreground">
                      {t('Benefits.ruleSource')}: {rule.sourceReference}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            aria-labelledby="history-title"
            className="grid gap-3 rounded-lg border bg-card p-5"
          >
            <h2 id="history-title" className="text-xl font-semibold">
              {t('Benefits.historyTitle')}
            </h2>
            <form
              method="get"
              className="grid gap-3 rounded-md border p-4 md:grid-cols-2 lg:grid-cols-4"
            >
              <Field
                id="history-month"
                name="month"
                label={t('Benefits.historyMonth')}
                type="month"
                defaultValue={month ?? ''}
              />
              <SelectField
                id="history-source"
                name="fundingSourceId"
                label={t('Benefits.historySource')}
                defaultValue={fundingSourceId ?? ''}
              >
                <option value="">{t('Benefits.allSources')}</option>
                {budget.fundingSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label ?? sourceTypeLabel(benefitT, source.sourceType)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="history-type"
                name="entryType"
                label={t('Benefits.historyType')}
                defaultValue={entryType ?? ''}
              >
                <option value="">{t('Benefits.allEntryTypes')}</option>
                {historyEntryTypes.map((value) => (
                  <option key={value} value={value}>
                    {t(`Benefits.entryTypes.${value}`)}
                  </option>
                ))}
              </SelectField>
              <Field
                id="history-reference"
                name="reference"
                label={t('Benefits.historyReference')}
                defaultValue={reference ?? ''}
              />
              <div className="flex items-end gap-2 md:col-span-2 lg:col-span-4">
                <Button type="submit" variant="secondary">
                  {t('Benefits.applyFilters')}
                </Button>
                <Button asChild variant="link">
                  <Link href={`/clients/${client.id}/benefits#history-title`}>
                    {t('Benefits.clearFilters')}
                  </Link>
                </Button>
              </div>
            </form>
            {history?.items.length ? (
              <div className="overflow-x-auto">
                <ShadcnTable className="w-full min-w-[48rem] text-left text-sm">
                  <ShadcnTableHeader>
                    <ShadcnTableRow className="border-b text-muted-foreground">
                      <ShadcnTableHead className="p-2">{t('Benefits.serviceDate')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">{t('Benefits.historyType')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">
                        {t('Benefits.fundingSource')}
                      </ShadcnTableHead>
                      <ShadcnTableHead className="p-2">{benefitT('amount')}</ShadcnTableHead>
                      <ShadcnTableHead className="p-2">
                        {t('Benefits.historyReference')}
                      </ShadcnTableHead>
                      <ShadcnTableHead className="p-2">
                        {t('Benefits.verification')}
                      </ShadcnTableHead>
                    </ShadcnTableRow>
                  </ShadcnTableHeader>
                  <ShadcnTableBody>
                    {history.items.map((entry) => (
                      <ShadcnTableRow key={entry.id} className="border-b last:border-0">
                        <ShadcnTableCell className="p-2">
                          {formatDate(entry.effectiveDate, locale)}
                          <span className="block text-xs text-muted-foreground">
                            {formatDateTime(entry.recordedAt, locale)}
                          </span>
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {t(`Benefits.entryTypes.${entry.entryType}`)}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {sourceById.get(entry.fundingSourceId)?.label ??
                            sourceTypeLabel(
                              benefitT,
                              sourceById.get(entry.fundingSourceId)?.sourceType ?? 'other',
                            )}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2 font-medium">
                          {money(entry.amountCents, locale, true)}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {entry.reference && !uuidPattern.test(entry.reference)
                            ? entry.reference
                            : (entry.performedServiceLabel ?? t('Resources.unavailableService'))}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="p-2">
                          {verificationLabel(benefitT, entry.verificationStatus)}
                        </ShadcnTableCell>
                      </ShadcnTableRow>
                    ))}
                  </ShadcnTableBody>
                </ShadcnTable>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('Benefits.noHistory')}</p>
            )}
            {history && history.total > history.pageSize ? (
              <div className="flex justify-end gap-2">
                {history.page > 1 ? (
                  <Button asChild variant="secondary">
                    <Link href={historyHref(client.id, query, history.page - 1)}>
                      {t('Common.actions.previous')}
                    </Link>
                  </Button>
                ) : null}
                {history.page * history.pageSize < history.total ? (
                  <Button asChild variant="secondary">
                    <Link href={historyHref(client.id, query, history.page + 1)}>
                      {t('Common.actions.next')}
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>

          {canManage || canAdjust ? (
            <section
              aria-labelledby="manage-title"
              className="grid gap-4 rounded-lg border bg-card p-5"
            >
              <h2 id="manage-title" className="text-xl font-semibold">
                {t('Benefits.manageTitle')}
              </h2>
              {canManage ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <RHFActionForm
                    action={createFundingSourceAction}
                    className="grid content-start gap-3 rounded-md border p-4"
                  >
                    <h3 className="font-semibold">{t('Benefits.fundingSourceForm')}</h3>
                    <input type="hidden" name="clientId" value={client.id} />
                    <SelectField
                      id="sourceType"
                      name="sourceType"
                      label={t('Benefits.fundingSource')}
                      required
                    >
                      <option value="statutory_long_term_care_insurance">
                        {t('Benefits.sourceTypes.statutory_long_term_care_insurance')}
                      </option>
                      <option value="private_long_term_care_insurance">
                        {t('Benefits.sourceTypes.private_long_term_care_insurance')}
                      </option>
                      <option value="self_pay">{t('Benefits.sourceTypes.self_pay')}</option>
                      <option value="other">{t('Benefits.sourceTypes.other')}</option>
                    </SelectField>
                    <SelectField
                      id="clientInsuranceId"
                      name="clientInsuranceId"
                      label={t('Benefits.insuranceRecord')}
                    >
                      <option value="">{t('Benefits.selectInsurance')}</option>
                      {insurances.map((insurance) => (
                        <option key={insurance.id} value={insurance.id}>
                          {insurance.insurerName} ·{' '}
                          {t(
                            `Clients.detail.insuranceTypes.${insurance.insuranceType === 'pflegeversicherung' ? 'care' : insurance.insuranceType === 'private' ? 'private' : insurance.insuranceType === 'krankenversicherung' ? 'health' : 'other'}`,
                          )}
                        </option>
                      ))}
                    </SelectField>
                    <Field id="funding-label" name="label" label={t('Benefits.optionalLabel')} />
                    <Button type="submit" className="w-fit">
                      {t('Benefits.createFundingSource')}
                    </Button>
                  </RHFActionForm>

                  <RHFActionForm
                    action={createEntitlementAction}
                    className="grid content-start gap-3 rounded-md border p-4"
                  >
                    <h3 className="font-semibold">{t('Benefits.entitlementForm')}</h3>
                    <input type="hidden" name="clientId" value={client.id} />
                    <SelectField
                      id="benefitType"
                      name="benefitType"
                      label={t('Benefits.benefitType')}
                      required
                    >
                      {benefitTypes.map((value) => (
                        <option key={value} value={value}>
                          {benefitTypeLabel(benefitT, value)}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      id="entitlement-source"
                      name="fundingSourceId"
                      label={t('Benefits.fundingSource')}
                      required
                    >
                      <option value="">{t('Benefits.selectFundingSource')}</option>
                      {budget.fundingSources
                        .filter((source) => source.status === 'active')
                        .map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.label ?? sourceTypeLabel(benefitT, source.sourceType)}
                          </option>
                        ))}
                    </SelectField>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        id="entitlement-validFrom"
                        name="validFrom"
                        label={t('Benefits.validFrom')}
                        type="date"
                        defaultValue={currentDate}
                        required
                      />
                      <Field
                        id="entitlement-validUntil"
                        name="validUntil"
                        label={t('Benefits.validUntil')}
                        type="date"
                      />
                    </div>
                    <SelectField
                      id="entitlement-source-info"
                      name="source"
                      label={t('Benefits.entitlementSource')}
                      required
                    >
                      <option value="payer_confirmed">{t('Benefits.payerReported')}</option>
                      <option value="client_reported">{t('Benefits.clientReported')}</option>
                      <option value="provider_reported">{t('Benefits.providerReported')}</option>
                      <option value="contract">{t('Benefits.contractReported')}</option>
                    </SelectField>
                    <Button
                      type="submit"
                      className="w-fit"
                      disabled={!budget.fundingSources.some((source) => source.status === 'active')}
                    >
                      {t('Benefits.createEntitlement')}
                    </Button>
                  </RHFActionForm>
                </div>
              ) : null}
              {canAdjust && budget.fundingSources.some((source) => source.status === 'active') ? (
                <RHFActionForm
                  action={recordBenefitAdjustmentAction}
                  className="grid gap-3 rounded-md border p-4 md:grid-cols-2 lg:grid-cols-3"
                >
                  <h3 className="font-semibold md:col-span-2 lg:col-span-3">
                    {t('Benefits.adjustmentForm')}
                  </h3>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <SelectField
                    id="adjustment-funding-source"
                    name="fundingSourceId"
                    label={t('Benefits.fundingSource')}
                    required
                  >
                    {budget.fundingSources
                      .filter((source) => source.status === 'active')
                      .map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.label ?? sourceTypeLabel(benefitT, source.sourceType)}
                        </option>
                      ))}
                  </SelectField>
                  <SelectField
                    id="adjustment-benefit-type"
                    name="benefitType"
                    label={t('Benefits.benefitType')}
                    required
                  >
                    {benefitTypes
                      .filter((value) => value !== 'private')
                      .map((value) => (
                        <option key={value} value={value}>
                          {benefitTypeLabel(benefitT, value)}
                        </option>
                      ))}
                  </SelectField>
                  <SelectField
                    id="adjustment-entitlement"
                    name="entitlementId"
                    label={`${t('Benefits.entitlements')} (${t('Common.empty.notSpecified')})`}
                  >
                    <option value="">{t('Common.empty.notSpecified')}</option>
                    {budget.entitlements.map((item) => (
                      <option key={item.id} value={item.id}>
                        {benefitTypeLabel(benefitT, item.benefitType)} ·{' '}
                        {formatDate(item.validFrom, locale)}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    id="adjustment-type"
                    name="adjustmentType"
                    label={t('Benefits.adjustmentType')}
                    required
                  >
                    <option value="opening_balance">
                      {t('Benefits.entryTypes.opening_balance_adjusted')}
                    </option>
                    <option value="external_consumption">
                      {t('Benefits.entryTypes.external_consumption_recorded')}
                    </option>
                    <option value="external_input">
                      {t('Benefits.benefitTypes.umwandlungsanspruch_45a_4')}
                    </option>
                    <option value="manual_adjustment">
                      {t('Benefits.entryTypes.manual_adjustment')}
                    </option>
                  </SelectField>
                  <Field
                    id="adjustment-amount"
                    name="amount"
                    label={t('Benefits.adjustmentAmount')}
                    required
                    inputMode="decimal"
                  />
                  <Field
                    id="adjustment-date"
                    name="effectiveDate"
                    label={t('Benefits.serviceDate')}
                    type="date"
                    defaultValue={currentDate}
                    required
                  />
                  <Field
                    id="adjustment-source-type"
                    name="sourceType"
                    label={t('Benefits.adjustmentSource')}
                    defaultValue="client_statement"
                    required
                  />
                  <SelectField
                    id="adjustment-verification"
                    name="verificationStatus"
                    label={t('Benefits.verificationStatus')}
                    required
                  >
                    {verificationStatuses.map((value) => (
                      <option key={value} value={value}>
                        {verificationLabel(benefitT, value)}
                      </option>
                    ))}
                  </SelectField>
                  <Field
                    id="adjustment-reference"
                    name="reference"
                    label={t('Benefits.adjustmentReference')}
                  />
                  <p className="text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
                    {t('Benefits.adjustmentNote')}
                  </p>
                  <Button type="submit" className="w-fit">
                    {t('Benefits.recordAdjustment')}
                  </Button>
                </RHFActionForm>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  required,
  inputMode,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  inputMode?: 'decimal' | 'numeric';
}>) {
  return (
    <label className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        inputMode={inputMode}
      />
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
    <label className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        selectClassName="min-h-10 rounded-md border bg-card px-3 py-2"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

type BenefitTranslator = Awaited<ReturnType<typeof getTranslations<'Benefits'>>>;

function benefitTypeLabel(t: BenefitTranslator, type: string) {
  switch (type) {
    case 'entlastungsbetrag_45b':
      return t('benefitTypes.entlastungsbetrag_45b');
    case 'umwandlungsanspruch_45a_4':
      return t('benefitTypes.umwandlungsanspruch_45a_4');
    case 'private':
      return t('benefitTypes.private');
    default:
      return t('benefitTypes.other');
  }
}

function sourceTypeLabel(t: BenefitTranslator, type: string) {
  switch (type) {
    case 'statutory_long_term_care_insurance':
      return t('sourceTypes.statutory_long_term_care_insurance');
    case 'private_long_term_care_insurance':
      return t('sourceTypes.private_long_term_care_insurance');
    case 'self_pay':
      return t('sourceTypes.self_pay');
    default:
      return t('sourceTypes.other');
  }
}

function sourceLabel(t: BenefitTranslator, source: string) {
  switch (source) {
    case 'payer_confirmed':
      return t('payerReported');
    case 'client_reported':
      return t('clientReported');
    case 'provider_reported':
      return t('providerReported');
    default:
      return t('contractReported');
  }
}

function verificationLabel(t: BenefitTranslator, status: string) {
  switch (status) {
    case 'payer_confirmed':
      return t('verificationStatuses.payer_confirmed');
    case 'provider_reported':
      return t('verificationStatuses.provider_reported');
    case 'client_reported':
      return t('verificationStatuses.client_reported');
    default:
      return t('verificationStatuses.estimated');
  }
}

function money(cents: number, locale: Locale, signed = false): string {
  const value = formatCurrency(Math.abs(cents) / 100, locale);
  if (!signed || cents === 0) return value;
  return `${cents > 0 ? '+' : '−'}${value}`;
}

function moneyOrUnknown(cents: number | null, locale: Locale, unknown: string): string {
  return cents === null ? unknown : money(cents, locale);
}

function validMonth(value: string | undefined): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

function monthDates(month: string): { from: string; until: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    until: new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10),
  };
}

function validUuid(value: string | undefined): string | null {
  return value && uuidPattern.test(value) ? value : null;
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function benefitAllocationExportHref(
  clientId: string,
  organizationId: string,
  facilityId: string | null,
  period: string,
): string {
  const range = monthDates(period);
  const params = new URLSearchParams({
    from: range.from,
    until: range.until,
    organizationId,
    clientId,
  });
  if (facilityId) params.set('facilityId', facilityId);
  return `/exports/benefit-allocations?${params.toString()}`;
}

function historyHref(clientId: string, query: Awaited<SearchParams>, page: number): string {
  const search = new URLSearchParams();
  if (query.month) search.set('month', query.month);
  if (query.fundingSourceId) search.set('fundingSourceId', query.fundingSourceId);
  if (query.entryType) search.set('entryType', query.entryType);
  if (query.reference) search.set('reference', query.reference);
  search.set('page', String(page));
  return `/clients/${clientId}/benefits?${search.toString()}#history-title`;
}
