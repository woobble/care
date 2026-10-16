import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  addTaskCommentAction,
  transitionTaskAction,
  updateTaskAction,
} from '@app/web/app/(office)/operations/actions';
import { taskSourceHref, taskStatusTranslation } from '@app/web/app/(office)/operations/ui';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { visitDateTimeInputValue } from '@app/web/lib/care-date';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { Textarea } from '@care/ui/components/textarea';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidInDisplayNamePattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function displayNameWithoutIdentifiers(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && !uuidInDisplayNamePattern.test(normalized) ? normalized : null;
}

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
      <p role="alert" className="rounded-md border bg-card p-5">
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
        <Link className="text-sm text-primary underline" href="/operations/tasks">
          {t('tasksTitle')}
        </Link>
        <p role="alert" className="rounded-md border bg-card p-5">
          {translate(
            errorMessageKey(
              (taskResult.error as { code?: string } | undefined)?.code ??
                'OPERATIONS_TASK_NOT_FOUND',
            ),
          )}
        </p>
      </div>
    );
  }
  const task = taskResult.data as components['schemas']['OperationsTaskResponseDto'];
  const [activityResult, organizationResult, facilityResult, employeeResult, clientResult] =
    await Promise.all([
      api.GET('/api/v1/operations/tasks/{id}/activity', { params: { path: { id }, header } }),
      api.GET('/api/v1/organizations/{id}', {
        params: { path: { id: task.organizationId }, header },
      }),
      task.facilityId && hasPermission(permissions, 'facility.read')
        ? api.GET('/api/v1/facilities/{id}', {
            params: { path: { id: task.facilityId }, header },
          })
        : Promise.resolve({ data: undefined, error: undefined }),
      task.assignedEmployeeId && hasPermission(permissions, 'employee.read')
        ? api.GET('/api/v1/employees/{id}', {
            params: { path: { id: task.assignedEmployeeId }, header },
          })
        : Promise.resolve({ data: undefined, error: undefined }),
      task.clientId && hasPermission(permissions, 'client.read')
        ? api.GET('/api/v1/clients/{id}', { params: { path: { id: task.clientId }, header } })
        : Promise.resolve({ data: undefined, error: undefined }),
    ]);
  const organization = organizationResult.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const facility = facilityResult.data as components['schemas']['FacilityResponseDto'] | undefined;
  const client = clientResult.data as components['schemas']['ClientResponseDto'] | undefined;
  const activity = activityResult.data as
    | components['schemas']['OperationsTaskActivityResponseDto'][]
    | undefined;
  const timezone = organization?.timezone ?? 'Europe/Berlin';
  const assignedEmployee = employeeResult.data as
    | components['schemas']['EmployeeDetailResponseDto']
    | undefined;
  const assignedEmployeeName = assignedEmployee
    ? displayNameWithoutIdentifiers(
        `${assignedEmployee.preferredName || assignedEmployee.firstName} ${assignedEmployee.lastName}`,
      )
    : null;
  const clientName = client
    ? displayNameWithoutIdentifiers(
        `${client.preferredName || client.firstName} ${client.lastName}`,
      )
    : null;
  const assignedEmployeeOption = task.assignedEmployeeId
    ? {
        id: task.assignedEmployeeId,
        label: assignedEmployeeName ?? translate('Resources.unavailableEmployee'),
      }
    : undefined;
  const sourceHref = taskSourceHref(task);
  const terminal = task.status === 'completed' || task.status === 'cancelled';

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={<Link href="/operations/tasks">{t('tasksTitle')}</Link>}
        title={task.title}
        meta={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-muted px-3 py-1">
              {t(taskStatusTranslation(task.status))}
            </span>
            <span className="rounded-full bg-accent px-3 py-1">{t(task.priority)}</span>
            <span className="text-muted-foreground">
              {task.dueAt
                ? `${t('dueDate')}: ${formatDateTime(task.dueAt, locale, timezone)}`
                : t('noDueDate')}
            </span>
          </div>
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
          {t('taskUpdated')}
        </p>
      ) : null}
      {task.assignmentWarningCode === 'assignee_unavailable' && !task.assignedEmployeeId ? (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning-muted p-3 text-warning-foreground"
        >
          {t('assigneeUnavailableWarning')}
        </p>
      ) : null}
      {sourceHref ? (
        <Link
          className="w-fit rounded-md border bg-card px-4 py-2 text-sm font-medium text-primary underline"
          href={sourceHref}
        >
          {t('openSource')}
        </Link>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <section
          aria-labelledby="task-edit-heading"
          className="grid content-start gap-4 rounded-lg border bg-card p-5"
        >
          <h2 id="task-edit-heading" className="text-xl font-semibold">
            {t('taskDetails')}
          </h2>
          {task.description ? (
            <p className="whitespace-pre-wrap text-muted-foreground">{task.description}</p>
          ) : null}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('organization')}</dt>
              <dd>
                <ResourceReference
                  label={
                    displayNameWithoutIdentifiers(organization?.name) ??
                    translate('Resources.unavailableOrganization')
                  }
                  href={
                    organization ? `/administration/organizations/${task.organizationId}` : null
                  }
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('facility')}</dt>
              <dd>
                {task.facilityId ? (
                  <ResourceReference
                    label={
                      displayNameWithoutIdentifiers(facility?.name) ??
                      translate('Resources.unavailableFacility')
                    }
                    href={facility ? `/administration/facilities/${task.facilityId}` : null}
                  />
                ) : (
                  t('all')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('client')}</dt>
              <dd>
                {client && clientName ? (
                  <Link className="text-primary underline" href={`/clients/${client.id}`}>
                    {clientName}
                  </Link>
                ) : client ? (
                  translate('Resources.unavailableClient')
                ) : task.clientId ? (
                  t('restrictedClient')
                ) : (
                  t('noClient')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('assignee')}</dt>
              <dd>
                {task.assignedEmployeeId
                  ? (assignedEmployeeOption?.label ?? t('assigned'))
                  : t('unassigned')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('createdAt')}</dt>
              <dd>{formatDateTime(task.createdAt, locale, timezone)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('updatedAt')}</dt>
              <dd>{formatDateTime(task.updatedAt, locale, timezone)}</dd>
            </div>
          </dl>

          {canManage && !terminal ? (
            <RHFActionForm action={updateTaskAction} className="grid gap-4 border-t pt-4">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="expectedVersion" value={task.version} />
              <input type="hidden" name="timezone" value={timezone} />
              <div className="grid gap-2">
                <Label htmlFor="title">{t('taskTitle')}</Label>
                <Input id="title" name="title" required maxLength={200} defaultValue={task.title} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">{t('taskDescription')}</Label>
                <Textarea
                  id="description"
                  name="description"
                  maxLength={8000}
                  rows={4}
                  defaultValue={task.description ?? ''}
                  className="rounded-md border bg-card px-3 py-2"
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
                <AsyncEntityCombobox
                  name="assignedEmployeeId"
                  entity="employees"
                  label={t('assignee')}
                  placeholder={t('unassigned')}
                  organizationId={task.organizationId}
                  facilityId={task.facilityId ?? undefined}
                  initialOption={assignedEmployeeOption}
                />
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
            </RHFActionForm>
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
          className="grid content-start gap-4 rounded-lg border bg-card p-5"
        >
          <h2 id="activity-heading" className="text-xl font-semibold">
            {t('activity')}
          </h2>
          {activityResult.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t('loadFailed')}
            </p>
          ) : null}
          {activity?.length ? (
            <ol className="grid gap-3">
              {activity.map((entry) => (
                <li key={entry.id} className="border-l-2 border-border pl-3">
                  <p className="font-medium">{entry.comment ?? activityLabel(t, entry.kind)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(entry.occurredAt, locale, timezone)} ·{' '}
                    {t('activityBy', {
                      name: entry.actorName ?? translate('Resources.unavailableUser'),
                    })}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noActivity')}</p>
          )}
          {canManage ? (
            <RHFActionForm action={addTaskCommentAction} className="grid gap-2 border-t pt-4">
              <input type="hidden" name="taskId" value={task.id} />
              <Label htmlFor="comment">{t('comment')}</Label>
              <Textarea
                id="comment"
                name="comment"
                required
                maxLength={4000}
                rows={3}
                className="rounded-md border bg-card px-3 py-2"
              />
              <Button type="submit" variant="secondary" className="w-fit">
                {t('addComment')}
              </Button>
            </RHFActionForm>
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
