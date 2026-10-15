import { NativeSelect } from '@care/ui/components/native-select';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { DataPagination } from '@app/web/components/data-pagination';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';

type DocumentTranslator = Awaited<ReturnType<typeof getTranslations<'Documents'>>>;

type DocumentType =
  | 'service_evidence'
  | 'service_agreement'
  | 'invoice'
  | 'invoice_correction'
  | 'benefit_overview'
  | 'claim_summary';
type DocumentStatus = 'pending' | 'ready' | 'failed' | 'superseded';
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
type DocumentList = { items: DocumentItem[]; page: number; pageSize: number; totalItems: number };

const documentTypes: DocumentType[] = [
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
];
const statuses: DocumentStatus[] = ['pending', 'ready', 'failed', 'superseded'];
const sortOptions = ['createdAt', 'name', 'type', 'status'] as const;
const sourceReadPermissions = [
  'service_evidence.read',
  'service_agreement.read',
  'billing.read',
  'benefits.read',
  'claims.read',
] as const;
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

export default async function DocumentsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    q?: string;
    documentType?: string;
    status?: string;
    from?: string;
    until?: string;
    organizationId?: string;
    facilityId?: string;
    clientId?: string;
    sort?: string;
    order?: string;
    page?: string;
    pageSize?: string;
  }>;
}>) {
  const [query, t, common, locale] = await Promise.all([
    searchParams,
    getTranslations('Documents'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const grants = await getPermissionGrants(api);
  const canRead =
    hasPermission(grants, 'documents.read') &&
    sourceReadPermissions.some((permission) => hasPermission(grants, permission));

  if (!canRead) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('workspace.noAccess')}
      </p>
    );
  }

  const selectedOrganizationId = isUuid(query.organizationId) ? query.organizationId : undefined;
  const selectedFacilityId = isUuid(query.facilityId) ? query.facilityId : undefined;
  const selectedClientId = isUuid(query.clientId) ? query.clientId : undefined;
  const [organizationResult, facilityResult, clientResult] = await Promise.all([
    selectedOrganizationId && hasPermission(grants, 'organization.read')
      ? api.GET('/api/v1/organizations/{id}', {
          params: { path: { id: selectedOrganizationId }, header },
        })
      : Promise.resolve(null),
    selectedFacilityId && hasPermission(grants, 'facility.read')
      ? api.GET('/api/v1/facilities/{id}', {
          params: { path: { id: selectedFacilityId }, header },
        })
      : Promise.resolve(null),
    selectedClientId
      ? api.GET('/api/v1/clients/{id}', {
          params: { path: { id: selectedClientId }, header },
        })
      : Promise.resolve(null),
  ]);
  const selectedOrganization = organizationResult?.data;
  const selectedFacility = facilityResult?.data;
  const selectedClient = clientResult?.data;
  const organizationId = selectedOrganization?.id;
  const facilityId = selectedFacility?.id;
  const clientId = selectedClient?.id;
  const documentType = documentTypes.find((value) => value === query.documentType);
  const status = statuses.find((value) => value === query.status);
  const sort = sortOptions.find((value) => value === query.sort) ?? 'createdAt';
  const order = query.order === 'asc' ? 'asc' : 'desc';
  const from = validDateInput(query.from);
  const until = validDateInput(query.until);
  const search = query.q?.trim().slice(0, 120) ?? '';
  const requestedPage = positiveInteger(query.page, 1, 100_000);
  const pageSize = allowedPageSize(query.pageSize);
  const result = await api.GET('/api/v1/documents', {
    params: {
      query: {
        page: requestedPage,
        pageSize,
        ...(organizationId ? { organizationId } : {}),
        ...(facilityId ? { facilityId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(documentType ? { documentType } : {}),
        ...(status ? { status } : {}),
        ...(from ? { from } : {}),
        ...(until ? { until } : {}),
        ...(search ? { search } : {}),
        sort,
        order,
      },
      header,
    },
  });
  const response = result.data as unknown as DocumentList | undefined;
  const filters = {
    q: search || undefined,
    documentType,
    status,
    from: from || undefined,
    until: until || undefined,
    organizationId,
    facilityId,
    clientId,
    sort,
    order,
  };

  if (response) {
    redirectToValidPage('/documents', query, response.page, response.pageSize, response.totalItems);
  }

  const interactions = response?.items ?? [];
  const forbidden =
    (result.error as { status?: number; code?: string } | undefined)?.status === 403;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('workspace.title')}
        description={t('workspace.description')}
        actions={
          hasPermission(grants, 'documents.generate') ||
          hasPermission(grants, 'billing.read') ||
          hasPermission(grants, 'claims.read') ? (
            <Button asChild>
              <Link href="/documents/create">{t('workspace.create')}</Link>
            </Button>
          ) : null
        }
      />

      {result.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {forbidden ? t('workspace.noAccess') : t('workspace.loadFailed')}
        </p>
      ) : null}

      <section
        aria-label={t('workspace.title')}
        className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5"
      >
        <form method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="pageSize" value={pageSize} />
          <TextField
            id="documents-search"
            name="q"
            label={t('workspace.search')}
            defaultValue={search}
          />
          {hasPermission(grants, 'client.read') ? (
            <AsyncEntityCombobox
              name="clientId"
              label={t('workspace.client')}
              entity="clients"
              placeholder={t('workspace.all')}
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
          {hasPermission(grants, 'organization.read') ? (
            <AsyncEntityCombobox
              name="organizationId"
              label={t('workspace.organization')}
              entity="organizations"
              placeholder={t('workspace.all')}
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
          {hasPermission(grants, 'facility.read') ? (
            <AsyncEntityCombobox
              name="facilityId"
              label={t('workspace.facility')}
              entity="facilities"
              {...(organizationId ? { organizationId } : {})}
              placeholder={t('workspace.all')}
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
          <SelectField
            id="documents-type"
            name="documentType"
            label={t('workspace.documentType')}
            defaultValue={documentType ?? ''}
          >
            <option value="">{t('workspace.all')}</option>
            {documentTypes.map((type) => (
              <option key={type} value={type}>
                {t(`documentTypes.${type}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="documents-status"
            name="status"
            label={t('workspace.status')}
            defaultValue={status ?? ''}
          >
            <option value="">{t('workspace.all')}</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            id="documents-from"
            name="from"
            type="date"
            label={t('workspace.from')}
            defaultValue={from}
          />
          <TextField
            id="documents-until"
            name="until"
            type="date"
            label={t('workspace.until')}
            defaultValue={until}
          />
          <SelectField
            id="documents-sort"
            name="sort"
            label={t('workspace.sort')}
            defaultValue={sort}
          >
            {sortOptions.map((value) => (
              <option key={value} value={value}>
                {t(`workspace.sortOptions.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="documents-order"
            name="order"
            label={t('workspace.order')}
            defaultValue={order}
          >
            <option value="desc">{t('workspace.orderOptions.desc')}</option>
            <option value="asc">{t('workspace.orderOptions.asc')}</option>
          </SelectField>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              {t('workspace.apply')}
            </Button>
          </div>
        </form>

        {interactions.length ? (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 font-medium">{t('workspace.columns.document')}</th>
                    <th className="px-3 py-3 font-medium">{t('workspace.columns.client')}</th>
                    <th className="px-3 py-3 font-medium">{t('workspace.columns.created')}</th>
                    <th className="px-3 py-3 font-medium">{t('workspace.columns.source')}</th>
                    <th className="px-3 py-3 font-medium">{t('workspace.columns.status')}</th>
                    <th className="px-3 py-3 font-medium">{t('workspace.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {interactions.map((document) => (
                    <tr key={document.id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <Link
                          className="font-medium text-primary underline"
                          href={`/documents/${document.id}`}
                        >
                          {document.title || t(`documentTypes.${document.documentType}`)}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(`documentTypes.${document.documentType}`)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {clientReference(document, common('Resources.unavailableClient'))}
                      </td>
                      <td className="px-3 py-3">
                        {formatDateTime(document.generatedAt ?? document.createdAt, locale)}
                      </td>
                      <td className="px-3 py-3">{sourceReference(document, t)}</td>
                      <td className="px-3 py-3">{statusLabel(document.status, t)}</td>
                      <td className="px-3 py-3">
                        <DocumentActions document={document} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-3 lg:hidden">
              {interactions.map((document) => (
                <li key={document.id} className="grid gap-3 rounded-md border p-4">
                  <div className="grid gap-1">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/documents/${document.id}`}
                    >
                      {document.title || t(`documentTypes.${document.documentType}`)}
                    </Link>
                    <p className="text-sm">{t(`documentTypes.${document.documentType}`)}</p>
                    <p className="text-sm text-muted-foreground">
                      {clientReference(document, common('Resources.unavailableClient'))}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDateTime(document.generatedAt ?? document.createdAt, locale)}
                    </p>
                    <p className="text-sm text-muted-foreground">{sourceReference(document, t)}</p>
                    <p className="text-sm font-medium">{statusLabel(document.status, t)}</p>
                  </div>
                  <DocumentActions document={document} t={t} />
                </li>
              ))}
            </ul>
          </>
        ) : result.error ? null : search ||
          documentType ||
          status ||
          from ||
          until ||
          clientId ||
          organizationId ||
          facilityId ? (
          <EmptyState title={t('workspace.emptyFiltered')} />
        ) : (
          <EmptyState title={t('workspace.empty')} />
        )}

        {response ? (
          <DataPagination
            pathname="/documents"
            page={response.page}
            pageSize={response.pageSize}
            totalItems={response.totalItems}
            filters={filters}
          />
        ) : null}
      </section>
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  type = 'search',
}: Readonly<{ id: string; name: string; label: string; defaultValue: string; type?: string }>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={type === 'date' ? undefined : 120}
      />
    </div>
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
  defaultValue: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        selectClassName="h-10 rounded-md border bg-card px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}

function DocumentActions({
  document,
  t,
}: Readonly<{ document: DocumentItem; t: DocumentTranslator }>) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <Link href={`/documents/${document.id}`}>{t('workspace.open')}</Link>
      </Button>
      {document.status === 'ready' || document.status === 'superseded' ? (
        <Button asChild>
          <Link href={`/documents/${document.id}/pdf`}>{t('download')}</Link>
        </Button>
      ) : null}
    </div>
  );
}

function clientReference(document: DocumentItem, fallback: string) {
  return document.clientId && document.clientName ? (
    <ResourceReference label={document.clientName} href={`/clients/${document.clientId}`} />
  ) : (
    <span>{fallback}</span>
  );
}

function sourceReference(document: DocumentItem, t: DocumentTranslator) {
  const href = sourceHref(document);
  const sourceTypeLabel = sourceLabel(document.sourceEntityType, t);
  const label = document.sourceReference
    ? `${sourceTypeLabel} · ${document.sourceReference}`
    : sourceTypeLabel;
  return <ResourceReference label={label} href={href} />;
}

function sourceLabel(sourceEntityType: string, t: DocumentTranslator) {
  const key = sourceTypeLabels[sourceEntityType as keyof typeof sourceTypeLabels];
  return key ? t(key) : t('detail.source');
}

function sourceHref(document: DocumentItem): string | null {
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

function statusLabel(status: DocumentStatus, t: DocumentTranslator) {
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

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function validDateInput(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function allowedPageSize(value: string | undefined): number {
  const parsed = Number(value ?? 20);
  return [10, 20, 50, 100].includes(parsed) ? parsed : 20;
}
