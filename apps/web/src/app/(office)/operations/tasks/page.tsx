import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import { visitDateTimeInputValue } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { createTaskAction } from '@app/web/app/(office)/operations/actions';
import { PageHeader } from '@app/web/components/page-patterns';

type SearchParams = Promise<{
  page?: string;
  status?: string;
  priority?: string;
  due?: string;
  assignedEmployeeId?: string;
  assignedToMe?: string;
  order?: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  admissionCaseId?: string;
  q?: string;
  error?: string;
  updated?: string;
}>;

type AdmissionTaskContext = {
  id: string;
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  firstName: string;
  lastName: string;
  stage: string;
  nextFollowUpAt: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OperationsTasksPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, translate, locale, onboardingT] = await Promise.all([
    getTranslations('Operations'),
    getTranslations(),
    getLocale(),
    getTranslations('Onboarding'),
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

  const canCreate = hasPermission(permissions, 'operations.tasks.create');
  const canAssign = hasPermission(permissions, 'operations.tasks.assign');
  const requestedAdmissionCaseId = query.admissionCaseId?.trim();
  const admissionCaseId = validUuid(requestedAdmissionCaseId);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const clientId = validUuid(query.clientId);
  const assignedEmployeeId = canAssign ? validUuid(query.assignedEmployeeId) : undefined;
  const status = taskStatus(query.status);
  const priority = taskPriority(query.priority);
  const due = dueFilter(query.due);
  const order = query.order === 'created' ? 'created' : 'due';
  const search = query.q?.trim().slice(0, 120) || undefined;
  const page = validPage(query.page);
  const [taskResult, organizationResult, facilityResult, employeeResult, clientResult] =
    await Promise.all([
      api.GET('/api/v1/operations/tasks', {
        params: {
          query: {
            page,
            pageSize: 25,
            order,
            ...(organizationId ? { organizationId } : {}),
            ...(facilityId ? { facilityId } : {}),
            ...(clientId ? { clientId } : {}),
            ...(status ? { status } : {}),
            ...(priority ? { priority } : {}),
            ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
            ...(query.assignedToMe === 'true' ? { assignedToMe: 'true' } : {}),
            ...(due ? { due } : {}),
            ...(search ? { search } : {}),
          },
          header,
        },
      }),
      api.GET('/api/v1/organizations', { params: { query: { status: 'active' }, header } }),
      api.GET('/api/v1/facilities', {
        params: { query: organizationId ? { organizationId } : {}, header },
      }),
      canAssign
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
      canCreate
        ? api.GET('/api/v1/clients', {
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
    ]);
  const canReadAdmission = hasPermission(permissions, 'onboarding.read');
  const canManageAdmission = hasPermission(permissions, 'onboarding.manage');
  const admissionResult =
    admissionCaseId && canCreate && canReadAdmission && canManageAdmission
      ? await api.GET('/api/v1/onboarding/cases/{id}', {
          params: { path: { id: admissionCaseId }, header },
        })
      : null;
  const admission = admissionResult?.data as unknown as AdmissionTaskContext | undefined;
  const admissionHandoffRequested = requestedAdmissionCaseId !== undefined;
  const admissionHandoffReady = Boolean(
    admissionCaseId &&
    canCreate &&
    canReadAdmission &&
    canManageAdmission &&
    admission &&
    !['declined', 'withdrawn'].includes(admission.stage),
  );
  const admissionClientResult =
    admissionHandoffReady && admission?.clientId && hasPermission(permissions, 'client.read')
      ? await api.GET('/api/v1/clients/{id}', {
          params: { path: { id: admission.clientId }, header },
        })
      : null;
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const employees = employeeResult.data?.items ?? [];
  const clients = (clientResult.data?.items ?? []).map((client) => ({
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    preferredName: client.preferredName,
  }));
  if (
    admissionClientResult?.data &&
    !clients.some((client) => client.id === admissionClientResult.data!.id)
  ) {
    clients.push({
      id: admissionClientResult.data.id,
      firstName: admissionClientResult.data.firstName,
      lastName: admissionClientResult.data.lastName,
      preferredName: admissionClientResult.data.preferredName,
    });
  }
  const tasks = taskResult.data?.items ?? [];
  const timezoneByOrganization = new Map(
    organizations.map((organization) => [organization.id, organization.timezone]),
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('tasksTitle')}
        description={t('manualTaskHelp')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/operations/worklist">{t('openWorklist')}</Link>
          </Button>
        }
      />

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated === 'created' ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('taskCreated')}
        </p>
      ) : null}
      {taskResult.error || organizationResult.error || facilityResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}

      {admissionHandoffRequested && !admissionHandoffReady ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {onboardingT('taskContextUnavailable')}
        </p>
      ) : null}

      {canCreate && (!admissionHandoffRequested || admissionHandoffReady) ? (
        <section
          aria-labelledby="create-task-title"
          className="grid gap-4 rounded-lg border bg-white p-5"
        >
          <div className="grid gap-1">
            <h2 id="create-task-title" className="text-xl font-semibold">
              {t('newTaskTitle')}
            </h2>
            <p className="text-sm text-slate-600">{t('manualTaskHelp')}</p>
          </div>
          <form action={createTaskAction} className="grid gap-4 md:grid-cols-2">
            {admissionHandoffReady ? (
              <input type="hidden" name="admissionCaseId" value={admission!.id} />
            ) : null}
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="task-title">{t('taskTitle')}</Label>
              <Input
                id="task-title"
                name="title"
                required
                maxLength={200}
                defaultValue={
                  admission
                    ? onboardingT('followUpTaskTitle', {
                        name: `${admission.firstName} ${admission.lastName}`,
                      })
                    : ''
                }
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="task-description">{t('taskDescription')}</Label>
              <textarea
                id="task-description"
                name="description"
                maxLength={8000}
                rows={3}
                className="rounded-md border bg-white px-3 py-2"
              />
            </div>
            <SelectField
              id="organizationId"
              name="organizationId"
              label={t('organization')}
              required
              defaultValue={admission?.organizationId ?? ''}
            >
              <option value="" disabled>
                {t('selectOrganization')}
              </option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="facilityId"
              name="facilityId"
              label={t('facility')}
              defaultValue={admission?.facilityId ?? ''}
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
              defaultValue={admission?.clientId ?? ''}
            >
              <option value="">{t('unassigned')}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.preferredName || client.firstName} {client.lastName}
                </option>
              ))}
            </SelectField>
            {canAssign ? (
              <SelectField id="assignedEmployeeId" name="assignedEmployeeId" label={t('assignee')}>
                <option value="">{t('unassigned')}</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.preferredName || employee.firstName} {employee.lastName}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <SelectField
              id="priority"
              name="priority"
              label={t('priority')}
              required
              defaultValue="normal"
            >
              <option value="low">{t('low')}</option>
              <option value="normal">{t('normal')}</option>
              <option value="high">{t('high')}</option>
              <option value="urgent">{t('urgent')}</option>
            </SelectField>
            <div className="grid gap-2">
              <Label htmlFor="dueAt">{t('dueDate')}</Label>
              <Input
                id="dueAt"
                name="dueAt"
                type="datetime-local"
                defaultValue={
                  admission?.nextFollowUpAt
                    ? visitDateTimeInputValue(
                        admission.nextFollowUpAt,
                        timezoneByOrganization.get(admission.organizationId) ?? 'Europe/Berlin',
                      )
                    : ''
                }
              />
              <select
                name="timezone"
                aria-label={t('timezone')}
                className="h-10 rounded-md border bg-white px-3 text-sm"
                defaultValue={
                  admission
                    ? (timezoneByOrganization.get(admission.organizationId) ?? '')
                    : (organizations[0]?.timezone ?? '')
                }
              >
                {[...new Set(organizations.map((organization) => organization.timezone))].map(
                  (timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="min-h-11">
                {t('createTask')}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="grid gap-4" aria-labelledby="task-list-title">
        <h2 id="task-list-title" className="text-xl font-semibold">
          {t('tasksTitle')}
        </h2>
        <form method="get" className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span>{t('searchTasks')}</span>
            <Input type="search" name="q" maxLength={120} defaultValue={search} />
          </label>
          <SelectField
            id="filter-organizationId"
            name="organizationId"
            label={t('organization')}
            defaultValue={organizationId ?? ''}
          >
            <option value="">{t('all')}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="filter-facilityId"
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
            id="filter-clientId"
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
            id="filter-status"
            name="status"
            label={t('status')}
            defaultValue={status ?? ''}
          >
            <option value="">{t('allTaskStatuses')}</option>
            <option value="open">{t('taskOpen')}</option>
            <option value="in_progress">{t('taskInProgress')}</option>
            <option value="completed">{t('taskCompleted')}</option>
            <option value="cancelled">{t('taskCancelled')}</option>
          </SelectField>
          <SelectField
            id="filter-priority"
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
          <SelectField id="filter-due" name="due" label={t('dueDate')} defaultValue={due ?? ''}>
            <option value="">{t('all')}</option>
            <option value="overdue">{t('overdue')}</option>
            <option value="today">{t('dueToday')}</option>
            <option value="upcoming">{t('upcoming')}</option>
          </SelectField>
          <SelectField id="filter-order" name="order" label={t('sortBy')} defaultValue={order}>
            <option value="due">{t('sortDue')}</option>
            <option value="created">{t('sortCreated')}</option>
          </SelectField>
          {canAssign ? (
            <SelectField
              id="filter-assignee"
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
            <input
              type="checkbox"
              name="assignedToMe"
              value="true"
              defaultChecked={query.assignedToMe === 'true'}
            />
            {t('assignedToMe')}
          </label>
          <Button type="submit" className="min-h-11 w-fit">
            {t('filter')}
          </Button>
        </form>

        {taskResult.error ? null : tasks.length ? (
          <ul className="grid gap-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/operations/tasks/${task.id}`}
                  className="grid gap-3 rounded-lg border bg-white p-4 hover:border-blue-400 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <span className="grid gap-1">
                    <span className="font-semibold">{task.title}</span>
                    <span className="text-sm text-slate-600">
                      {t('manualTask')} ·{' '}
                      {task.priority === 'urgent'
                        ? t('urgent')
                        : task.priority === 'high'
                          ? t('high')
                          : task.priority === 'low'
                            ? t('low')
                            : t('normal')}{' '}
                      ·{' '}
                      {task.dueAt
                        ? formatDateTime(
                            task.dueAt,
                            locale,
                            timezoneByOrganization.get(task.organizationId) ?? 'Europe/Berlin',
                          )
                        : t('noDueDate')}
                    </span>
                  </span>
                  <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {taskStatusLabel(t, task.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border bg-white p-6">
            <p>{t('tasksEmpty')}</p>
          </div>
        )}

        {taskResult.data ? (
          <Pagination
            page={page}
            pageSize={25}
            total={taskResult.data.total}
            query={query}
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
  required,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  children: React.ReactNode;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      <span>{label}</span>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="h-10 rounded-md border bg-white px-3"
      >
        {children}
      </select>
    </label>
  );
}

function taskStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Operations'>>>,
  status: 'open' | 'in_progress' | 'completed' | 'cancelled',
) {
  switch (status) {
    case 'open':
      return t('taskOpen');
    case 'in_progress':
      return t('taskInProgress');
    case 'completed':
      return t('taskCompleted');
    case 'cancelled':
      return t('taskCancelled');
  }
}

function taskStatus(
  value: string | undefined,
): 'open' | 'in_progress' | 'completed' | 'cancelled' | undefined {
  return ['open', 'in_progress', 'completed', 'cancelled'].includes(value ?? '')
    ? (value as 'open' | 'in_progress' | 'completed' | 'cancelled')
    : undefined;
}

function taskPriority(value: string | undefined): 'low' | 'normal' | 'high' | 'urgent' | undefined {
  return ['low', 'normal', 'high', 'urgent'].includes(value ?? '')
    ? (value as 'low' | 'normal' | 'high' | 'urgent')
    : undefined;
}

function dueFilter(value: string | undefined): 'overdue' | 'today' | 'upcoming' | undefined {
  return ['overdue', 'today', 'upcoming'].includes(value ?? '')
    ? (value as 'overdue' | 'today' | 'upcoming')
    : undefined;
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function validPage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : 1;
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
          href={`/operations/tasks?${withPage(params, page - 1)}`}
        >
          {previousLabel}
        </Link>
      ) : (
        <span />
      )}
      {page * pageSize < total ? (
        <Link
          className="rounded-md border bg-white px-3 py-2"
          href={`/operations/tasks?${withPage(params, page + 1)}`}
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
