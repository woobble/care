import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';

type Interaction = components['schemas']['CommunicationInteractionResponseDto'];
type FollowUpStatus = 'needs_task' | 'open' | 'overdue' | 'completed';
const channels = ['phone', 'in_person', 'email', 'letter', 'portal', 'other'] as const;
const directions = ['inbound', 'outbound', 'internal'] as const;
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
const outcomes = [
  'information_provided',
  'request_received',
  'action_required',
  'appointment_agreed',
  'no_answer',
  'resolved',
  'other',
] as const;
const followUpStatuses: FollowUpStatus[] = ['needs_task', 'open', 'overdue', 'completed'];
const sorts = ['occurredAt', 'client', 'subject', 'channel'] as const;

export default async function CommunicationsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    q?: string;
    clientSearch?: string;
    organizationId?: string;
    facilityId?: string;
    channel?: string;
    direction?: string;
    category?: string;
    outcome?: string;
    from?: string;
    until?: string;
    recordedByUserId?: string;
    followUpStatus?: string;
    page?: string;
    pageSize?: string;
    sort?: string;
    order?: string;
  }>;
}>) {
  const [query, t, common, locale] = await Promise.all([
    searchParams,
    getTranslations('Communications'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const permissionGrants = await getPermissionGrants(api);
  if (
    !hasPermission(permissionGrants, 'communications.read') ||
    !hasPermission(permissionGrants, 'client.read')
  ) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }

  const canReadOperations = hasPermission(permissionGrants, 'operations.read');
  const canReadOrganizations = hasPermission(permissionGrants, 'organization.read');
  const canReadFacilities = hasPermission(permissionGrants, 'facility.read');
  const canReadEmployees = hasPermission(permissionGrants, 'employee.read');
  const selectedOrganizationId =
    canReadOrganizations && isUuid(query.organizationId) ? query.organizationId : undefined;
  const selectedFacilityId =
    canReadFacilities && isUuid(query.facilityId) ? query.facilityId : undefined;
  const [organizationResult, facilityResult, employeeResult] = await Promise.all([
    selectedOrganizationId
      ? get('/api/v1/organizations/{id}', {
          params: { path: { id: selectedOrganizationId }, header },
        })
      : Promise.resolve(null),
    selectedFacilityId
      ? get('/api/v1/facilities/{id}', { params: { path: { id: selectedFacilityId }, header } })
      : Promise.resolve(null),
    canReadEmployees && isUuid(query.recordedByUserId)
      ? get('/api/v1/employees', {
          params: {
            query: { userId: query.recordedByUserId, page: 1, pageSize: 1 },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const selectedOrganization = organizationResult?.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult?.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedEmployeeData = employeeResult.data as unknown as
    | components['schemas']['EmployeeListResponseDto']
    | undefined;
  const selectedEmployee = selectedEmployeeData?.items[0];
  const organizationId = selectedOrganization?.id;
  const facilityId = selectedFacility?.id;
  const channel = channels.find((value) => value === query.channel);
  const direction = directions.find((value) => value === query.direction);
  const category = categories.find((value) => value === query.category);
  const outcome = outcomes.find((value) => value === query.outcome);
  const followUpStatus = followUpStatuses.find((value) => value === query.followUpStatus);
  const sort = sorts.find((value) => value === query.sort) ?? 'occurredAt';
  const order = query.order === 'asc' ? 'asc' : 'desc';
  const employeeId = selectedEmployee?.userId;
  const from = dateBoundary(query.from, false);
  const until = dateBoundary(query.until, true);
  const pageNumber = Number(query.page);
  const page =
    Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, 100_000) : 1;
  const pageSizeNumber = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(pageSizeNumber) ? pageSizeNumber : 20;
  const search = query.q?.trim().slice(0, 120) ?? '';
  const clientSearch = query.clientSearch?.trim().slice(0, 120) ?? '';
  const result = await get('/api/v1/communications', {
    params: {
      query: {
        page,
        pageSize,
        ...(organizationId ? { organizationId } : {}),
        ...(facilityId ? { facilityId } : {}),
        ...(clientSearch ? { clientSearch } : {}),
        ...(employeeId ? { recordedByUserId: employeeId } : {}),
        ...(channel ? { channel } : {}),
        ...(direction ? { direction } : {}),
        ...(category ? { category } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from ? { from } : {}),
        ...(until ? { until } : {}),
        ...(followUpStatus && canReadOperations ? { followUpStatus } : {}),
        ...(search ? { search } : {}),
        sort,
        order,
      },
      header,
    },
  });
  const responseData = result.data as unknown as
    | components['schemas']['CommunicationInteractionListResponseDto']
    | undefined;
  const interactions: Interaction[] = responseData?.items ?? [];
  if (responseData)
    redirectToValidPage(
      '/communications',
      query,
      responseData.page,
      responseData.pageSize,
      responseData.total,
    );
  const filters = {
    q: search,
    clientSearch,
    organizationId,
    facilityId,
    channel,
    direction,
    category,
    outcome,
    from: validDateInput(query.from),
    until: validDateInput(query.until),
    recordedByUserId: employeeId ?? undefined,
    followUpStatus: canReadOperations ? followUpStatus : undefined,
    sort,
    order,
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('globalTitle')}
        description={t('globalDescription')}
        actions={
          hasPermission(permissionGrants, 'communications.create') ? (
            <Button asChild>
              <Link href="/communications/new">{t('recordCommunication')}</Link>
            </Button>
          ) : null
        }
      />

      {result.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}

      <section aria-label={t('globalTitle')} className="grid gap-4 rounded-lg border bg-card p-5">
        <form method="get" className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <input type="hidden" name="pageSize" value={pageSize} />
          <input type="hidden" name="page" value="1" />
          <TextField
            id="communications-search"
            name="q"
            label={t('searchInteractions')}
            defaultValue={search}
          />
          <TextField
            id="communications-client-search"
            name="clientSearch"
            label={t('filterClient')}
            defaultValue={clientSearch}
          />
          {canReadOrganizations ? (
            <AsyncEntityCombobox
              name="organizationId"
              label={t('filterOrganization')}
              entity="organizations"
              placeholder={t('all')}
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
              label={t('filterFacility')}
              entity="facilities"
              {...(organizationId ? { organizationId } : {})}
              placeholder={t('all')}
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
            id="communications-channel"
            name="channel"
            label={t('channel')}
            defaultValue={channel ?? ''}
          >
            <option value="">{t('all')}</option>
            {channels.map((value) => (
              <option key={value} value={value}>
                {t(`channels.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="communications-direction"
            name="direction"
            label={t('direction')}
            defaultValue={direction ?? ''}
          >
            <option value="">{t('all')}</option>
            {directions.map((value) => (
              <option key={value} value={value}>
                {t(`directions.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="communications-category"
            name="category"
            label={t('category')}
            defaultValue={category ?? ''}
          >
            <option value="">{t('all')}</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {t(`categories.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="communications-outcome"
            name="outcome"
            label={t('outcome')}
            defaultValue={outcome ?? ''}
          >
            <option value="">{t('all')}</option>
            {outcomes.map((value) => (
              <option key={value} value={value}>
                {t(`outcomes.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField id="communications-sort" name="sort" label={t('sortBy')} defaultValue={sort}>
            {sorts.map((value) => (
              <option key={value} value={value}>
                {t(`sortOptions.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="communications-order"
            name="order"
            label={t('sortOrder')}
            defaultValue={order}
          >
            <option value="desc">{t('sortOrderOptions.desc')}</option>
            <option value="asc">{t('sortOrderOptions.asc')}</option>
          </SelectField>
          {canReadEmployees ? (
            <AsyncEntityCombobox
              name="recordedByUserId"
              label={t('filterEmployee')}
              entity="employee-users"
              placeholder={t('all')}
              {...(selectedEmployee?.userId
                ? {
                    initialOption: {
                      id: selectedEmployee.userId,
                      label: `${selectedEmployee.preferredName || selectedEmployee.firstName} ${selectedEmployee.lastName}`,
                    },
                  }
                : {})}
            />
          ) : null}
          <TextField
            id="communications-from"
            name="from"
            label={t('from')}
            type="date"
            defaultValue={validDateInput(query.from)}
          />
          <TextField
            id="communications-until"
            name="until"
            label={t('until')}
            type="date"
            defaultValue={validDateInput(query.until)}
          />
          {canReadOperations ? (
            <SelectField
              id="communications-follow-up"
              name="followUpStatus"
              label={t('followUpStatus')}
              defaultValue={followUpStatus ?? ''}
            >
              <option value="">{t('all')}</option>
              {followUpStatuses.map((value) => (
                <option key={value} value={value}>
                  {t(`followUpStatuses.${value}`)}
                </option>
              ))}
            </SelectField>
          ) : null}
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              {t('applyFilters')}
            </Button>
          </div>
        </form>

        {interactions.length ? (
          <>
            <div className="hidden overflow-x-auto rounded-md border xl:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('globalTitle')}</caption>
                <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      {t('tableColumns.date')}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {t('tableColumns.communication')}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {t('tableColumns.client')}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {t('tableColumns.channel')}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {t('tableColumns.followUp')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {interactions.map((interaction) => (
                    <tr key={interaction.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDateTime(interaction.occurredAt, locale)}
                      </td>
                      <td className="min-w-64 px-4 py-3">
                        <div className="grid gap-1">
                          {interaction.clientName ? (
                            <Link
                              className="font-medium text-primary underline"
                              href={`/clients/${interaction.clientId}/communications?interactionId=${interaction.id}`}
                            >
                              {interaction.subject}
                            </Link>
                          ) : (
                            <span className="font-medium">{interaction.subject}</span>
                          )}
                          {interaction.summary ? (
                            <span className="line-clamp-2 text-muted-foreground">
                              {interaction.summary}
                            </span>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            {t(`outcomes.${interaction.outcome}`)} ·{' '}
                            {interaction.recordedByName ?? common('Resources.unavailableUser')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ResourceReference
                          label={interaction.clientName ?? common('Resources.unavailableClient')}
                          href={
                            interaction.clientName
                              ? `/clients/${interaction.clientId}/communications`
                              : null
                          }
                        />
                        {interaction.contactLabel ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {interaction.contactLabel}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {t(`channels.${interaction.channel}`)}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t(`categories.${interaction.category}`)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {interaction.followUpStatus ? (
                          <Link
                            className="text-primary underline"
                            href={`/clients/${interaction.clientId}/communications?interactionId=${interaction.id}`}
                          >
                            {t(`followUpStatuses.${interaction.followUpStatus}`)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {t('followUpStatuses.none')}
                          </span>
                        )}
                        {interaction.source ? (
                          <div className="mt-1">
                            <Link
                              className="text-xs text-primary underline"
                              href={sourceHref(interaction.source, interaction.clientId)}
                            >
                              {t('source')}: {t(`sourceTypes.${interaction.source.type}`)}
                            </Link>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-3 xl:hidden">
              {interactions.map((interaction) => (
                <li key={interaction.id} className="grid gap-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="grid gap-1">
                      <h2 className="font-semibold">
                        {interaction.clientName ? (
                          <Link
                            className="text-primary underline"
                            href={`/clients/${interaction.clientId}/communications?interactionId=${interaction.id}`}
                          >
                            {interaction.subject}
                          </Link>
                        ) : (
                          interaction.subject
                        )}
                      </h2>
                      <p className="text-sm font-medium">
                        <ResourceReference
                          label={interaction.clientName ?? common('Resources.unavailableClient')}
                          href={
                            interaction.clientName
                              ? `/clients/${interaction.clientId}/communications`
                              : null
                          }
                        />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(interaction.occurredAt, locale)} ·{' '}
                        {t(`channels.${interaction.channel}`)} ·{' '}
                        {t(`categories.${interaction.category}`)} ·{' '}
                        {t(`outcomes.${interaction.outcome}`)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {interaction.contactLabel ?? t('noContact')} · {t('recordedBy')}:{' '}
                        {interaction.recordedByName ?? common('Resources.unavailableUser')}
                      </p>
                    </div>
                  </div>

                  {interaction.source ? (
                    <p className="text-sm">
                      {t('source')}:{' '}
                      <Link
                        className="text-primary underline"
                        href={sourceHref(interaction.source, interaction.clientId)}
                      >
                        {t(`sourceTypes.${interaction.source.type}`)}
                      </Link>
                    </p>
                  ) : null}

                  {interaction.followUpStatus ? (
                    <div>
                      <p className="text-sm font-medium">
                        {t('followUpStatus')}:{' '}
                        <Link
                          className="text-primary underline"
                          href={`/clients/${interaction.clientId}/communications?interactionId=${interaction.id}`}
                        >
                          {t(`followUpStatuses.${interaction.followUpStatus}`)} ·{' '}
                          {t('openInteraction')}
                        </Link>
                      </p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState title={t('empty')} />
        )}

        {responseData ? (
          <DataPagination
            pathname="/communications"
            page={responseData.page}
            pageSize={responseData.pageSize}
            totalItems={responseData.total}
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
  type = 'search',
  defaultValue,
}: Readonly<{ id: string; name: string; label: string; type?: string; defaultValue: string }>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        maxLength={type === 'date' ? undefined : 120}
        defaultValue={defaultValue}
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

function dateBoundary(value: string | undefined, endOfDay: boolean): string | undefined {
  const date = validDateInput(value);
  if (!date) return undefined;
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(`${date}T${time}Z`).toISOString();
}

function validDateInput(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function sourceHref(source: { type: string; id: string }, clientId: string): string {
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
      return `/clients/${clientId}/communications`;
  }
}
