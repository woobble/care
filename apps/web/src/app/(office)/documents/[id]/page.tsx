import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { DataPagination } from '@app/web/components/data-pagination';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { Button } from '@care/ui/components/button';

import type { DocumentType } from '../document-types';
import { RefreshStatusButton } from './refresh-status-button';

type DocumentStatus = 'pending' | 'ready' | 'failed' | 'superseded';
type DocumentTranslator = Awaited<ReturnType<typeof getTranslations<'Documents'>>>;
const sourceTypeLabels = {
  evidence_package: 'sourceTypes.evidence_package',
  evidence_period: 'sourceTypes.evidence_period',
  claim_evidence: 'sourceTypes.claim_evidence',
  service_agreement: 'sourceTypes.service_agreement',
  benefit_overview: 'sourceTypes.benefit_overview',
  claim: 'sourceTypes.claim',
  invoice: 'sourceTypes.invoice',
  invoice_correction: 'sourceTypes.invoice_correction',
} as const;
const statusLabels: Record<DocumentStatus, `status.${DocumentStatus}`> = {
  pending: 'status.pending',
  ready: 'status.ready',
  failed: 'status.failed',
  superseded: 'status.superseded',
};
type DocumentItem = {
  id: string;
  title: string | null;
  clientId: string | null;
  clientName?: string | null;
  organizationId: string;
  facilityId: string | null;
  documentType: DocumentType;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceReference: string | null;
  sourceVersion: string;
  templateVersion: number;
  locale: 'de' | 'en';
  status: DocumentStatus;
  generatedAt: string | null;
  createdAt: string;
};

export default async function DocumentDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ historyPage?: string; historyPageSize?: string }>;
}>) {
  const [{ id }, query, t, common, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('Documents'),
    getTranslations(),
    getLocale(),
  ]);
  if (!isUuid(id)) notFound();

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissionGrants = await getPermissionGrants(api);
  const artifactResult = await api.GET('/api/v1/documents/{id}', {
    params: { path: { id }, header },
  });
  const artifact = artifactResult.data as unknown as DocumentItem | undefined;

  if (!artifact) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6">
        <PageHeader
          eyebrow={t('title')}
          title={t('detail.title')}
          actions={
            <Button asChild variant="secondary">
              <Link href="/documents">{t('detail.back')}</Link>
            </Button>
          }
        />
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('detail.notFound')}
        </p>
      </div>
    );
  }

  const clientName = artifact.clientName ?? null;
  const historyPage = positiveInteger(query.historyPage, 1, 100_000);
  const historyPageSize = [10, 20, 50].includes(Number(query.historyPageSize))
    ? Number(query.historyPageSize)
    : 20;
  const sourceHref = documentSourceHref(artifact);
  const sourceLabel = documentSourceLabel(artifact.sourceEntityType, t);
  const title = artifact.title || t(`documentTypes.${artifact.documentType}`);
  const createdAt = artifact.generatedAt ?? artifact.createdAt;
  const downloadable = artifact.status === 'ready' || artifact.status === 'superseded';
  const canRecordCommunication =
    Boolean(artifact.clientId) &&
    hasClientPermission(
      permissionGrants,
      'client.read',
      header['X-Tenant-Id'],
      artifact.organizationId,
      artifact.facilityId,
    ) &&
    hasClientPermission(
      permissionGrants,
      'communications.create',
      header['X-Tenant-Id'],
      artifact.organizationId,
      artifact.facilityId,
    );

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={t('detail.title')}
        title={title}
        description={t(`documentTypes.${artifact.documentType}`)}
        actions={
          <Button asChild variant="secondary">
            <Link href="/documents">{t('detail.back')}</Link>
          </Button>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-6">
          <section
            aria-labelledby="document-metadata-title"
            className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5"
          >
            <h2 id="document-metadata-title" className="text-xl font-semibold">
              {t('detail.title')}
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Metadata label={t('detail.status')}>
                <StatusText status={artifact.status} t={t} />
              </Metadata>
              <Metadata label={t('detail.created')}>{formatDateTime(createdAt, locale)}</Metadata>
              <Metadata label={t('detail.client')}>
                {artifact.clientId && clientName ? (
                  <ResourceReference label={clientName} href={`/clients/${artifact.clientId}`} />
                ) : (
                  common('Resources.unavailableClient')
                )}
              </Metadata>
              <Metadata label={t('detail.source')}>
                <ResourceReference label={sourceLabel} href={sourceHref} />
              </Metadata>
              {artifact.sourceReference ? (
                <Metadata label={t('detail.sourceReference')}>{artifact.sourceReference}</Metadata>
              ) : null}
              <Metadata label={t('detail.templateVersion')}>
                {artifact.templateVersion > 0
                  ? t('detail.versionValue', { version: artifact.templateVersion })
                  : t('detail.defaultTemplate')}
              </Metadata>
              <Metadata label={t('detail.sourceVersion')}>
                {sourceVersionLabel(artifact.sourceVersion, locale, t)}
              </Metadata>
            </dl>
            <p aria-live="polite" className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {t(`workspace.readiness.${artifact.status}`)}
            </p>
            <div className="flex flex-wrap gap-2">
              {downloadable ? (
                <Button asChild>
                  <Link href={`/documents/${artifact.id}/pdf`}>{t('download')}</Link>
                </Button>
              ) : null}
              {artifact.status === 'pending' ? (
                <RefreshStatusButton label={t('detail.refresh')} />
              ) : null}
              {artifact.status === 'failed' && sourceHref ? (
                <Button asChild variant="secondary">
                  <Link href={sourceHref}>{t('workspace.columns.source')}</Link>
                </Button>
              ) : null}
              {canRecordCommunication && artifact.clientId ? (
                <Button asChild variant="secondary">
                  <Link
                    href={`/clients/${artifact.clientId}/communications?documentId=${artifact.id}#new-interaction`}
                  >
                    {t('detail.recordCommunication')}
                  </Link>
                </Button>
              ) : null}
            </div>
            {canRecordCommunication ? (
              <p className="text-sm text-muted-foreground">
                {t('detail.downloadDoesNotRecordSend')}
              </p>
            ) : null}
          </section>

          {downloadable ? (
            <section
              aria-labelledby="document-preview-title"
              className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 sm:p-5"
            >
              <h2 id="document-preview-title" className="text-xl font-semibold">
                {t('detail.preview')}
              </h2>
              <iframe
                title={`${t('detail.preview')}: ${title}`}
                src={`/documents/${artifact.id}/preview`}
                sandbox=""
                className="h-[65vh] min-h-[28rem] w-full rounded-md border bg-muted"
              />
              <p className="text-sm text-muted-foreground">
                {t('detail.previewUnavailable')}{' '}
                <Link className="text-primary underline" href={`/documents/${artifact.id}/pdf`}>
                  {t('download')}
                </Link>
              </p>
            </section>
          ) : null}
        </div>

        <Suspense fallback={<HistoryLoading label={t('detail.historyLoading')} />}>
          <DocumentHistory artifact={artifact} page={historyPage} pageSize={historyPageSize} />
        </Suspense>
      </div>
    </div>
  );
}

async function DocumentHistory({
  artifact,
  page,
  pageSize,
}: Readonly<{ artifact: DocumentItem; page: number; pageSize: number }>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations('Documents'),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const result = await api.GET('/api/v1/documents', {
    params: {
      query: {
        page,
        pageSize,
        documentType: artifact.documentType,
        sourceEntityType: artifact.sourceEntityType,
        sourceEntityId: artifact.sourceEntityId,
        sort: 'createdAt',
        order: 'desc',
      },
      header,
    },
  });
  const response = result.data as unknown as
    | { items?: DocumentItem[]; page: number; pageSize: number; totalItems: number }
    | undefined;
  if (response) {
    redirectToValidPage(
      `/documents/${artifact.id}`,
      { historyPage: String(page), historyPageSize: String(pageSize) },
      response.page,
      response.pageSize,
      response.totalItems,
      'historyPage',
      'historyPageSize',
    );
  }
  const history = response?.items ?? [];

  return (
    <section
      aria-labelledby="document-history-title"
      className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h2 id="document-history-title" className="text-lg font-semibold">
        {t('detail.history')}
      </h2>
      {history.length ? (
        <ol className="grid gap-3">
          {history.map((version) => (
            <li key={version.id} className="grid gap-2 rounded-md border p-3">
              <Link
                className="font-medium text-primary underline"
                href={`/documents/${version.id}`}
              >
                {formatDateTime(version.generatedAt ?? version.createdAt, locale)}
              </Link>
              <p className="text-sm">{t(`status.${version.status}`)}</p>
              <p className="text-sm text-muted-foreground">
                {t('detail.templateVersion')}:{' '}
                {version.templateVersion > 0
                  ? t('detail.versionValue', { version: version.templateVersion })
                  : t('detail.defaultTemplate')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('detail.sourceVersion')}: {sourceVersionLabel(version.sourceVersion, locale, t)}
              </p>
              {version.status === 'ready' || version.status === 'superseded' ? (
                <Link
                  className="inline-flex min-h-10 items-center text-sm text-primary underline"
                  href={`/documents/${version.id}/pdf`}
                >
                  {t('download')}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : result.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('detail.historyUnavailable')}
        </p>
      ) : (
        <EmptyState title={t('detail.noHistory')} />
      )}
      {response ? (
        <DataPagination
          pathname={`/documents/${artifact.id}`}
          page={response.page}
          pageSize={response.pageSize}
          totalItems={response.totalItems}
          filters={{}}
          pageSizeOptions={[10, 20, 50]}
          pageParam="historyPage"
          pageSizeParam="historyPageSize"
          controlId={`document-history-page-size-${artifact.id}`}
          stacked
        />
      ) : null}
    </section>
  );
}

function HistoryLoading({ label }: Readonly<{ label: string }>) {
  return (
    <section aria-busy="true" className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">{label}</h2>
      <div className="h-24 animate-pulse rounded-md bg-muted" />
    </section>
  );
}

function Metadata({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

function StatusText({ status, t }: Readonly<{ status: DocumentStatus; t: DocumentTranslator }>) {
  return (
    <span
      className={
        status === 'failed'
          ? 'text-destructive'
          : status === 'ready'
            ? 'text-success-foreground'
            : 'text-muted-foreground'
      }
    >
      {t(statusLabels[status])}
    </span>
  );
}

function documentSourceLabel(sourceEntityType: string, t: DocumentTranslator) {
  const key = sourceTypeLabels[sourceEntityType as keyof typeof sourceTypeLabels];
  return key ? t(key) : t('detail.source');
}

function documentSourceHref(document: DocumentItem): string | null {
  switch (document.sourceEntityType) {
    case 'evidence_package':
    case 'claim_evidence':
      return `/service-evidence/${document.sourceEntityId}`;
    case 'evidence_period':
      return '/service-evidence';
    case 'service_agreement':
      return document.clientId
        ? `/clients/${document.clientId}/service-agreements#agreement-${document.sourceEntityId}`
        : null;
    case 'benefit_overview':
      return document.clientId ? `/clients/${document.clientId}/benefits` : null;
    case 'claim':
      return `/billing/claims/${document.sourceEntityId}`;
    case 'invoice':
    case 'invoice_correction':
      return `/billing/invoices/${document.sourceEntityId}`;
    default:
      return null;
  }
}

function sourceVersionLabel(sourceVersion: string, locale: 'en' | 'de', t: DocumentTranslator) {
  const value = sourceVersion.split(':', 1)[0] ?? '';
  if (/^\d+$/.test(value)) return t('detail.versionValue', { version: Number(value) });
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDateTime(`${value}T00:00:00.000Z`, locale);
  }
  return t('detail.sourceSnapshot');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}
