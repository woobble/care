import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
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
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import type { components } from '@care/api-client';

type SearchParams = Promise<{
  page?: string;
  pageSize?: string;
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
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }

  const canCreate = hasPermission(permissions, 'operations.tasks.create');
  const canAssign = hasPermission(permissions, 'operations.tasks.assign');
  const canReadClients = hasPermission(permissions, 'client.read');
  const canReadEmployees = hasPermission(permissions, 'employee.read');
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
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
  const requestedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;
  const [taskResult, facilityResult, filterClientResult, filterEmployeeResult] = await Promise.all([
    api.GET('/api/v1/operations/tasks', {
      params: {
        query: {
          page,
          pageSize,
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
    facilityId && canReadFacilities
      ? api.GET('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    clientId && canReadClients
      ? api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    assignedEmployeeId && canReadEmployees
      ? api.GET('/api/v1/employees/{id}', {
          params: { path: { id: assignedEmployeeId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const taskData = taskResult.data as unknown as
    | components['schemas']['OperationsTaskListResponseDto']
    | undefined;
  if (taskData)
    redirectToValidPage(
      '/operations/tasks',
      query,
      taskData.page,
      taskData.pageSize,
      taskData.total,
    );
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
    admissionHandoffReady && admission?.clientId && canReadClients
      ? await api.GET('/api/v1/clients/{id}', {
          params: { path: { id: admission.clientId }, header },
        })
      : null;
  const tasks = taskData?.items ?? [];
  const organizationLookup = canReadOrganizations
    ? await getOrganizationsByIds([
        ...(organizationId ? [organizationId] : []),
        ...(admission?.organizationId ? [admission.organizationId] : []),
        ...tasks.map((task) => task.organizationId),
      ])
    : { items: [], failed: false };
  const organizations = organizationLookup.items;
  const facilityIds = [
    ...new Set([facilityId, admission?.facilityId ?? undefined].filter((id): id is string => !!id)),
  ];
  const facilityLookups = canReadFacilities
    ? await Promise.all(
        facilityIds
          .filter((id) => id !== facilityId || !facilityResult.data)
          .map((id) => api.GET('/api/v1/facilities/{id}', { params: { path: { id }, header } })),
      )
    : [];
  const facilities = [
    ...(facilityResult.data
      ? [facilityResult.data as unknown as components['schemas']['FacilityResponseDto']]
      : []),
    ...facilityLookups.flatMap((result) =>
      result.data ? [result.data as unknown as components['schemas']['FacilityResponseDto']] : [],
    ),
  ];
  const admissionClient = admissionClientResult?.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const filterClient = filterClientResult.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const filterEmployee = filterEmployeeResult.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;
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
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated === 'created' ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('taskCreated')}
        </p>
      ) : null}
      {taskResult.error ||
      facilityResult.error ||
      facilityLookups.some((result) => result.error) ||
      organizationLookup.failed ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}

      {admissionHandoffRequested && !admissionHandoffReady ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {onboardingT('taskContextUnavailable')}
        </p>
      ) : null}

      {canCreate &&
      canReadOrganizations &&
      (!admissionHandoffRequested || admissionHandoffReady) ? (
        <section
          aria-labelledby="create-task-title"
          className="grid gap-4 rounded-lg border bg-card p-5"
        >
          <div className="grid gap-1">
            <h2 id="create-task-title" className="text-xl font-semibold">
              {t('newTaskTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('manualTaskHelp')}</p>
          </div>
          <RHFActionForm action={createTaskAction} className="grid gap-4 md:grid-cols-2">
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
              <Textarea
                id="task-description"
                name="description"
                maxLength={8000}
                rows={3}
                className="rounded-md border bg-card px-3 py-2"
              />
            </div>
            <AsyncEntityCombobox
              name="organizationId"
              label={t('organization')}
              entity="organizations"
              required
              placeholder={t('selectOrganization')}
              timezoneFieldName="timezone"
              {...(admission && organizations.find((item) => item.id === admission.organizationId)
                ? {
                    initialOption: {
                      id: admission.organizationId,
                      label: organizations.find((item) => item.id === admission.organizationId)!
                        .name,
                      timezone: organizations.find((item) => item.id === admission.organizationId)!
                        .timezone,
                    },
                  }
                : {})}
            />
            <AsyncEntityCombobox
              name="facilityId"
              label={t('facility')}
              entity="facilities"
              {...(admission?.organizationId ? { organizationId: admission.organizationId } : {})}
              placeholder={t('all')}
              {...(admission?.facilityId
                ? {
                    initialOption: {
                      id: admission.facilityId,
                      label:
                        facilities.find((item) => item.id === admission.facilityId)?.name ??
                        t('all'),
                    },
                  }
                : {})}
            />
            {canReadClients ? (
              <AsyncEntityCombobox
                name="clientId"
                label={t('client')}
                entity="clients"
                {...(admissionClient
                  ? {
                      initialOption: {
                        id: admissionClient.id,
                        label: `${admissionClient.preferredName || admissionClient.firstName} ${admissionClient.lastName}`,
                      },
                    }
                  : {})}
                placeholder={t('unassigned')}
              />
            ) : null}
            {canAssign && canReadEmployees ? (
              <AsyncEntityCombobox
                name="assignedEmployeeId"
                label={t('assignee')}
                entity="employees"
                placeholder={t('unassigned')}
              />
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
            </div>
            <div className="flex items-end">
              <Button type="submit" className="min-h-11">
                {t('createTask')}
              </Button>
            </div>
          </RHFActionForm>
        </section>
      ) : null}

      <section className="grid gap-4" aria-labelledby="task-list-title">
        <h2 id="task-list-title" className="text-xl font-semibold">
          {t('tasksTitle')}
        </h2>
        <form method="get" className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-4">
          <input type="hidden" name="pageSize" value={pageSize} />
          <label className="grid gap-1 text-sm">
            <span>{t('searchTasks')}</span>
            <Input type="search" name="q" maxLength={120} defaultValue={search} />
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
              {...(facilityId
                ? {
                    initialOption: {
                      id: facilityId,
                      label: facilities.find((item) => item.id === facilityId)?.name ?? t('all'),
                    },
                  }
                : {})}
            />
          ) : null}
          {canReadClients ? (
            <AsyncEntityCombobox
              name="clientId"
              label={t('client')}
              entity="clients"
              {...(filterClient
                ? {
                    initialOption: {
                      id: filterClient.id,
                      label: `${filterClient.preferredName || filterClient.firstName} ${filterClient.lastName}`,
                    },
                  }
                : {})}
              placeholder={t('all')}
            />
          ) : null}
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
          {canAssign && canReadEmployees ? (
            <AsyncEntityCombobox
              name="assignedEmployeeId"
              label={t('assignee')}
              entity="employees"
              {...(filterEmployee
                ? {
                    initialOption: {
                      id: filterEmployee.id,
                      label: `${filterEmployee.preferredName || filterEmployee.firstName} ${filterEmployee.lastName}`,
                    },
                  }
                : {})}
              placeholder={t('allEmployees')}
            />
          ) : null}
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <ShadcnCheckbox
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
                  className="grid gap-3 rounded-lg border bg-card p-4 hover:border-primary/40 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <span className="grid gap-1">
                    <span className="font-semibold">{task.title}</span>
                    <span className="text-sm text-muted-foreground">
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
                  <span className="w-fit rounded-full bg-muted px-3 py-1 text-sm">
                    {taskStatusLabel(t, task.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border bg-card p-6">
            <p>{t('tasksEmpty')}</p>
          </div>
        )}

        {taskData ? (
          <DataPagination
            pathname="/operations/tasks"
            page={taskData.page}
            pageSize={taskData.pageSize}
            totalItems={taskData.total}
            filters={{
              q: search,
              status,
              priority,
              due,
              assignedEmployeeId,
              assignedToMe: query.assignedToMe === 'true' ? 'true' : undefined,
              order,
              organizationId,
              facilityId,
              clientId,
              admissionCaseId,
            }}
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
      <NativeSelect
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue}
        selectClassName="h-10 rounded-md border bg-card px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
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
