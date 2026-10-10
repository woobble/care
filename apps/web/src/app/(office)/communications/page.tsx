import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import type { components } from '@care/api-client';
import { formatDateTime } from '../../../i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../lib/api';

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
  }>;
}>) {
  const [query, t, locale] = await Promise.all([
    searchParams,
    getTranslations('Communications'),
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
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  }

  const canReadOperations = hasPermission(permissionGrants, 'operations.read');
  const canReadOrganizations = hasPermission(permissionGrants, 'organization.read');
  const canReadFacilities = hasPermission(permissionGrants, 'facility.read');
  const canReadEmployees = hasPermission(permissionGrants, 'employee.read');
  const [organizationResult, facilityResult, employeeResult] = await Promise.all([
    canReadOrganizations
      ? get('/api/v1/organizations', { params: { query: { status: 'active' }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadFacilities
      ? get('/api/v1/facilities', {
          params: {
            query: {
              status: 'active',
              ...(isUuid(query.organizationId) ? { organizationId: query.organizationId } : {}),
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadEmployees
      ? get('/api/v1/employees', {
          params: { query: { status: 'active', page: 1, pageSize: 100 }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const employees = employeeResult.data?.items ?? [];
  const organizationId = organizations.some((item) => item.id === query.organizationId)
    ? query.organizationId
    : undefined;
  const facilityId = facilities.some((item) => item.id === query.facilityId)
    ? query.facilityId
    : undefined;
  const channel = channels.find((value) => value === query.channel);
  const direction = directions.find((value) => value === query.direction);
  const category = categories.find((value) => value === query.category);
  const outcome = outcomes.find((value) => value === query.outcome);
  const followUpStatus = followUpStatuses.find((value) => value === query.followUpStatus);
  const employeeId = employees.some((item) => item.userId === query.recordedByUserId)
    ? query.recordedByUserId
    : undefined;
  const from = dateBoundary(query.from, false);
  const until = dateBoundary(query.until, true);
  const pageNumber = Number(query.page);
  const page =
    Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, 100_000) : 1;
  const search = query.q?.trim().slice(0, 120) ?? '';
  const clientSearch = query.clientSearch?.trim().slice(0, 120) ?? '';
  const result = await get('/api/v1/communications', {
    params: {
      query: {
        page,
        pageSize: 50,
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
      },
      header,
    },
  });
  const interactions: Interaction[] = result.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / (result.data?.pageSize ?? 50)));
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
    recordedByUserId: employeeId,
    followUpStatus: canReadOperations ? followUpStatus : undefined,
  };

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">{t('title')}</p>
        <h1 className="text-3xl font-semibold">{t('globalTitle')}</h1>
        <p className="max-w-3xl text-slate-700">{t('globalDescription')}</p>
      </header>

      {result.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}

      <section aria-label={t('globalTitle')} className="grid gap-4 rounded-lg border bg-white p-5">
        <form method="get" className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
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
            <SelectField
              id="communications-organization"
              name="organizationId"
              label={t('filterOrganization')}
              defaultValue={organizationId ?? ''}
            >
              <option value="">{t('all')}</option>
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {canReadFacilities ? (
            <SelectField
              id="communications-facility"
              name="facilityId"
              label={t('filterFacility')}
              defaultValue={facilityId ?? ''}
            >
              <option value="">{t('all')}</option>
              {facilities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
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
          {canReadEmployees ? (
            <SelectField
              id="communications-employee"
              name="recordedByUserId"
              label={t('filterEmployee')}
              defaultValue={employeeId ?? ''}
            >
              <option value="">{t('all')}</option>
              {employees
                .filter((item) => item.userId)
                .map((item) => (
                  <option key={item.id} value={item.userId!}>
                    {item.preferredName || item.firstName} {item.lastName}
                  </option>
                ))}
            </SelectField>
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
          <ul className="grid gap-3">
            {interactions.map((interaction) => (
              <li key={interaction.id} className="grid gap-3 rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <h2 className="font-semibold">{interaction.subject}</h2>
                    <p className="text-sm font-medium">
                      {interaction.clientName ?? t('unknownClient')}
                    </p>
                    <p className="text-sm text-slate-600">
                      {formatDateTime(interaction.occurredAt, locale)} ·{' '}
                      {t(`channels.${interaction.channel}`)} ·{' '}
                      {t(`categories.${interaction.category}`)} ·{' '}
                      {t(`outcomes.${interaction.outcome}`)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {interaction.contactLabel ?? t('noContact')} ·{' '}
                      {interaction.recordedByName ??
                        t('recordedBy', { userId: interaction.recordedByUserId })}
                    </p>
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/clients/${interaction.clientId}/communications`}>
                      {t('openClient')}
                    </Link>
                  </Button>
                </div>

                {interaction.source ? (
                  <p className="text-sm">
                    {t('source')}:{' '}
                    <Link
                      className="text-blue-800 underline"
                      href={sourceHref(interaction.source, interaction.clientId)}
                    >
                      {t(`sourceTypes.${interaction.source.type}`)}
                    </Link>
                  </p>
                ) : null}

                {interaction.followUpStatus ? (
                  <div>
                    <p className="text-sm font-medium">
                      {t('followUpStatus')}: {t(`followUpStatuses.${interaction.followUpStatus}`)}
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-5 text-slate-700">{t('empty')}</p>
        )}

        {pages > 1 ? (
          <nav aria-label={t('globalTitle')} className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {page} / {pages}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, page - 1)}>{t('previousPage')}</Link>
                </Button>
              ) : null}
              {page < pages ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, page + 1)}>{t('nextPage')}</Link>
                </Button>
              ) : null}
            </div>
          </nav>
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
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="h-10 rounded-md border bg-white px-3"
      >
        {children}
      </select>
    </div>
  );
}

function pageHref(filters: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  params.set('page', String(page));
  return `/communications?${params.toString()}`;
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
