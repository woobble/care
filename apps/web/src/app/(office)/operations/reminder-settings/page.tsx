import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { updateReminderPolicyAction } from '@app/web/app/(office)/operations/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ClearableSuccessNotice, RHFActionForm } from '@app/web/components/rhf-action-form';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { getEmployeesByIds } from '@app/web/lib/employee-lookup';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { Input } from '@care/ui/components/input';

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
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  const organizationId =
    query.organizationId && uuidPattern.test(query.organizationId)
      ? query.organizationId
      : undefined;
  const settingsResult = organizationId
    ? await api.GET('/api/v1/operations/reminder-settings', {
        params: { query: organizationId ? { organizationId } : {}, header },
      })
    : null;
  const settingsData = settingsResult?.data as
    | components['schemas']['ReminderSettingsResponseDto']
    | undefined;
  const selected = settingsData?.organizations[0];
  const employeeIds = hasPermission(permissions, 'employee.read')
    ? [
        ...new Set(
          selected?.policies.flatMap((policy) =>
            policy.assignedEmployeeId ? [policy.assignedEmployeeId] : [],
          ) ?? [],
        ),
      ]
    : [];
  const employeeLookup = await getEmployeesByIds(employeeIds);
  const employeeLabels = new Map(
    employeeLookup.items.map(
      (employee) =>
        [
          employee.id,
          `${employee.preferredName || employee.firstName} ${employee.lastName}`,
        ] as const,
    ),
  );
  const scheduler = settingsData?.scheduler as
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
      <PageHeader
        eyebrow={t('title')}
        title={t('reminderSettings')}
        description={t('reminderSettingsDescription')}
        actions={
          <Button asChild variant="secondary">
            <Link
              href={
                hasPermission(permissions, 'operations.read') ? '/operations' : '/administration'
              }
            >
              {hasPermission(permissions, 'operations.read')
                ? t('dashboardTitle')
                : translate('Navigation.administration')}
            </Link>
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
      {query.updated ? (
        <ClearableSuccessNotice>
          <p
            role="status"
            className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
          >
            {t('reminderSettingsSaved')}
          </p>
        </ClearableSuccessNotice>
      ) : null}
      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(16rem,1fr)_auto] sm:items-end"
      >
        <AsyncEntityCombobox
          name="organizationId"
          entity="organizations"
          label={t('organization')}
          initialOption={selected ? { id: selected.id, label: selected.name } : undefined}
        />
        <Button type="submit" variant="secondary">
          {t('openReminderSettings')}
        </Button>
      </form>
      {settingsResult?.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}
      {scheduler ? (
        <section
          aria-label={t('schedulerStatus')}
          className="grid gap-1 rounded-lg border bg-card p-4 text-sm"
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
      {selected ? (
        <>
          <p className="font-medium">{selected.name}</p>
          <section className="grid gap-3">
            {selected?.policies.map((policy) => (
              <article key={policy.category} className="grid gap-3 rounded-lg border bg-card p-4">
                <h2 className="text-lg font-semibold">
                  {t(`reminderCategories.${policy.category as (typeof categories)[number]}`)}
                </h2>
                <RHFActionForm
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
                    <span
                      id={`offset-help-${policy.category}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('leadTimesHelp')}
                    </span>
                  </label>
                  {hasPermission(permissions, 'operations.tasks.assign') ? (
                    <AsyncEntityCombobox
                      name="assignedEmployeeId"
                      entity="employees"
                      label={t('assignee')}
                      placeholder={t('unassigned')}
                      organizationId={selected.id}
                      initialOption={
                        policy.assignedEmployeeId
                          ? {
                              id: policy.assignedEmployeeId,
                              label: employeeLabels.get(policy.assignedEmployeeId) ?? t('assigned'),
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <p className="text-sm">
                      {t('assignee')}:{' '}
                      {policy.assignedEmployeeId
                        ? (employeeLabels.get(policy.assignedEmployeeId) ?? t('assigned'))
                        : t('unassigned')}
                    </p>
                  )}
                  <div className="grid content-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <ShadcnCheckbox name="enabled" defaultChecked={policy.enabled} />
                      {t('enabled')}
                    </label>
                    {policy.category === 'agreements' ? (
                      <label className="flex items-center gap-2 text-sm">
                        <ShadcnCheckbox
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
                </RHFActionForm>
              </article>
            ))}
          </section>
        </>
      ) : !query.organizationId && !settingsResult?.error ? (
        <EmptyState title={t('chooseReminderOrganization')} />
      ) : query.organizationId && !organizationId ? (
        <p role="alert" className="rounded-md border bg-card p-4 text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : null}
    </div>
  );
}
