import { NativeSelect } from '@care/ui';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import {
  acknowledgeExceptionAction,
  createDeadlineTaskAction,
  snoozeExceptionAction,
} from '@app/web/app/(office)/operations/actions';
import {
  categoryTranslationKey,
  issueTitleKey,
  workItemSourceHref,
} from '@app/web/app/(office)/operations/ui';
import type { components } from '@care/api-client';

type SearchParams = Promise<Record<string, string | undefined>>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = ['agreements', 'employees', 'benefits', 'billing', 'onboarding'] as const;
const states = ['open', 'acknowledged', 'snoozed'] as const;
const dueFilters = ['overdue', 'today', 'upcoming'] as const;
const sources = [
  'service_agreements',
  'employee_qualifications',
  'benefits',
  'billing',
  'onboarding',
] as const;

export default async function OperationsDeadlinesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, translate, locale] = await Promise.all([
    getTranslations('Operations'),
    getTranslations(),
    getLocale(),
  ]);
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read')) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const employeeId = validUuid(query.employeeId);
  const assignedEmployeeId = validUuid(query.assignedEmployeeId);
  const canFilterByAssignee =
    hasPermission(permissions, 'operations.tasks.assign') &&
    hasPermission(permissions, 'employee.read');
  const category = choice(query.category, categories);
  const status = choice(query.status, states);
  const due = choice(query.due, dueFilters);
  const sourceDomain = choice(query.sourceDomain, sources);
  const fromDate = validDate(query.fromDate);
  const untilDate = validDate(query.untilDate);
  const page = Math.max(1, Math.min(100_000, Number.parseInt(query.page ?? '1', 10) || 1));
  const requestedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;
  const [
    deadlineResult,
    facilityResult,
    selectedClientResult,
    selectedEmployeeResult,
    selectedAssignedEmployeeResult,
  ] = await Promise.all([
    api.GET('/api/v1/operations/deadlines', {
      params: {
        query: {
          page,
          pageSize,
          sort: 'due',
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(clientId ? { clientId } : {}),
          ...(employeeId ? { employeeId } : {}),
          ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
          ...(category ? { category } : {}),
          ...(status ? { status } : {}),
          ...(due ? { due } : {}),
          ...(sourceDomain ? { sourceDomain } : {}),
          ...(fromDate ? { fromDate } : {}),
          ...(untilDate ? { untilDate } : {}),
        },
        header,
      },
    }),
    facilityId && hasPermission(permissions, 'facility.read')
      ? api.GET('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    clientId && hasPermission(permissions, 'client.read')
      ? api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    employeeId && hasPermission(permissions, 'employee.read')
      ? api.GET('/api/v1/employees/{id}', { params: { path: { id: employeeId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    assignedEmployeeId && canFilterByAssignee
      ? api.GET('/api/v1/employees/{id}', {
          params: { path: { id: assignedEmployeeId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const result = deadlineResult.data as unknown as
    | components['schemas']['OperationsWorklistResponseDto']
    | undefined;
  const items = result?.items ?? [];
  if (result)
    redirectToValidPage('/operations/deadlines', query, result.page, result.pageSize, result.total);
  const selectedFacility = facilityResult.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedClient = selectedClientResult.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const selectedEmployee = selectedEmployeeResult.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;
  const selectedAssignedEmployee = selectedAssignedEmployeeResult.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;
  const organizationLookup = hasPermission(permissions, 'organization.read')
    ? await getOrganizationsByIds([
        ...(organizationId ? [organizationId] : []),
        ...items.flatMap((item) => (item.organizationId ? [item.organizationId] : [])),
      ])
    : { items: [], failed: false };
  const timezoneOrganizations = organizationLookup.items;
  const selectedOrganization = timezoneOrganizations.find((item) => item.id === organizationId);
  const timezoneByOrganization = new Map(
    timezoneOrganizations.map((organization) => [organization.id, organization.timezone]),
  );
  const canManage = hasPermission(permissions, 'operations.exceptions.manage');
  const canCreateTask = hasPermission(permissions, 'operations.tasks.create');

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('deadlinesTitle')}
        description={t('deadlinesDescription')}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/operations">{t('dashboardTitle')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/operations/recurring-tasks">{t('recurringTasks')}</Link>
            </Button>
          </>
        }
      />

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {query.updated === 'acknowledged' ? t('acknowledged') : t('snoozed')}
        </p>
      ) : null}
      {deadlineResult.error || organizationLookup.failed || facilityResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}
      {result?.truncated ? (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning-muted p-3 text-warning-foreground"
        >
          {t('truncated')}
        </p>
      ) : null}

      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input type="hidden" name="pageSize" value={pageSize} />
        {hasPermission(permissions, 'organization.read') ? (
          <AsyncEntityCombobox
            name="organizationId"
            label={t('organization')}
            entity="organizations"
            placeholder={t('all')}
            {...(selectedOrganization
              ? { initialOption: { id: selectedOrganization.id, label: selectedOrganization.name } }
              : {})}
          />
        ) : null}
        {hasPermission(permissions, 'facility.read') ? (
          <AsyncEntityCombobox
            name="facilityId"
            label={t('facility')}
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
        <label className="grid gap-1 text-sm">
          <span>{t('category')}</span>
          <NativeSelect
            selectClassName="h-10 rounded-md border px-3"
            name="category"
            defaultValue={category ?? ''}
            className="w-full"
          >
            <option value="">{t('all')}</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {t(categoryTranslationKey(value))}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('sourceDomain')}</span>
          <NativeSelect
            selectClassName="h-10 rounded-md border px-3"
            name="sourceDomain"
            defaultValue={sourceDomain ?? ''}
            className="w-full"
          >
            <option value="">{t('all')}</option>
            {sources.map((value) => (
              <option key={value} value={value}>
                {t(`deadlineSources.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('status')}</span>
          <NativeSelect
            selectClassName="h-10 rounded-md border px-3"
            name="status"
            defaultValue={status ?? ''}
            className="w-full"
          >
            <option value="">{t('all')}</option>
            {states.map((value) => (
              <option key={value} value={value}>
                {t(value === 'open' ? 'taskOpen' : value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('dueDate')}</span>
          <NativeSelect
            selectClassName="h-10 rounded-md border px-3"
            name="due"
            defaultValue={due ?? ''}
            className="w-full"
          >
            <option value="">{t('all')}</option>
            {dueFilters.map((value) => (
              <option key={value} value={value}>
                {t(value === 'today' ? 'dueToday' : value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        {hasPermission(permissions, 'client.read') ? (
          <AsyncEntityCombobox
            name="clientId"
            label={t('client')}
            entity="clients"
            placeholder={t('all')}
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
        {hasPermission(permissions, 'employee.read') ? (
          <AsyncEntityCombobox
            name="employeeId"
            label={t('employee')}
            entity="employees"
            placeholder={t('all')}
            {...(selectedEmployee
              ? {
                  initialOption: {
                    id: selectedEmployee.id,
                    label: `${selectedEmployee.preferredName || selectedEmployee.firstName} ${selectedEmployee.lastName}`,
                  },
                }
              : {})}
          />
        ) : null}
        {canFilterByAssignee ? (
          <AsyncEntityCombobox
            name="assignedEmployeeId"
            label={t('assignedEmployeeFilter')}
            entity="employees"
            placeholder={t('all')}
            {...(organizationId ? { organizationId } : {})}
            {...(selectedAssignedEmployee
              ? {
                  initialOption: {
                    id: selectedAssignedEmployee.id,
                    label: `${selectedAssignedEmployee.preferredName || selectedAssignedEmployee.firstName} ${selectedAssignedEmployee.lastName}`,
                  },
                }
              : {})}
          />
        ) : null}
        <label className="grid gap-1 text-sm">
          <span>{t('fromDate')}</span>
          <input
            className="h-10 rounded-md border px-3"
            type="date"
            name="fromDate"
            defaultValue={fromDate ?? ''}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('untilDate')}</span>
          <input
            className="h-10 rounded-md border px-3"
            type="date"
            name="untilDate"
            defaultValue={untilDate ?? ''}
          />
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">{t('filter')}</Button>
          <Button asChild variant="secondary">
            <Link href="/operations/deadlines">{t('clearFilters')}</Link>
          </Button>
        </div>
      </form>

      {items.length ? (
        <ul className="grid gap-3">
          {items.map((item) => {
            const subjectName =
              item.clientName ?? item.employeeName ?? t(categoryTranslationKey(item.category));
            const timezone =
              timezoneByOrganization.get(item.organizationId ?? '') ?? 'Europe/Berlin';
            return (
              <li key={item.id} className="grid gap-3 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <Link
                      className="font-semibold text-primary underline"
                      href={workItemSourceHref(item)}
                    >
                      {t(`issueTitles.${issueTitleKey(item.issueCode)}`)}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {subjectName}
                      {item.dueAt
                        ? ` · ${formatDateTime(item.dueAt, locale as 'en' | 'de', timezone)}`
                        : ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(`deadlineSources.${item.sourceDomain as (typeof sources)[number]}`)} ·{' '}
                      {t(item.status === 'open' ? 'taskOpen' : item.status)} · {t(item.severity)}
                    </span>
                  </div>
                  <Link
                    className="text-sm font-medium text-primary underline"
                    href={`/operations/work-items/${item.id}/history`}
                  >
                    {t('issuePages')}
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && item.status !== 'acknowledged' ? (
                    <form action={acknowledgeExceptionAction}>
                      <input type="hidden" name="issueId" value={item.id} />
                      <input type="hidden" name="returnTo" value="/operations/deadlines" />
                      <Button size="sm" variant="secondary">
                        {t('acknowledge')}
                      </Button>
                    </form>
                  ) : null}
                  {canManage ? (
                    <form action={snoozeExceptionAction}>
                      <input type="hidden" name="issueId" value={item.id} />
                      <input type="hidden" name="returnTo" value="/operations/deadlines" />
                      <Button size="sm" variant="secondary">
                        {t('snooze')}
                      </Button>
                    </form>
                  ) : null}
                  {canCreateTask && item.sourceDomain === 'service_agreements' ? (
                    <form action={createDeadlineTaskAction}>
                      <input type="hidden" name="issueId" value={item.id} />
                      <input type="hidden" name="title" value={t('agreementFollowUpTask')} />
                      <input
                        type="hidden"
                        name="priority"
                        value={item.severity === 'critical' ? 'urgent' : 'high'}
                      />
                      <Button size="sm">{t('createFollowUpTask')}</Button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={t('deadlinesEmpty')} />
      )}

      {result ? (
        <DataPagination
          pathname="/operations/deadlines"
          page={result.page}
          pageSize={result.pageSize}
          totalItems={result.total}
          filters={query}
        />
      ) : null}
    </div>
  );
}

function validUuid(value?: string): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}
function validDate(value?: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}
function choice<const T extends readonly string[]>(
  value: string | undefined,
  values: T,
): T[number] | undefined {
  return values.includes(value as T[number]) ? (value as T[number]) : undefined;
}
