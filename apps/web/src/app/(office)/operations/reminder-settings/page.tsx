import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { updateReminderPolicyAction } from '@app/web/app/(office)/operations/actions';

type SearchParams = Promise<{ organizationId?: string; error?: string; updated?: string }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = ['agreements', 'employees', 'benefits', 'billing', 'onboarding'] as const;

export default async function ReminderSettingsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, translate] = await Promise.all([getTranslations('Operations'), getTranslations()]);
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.reminder_settings.manage'))
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  const organizationId =
    query.organizationId && uuidPattern.test(query.organizationId)
      ? query.organizationId
      : undefined;
  const [settingsResult, employeeResult] = await Promise.all([
    api.GET('/api/v1/operations/reminder-settings', {
      params: { query: organizationId ? { organizationId } : {}, header },
    }),
    hasPermission(permissions, 'operations.tasks.assign') &&
    hasPermission(permissions, 'employee.read')
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
  ]);
  const organizations = settingsResult.data?.organizations ?? [];
  const selected = organizations.find((item) => item.id === organizationId) ?? organizations[0];
  const employees = employeeResult.data?.items ?? [];
  const scheduler = settingsResult.data?.scheduler as
    | {
        status: string;
        lastSucceededAt: string | null;
        lastFailedAt: string | null;
        lastFailureCode: string | null;
        tasksCreated: number;
        remindersTriggered: number;
      }
    | null
    | undefined;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('title')}
          </p>
          <h1 className="text-3xl font-semibold">{t('reminderSettings')}</h1>
          <p className="max-w-3xl text-slate-700">{t('reminderSettingsDescription')}</p>
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
          {t('reminderSettingsSaved')}
        </p>
      ) : null}
      {settingsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}
      {scheduler ? (
        <section
          aria-label={t('schedulerStatus')}
          className="grid gap-1 rounded-lg border bg-white p-4 text-sm"
        >
          <strong>
            {t('schedulerStatus')}: {scheduler.status}
          </strong>
          <span>
            {t('lastSuccessfulEvaluation')}: {scheduler.lastSucceededAt ?? t('noDueDate')}
          </span>
          {scheduler.lastFailureCode ? (
            <span>
              {t('lastFailure')}: {scheduler.lastFailureCode}
              {scheduler.lastFailedAt ? ` · ${scheduler.lastFailedAt}` : ''}
            </span>
          ) : null}
          <span>
            {t('generatedTasks')}: {scheduler.tasksCreated}
          </span>
          <span>
            {t('triggeredReminders')}: {scheduler.remindersTriggered}
          </span>
        </section>
      ) : null}
      {organizations.length ? (
        <>
          {organizations.length > 1 ? (
            <nav aria-label={t('organization')} className="flex flex-wrap gap-2">
              {organizations.map((organization) => (
                <Link
                  key={organization.id}
                  className={`rounded-md border px-3 py-2 text-sm ${organization.id === selected?.id ? 'bg-blue-50 font-semibold' : 'bg-white'}`}
                  href={`/operations/reminder-settings?organizationId=${organization.id}`}
                >
                  {organization.name}
                </Link>
              ))}
            </nav>
          ) : (
            <p className="font-medium">{selected?.name}</p>
          )}
          <section className="grid gap-3">
            {selected?.policies.map((policy) => (
              <article key={policy.category} className="grid gap-3 rounded-lg border bg-white p-4">
                <h2 className="text-lg font-semibold">
                  {t(`reminderCategories.${policy.category as (typeof categories)[number]}`)}
                </h2>
                <form
                  action={updateReminderPolicyAction}
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <input type="hidden" name="organizationId" value={selected.id} />
                  <input type="hidden" name="category" value={policy.category} />
                  <input type="hidden" name="expectedVersion" value={policy.version} />
                  <label className="grid gap-1 text-sm">
                    <span>{t('leadTimes')}</span>
                    <Input
                      name="offsetsDays"
                      defaultValue={policy.offsetsDays.join(', ')}
                      aria-describedby={`offset-help-${policy.category}`}
                      required
                    />
                    <span id={`offset-help-${policy.category}`} className="text-xs text-slate-600">
                      {t('leadTimesHelp')}
                    </span>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>{t('assignee')}</span>
                    <select
                      name="assignedEmployeeId"
                      className="h-10 rounded-md border px-3"
                      defaultValue={policy.assignedEmployeeId ?? ''}
                    >
                      <option value="">{t('unassigned')}</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.preferredName ?? employee.firstName} {employee.lastName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid content-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="enabled" defaultChecked={policy.enabled} />
                      {t('enabled')}
                    </label>
                    {policy.category === 'agreements' ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="createFollowUpTask"
                          defaultChecked={policy.createFollowUpTask}
                        />
                        {t('automaticTaskCreation')}
                      </label>
                    ) : null}
                  </div>
                  <div className="flex items-end">
                    <Button type="submit">{t('save')}</Button>
                  </div>
                </form>
              </article>
            ))}
          </section>
        </>
      ) : (
        <p className="rounded-lg border bg-white p-5">{t('noReminderOrganizations')}</p>
      )}
    </div>
  );
}
