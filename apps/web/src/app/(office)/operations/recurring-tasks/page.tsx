import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import { todayDateKey } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import {
  createRecurringTaskAction,
  transitionRecurringTaskAction,
  updateRecurringTaskAction,
} from '@app/web/app/(office)/operations/actions';

type SearchParams = Promise<Record<string, string | undefined>>;
const weekdayNumbers = [1, 2, 3, 4, 5, 6, 7] as const;

export default async function RecurringTasksPage({
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
  if (!hasPermission(permissions, 'operations.read'))
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  const canManage = hasPermission(permissions, 'operations.recurring_tasks.manage');
  const canCreate = canManage && hasPermission(permissions, 'operations.tasks.create');
  const canAssign =
    hasPermission(permissions, 'operations.tasks.assign') &&
    hasPermission(permissions, 'employee.read');
  const [taskResult, organizationResult, facilityResult, employeeResult, clientResult] =
    await Promise.all([
      api.GET('/api/v1/operations/recurring-tasks', {
        params: { query: { page: 1, pageSize: 100 }, header },
      }),
      api.GET('/api/v1/organizations', { params: { header } }),
      api.GET('/api/v1/facilities', { params: { header } }),
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
      hasPermission(permissions, 'client.read')
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
  const recurrences = taskResult.data?.items ?? [];
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const employees = employeeResult.data?.items ?? [];
  const clients = clientResult.data?.items ?? [];
  const timezoneByOrganization = new Map(organizations.map((org) => [org.id, org.timezone]));
  const today = todayDateKey();

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('title')}
          </p>
          <h1 className="text-3xl font-semibold">{t('recurringTasks')}</h1>
          <p className="max-w-3xl text-slate-700">{t('recurringTasksDescription')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/operations">{t('dashboardTitle')}</Link>
        </Button>
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
          {query.updated === 'created' ? t('recurrenceCreated') : t('recurrenceUpdated')}
        </p>
      ) : null}
      {taskResult.error || organizationResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}

      {canCreate ? (
        <section
          className="grid gap-4 rounded-lg border bg-white p-5"
          aria-labelledby="recurring-create-title"
        >
          <h2 id="recurring-create-title" className="text-xl font-semibold">
            {t('newRecurringTask')}
          </h2>
          <form action={createRecurringTaskAction} className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="recurring-title">{t('taskTitle')}</Label>
              <Input id="recurring-title" name="title" required maxLength={200} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recurring-organization">{t('organization')}</Label>
              <select
                id="recurring-organization"
                name="organizationId"
                className="h-10 rounded-md border px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {t('selectOrganization')}
                </option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recurring-facility">{t('facility')}</Label>
              <select
                id="recurring-facility"
                name="facilityId"
                className="h-10 rounded-md border px-3"
                defaultValue=""
              >
                <option value="">{t('all')}</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
            </div>
            {hasPermission(permissions, 'client.read') ? (
              <div className="grid gap-2">
                <Label htmlFor="recurring-client">{t('client')}</Label>
                <select
                  id="recurring-client"
                  name="clientId"
                  className="h-10 rounded-md border px-3"
                  defaultValue=""
                >
                  <option value="">{t('all')}</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.preferredName ?? client.firstName} {client.lastName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="recurring-priority">{t('priority')}</Label>
              <select
                id="recurring-priority"
                name="priority"
                className="h-10 rounded-md border px-3"
                defaultValue="normal"
              >
                {(['low', 'normal', 'high', 'urgent'] as const).map((priority) => (
                  <option key={priority} value={priority}>
                    {t(priority)}
                  </option>
                ))}
              </select>
            </div>
            {canAssign ? (
              <div className="grid gap-2">
                <Label htmlFor="recurring-assignee">{t('assignee')}</Label>
                <select
                  id="recurring-assignee"
                  name="assignedEmployeeId"
                  className="h-10 rounded-md border px-3"
                  defaultValue=""
                >
                  <option value="">{t('unassigned')}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.preferredName ?? employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="recurring-description">{t('taskDescription')}</Label>
              <textarea
                id="recurring-description"
                name="description"
                maxLength={8000}
                className="min-h-20 rounded-md border px-3 py-2"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="frequency">{t('recurrenceFrequency')}</Label>
              <select
                id="frequency"
                name="frequency"
                className="h-10 rounded-md border px-3"
                defaultValue="weekly"
              >
                <option value="daily">{t('daily')}</option>
                <option value="weekly">{t('weekly')}</option>
                <option value="monthly">{t('monthly')}</option>
                <option value="yearly">{t('yearly')}</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="interval">{t('interval')}</Label>
              <div className="flex gap-2">
                <Input
                  id="interval"
                  name="interval"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={1}
                  required
                />
                <span className="self-center text-sm text-slate-600">{t('intervalUnit')}</span>
              </div>
            </div>
            <fieldset className="grid gap-2 md:col-span-2">
              <legend className="text-sm font-medium">{t('weekdays')}</legend>
              <div className="flex flex-wrap gap-3">
                {weekdayNumbers.map((day) => (
                  <label key={day} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="weekdays" value={day} defaultChecked={day <= 5} />
                    {t(`weekdayNames.${day}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-2">
              <Label htmlFor="dayOfMonth">{t('dayOfMonth')}</Label>
              <Input
                id="dayOfMonth"
                name="dayOfMonth"
                type="number"
                min={1}
                max={31}
                defaultValue={Number(today.slice(8, 10))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="month">{t('month')}</Label>
              <select
                id="month"
                name="month"
                className="h-10 rounded-md border px-3"
                defaultValue={Number(today.slice(5, 7))}
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="startDate">{t('startDate')}</Label>
              <Input id="startDate" name="startDate" type="date" defaultValue={today} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endDate">{t('endDate')}</Label>
              <Input id="endDate" name="endDate" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timeOfDay">{t('timeOfDay')}</Label>
              <Input id="timeOfDay" name="timeOfDay" type="time" defaultValue="09:00" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="generationPolicy">{t('generationPolicy')}</Label>
              <select
                id="generationPolicy"
                name="generationPolicy"
                className="h-10 rounded-md border px-3"
                defaultValue="generate_missed"
              >
                <option value="generate_missed">{t('generateMissed')}</option>
                <option value="skip_missed">{t('skipMissed')}</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">{t('newRecurringTask')}</Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="recurring-list-title">
        <h2 id="recurring-list-title" className="text-xl font-semibold">
          {t('recurrenceDefinitions')}
        </h2>
        {recurrences.length ? (
          <ul className="grid gap-3">
            {recurrences.map((item) => (
              <li key={item.id} className="grid gap-3 rounded-lg border bg-white p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="grid gap-1">
                    <Link
                      className="font-semibold text-blue-900 underline"
                      href={`/operations/recurring-tasks/${item.id}`}
                    >
                      {item.title}
                    </Link>
                    <span className="text-sm text-slate-600">
                      {t(
                        item.status === 'active'
                          ? 'recurrenceActive'
                          : item.status === 'paused'
                            ? 'recurrencePaused'
                            : 'recurrenceEnded',
                      )}{' '}
                      · {t(item.rule.frequency as 'daily' | 'weekly' | 'monthly' | 'yearly')} ·{' '}
                      {Number(item.rule.interval)} · {t('nextOccurrence')}:{' '}
                      {item.nextOccurrenceAt
                        ? formatDateTime(
                            item.nextOccurrenceAt,
                            locale as 'en' | 'de',
                            timezoneByOrganization.get(item.organizationId) ?? item.timezone,
                          )
                        : t('noDueDate')}
                    </span>
                  </div>
                  {canManage && item.status !== 'ended' ? (
                    <div className="flex flex-wrap gap-2">
                      {item.status === 'active' ? (
                        <RecurrenceTransition
                          item={item}
                          action="pause"
                          label={t('pauseRecurrence')}
                        />
                      ) : (
                        <RecurrenceTransition
                          item={item}
                          action="resume"
                          label={t('resumeRecurrence')}
                        />
                      )}
                      <RecurrenceTransition item={item} action="end" label={t('endRecurrence')} />
                    </div>
                  ) : null}
                </div>
                {canManage && item.status !== 'ended' ? (
                  <form
                    action={updateRecurringTaskAction}
                    className="flex flex-wrap items-end gap-2 border-t pt-3"
                  >
                    <input type="hidden" name="recurrenceId" value={item.id} />
                    <input type="hidden" name="expectedVersion" value={item.version} />
                    <label className="grid gap-1 text-sm">
                      <span>{t('taskTitle')}</span>
                      <Input name="title" defaultValue={item.title} maxLength={200} required />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>{t('priority')}</span>
                      <select
                        name="priority"
                        className="h-10 rounded-md border px-3"
                        defaultValue={item.priority}
                      >
                        {(['low', 'normal', 'high', 'urgent'] as const).map((priority) => (
                          <option key={priority} value={priority}>
                            {t(priority)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button size="sm" variant="secondary">
                      {t('save')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-white p-5">{t('recurrencesEmpty')}</p>
        )}
      </section>
    </div>
  );
}

function RecurrenceTransition({
  item,
  action,
  label,
}: {
  item: { id: string; version: number };
  action: 'pause' | 'resume' | 'end';
  label: string;
}) {
  return (
    <form action={transitionRecurringTaskAction}>
      <input type="hidden" name="recurrenceId" value={item.id} />
      <input type="hidden" name="expectedVersion" value={item.version} />
      <input type="hidden" name="action" value={action} />
      <Button size="sm" variant="secondary">
        {label}
      </Button>
    </form>
  );
}
