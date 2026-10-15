import { randomUUID } from 'node:crypto';
import { getLocale, getTranslations } from 'next-intl/server';
import { AllocationReversalForm } from '@app/web/app/(office)/benefits/allocation-reversal-form';
import { DataPagination } from '@app/web/components/data-pagination';
import { ErrorNotice } from '@app/web/components/page-patterns';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from '@care/ui/components/table';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatCurrency, formatDate, formatDateTime } from '@app/web/i18n/format';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';

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

type HistoryEntryType = (typeof historyEntryTypes)[number];
type BenefitTranslator = Awaited<ReturnType<typeof getTranslations<'Benefits'>>>;

type FundingSource = Readonly<{
  id: string;
  label: string | null;
  sourceType: string;
}>;

type FundingHistoryProps = Readonly<{
  clientId: string;
  fundingSources: readonly FundingSource[];
  canAllocate: boolean;
  period: string | null;
  month: string | null;
  fundingSourceId: string | null;
  entryType: HistoryEntryType | undefined;
  reference: string | undefined;
  page: number;
  pageSize: number;
}>;

export async function FundingHistorySection(props: FundingHistoryProps) {
  const { clientId, fundingSources, canAllocate } = props;
  const [t, benefitT, locale] = await Promise.all([
    getTranslations(),
    getTranslations('Benefits'),
    getLocale(),
  ]);
  const resourceT = await getTranslations('Resources');
  const api = await getApiClient();
  const header = await getTenantHeader();
  const range = props.month ? monthDates(props.month) : null;
  const result = await api.GET('/api/v1/clients/{clientId}/budget-history', {
    params: {
      path: { clientId },
      query: {
        ...(range ? { from: range.from, until: range.until } : {}),
        ...(props.fundingSourceId ? { fundingSourceId: props.fundingSourceId } : {}),
        ...(props.entryType ? { entryType: props.entryType } : {}),
        ...(props.reference ? { reference: props.reference } : {}),
        page: props.page,
        pageSize: props.pageSize,
      },
      header,
    },
  });
  const history = result.data;
  const filters = {
    ...(props.period ? { period: props.period } : {}),
    ...(props.month ? { month: props.month } : {}),
    ...(props.fundingSourceId ? { fundingSourceId: props.fundingSourceId } : {}),
    ...(props.entryType ? { entryType: props.entryType } : {}),
    ...(props.reference ? { reference: props.reference } : {}),
  };
  if (history) {
    redirectToValidPage(
      `/clients/${clientId}/benefits`,
      { ...filters, page: String(props.page), pageSize: String(props.pageSize) },
      props.page,
      props.pageSize,
      history.total,
    );
  }

  const sourceById = new Map(fundingSources.map((source) => [source.id, source]));
  const error = result.error?.code;

  return (
    <section aria-labelledby="history-title" className="grid gap-3 rounded-lg border bg-card p-5">
      <h2 id="history-title" className="text-xl font-semibold">
        {t('Benefits.historyTitle')}
      </h2>
      {error ? <ErrorNotice>{t(errorMessageKey(error))}</ErrorNotice> : null}
      {history ? (
        history.items.length ? (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <ShadcnTable className="w-full min-w-[48rem] text-left text-sm">
                <ShadcnTableHeader>
                  <ShadcnTableRow className="border-b text-muted-foreground">
                    <ShadcnTableHead className="p-2">{t('Benefits.serviceDate')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('Benefits.historyType')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('Benefits.fundingSource')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{benefitT('amount')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">
                      {t('Benefits.historyReference')}
                    </ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('Benefits.verification')}</ShadcnTableHead>
                    <ShadcnTableHead className="p-2">{t('Benefits.correction')}</ShadcnTableHead>
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
                        {benefitT(`entryTypes.${entry.entryType}`)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {fundingSourceLabel(benefitT, sourceById.get(entry.fundingSourceId))}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2 font-medium">
                        {money(entry.amountCents, locale, true)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {historyReference(entry.reference, entry.performedServiceLabel, resourceT)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2">
                        {verificationLabel(benefitT, entry.verificationStatus)}
                      </ShadcnTableCell>
                      <ShadcnTableCell className="p-2 align-top">
                        <CorrectionAction
                          clientId={clientId}
                          canAllocate={canAllocate}
                          entry={entry}
                        />
                      </ShadcnTableCell>
                    </ShadcnTableRow>
                  ))}
                </ShadcnTableBody>
              </ShadcnTable>
            </div>
            <ul className="grid gap-2 sm:hidden">
              {history.items.map((entry) => (
                <li key={entry.id} className="grid gap-2 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{benefitT(`entryTypes.${entry.entryType}`)}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(entry.effectiveDate, locale)} ·{' '}
                        {formatDateTime(entry.recordedAt, locale)}
                      </p>
                    </div>
                    <p className="font-semibold">{money(entry.amountCents, locale, true)}</p>
                  </div>
                  <dl className="grid gap-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">{t('Benefits.fundingSource')}</dt>
                      <dd>{fundingSourceLabel(benefitT, sourceById.get(entry.fundingSourceId))}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('Benefits.historyReference')}</dt>
                      <dd>
                        {historyReference(entry.reference, entry.performedServiceLabel, resourceT)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('Benefits.verification')}</dt>
                      <dd>{verificationLabel(benefitT, entry.verificationStatus)}</dd>
                    </div>
                  </dl>
                  <CorrectionAction clientId={clientId} canAllocate={canAllocate} entry={entry} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Benefits.noHistory')}</p>
        )
      ) : null}
      {history ? (
        <DataPagination
          pathname={`/clients/${clientId}/benefits`}
          page={history.page}
          pageSize={history.pageSize}
          totalItems={history.total}
          filters={filters}
          controlId="benefit-history-page-size"
        />
      ) : null}
    </section>
  );
}

async function CorrectionAction({
  clientId,
  canAllocate,
  entry,
}: Readonly<{
  clientId: string;
  canAllocate: boolean;
  entry: {
    entryType: string;
    serviceAllocationId: string | null;
    allocationReversed: boolean;
  };
}>) {
  const t = await getTranslations();
  if (entry.entryType !== 'service_consumption_allocated' || !entry.serviceAllocationId)
    return null;
  if (entry.allocationReversed)
    return (
      <span className="text-sm text-muted-foreground">{t('Benefits.allocationReversed')}</span>
    );
  return canAllocate ? (
    <AllocationReversalForm
      clientId={clientId}
      allocationId={entry.serviceAllocationId}
      idempotencyKey={randomUUID()}
    />
  ) : null;
}

function historyReference(
  reference: string | null,
  performedServiceLabel: string | null,
  t: Awaited<ReturnType<typeof getTranslations<'Resources'>>>,
): string {
  return reference && !uuidPattern.test(reference)
    ? reference
    : (performedServiceLabel ?? t('unavailableService'));
}

function fundingSourceLabel(t: BenefitTranslator, source: FundingSource | undefined): string {
  return source?.label ?? sourceTypeLabel(t, source?.sourceType ?? 'other');
}

function sourceTypeLabel(t: BenefitTranslator, type: string): string {
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

function verificationLabel(t: BenefitTranslator, status: string): string {
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

function monthDates(month: string): { from: string; until: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    until: new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10),
  };
}
