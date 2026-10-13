import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { auditActionKey } from '@app/web/i18n/audit';
import { formatDateTime } from '@app/web/i18n/format';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import type { components } from '@care/api-client';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';

type SearchParams = Promise<{ page?: string; pageSize?: string }>;

export default async function AuditPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const result = await get('/api/v1/audit', {
    params: { query: { page, pageSize }, header: await getTenantHeader() },
  });
  const data = result.data as unknown as components['schemas']['AuditListDto'] | undefined;
  const error = result.error as { code?: string } | undefined;
  if (data) redirectToValidPage('/administration/audit', {}, page, pageSize, data.total);
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={<Link href="/administration/users">{t('Navigation.administration')}</Link>}
        title={t('Audit.title')}
      />
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('Audit.loadFailed')}
        </p>
      ) : data?.items.length ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <ShadcnTable className="w-full border-collapse text-left text-sm">
            <ShadcnTableCaption className="sr-only">{t('Audit.caption')}</ShadcnTableCaption>
            <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
              <ShadcnTableRow>
                <ShadcnTableHead scope="col" className="px-4 py-3">
                  {t('Audit.timestamp')}
                </ShadcnTableHead>
                <ShadcnTableHead scope="col" className="px-4 py-3">
                  {t('Audit.actor')}
                </ShadcnTableHead>
                <ShadcnTableHead scope="col" className="px-4 py-3">
                  {t('Audit.action')}
                </ShadcnTableHead>
                <ShadcnTableHead scope="col" className="px-4 py-3">
                  {t('Audit.resource')}
                </ShadcnTableHead>
              </ShadcnTableRow>
            </ShadcnTableHeader>
            <ShadcnTableBody>
              {data.items.map((entry) => (
                <ShadcnTableRow key={entry.id} className="border-b last:border-0">
                  <ShadcnTableCell className="whitespace-nowrap px-4 py-3">
                    {formatDateTime(entry.timestamp, locale) ?? '—'}
                  </ShadcnTableCell>
                  <ShadcnTableCell className="px-4 py-3">
                    {t('Resources.unavailableUser')}
                  </ShadcnTableCell>
                  <ShadcnTableCell className="px-4 py-3">
                    {t(auditActionKey(entry.action))}
                  </ShadcnTableCell>
                  <ShadcnTableCell className="px-4 py-3">
                    {t('Resources.unavailableResource')}
                  </ShadcnTableCell>
                </ShadcnTableRow>
              ))}
            </ShadcnTableBody>
          </ShadcnTable>
        </div>
      ) : (
        <EmptyState title={t('Audit.empty')} />
      )}
      {data ? (
        <DataPagination
          pathname="/administration/audit"
          page={data.page}
          pageSize={data.pageSize}
          totalItems={data.total}
          filters={{}}
        />
      ) : null}
    </div>
  );
}

function parsePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

function parsePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
}
