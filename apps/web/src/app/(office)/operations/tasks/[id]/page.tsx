import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { errorMessageKey } from '../../../../../i18n/errors';
import { formatDateTime } from '../../../../../i18n/format';
import { visitDateTimeInputValue } from '../../../../../lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../../../lib/api';
import { addTaskCommentAction, transitionTaskAction, updateTaskAction } from '../../actions';
import { taskSourceHref, taskStatusTranslation } from '../../ui';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OperationsTaskDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const [{ id }, query, t, translate, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('Operations'),
    getTranslations(),
    getLocale(),
  ]);
  if (!uuidPattern.test(id)) notFound();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read'))
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  const canManage = hasPermission(permissions, 'operations.tasks.manage');
  const canAssign = hasPermission(permissions, 'operations.tasks.assign');
  const taskResult = await api.GET('/api/v1/operations/tasks/{id}', {
    params: { path: { id }, header },
  });
  if (taskResult.error || !taskResult.data) {
    return (
      <div className="grid gap-4">
        <Link className="text-sm text-blue-800 underline" href="/operations/tasks">
          {t('tasksTitle')}
        </Link>
        <p role="alert" className="rounded-md border bg-white p-5">
          {translate(errorMessageKey(taskResult.error?.code ?? 'OPERATIONS_TASK_NOT_FOUND'))}
        </p>
      </div>
    );
  }
  const task = taskResult.data;
  const [activityResult, organizationResult, employeeResult, clientResult] = await Promise.all([
    api.GET('/api/v1/operations/tasks/{id}/activity', { params: { path: { id }, header } }),
    api.GET('/api/v1/organizations/{id}', {
      params: { path: { id: task.organizationId }, header },
    }),
    canAssign
      ? api.GET('/api/v1/employees', {
          params: {
            query: {
              status: 'active',
              organizationId: task.organizationId,
              ...(task.facilityId ? { facilityId: task.facilityId } : {}),
              page: 1,
              pageSize: 100,
              sortBy: 'lastName',
              sortOrder: 'asc',
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    task.clientId && hasPermission(permissions, 'client.read')
      ? api.GET('/api/v1/clients/{id}', { params: { path: { id: task.clientId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const timezone = organizationResult.data?.timezone ?? 'Europe/Berlin';
  const employees = employeeResult.data?.items ?? [];
  const employeeName = new Map(
    employees.map((employee) => [
      employee.id,
      `${employee.preferredName || employee.firstName} ${employee.lastName}`,
    ]),
  );
  const sourceHref = taskSourceHref(task);
  const terminal = task.status === 'completed' || task.status === 'cancelled';

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/operations/tasks">{t('tasksTitle')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{task.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t(taskStatusTranslation(task.status))}
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1">{t(task.priority)}</span>
          {task.dueAt ? (
            <span className="text-slate-600">
              {t('dueDate')}: {formatDateTime(task.dueAt, locale, timezone)}
            </span>
          ) : (
            <span className="text-slate-600">{t('noDueDate')}</span>
          )}
        </div>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('taskUpdated')}
        </p>
      ) : null}
      {sourceHref ? (
        <Link
          className="w-fit rounded-md border bg-white px-4 py-2 text-sm font-medium text-blue-900 underline"
          href={sourceHref}
        >
          {t('openSource')}
        </Link>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <section
          aria-labelledby="task-edit-heading"
          className="grid content-start gap-4 rounded-lg border bg-white p-5"
        >
          <h2 id="task-edit-heading" className="text-xl font-semibold">
            {t('taskDetails')}
          </h2>
          {task.description ? (
            <p className="whitespace-pre-wrap text-slate-700">{task.description}</p>
          ) : null}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-600">{t('organization')}</dt>
              <dd>{organizationResult.data?.name ?? task.organizationId}</dd>
            </div>
            <div>
              <dt className="text-slate-600">{t('facility')}</dt>
              <dd>{task.facilityId ?? t('all')}</dd>
            </div>
            <div>
              <dt className="text-slate-600">{t('client')}</dt>
              <dd>
                {clientResult.data ? (
                  <Link
                    className="text-blue-900 underline"
                    href={`/clients/${clientResult.data.id}`}
                  >
                    {clientResult.data.preferredName || clientResult.data.firstName}{' '}
                    {clientResult.data.lastName}
                  </Link>
                ) : task.clientId ? (
                  t('restrictedClient')
                ) : (
                  t('noClient')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">{t('assignee')}</dt>
              <dd>
                {task.assignedEmployeeId
                  ? (employeeName.get(task.assignedEmployeeId) ?? t('assigned'))
                  : t('unassigned')}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">{t('createdAt')}</dt>
              <dd>{formatDateTime(task.createdAt, locale, timezone)}</dd>
            </div>
            <div>
              <dt className="text-slate-600">{t('updatedAt')}</dt>
              <dd>{formatDateTime(task.updatedAt, locale, timezone)}</dd>
            </div>
          </dl>

          {canManage && !terminal ? (
            <form action={updateTaskAction} className="grid gap-4 border-t pt-4">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="expectedVersion" value={task.version} />
              <input type="hidden" name="timezone" value={timezone} />
              <div className="grid gap-2">
                <Label htmlFor="title">{t('taskTitle')}</Label>
                <Input id="title" name="title" required maxLength={200} defaultValue={task.title} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">{t('taskDescription')}</Label>
                <textarea
                  id="description"
                  name="description"
                  maxLength={8000}
                  rows={4}
                  defaultValue={task.description ?? ''}
                  className="rounded-md border bg-white px-3 py-2"
                />
              </div>
              <SelectField
                id="priority"
                name="priority"
                label={t('priority')}
                defaultValue={task.priority}
              >
                <option value="low">{t('low')}</option>
                <option value="normal">{t('normal')}</option>
                <option value="high">{t('high')}</option>
                <option value="urgent">{t('urgent')}</option>
              </SelectField>
              {canAssign ? (
                <SelectField
                  id="assignedEmployeeId"
                  name="assignedEmployeeId"
                  label={t('assignee')}
                  defaultValue={task.assignedEmployeeId ?? ''}
                >
                  <option value="">{t('unassigned')}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.preferredName || employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="dueAt">{t('dueDate')}</Label>
                <Input
                  id="dueAt"
                  name="dueAt"
                  type="datetime-local"
                  defaultValue={task.dueAt ? visitDateTimeInputValue(task.dueAt, timezone) : ''}
                />
              </div>
              <Button type="submit" className="w-fit">
                {t('save')}
              </Button>
            </form>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {task.status === 'open' ? (
                <TransitionButton
                  id={task.id}
                  version={task.version}
                  action="start"
                  label={t('start')}
                />
              ) : null}
              {task.status === 'open' || task.status === 'in_progress' ? (
                <TransitionButton
                  id={task.id}
                  version={task.version}
                  action="complete"
                  label={t('complete')}
                />
              ) : null}
              {task.status === 'open' || task.status === 'in_progress' ? (
                <TransitionButton
                  id={task.id}
                  version={task.version}
                  action="cancel"
                  label={t('cancel')}
                />
              ) : null}
              {task.status === 'completed' ? (
                <TransitionButton
                  id={task.id}
                  version={task.version}
                  action="reopen"
                  label={t('reopen')}
                />
              ) : null}
            </div>
          ) : null}
        </section>

        <section
          id="activity"
          aria-labelledby="activity-heading"
          className="grid content-start gap-4 rounded-lg border bg-white p-5"
        >
          <h2 id="activity-heading" className="text-xl font-semibold">
            {t('activity')}
          </h2>
          {activityResult.error ? (
            <p role="alert" className="text-sm text-red-800">
              {t('loadFailed')}
            </p>
          ) : null}
          {activityResult.data?.length ? (
            <ol className="grid gap-3">
              {activityResult.data.map((entry) => (
                <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="font-medium">{entry.comment ?? activityLabel(t, entry.kind)}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {formatDateTime(entry.occurredAt, locale, timezone)} ·{' '}
                    {t('activityBy', { userId: entry.actorUserId })}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-600">{t('noActivity')}</p>
          )}
          {canManage ? (
            <form action={addTaskCommentAction} className="grid gap-2 border-t pt-4">
              <input type="hidden" name="taskId" value={task.id} />
              <Label htmlFor="comment">{t('comment')}</Label>
              <textarea
                id="comment"
                name="comment"
                required
                maxLength={4000}
                rows={3}
                className="rounded-md border bg-white px-3 py-2"
              />
              <Button type="submit" variant="secondary" className="w-fit">
                {t('addComment')}
              </Button>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function TransitionButton({
  id,
  version,
  action,
  label,
}: {
  id: string;
  version: number;
  action: 'start' | 'complete' | 'reopen' | 'cancel';
  label: string;
}) {
  return (
    <form action={transitionTaskAction}>
      <input type="hidden" name="taskId" value={id} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" size="sm" variant={action === 'cancel' ? 'secondary' : 'default'}>
        {label}
      </Button>
    </form>
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
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="h-10 rounded-md border bg-white px-3"
      >
        {children}
      </select>
    </label>
  );
}

function activityLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Operations'>>>,
  kind: string,
): string {
  switch (kind) {
    case 'created':
      return t('createdActivity');
    case 'edited':
      return t('editedActivity');
    case 'assigned':
      return t('assignedActivity');
    case 'priority_changed':
      return t('priorityChanged');
    case 'due_date_changed':
      return t('dueDateChanged');
    case 'status_changed':
      return t('statusChanged');
    default:
      return t('commentAdded');
  }
}
