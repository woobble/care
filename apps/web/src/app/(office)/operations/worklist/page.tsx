import { Checkbox as ShadcnCheckbox } from '@care/ui';
import { NativeSelect } from '@care/ui';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import {
  acknowledgeExceptionAction,
  snoozeExceptionAction,
} from '@app/web/app/(office)/operations/actions';
import {
  issueTitleKey,
  categoryTranslationKey,
  taskSourceHref,
  taskStatusTranslation,
  workItemSourceHref,
} from '@app/web/app/(office)/operations/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import type { components } from '@care/api-client';

type SearchParams = Promise<
  Record<string, string | undefined> & { error?: string; updated?: string }
>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = [
  'scheduling',
  'visits',
  'documentation',
  'benefits',
  'billing',
  'claims',
  'onboarding',
  'agreements',
  'employees',
] as const;

export default async function OperationsWorklistPage({
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
  const canAssign = hasPermission(permissions, 'operations.tasks.assign');
  const canManageExceptions = hasPermission(permissions, 'operations.exceptions.manage');
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const canReadEmployees = hasPermission(permissions, 'employee.read');
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const category = enumValue(query.category, categories);
  const severity = enumValue(query.severity, ['info', 'warning', 'critical'] as const);
  const issueStatus = enumValue(query.issueStatus ?? query.status, [
    'open',
    'acknowledged',
    'snoozed',
  ] as const);
  const taskStatus = enumValue(query.taskStatus, [
    'open',
    'in_progress',
    'completed',
    'cancelled',
  ] as const);
  const priority = enumValue(query.priority, ['low', 'normal', 'high', 'urgent'] as const);
  const due = enumValue(query.due, ['overdue', 'today', 'upcoming'] as const);
  const issueSort = enumValue(query.sort, ['relevance', 'due'] as const);
  const taskOrder = enumValue(query.order, ['due', 'created'] as const);
  const assignedEmployeeId = canAssign ? validUuid(query.assignedEmployeeId) : undefined;
  const assignedToMe = query.assignedToMe === 'true' ? 'true' : undefined;
  const search = query.search?.trim().slice(0, 120) || undefined;
  const workItemsPage = validPage(query.workItemsPage ?? query.page);
  const tasksPage = validPage(query.tasksPage ?? query.page);
  const workItemsPageSize = pageSizeValue(query.workItemsPageSize);
  const tasksPageSize = pageSizeValue(query.tasksPageSize);

  const [workItemsResult, tasksResult, facilitiesResult, employeesResult, clientsResult] =
    await Promise.all([
      api.GET('/api/v1/operations/work-items', {
        params: {
          query: {
            page: workItemsPage,
            pageSize: workItemsPageSize,
            ...(organizationId ? { organizationId } : {}),
            ...(facilityId ? { facilityId } : {}),
            ...(clientId ? { clientId } : {}),
            ...(category ? { category } : {}),
            ...(severity ? { severity } : {}),
            ...(issueStatus ? { status: issueStatus } : {}),
            ...(due ? { due } : {}),
            ...(issueSort ? { sort: issueSort } : {}),
            ...(search ? { search } : {}),
          },
          header,
        },
      }),
      api.GET('/api/v1/operations/tasks', {
        params: {
          query: {
            page: tasksPage,
            pageSize: tasksPageSize,
            order: taskOrder ?? 'due',
            ...(organizationId ? { organizationId } : {}),
            ...(facilityId ? { facilityId } : {}),
            ...(clientId ? { clientId } : {}),
            ...(taskStatus ? { status: taskStatus } : {}),
            ...(priority ? { priority } : {}),
            ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
            ...(assignedToMe ? { assignedToMe } : {}),
            ...(due ? { due } : {}),
            ...(search ? { search } : {}),
          },
          header,
        },
      }),
      facilityId && canReadFacilities
        ? api.GET('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
        : Promise.resolve({ data: undefined, error: undefined }),
      assignedEmployeeId && canAssign && canReadEmployees
        ? api.GET('/api/v1/employees/{id}', {
            params: { path: { id: assignedEmployeeId }, header },
          })
        : Promise.resolve({ data: undefined, error: undefined }),
      clientId && hasPermission(permissions, 'client.read')
        ? api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
        : Promise.resolve({ data: undefined, error: undefined }),
    ]);
  const workItemsData = workItemsResult.data as unknown as
    | components['schemas']['OperationsWorklistResponseDto']
    | undefined;
  const tasksData = tasksResult.data as unknown as
    | components['schemas']['OperationsTaskListResponseDto']
    | undefined;
  if (workItemsData)
    redirectToValidPage(
      '/operations/worklist',
      query,
      workItemsData.page,
      workItemsData.pageSize,
      workItemsData.total,
      'workItemsPage',
      'workItemsPageSize',
    );
  if (tasksData)
    redirectToValidPage(
      '/operations/worklist',
      query,
      tasksData.page,
      tasksData.pageSize,
      tasksData.total,
      'tasksPage',
      'tasksPageSize',
    );
  const workItems = workItemsData?.items ?? [];
  const tasks = tasksData?.items ?? [];
  const organizationLookup = canReadOrganizations
    ? await getOrganizationsByIds([
        ...(organizationId ? [organizationId] : []),
        ...workItems.flatMap((item) => (item.organizationId ? [item.organizationId] : [])),
        ...tasks.map((task) => task.organizationId),
      ])
    : { items: [], failed: false };
  const organizations = organizationLookup.items;
  const selectedFacility = facilitiesResult.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const selectedEmployee = employeesResult.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;
  const selectedClient = clientsResult.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const timezoneByOrganization = new Map(
    organizations.map((organization) => [organization.id, organization.timezone]),
  );
  const listFilters = {
    organizationId,
    facilityId,
    clientId,
    category,
    severity,
    issueStatus,
    taskStatus,
    priority,
    due,
    sort: issueSort,
    order: taskOrder,
    assignedEmployeeId,
    assignedToMe,
    search,
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('worklistTitle')}
        description={t('description')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/operations">{t('dashboardTitle')}</Link>
          </Button>
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
      {workItemsResult.error || tasksResult.error || organizationLookup.failed ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}
      {workItemsData?.truncated ? (
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
        <input type="hidden" name="workItemsPage" value="1" />
        <input type="hidden" name="tasksPage" value="1" />
        <input type="hidden" name="workItemsPageSize" value={workItemsPageSize} />
        <input type="hidden" name="tasksPageSize" value={tasksPageSize} />
        <label className="grid gap-1 text-sm">
          <span>{t('search')}</span>
          <input
            className="h-10 rounded-md border px-3"
            type="search"
            name="search"
            maxLength={120}
            defaultValue={search}
          />
        </label>
        {canReadOrganizations ? (
          <AsyncEntityCombobox
            name="organizationId"
            label={t('organization')}
            entity="organizations"
            placeholder={t('all')}
            {...(organizationId
              ? {
                  initialOption: {
                    id: organizationId,
                    label:
                      organizations.find((item) => item.id === organizationId)?.name ?? t('all'),
                  },
                }
              : {})}
          />
        ) : null}
        {canReadFacilities ? (
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
        <SelectField
          id="category"
          name="category"
          label={t('category')}
          defaultValue={category ?? ''}
        >
          <option value="">{t('allCategories')}</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {t(categoryTranslationKey(value))}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="severity"
          name="severity"
          label={t('severity')}
          defaultValue={severity ?? ''}
        >
          <option value="">{t('allSeverities')}</option>
          <option value="critical">{t('critical')}</option>
          <option value="warning">{t('warning')}</option>
          <option value="info">{t('info')}</option>
        </SelectField>
        <SelectField
          id="issueStatus"
          name="issueStatus"
          label={t('exceptionStatus')}
          defaultValue={issueStatus ?? ''}
        >
          <option value="">{t('all')}</option>
          <option value="open">{t('taskOpen')}</option>
          <option value="acknowledged">{t('acknowledged')}</option>
          <option value="snoozed">{t('snoozed')}</option>
        </SelectField>
        <SelectField
          id="taskStatus"
          name="taskStatus"
          label={t('status')}
          defaultValue={taskStatus ?? ''}
        >
          <option value="">{t('allTaskStatuses')}</option>
          <option value="open">{t('taskOpen')}</option>
          <option value="in_progress">{t('taskInProgress')}</option>
          <option value="completed">{t('taskCompleted')}</option>
          <option value="cancelled">{t('taskCancelled')}</option>
        </SelectField>
        <SelectField
          id="priority"
          name="priority"
          label={t('priority')}
          defaultValue={priority ?? ''}
        >
          <option value="">{t('allPriorities')}</option>
          <option value="low">{t('low')}</option>
          <option value="normal">{t('normal')}</option>
          <option value="high">{t('high')}</option>
          <option value="urgent">{t('urgent')}</option>
        </SelectField>
        <SelectField id="due" name="due" label={t('dueDate')} defaultValue={due ?? ''}>
          <option value="">{t('all')}</option>
          <option value="overdue">{t('overdue')}</option>
          <option value="today">{t('dueToday')}</option>
          <option value="upcoming">{t('upcoming')}</option>
        </SelectField>
        <SelectField
          id="sort"
          name="sort"
          label={t('sortBy')}
          defaultValue={issueSort ?? 'relevance'}
        >
          <option value="relevance">{t('sortRelevance')}</option>
          <option value="due">{t('sortDue')}</option>
        </SelectField>
        <SelectField
          id="order"
          name="order"
          label={t('taskSortBy')}
          defaultValue={taskOrder ?? 'due'}
        >
          <option value="due">{t('sortDue')}</option>
          <option value="created">{t('sortCreated')}</option>
        </SelectField>
        {canAssign && canReadEmployees ? (
          <AsyncEntityCombobox
            name="assignedEmployeeId"
            label={t('assignee')}
            entity="employees"
            placeholder={t('allEmployees')}
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
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <ShadcnCheckbox
            name="assignedToMe"
            value="true"
            defaultChecked={assignedToMe === 'true'}
          />
          {t('assignedToMe')}
        </label>
        <Button type="submit" className="min-h-10 w-fit">
          {t('filter')}
        </Button>
      </form>

      <section aria-labelledby="exceptions-heading" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="exceptions-heading" className="text-xl font-semibold">
            {t('systemIssues')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('systemIssueHelp')}</p>
        </div>
        {workItems.length ? (
          <ul className="grid gap-3">
            {workItems.map((item) => (
              <li
                key={item.id}
                className="grid gap-3 rounded-lg border bg-card p-4 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-primary">
                      {t(categoryTranslationKey(item.category))}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.severity === 'critical' ? 'bg-destructive/15 text-destructive' : item.severity === 'warning' ? 'bg-warning-muted text-warning-foreground' : 'bg-muted text-foreground'}`}
                    >
                      {t(item.severity)}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
                      {exceptionStatusLabel(t, item.status)}
                    </span>
                  </div>
                  <Link
                    className="font-semibold text-primary underline"
                    href={workItemSourceHref(item)}
                  >
                    {t(`issueTitles.${issueTitleKey(item.issueCode)}`)}
                  </Link>
                  <p className="text-sm text-muted-foreground">{t('issueActionHelp')}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.clientName ?? t('noClient')} ·{' '}
                    {item.dueAt
                      ? formatDateTime(
                          item.dueAt,
                          locale,
                          timezoneByOrganization.get(item.organizationId ?? '') ?? 'Europe/Berlin',
                        )
                      : t('noDueDate')}{' '}
                    · {t('lastObserved')}:{' '}
                    {formatDateTime(
                      item.lastObservedAt,
                      locale,
                      timezoneByOrganization.get(item.organizationId ?? '') ?? 'Europe/Berlin',
                    )}
                  </p>
                  <Link
                    className="w-fit text-sm font-medium text-primary underline"
                    href={workItemSourceHref(item)}
                  >
                    {t('openSource')}
                  </Link>
                </div>
                {canManageExceptions && item.status !== 'acknowledged' ? (
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <form action={acknowledgeExceptionAction}>
                      <input type="hidden" name="issueId" value={item.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        {t('acknowledge')}
                      </Button>
                    </form>
                    {item.severity !== 'critical' && item.status !== 'snoozed' ? (
                      <form action={snoozeExceptionAction}>
                        <input type="hidden" name="issueId" value={item.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          {t('snooze')}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border bg-card p-5">
            <p>{t('worklistEmpty')}</p>
          </div>
        )}
        {workItemsData ? (
          <DataPagination
            pathname="/operations/worklist"
            page={workItemsData.page}
            pageSize={workItemsData.pageSize}
            totalItems={workItemsData.total}
            filters={{ ...listFilters, tasksPage, tasksPageSize }}
            pageParam="workItemsPage"
            pageSizeParam="workItemsPageSize"
            controlId="work-items-page-size"
          />
        ) : null}
      </section>

      <section aria-labelledby="tasks-heading" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="tasks-heading" className="text-xl font-semibold">
              {t('tasksTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('manualTaskHelp')}</p>
          </div>
          <Link className="text-sm font-medium text-primary underline" href="/operations/tasks">
            {t('openTasks')}
          </Link>
        </div>
        {tasks.length ? (
          <ul className="grid gap-3">
            {tasks.map((task) => {
              const sourceHref = taskSourceHref(task);
              return (
                <li
                  key={task.id}
                  className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="grid gap-1">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/operations/tasks/${task.id}`}
                    >
                      {task.title}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {t('manualTask')} · {t(task.priority)} ·{' '}
                      {t(taskStatusTranslation(task.status))} ·{' '}
                      {task.dueAt
                        ? formatDateTime(
                            task.dueAt,
                            locale,
                            timezoneByOrganization.get(task.organizationId) ?? 'Europe/Berlin',
                          )
                        : t('noDueDate')}
                    </span>
                    {sourceHref ? (
                      <Link href={sourceHref} className="w-fit text-sm text-primary underline">
                        {t('openSource')}
                      </Link>
                    ) : null}
                  </div>
                  <Link
                    href={`/operations/tasks/${task.id}`}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    {t('openTask')}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-lg border bg-card p-5">
            <p>{t('tasksEmpty')}</p>
          </div>
        )}
        {tasksData ? (
          <DataPagination
            pathname="/operations/worklist"
            page={tasksData.page}
            pageSize={tasksData.pageSize}
            totalItems={tasksData.total}
            filters={{ ...listFilters, workItemsPage, workItemsPageSize }}
            pageParam="tasksPage"
            pageSizeParam="tasksPageSize"
            controlId="tasks-page-size"
          />
        ) : null}
      </section>
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  children,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  children: React.ReactNode;
  defaultValue?: string;
}) {
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      <span>{label}</span>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        selectClassName="h-10 rounded-md border bg-card px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

function exceptionStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Operations'>>>,
  status: 'open' | 'acknowledged' | 'snoozed',
) {
  return status === 'open'
    ? t('taskOpen')
    : status === 'acknowledged'
      ? t('acknowledged')
      : t('snoozed');
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function validPage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : 1;
}

function pageSizeValue(value: string | undefined): number {
  const parsed = Number(value ?? '20');
  return [10, 20, 50, 100].includes(parsed) ? parsed : 20;
}

function enumValue<const T extends readonly string[]>(
  value: string | undefined,
  values: T,
): T[number] | undefined {
  return (values as readonly string[]).includes(value ?? '') ? (value as T[number]) : undefined;
}
