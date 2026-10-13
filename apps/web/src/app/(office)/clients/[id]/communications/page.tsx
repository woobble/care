import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import type { components } from '@care/api-client';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import {
  amendCommunicationAction,
  createCommunicationAction,
  createCommunicationFollowUpAction,
  saveCommunicationPreferencesAction,
} from './actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';

type Interaction = components['schemas']['CommunicationInteractionResponseDto'];
type Preferences = components['schemas']['CommunicationPreferencesResponseDto'];
type Visit = components['schemas']['VisitListResponseDto']['items'][number];
type Task = components['schemas']['OperationsTaskListResponseDto']['items'][number];
type SourceType =
  | 'visit'
  | 'service_agreement'
  | 'operations_task'
  | 'invoice'
  | 'claim'
  | 'document';
type SourceOption = { type: SourceType; id: string; label: string };

const channels = ['phone', 'in_person', 'email', 'letter', 'portal', 'other'] as const;
const categories = [
  'general_inquiry',
  'appointment_coordination',
  'cancellation_rescheduling',
  'service_request',
  'service_agreement',
  'documentation',
  'billing_payment',
  'benefits_payer',
  'complaint_feedback',
  'other',
] as const;
const directions = ['inbound', 'outbound', 'internal'] as const;
const outcomes = [
  'information_provided',
  'request_received',
  'action_required',
  'appointment_agreed',
  'no_answer',
  'resolved',
  'other',
] as const;

export default async function ClientCommunicationsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    updated?: string;
    interactionId?: string;
    q?: string;
    channel?: string;
    category?: string;
    from?: string;
    until?: string;
    page?: string;
    pageSize?: string;
  }>;
}>) {
  const [{ id: clientId }, query] = await Promise.all([params, searchParams]);
  const [t, common, locale] = await Promise.all([
    getTranslations('Communications'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [clientResult, permissionGrants] = await Promise.all([
    get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
    getPermissionGrants(api),
  ]);
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();
  const client = clientResult.data;
  if (!client) notFound();

  const canRead =
    hasClientPermission(
      permissionGrants,
      'communications.read',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    ) &&
    hasClientPermission(
      permissionGrants,
      'client.read',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    );
  const canCreate =
    canRead &&
    hasClientPermission(
      permissionGrants,
      'communications.create',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    );
  const canAmend =
    canRead &&
    hasClientPermission(
      permissionGrants,
      'communications.update',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    ) &&
    hasClientPermission(
      permissionGrants,
      'communications.amend',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    );
  const canManagePreferences =
    canRead &&
    hasClientPermission(
      permissionGrants,
      'communications.preferences.manage',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    );
  const canReadSchedule = hasClientPermission(
    permissionGrants,
    'schedule.read',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadOperations = hasClientPermission(
    permissionGrants,
    'operations.read',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );
  const canCreateTask = hasClientPermission(
    permissionGrants,
    'operations.tasks.create',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );
  const canAssignTask =
    canCreateTask &&
    hasClientPermission(
      permissionGrants,
      'operations.tasks.assign',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    );
  const canReadEmployees = canAssignTask && hasPermission(permissionGrants, 'employee.read');
  const canReadAgreements = hasClientPermission(
    permissionGrants,
    'service_agreement.read',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadBilling = hasClientPermission(
    permissionGrants,
    'billing.read',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadClaims = hasClientPermission(
    permissionGrants,
    'claims.read',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadDocuments = hasClientPermission(
    permissionGrants,
    'documents.read',
    header['X-Tenant-Id'],
    client.organizationId,
    client.primaryFacilityId,
  );

  const visitWindow = clientVisitWindow();
  const historyPage = positivePage(query.page);
  const historyPageSize = positivePageSize(query.pageSize);
  const historyChannel = channels.find((value) => value === query.channel);
  const historyCategory = categories.find((value) => value === query.category);
  const historyFrom = dateBoundary(query.from, false);
  const historyUntil = dateBoundary(query.until, true);
  const historySearch = query.q?.trim().slice(0, 120);
  const [
    interactionResult,
    contactsResult,
    preferencesResult,
    visitsResult,
    tasksResult,
    agreementsResult,
    invoicesResult,
    claimsResult,
    documentsResult,
    organizationResult,
    selectedResult,
  ] = await Promise.all([
    canRead
      ? get('/api/v1/communications/clients/{clientId}/interactions', {
          params: {
            path: { clientId },
            query: {
              page: historyPage,
              pageSize: historyPageSize,
              ...(historyChannel ? { channel: historyChannel } : {}),
              ...(historyCategory ? { category: historyCategory } : {}),
              ...(historyFrom ? { from: historyFrom } : {}),
              ...(historyUntil ? { until: historyUntil } : {}),
              ...(historySearch ? { search: historySearch } : {}),
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    get('/api/v1/clients/{clientId}/contacts', { params: { path: { clientId }, header } }),
    canRead || canManagePreferences
      ? get('/api/v1/communications/clients/{clientId}/preferences', {
          params: { path: { clientId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadSchedule
      ? get('/api/v1/visits', {
          params: {
            query: {
              from: visitWindow.from,
              until: visitWindow.until,
              clientId,
              page: 1,
              pageSize: 100,
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadOperations
      ? get('/api/v1/operations/tasks', {
          params: { query: { clientId, page: 1, pageSize: 100 }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadAgreements
      ? get('/api/v1/clients/{clientId}/service-agreements', {
          params: { path: { clientId }, query: { page: 1, pageSize: 25 }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadBilling
      ? get('/api/v1/billing/invoices', {
          params: { query: { clientId, page: 1, pageSize: 25 }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadClaims
      ? get('/api/v1/billing/claims', {
          params: { query: { clientId, page: 1, pageSize: 25 }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadDocuments
      ? get('/api/v1/documents', {
          params: { query: { clientId, page: 1, pageSize: 25 }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    client.organizationId
      ? get('/api/v1/organizations/{id}', {
          params: { path: { id: client.organizationId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canRead && query.interactionId
      ? get('/api/v1/communications/interactions/{id}', {
          params: { path: { id: query.interactionId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const interactionData = interactionResult.data as
    | { items: Interaction[]; page: number; pageSize: number; total: number }
    | undefined;
  if (interactionData) {
    redirectToValidPage(
      `/clients/${clientId}/communications`,
      {
        q: query.q,
        channel: query.channel,
        category: query.category,
        from: validDateInput(query.from) || undefined,
        until: validDateInput(query.until) || undefined,
        interactionId: query.interactionId,
      },
      historyPage,
      historyPageSize,
      interactionData.total,
    );
  }
  const interactions = interactionData?.items ?? [];
  const contacts = contactsResult.data ?? [];
  const preferences = preferencesResult.data as Preferences | undefined;
  const visits = visitsResult.data?.items ?? [];
  const tasks = tasksResult.data?.items ?? [];
  const agreements = agreementsResult.data?.items ?? [];
  const invoices = invoicesResult.data?.items ?? [];
  const claims =
    (claimsResult.data as { items?: Array<{ id: string; status?: string }> } | undefined)?.items ??
    [];
  const documents =
    (documentsResult.data as { items?: Array<{ id: string; documentType?: string }> } | undefined)
      ?.items ?? [];
  const timezone = organizationResult.data?.timezone ?? 'Europe/Berlin';
  const taskStatusLabels: Record<string, string> = {
    open: t('taskStatuses.open'),
    in_progress: t('taskStatuses.in_progress'),
    completed: t('taskStatuses.completed'),
    cancelled: t('taskStatuses.cancelled'),
  };
  const taskPriorityLabels: Record<string, string> = {
    low: t('taskPriorities.low'),
    normal: t('taskPriorities.normal'),
    high: t('taskPriorities.high'),
    urgent: t('taskPriorities.urgent'),
  };
  const selectedHistory = selectedResult.data as
    | (Interaction & { amendments?: Array<Record<string, unknown>> })
    | undefined;
  const selectedInteraction = query.interactionId ? selectedHistory : undefined;
  const sourceOptions: SourceOption[] = [
    ...visits.map((visit: Visit) => ({
      type: 'visit' as const,
      id: visit.id,
      label: `${t('channels.in_person')} · ${formatDateTime(visit.plannedStart, locale)}`,
    })),
    ...tasks.map((task: Task) => ({
      type: 'operations_task' as const,
      id: task.id,
      label: task.title,
    })),
    ...agreements.map((agreement) => ({
      type: 'service_agreement' as const,
      id: agreement.id,
      label: `${t('sourceTypes.service_agreement')} · ${agreement.status}`,
    })),
    ...invoices.map((invoice) => ({
      type: 'invoice' as const,
      id: invoice.id,
      label: `${t('sourceTypes.invoice')} · ${invoice.invoiceNumber ?? common('Resources.draftInvoice')}`,
    })),
    ...claims.map((claim) => ({
      type: 'claim' as const,
      id: claim.id,
      label: t('sourceTypes.claim'),
    })),
    ...documents.map((document) => ({
      type: 'document' as const,
      id: document.id,
      label: `${t('sourceTypes.document')} · ${document.documentType ?? common('Resources.unavailableDocument')}`,
    })),
  ];
  const linkedTasks = new Map<string, Task[]>();
  for (const task of tasks) {
    const sourceInfo = task.source as { type?: unknown; id?: unknown } | null;
    if (sourceInfo?.type !== 'communication' || typeof sourceInfo.id !== 'string') continue;
    const existing = linkedTasks.get(sourceInfo.id) ?? [];
    existing.push(task);
    linkedTasks.set(sourceInfo.id, existing);
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        eyebrow={
          <Link href={`/clients/${client.id}`}>
            {client.preferredName || client.firstName} {client.lastName}
          </Link>
        }
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/clients/${client.id}`}>{common('Clients.detail.backToList')}</Link>
          </Button>
        }
      />

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {query.error === 'COMMUNICATION_INVALID_INPUT' ? t('loadFailed') : t('loadFailed')}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {query.updated === 'recorded'
            ? t('recorded')
            : query.updated === 'amended'
              ? t('amended')
              : query.updated === 'preferences'
                ? t('preferencesSaved')
                : query.updated === 'followup'
                  ? t('followUpCreated')
                  : t('recorded')}
        </p>
      ) : null}

      {!canRead && !canManagePreferences ? (
        <p role="alert" className="rounded-md border bg-card p-5">
          {t('noAccess')}
        </p>
      ) : null}

      {canManagePreferences && preferences ? (
        <section
          aria-labelledby="communication-preferences-title"
          className="grid gap-4 rounded-lg border bg-card p-5"
        >
          <div>
            <h2 id="communication-preferences-title" className="text-xl font-semibold">
              {t('preferences')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('preferencesDescription')}</p>
            <p className="text-sm text-muted-foreground">
              {t('consentStatus', {
                status: t(`consentStatuses.${preferences.consentStatus}`),
              })}
            </p>
          </div>
          <RHFActionForm
            action={saveCommunicationPreferencesAction}
            className="grid gap-4 md:grid-cols-2"
          >
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="expectedVersion" value={preferences.version} />
            <SelectField
              id="preferred-channel"
              name="preferredChannel"
              label={t('preferredChannel')}
              defaultValue={preferences.preferredChannel ?? ''}
            >
              <option value="">{common('Common.empty.notSpecified')}</option>
              {channels.map((value) => (
                <option key={value} value={value}>
                  {t(`channels.${value}`)}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="preferred-language"
              name="preferredLanguage"
              label={t('preferredLanguage')}
              defaultValue={preferences.preferredLanguage ?? ''}
            >
              <option value="">{common('Common.empty.notSpecified')}</option>
              <option value="de">{common('Common.languages.de')}</option>
              <option value="en">{common('Common.languages.en')}</option>
            </SelectField>
            <SelectField
              id="preferred-contact"
              name="preferredContactId"
              label={t('preferredContact')}
              defaultValue={preferences.preferredContactId ?? ''}
            >
              <option value="">{t('noContact')}</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName} ·{' '}
                  {t(`contactRelationships.${contact.relationshipType}`)}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="correspondence-preference"
              name="correspondencePreference"
              label={t('correspondence')}
              defaultValue={preferences.correspondencePreference}
            >
              {(['unspecified', 'postal', 'electronic'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`correspondenceOptions.${value}`)}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-2">
              <Label htmlFor="preferred-contact-times">{t('preferredTimes')}</Label>
              <Input
                id="preferred-contact-times"
                name="preferredContactTimes"
                maxLength={250}
                defaultValue={preferences.preferredContactTimes ?? ''}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-restrictions">{t('contactRestrictions')}</Label>
              <Input
                id="contact-restrictions"
                name="contactRestrictions"
                maxLength={1000}
                defaultValue={preferences.contactRestrictions ?? ''}
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit">{t('savePreferences')}</Button>
            </div>
          </RHFActionForm>
        </section>
      ) : null}

      {canRead ? (
        <>
          {canCreate ? (
            <section
              aria-labelledby="new-interaction-title"
              className="grid gap-4 rounded-lg border bg-card p-5"
            >
              <h2 id="new-interaction-title" className="text-xl font-semibold">
                {t('newInteraction')}
              </h2>
              <RHFActionForm
                action={createCommunicationAction}
                className="grid gap-4 md:grid-cols-2"
              >
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="timezone" value={timezone} />
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="communication-subject">{t('subject')}</Label>
                  <Input id="communication-subject" name="subject" required maxLength={200} />
                </div>
                <SelectField
                  id="communication-direction"
                  name="direction"
                  label={t('direction')}
                  defaultValue="inbound"
                >
                  {directions.map((value) => (
                    <option key={value} value={value}>
                      {t(`directions.${value}`)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="communication-channel"
                  name="channel"
                  label={t('channel')}
                  defaultValue="phone"
                >
                  {channels.map((value) => (
                    <option key={value} value={value}>
                      {t(`channels.${value}`)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="communication-category"
                  name="category"
                  label={t('category')}
                  defaultValue="general_inquiry"
                >
                  {categories.map((value) => (
                    <option key={value} value={value}>
                      {t(`categories.${value}`)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="communication-outcome"
                  name="outcome"
                  label={t('outcome')}
                  defaultValue="information_provided"
                >
                  {outcomes.map((value) => (
                    <option key={value} value={value}>
                      {t(`outcomes.${value}`)}
                    </option>
                  ))}
                </SelectField>
                <div className="grid gap-2">
                  <Label htmlFor="communication-occurred-at">{t('occurredAt')}</Label>
                  <Input
                    id="communication-occurred-at"
                    name="occurredAt"
                    type="datetime-local"
                    required
                  />
                </div>
                <SelectField
                  id="communication-contact"
                  name="contactId"
                  label={t('contact')}
                  defaultValue=""
                >
                  <option value="">{t('noContact')}</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName} ·{' '}
                      {t(`contactRelationships.${contact.relationshipType}`)}
                    </option>
                  ))}
                </SelectField>
                <div className="grid gap-2">
                  <Label htmlFor="communication-contact-label">{t('contactLabel')}</Label>
                  <Input id="communication-contact-label" name="contactLabel" maxLength={120} />
                </div>
                {sourceOptions.length ? (
                  <SelectField
                    id="communication-source"
                    name="source"
                    label={t('source')}
                    defaultValue=""
                  >
                    <option value="">{t('noSource')}</option>
                    {sourceOptions.map((source) => (
                      <option
                        key={`${source.type}:${source.id}`}
                        value={`${source.type}:${source.id}`}
                      >
                        {t(`sourceTypes.${source.type}`)} · {source.label}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="communication-summary">{t('summary')}</Label>
                  <Textarea
                    id="communication-summary"
                    name="summary"
                    maxLength={4000}
                    rows={3}
                    className="rounded-md border bg-card px-3 py-2"
                  />
                </div>
                <div className="md:col-span-2">
                  <Button type="submit">{t('saveInteraction')}</Button>
                </div>
              </RHFActionForm>
            </section>
          ) : null}

          {selectedInteraction ? (
            <section
              aria-labelledby="amendment-history-title"
              className="grid gap-3 rounded-lg border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="amendment-history-title" className="text-xl font-semibold">
                  {t('amend')}
                </h2>
                <Button asChild variant="secondary">
                  <Link href={`/clients/${client.id}/communications`}>
                    {common('Clients.detail.backToList')}
                  </Link>
                </Button>
              </div>
              <p className="font-medium">{selectedInteraction.subject}</p>
              {selectedHistory?.amendments?.length ? (
                <ol className="grid gap-2">
                  {selectedHistory.amendments.map((amendment, index) => (
                    <li key={String(amendment.id ?? index)} className="rounded-md border p-3">
                      <p className="font-medium">{String(amendment.subject ?? '')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('priorVersion', { version: Number(amendment.version ?? 0) })} ·{' '}
                        {String(amendment.reason ?? '')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('amendedBy', {
                          userId: String(
                            amendment.recordedByName ?? common('Resources.unavailableUser'),
                          ),
                        })}
                        {typeof amendment.recordedAt === 'string'
                          ? ` · ${formatDateTime(amendment.recordedAt, locale)}`
                          : ''}
                      </p>
                      {amendment.summary ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {String(amendment.summary)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noAmendments')}</p>
              )}
            </section>
          ) : null}

          <section aria-labelledby="communication-history-title" className="grid gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="communication-history-title" className="text-xl font-semibold">
                {common('Clients.detail.communicationsSummary')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {interactionData?.total ?? interactions.length}
              </p>
            </div>
            <form
              method="get"
              className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <input type="hidden" name="page" value="1" />
              <input type="hidden" name="pageSize" value={historyPageSize} />
              <div className="grid gap-2">
                <Label htmlFor="history-search">{t('searchInteractions')}</Label>
                <Input
                  id="history-search"
                  name="q"
                  maxLength={120}
                  defaultValue={historySearch ?? ''}
                />
              </div>
              <SelectField
                id="history-channel"
                name="channel"
                label={t('channel')}
                defaultValue={historyChannel ?? ''}
              >
                <option value="">{t('all')}</option>
                {channels.map((value) => (
                  <option key={value} value={value}>
                    {t(`channels.${value}`)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="history-category"
                name="category"
                label={t('category')}
                defaultValue={historyCategory ?? ''}
              >
                <option value="">{t('all')}</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {t(`categories.${value}`)}
                  </option>
                ))}
              </SelectField>
              <div className="grid gap-2">
                <Label htmlFor="history-from">{t('from')}</Label>
                <Input
                  id="history-from"
                  name="from"
                  type="date"
                  defaultValue={validDateInput(query.from)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="history-until">{t('until')}</Label>
                <Input
                  id="history-until"
                  name="until"
                  type="date"
                  defaultValue={validDateInput(query.until)}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-5">
                <Button type="submit" variant="secondary">
                  {t('applyFilters')}
                </Button>
              </div>
            </form>
            {interactionResult.error ? (
              <p role="alert" className="rounded-md border bg-card p-4">
                {t('loadFailed')}
              </p>
            ) : null}
            {interactionResult.error ? null : interactions.length ? (
              <ul className="grid gap-3">
                {interactions.map((interaction) => (
                  <li key={interaction.id} className="grid gap-4 rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="grid gap-1">
                        <h3 className="font-semibold">{interaction.subject}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatDateTime(interaction.occurredAt, locale)} ·{' '}
                          {t(`channels.${interaction.channel}`)} ·{' '}
                          {t(`categories.${interaction.category}`)}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-xs">
                        {t(`directions.${interaction.direction}`)}
                      </span>
                    </div>
                    {interaction.summary ? (
                      <p className="whitespace-pre-wrap text-sm">{interaction.summary}</p>
                    ) : null}
                    <dl className="grid gap-1 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="inline font-medium">{t('outcome')}: </dt>
                        <dd className="inline">{t(`outcomes.${interaction.outcome}`)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">{t('authorization')}: </dt>
                        <dd className="inline">
                          {t(`authorizationStatus.${interaction.contactAuthorization}`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">{t('recordedBy')}: </dt>
                        <dd className="inline">
                          {interaction.recordedByName ?? common('Resources.unavailableUser')}
                        </dd>
                      </div>
                      {interaction.contactLabel ? (
                        <div>
                          <dt className="inline font-medium">{t('contact')}: </dt>
                          <dd className="inline">{interaction.contactLabel}</dd>
                        </div>
                      ) : null}
                      {interaction.source ? (
                        <div>
                          <dt className="inline font-medium">{t('source')}: </dt>
                          <dd className="inline">
                            {sourceHref(interaction.source, client.id) ? (
                              <Link
                                className="text-primary underline"
                                href={sourceHref(interaction.source, client.id)!}
                              >
                                {typeof interaction.source.type === 'string'
                                  ? t(`sourceTypes.${interaction.source.type}`)
                                  : t('source')}
                              </Link>
                            ) : typeof interaction.source.type === 'string' ? (
                              t(`sourceTypes.${interaction.source.type}`)
                            ) : (
                              t('source')
                            )}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {linkedTasks.get(interaction.id)?.map((task) => (
                      <p key={task.id} className="rounded-md bg-accent p-3 text-sm">
                        {t('followUpTask')}:{' '}
                        <Link
                          className="font-medium text-primary underline"
                          href={`/operations/tasks/${task.id}`}
                        >
                          {task.title}
                        </Link>{' '}
                        · {taskStatusLabels[task.status] ?? task.status}
                        {task.dueAt ? ` · ${formatDateTime(task.dueAt, locale)}` : ''}
                      </p>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="secondary" size="sm">
                        <Link
                          href={`/clients/${client.id}/communications?interactionId=${interaction.id}`}
                        >
                          {t('viewAmendments')}
                        </Link>
                      </Button>
                    </div>
                    {canAmend ? (
                      <RHFActionForm
                        action={amendCommunicationAction}
                        className="grid gap-3 border-t pt-4 md:grid-cols-2"
                      >
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="interactionId" value={interaction.id} />
                        <input type="hidden" name="expectedVersion" value={interaction.version} />
                        <div className="grid gap-2">
                          <Label htmlFor={`amend-reason-${interaction.id}`}>
                            {t('amendmentReason')}
                          </Label>
                          <Input
                            id={`amend-reason-${interaction.id}`}
                            name="reason"
                            required
                            maxLength={500}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`amend-subject-${interaction.id}`}>{t('subject')}</Label>
                          <Input
                            id={`amend-subject-${interaction.id}`}
                            name="subject"
                            required
                            maxLength={200}
                            defaultValue={interaction.subject}
                          />
                        </div>
                        <div className="grid gap-2 md:col-span-2">
                          <Label htmlFor={`amend-summary-${interaction.id}`}>{t('summary')}</Label>
                          <Textarea
                            id={`amend-summary-${interaction.id}`}
                            name="summary"
                            maxLength={4000}
                            rows={2}
                            defaultValue={interaction.summary ?? ''}
                            className="rounded-md border bg-card px-3 py-2"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Button type="submit" variant="secondary">
                            {t('saveAmendment')}
                          </Button>
                        </div>
                      </RHFActionForm>
                    ) : null}
                    {canCreateTask && client.organizationId ? (
                      <RHFActionForm
                        action={createCommunicationFollowUpAction}
                        className="grid gap-3 border-t pt-4 sm:grid-cols-2"
                      >
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="interactionId" value={interaction.id} />
                        <input type="hidden" name="organizationId" value={client.organizationId} />
                        <input type="hidden" name="timezone" value={timezone} />
                        <div className="grid gap-2">
                          <Label htmlFor={`followup-title-${interaction.id}`}>
                            {t('followUpTitle')}
                          </Label>
                          <Input
                            id={`followup-title-${interaction.id}`}
                            name="title"
                            required
                            maxLength={200}
                            defaultValue={
                              interaction.outcome === 'action_required' ? interaction.subject : ''
                            }
                          />
                        </div>
                        <SelectField
                          id={`followup-priority-${interaction.id}`}
                          name="priority"
                          label={t('followUpPriority')}
                          defaultValue="normal"
                        >
                          {(['low', 'normal', 'high', 'urgent'] as const).map((value) => (
                            <option key={value} value={value}>
                              {taskPriorityLabels[value]}
                            </option>
                          ))}
                        </SelectField>
                        {canAssignTask && canReadEmployees ? (
                          <AsyncEntityCombobox
                            name="assignedEmployeeId"
                            entity="employees"
                            label={t('followUpAssignee')}
                            organizationId={client.organizationId ?? undefined}
                            facilityId={client.primaryFacilityId ?? undefined}
                            placeholder={common('Operations.unassigned')}
                          />
                        ) : canAssignTask ? (
                          <SelectField
                            id={`followup-assignee-${interaction.id}`}
                            name="assignedEmployeeId"
                            label={t('followUpAssignee')}
                            defaultValue=""
                          >
                            <option value="">{common('Operations.unassigned')}</option>
                          </SelectField>
                        ) : null}
                        <div className="grid gap-2">
                          <Label htmlFor={`followup-due-${interaction.id}`}>
                            {t('followUpDue')}
                          </Label>
                          <Input
                            id={`followup-due-${interaction.id}`}
                            name="dueAt"
                            type="datetime-local"
                          />
                        </div>
                        <div className="self-end">
                          <Button type="submit" variant="secondary">
                            {t('createFollowUp')}
                          </Button>
                        </div>
                      </RHFActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('empty')} />
            )}
            {interactionData ? (
              <DataPagination
                pathname={`/clients/${clientId}/communications`}
                page={interactionData.page}
                pageSize={interactionData.pageSize}
                totalItems={interactionData.total}
                filters={{
                  q: historySearch,
                  channel: historyChannel,
                  category: historyCategory,
                  from: validDateInput(query.from) || undefined,
                  until: validDateInput(query.until) || undefined,
                  interactionId: query.interactionId,
                }}
                controlId="communication-history-page-size"
              />
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function clientVisitWindow() {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    until: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function positivePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

function positivePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 25, 50, 100].includes(pageSize) ? pageSize : 25;
}

function dateBoundary(value: string | undefined, endOfDay: boolean): string | undefined {
  const date = validDateInput(value);
  if (!date) return undefined;
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`).toISOString();
}

function validDateInput(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

function sourceHref(source: { [key: string]: unknown } | null, clientId: string): string | null {
  if (!source || typeof source.type !== 'string' || typeof source.id !== 'string') return null;
  switch (source.type) {
    case 'visit':
      return `/visits/${source.id}`;
    case 'service_agreement':
      return `/clients/${clientId}/service-agreements`;
    case 'operations_task':
      return `/operations/tasks/${source.id}`;
    case 'invoice':
      return `/billing/invoices/${source.id}`;
    case 'claim':
      return `/billing/claims/${source.id}`;
    case 'document':
      return `/documents/${source.id}/pdf`;
    default:
      return null;
  }
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
