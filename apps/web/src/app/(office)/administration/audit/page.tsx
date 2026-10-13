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

export default async function AuditPage() {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const { data, error } = await get('/api/v1/audit', {
    params: { query: { page: 1, pageSize: 50 }, header: await getTenantHeader() },
  });
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
    </div>
  );
}
