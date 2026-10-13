import { NativeSelect } from '@care/ui';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
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
  createDeadlineTaskAction,
  snoozeExceptionAction,
} from '@app/web/app/(office)/operations/actions';
import {
  categoryTranslationKey,
  issueTitleKey,
  workItemSourceHref,
} from '@app/web/app/(office)/operations/ui';

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
  const [
    deadlineResult,
    organizationResult,
    facilityResult,
    employeeResult,
    selectedClientResult,
    selectedEmployeeResult,
  ] = await Promise.all([
    api.GET('/api/v1/operations/deadlines', {
      params: {
        query: {
          page,
          pageSize: 25,
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
    api.GET('/api/v1/organizations', { params: { header } }),
    api.GET('/api/v1/facilities', {
      params: { query: organizationId ? { organizationId } : {}, header },
    }),
    canFilterByAssignee
      ? api.GET('/api/v1/employees', {
          params: {
            query: {
              status: 'active',
              page: 1,
              pageSize: 100,
              sortBy: 'lastName',
              sortOrder: 'asc',
              ...(organizationId ? { organizationId } : {}),
              ...(facilityId ? { facilityId } : {}),
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    clientId && hasPermission(permissions, 'client.read')
      ? api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
    employeeId && hasPermission(permissions, 'employee.read')
      ? api.GET('/api/v1/employees/{id}', { params: { path: { id: employeeId }, header } })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const items = deadlineResult.data?.items ?? [];
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const employees = employeeResult.data?.items ?? [];
  const timezoneByOrganization = new Map(organizations.map((org) => [org.id, org.timezone]));
  const canManage = hasPermission(permissions, 'operations.exceptions.manage');
  const canCreateTask = hasPermission(permissions, 'operations.tasks.create');
  const result = deadlineResult.data;

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
      {deadlineResult.error || organizationResult.error || facilityResult.error ? (
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
        <label className="grid gap-1 text-sm">
          <span>{t('organization')}</span>
          <NativeSelect
            selectClassName="h-10 rounded-md border px-3"
            name="organizationId"
            defaultValue={organizationId ?? ''}
            className="w-full"
          >
            <option value="">{t('all')}</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('facility')}</span>
          <NativeSelect
            selectClassName="h-10 rounded-md border px-3"
            name="facilityId"
            defaultValue={facilityId ?? ''}
            className="w-full"
          >
            <option value="">{t('all')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </NativeSelect>
        </label>
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
          <label className="grid gap-1 text-sm">
            <span>{t('client')}</span>
            {clientId ? (
              <>
                <input type="hidden" name="clientId" value={clientId} />
                <ResourceReference
                  label={
                    selectedClientResult.data
                      ? `${selectedClientResult.data.preferredName || selectedClientResult.data.firstName} ${selectedClientResult.data.lastName}`
                      : translate('Resources.unavailableClient')
                  }
                  href={selectedClientResult.data ? `/clients/${clientId}` : null}
                />
              </>
            ) : (
              <span className="h-10 rounded-md border px-3 py-2 text-muted-foreground">
                {t('all')}
              </span>
            )}
          </label>
        ) : null}
        {hasPermission(permissions, 'employee.read') ? (
          <label className="grid gap-1 text-sm">
            <span>{t('employee')}</span>
            {employeeId ? (
              <>
                <input type="hidden" name="employeeId" value={employeeId} />
                <ResourceReference
                  label={
                    selectedEmployeeResult.data
                      ? `${selectedEmployeeResult.data.preferredName || selectedEmployeeResult.data.firstName} ${selectedEmployeeResult.data.lastName}`
                      : translate('Resources.unavailableEmployee')
                  }
                  href={selectedEmployeeResult.data ? `/employees/${employeeId}` : null}
                />
              </>
            ) : (
              <span className="h-10 rounded-md border px-3 py-2 text-muted-foreground">
                {t('all')}
              </span>
            )}
          </label>
        ) : null}
        {canFilterByAssignee ? (
          <label className="grid gap-1 text-sm">
            <span>{t('assignedEmployeeFilter')}</span>
            <NativeSelect
              selectClassName="h-10 rounded-md border px-3"
              name="assignedEmployeeId"
              defaultValue={assignedEmployeeId ?? ''}
              className="w-full"
            >
              <option value="">{t('all')}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
                </option>
              ))}
            </NativeSelect>
          </label>
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

      {result && result.total > result.pageSize ? (
        <nav aria-label={t('issuePages')} className="flex justify-between">
          <PageLink page={page - 1} disabled={page <= 1} query={query} label={t('previousPage')} />
          <span>
            {t('pageOf', { page: result.page, pages: Math.ceil(result.total / result.pageSize) })}
          </span>
          <PageLink
            page={page + 1}
            disabled={page * result.pageSize >= result.total}
            query={query}
            label={t('nextPage')}
          />
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  page,
  disabled,
  query,
  label,
}: {
  page: number;
  disabled: boolean;
  query: Record<string, string | undefined>;
  label: string;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value && key !== 'page') params.set(key, value);
  params.set('page', String(page));
  return disabled ? (
    <span className="text-muted-foreground">{label}</span>
  ) : (
    <Link className="text-primary underline" href={`/operations/deadlines?${params}`}>
      {label}
    </Link>
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
