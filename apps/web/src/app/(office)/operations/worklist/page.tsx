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
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  }
  const canAssign = hasPermission(permissions, 'operations.tasks.assign');
  const canManageExceptions = hasPermission(permissions, 'operations.exceptions.manage');
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
  const page = validPage(query.page);

  const [
    workItemsResult,
    tasksResult,
    organizationsResult,
    facilitiesResult,
    employeesResult,
    clientsResult,
  ] = await Promise.all([
    api.GET('/api/v1/operations/work-items', {
      params: {
        query: {
          page,
          pageSize: 25,
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
          page,
          pageSize: 25,
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
    api.GET('/api/v1/organizations', { params: { header } }),
    api.GET('/api/v1/facilities', {
      params: { query: organizationId ? { organizationId } : {}, header },
    }),
    canAssign && hasPermission(permissions, 'employee.read')
      ? api.GET('/api/v1/employees', {
          params: {
            query: {
              status: 'active',
              page: 1,
              pageSize: 100,
              sortBy: 'lastName',
              sortOrder: 'asc',
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    hasPermission(permissions, 'client.read')
      ? api.GET('/api/v1/clients', {
          params: {
            query: {
              page: 1,
              pageSize: 100,
              status: 'active',
              sortBy: 'lastName',
              sortOrder: 'asc',
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const workItems = workItemsResult.data?.items ?? [];
  const tasks = tasksResult.data?.items ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const employees = employeesResult.data?.items ?? [];
  const clients = clientsResult.data?.items ?? [];
  const timezoneByOrganization = new Map(
    organizations.map((organization) => [organization.id, organization.timezone]),
  );
  const currentQuery = {
    ...query,
    ...(organizationId ? { organizationId } : {}),
    ...(facilityId ? { facilityId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(category ? { category } : {}),
    ...(severity ? { severity } : {}),
    ...(issueStatus ? { issueStatus } : {}),
    ...(taskStatus ? { taskStatus } : {}),
    ...(priority ? { priority } : {}),
    ...(due ? { due } : {}),
    ...(issueSort ? { sort: issueSort } : {}),
    ...(taskOrder ? { order: taskOrder } : {}),
    ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
    ...(search ? { search } : {}),
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
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {workItemsResult.error || tasksResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}
      {workItemsResult.data?.truncated ? (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {t('truncated')}
        </p>
      ) : null}

      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
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
        <SelectField
          id="organizationId"
          name="organizationId"
          label={t('organization')}
          defaultValue={organizationId ?? ''}
        >
          <option value="">{t('all')}</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="facilityId"
          name="facilityId"
          label={t('facility')}
          defaultValue={facilityId ?? ''}
        >
          <option value="">{t('all')}</option>
          {facilities.map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="clientId"
          name="clientId"
          label={t('client')}
          defaultValue={clientId ?? ''}
        >
          <option value="">{t('all')}</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.preferredName || client.firstName} {client.lastName}
            </option>
          ))}
        </SelectField>
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
        {canAssign ? (
          <SelectField
            id="assignedEmployeeId"
            name="assignedEmployeeId"
            label={t('assignee')}
            defaultValue={assignedEmployeeId ?? ''}
          >
            <option value="">{t('allEmployees')}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.preferredName || employee.firstName} {employee.lastName}
              </option>
            ))}
          </SelectField>
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
          <p className="text-sm text-slate-600">{t('systemIssueHelp')}</p>
        </div>
        {workItems.length ? (
          <ul className="grid gap-3">
            {workItems.map((item) => (
              <li
                key={item.id}
                className="grid gap-3 rounded-lg border bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-900">
                      {t(categoryTranslationKey(item.category))}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.severity === 'critical' ? 'bg-red-100 text-red-900' : item.severity === 'warning' ? 'bg-amber-100 text-amber-950' : 'bg-slate-100 text-slate-800'}`}
                    >
                      {t(item.severity)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                      {exceptionStatusLabel(t, item.status)}
                    </span>
                  </div>
                  <Link
                    className="font-semibold text-blue-900 underline"
                    href={workItemSourceHref(item)}
                  >
                    {t(`issueTitles.${issueTitleKey(item.issueCode)}`)}
                  </Link>
                  <p className="text-sm text-slate-700">{t('issueActionHelp')}</p>
                  <p className="text-sm text-slate-600">
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
                    className="w-fit text-sm font-medium text-blue-800 underline"
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
          <div className="rounded-lg border bg-white p-5">
            <p>{t('worklistEmpty')}</p>
          </div>
        )}
        {workItemsResult.data ? (
          <Pagination
            page={page}
            pageSize={25}
            total={workItemsResult.data.total}
            query={currentQuery}
            label={t('issuePages')}
            previousLabel={t('previousPage')}
            nextLabel={t('nextPage')}
          />
        ) : null}
      </section>

      <section aria-labelledby="tasks-heading" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="tasks-heading" className="text-xl font-semibold">
              {t('tasksTitle')}
            </h2>
            <p className="text-sm text-slate-600">{t('manualTaskHelp')}</p>
          </div>
          <Link className="text-sm font-medium text-blue-800 underline" href="/operations/tasks">
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
                  className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="grid gap-1">
                    <Link
                      className="font-semibold text-blue-900 underline"
                      href={`/operations/tasks/${task.id}`}
                    >
                      {task.title}
                    </Link>
                    <span className="text-sm text-slate-600">
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
                      <Link href={sourceHref} className="w-fit text-sm text-blue-800 underline">
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
          <div className="rounded-lg border bg-white p-5">
            <p>{t('tasksEmpty')}</p>
          </div>
        )}
        {tasksResult.data ? (
          <Pagination
            page={page}
            pageSize={25}
            total={tasksResult.data.total}
            query={currentQuery}
            label={t('taskPages')}
            previousLabel={t('previousPage')}
            nextLabel={t('nextPage')}
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
        selectClassName="h-10 rounded-md border bg-white px-3"
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

function Pagination({
  page,
  pageSize,
  total,
  query,
  label,
  previousLabel,
  nextLabel,
}: {
  page: number;
  pageSize: number;
  total: number;
  query: Record<string, string | undefined>;
  label: string;
  previousLabel: string;
  nextLabel: string;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value && key !== 'page' && key !== 'error' && key !== 'updated') params.set(key, value);
  return (
    <nav aria-label={label} className="flex justify-between">
      {page > 1 ? (
        <Link
          className="rounded-md border bg-white px-3 py-2"
          href={`/operations/worklist?${withPage(params, page - 1)}`}
        >
          {previousLabel}
        </Link>
      ) : (
        <span />
      )}
      {page * pageSize < total ? (
        <Link
          className="rounded-md border bg-white px-3 py-2"
          href={`/operations/worklist?${withPage(params, page + 1)}`}
        >
          {nextLabel}
        </Link>
      ) : null}
    </nav>
  );
}

function withPage(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  next.set('page', String(page));
  return next.toString();
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function validPage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : 1;
}

function enumValue<const T extends readonly string[]>(
  value: string | undefined,
  values: T,
): T[number] | undefined {
  return (values as readonly string[]).includes(value ?? '') ? (value as T[number]) : undefined;
}
