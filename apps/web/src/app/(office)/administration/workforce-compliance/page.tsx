import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import type { Locale } from '../../../../i18n/config';
import { formatDate } from '../../../../i18n/format';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { todayDateKey } from '../../../../lib/care-date';
import { ActionNotice } from '../action-notice';
import { updateWorkforceComplianceSettingsAction } from './actions';
import {
  WorkforceComplianceNotice,
  WorkforceCompliancePageHeader,
  WorkforceComplianceSection,
  WorkforceComplianceSettingsForm,
} from './page-shell';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  employeeQ?: string;
  employeeStatus?: string;
  employeeOrganizationId?: string;
  employeeFacilityId?: string;
  employeeTeamId?: string;
  employeePage?: string;
  qualificationQ?: string;
  qualificationStatus?: string;
  assignmentStatus?: string;
  qualificationOrganizationId?: string;
  qualificationFacilityId?: string;
  qualificationTeamId?: string;
  qualificationEmployeeId?: string;
  qualificationId?: string;
  expiresBefore?: string;
  expiresWithinDays?: string;
  qualificationPage?: string;
  impactQualificationId?: string;
  impactOperationKey?: string;
  impactPage?: string;
}>;

const PAGE_SIZE = 25;
const employeeStatuses = ['active', 'inactive', 'archived'] as const;
const qualificationStatuses = [
  'valid',
  'expiring_soon',
  'expired',
  'not_yet_valid',
  'revoked',
] as const;
const assignmentStatuses = ['active', 'revoked'] as const;
const operationKeys = ['care_plan.activate', 'care_plan.evaluate'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dayWindow(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : undefined;
}

type Query = Awaited<SearchParams>;

function enumValue<const T extends readonly string[]>(value: string | undefined, values: T) {
  return values.includes(value as T[number]) ? (value as T[number]) : undefined;
}

function pageNumber(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function uuidValue(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function calendarDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function pageHref(
  query: Query,
  key: 'employeePage' | 'qualificationPage' | 'impactPage',
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === 'string' && name !== 'error' && name !== 'updated') {
      params.set(name, value);
    }
  }
  params.set(key, String(page));
  return `/administration/workforce-compliance?${params.toString()}`;
}

function qualificationImpactHref(query: Query, qualificationId: string): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === 'string' && name !== 'error' && name !== 'updated') {
      params.set(name, value);
    }
  }
  params.set('impactQualificationId', qualificationId);
  params.set('impactPage', '1');
  params.delete('impactOperationKey');
  return `/administration/workforce-compliance?${params.toString()}#qualification-impact`;
}

function closeImpactHref(query: Query): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (
      typeof value === 'string' &&
      name !== 'error' &&
      name !== 'updated' &&
      name !== 'impactQualificationId' &&
      name !== 'impactOperationKey' &&
      name !== 'impactPage'
    ) {
      params.set(name, value);
    }
  }
  const search = params.toString();
  return `/administration/workforce-compliance${search ? `?${search}` : ''}`;
}

export default async function WorkforceCompliancePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations('WorkforceCompliance'), getLocale()]);
  const employeeStatus = enumValue(query.employeeStatus, employeeStatuses);
  const employeeOrganizationId = uuidValue(query.employeeOrganizationId);
  const employeeFacilityId = uuidValue(query.employeeFacilityId);
  const employeeTeamId = uuidValue(query.employeeTeamId);
  const qualificationStatus = enumValue(query.qualificationStatus, qualificationStatuses);
  const assignmentStatus = enumValue(query.assignmentStatus, assignmentStatuses);
  const qualificationOrganizationId = uuidValue(query.qualificationOrganizationId);
  const qualificationFacilityId = uuidValue(query.qualificationFacilityId);
  const qualificationTeamId = uuidValue(query.qualificationTeamId);
  const qualificationEmployeeId = uuidValue(query.qualificationEmployeeId);
  const qualificationId = uuidValue(query.qualificationId);
  const expiresBefore = calendarDate(query.expiresBefore);
  const expiresWithinDays = dayWindow(query.expiresWithinDays);
  const employeeQ = query.employeeQ?.trim().slice(0, 120) || undefined;
  const qualificationQ = query.qualificationQ?.trim().slice(0, 120) || undefined;
  const employeePage = pageNumber(query.employeePage);
  const qualificationPage = pageNumber(query.qualificationPage);
  const impactQualificationId = uuidValue(query.impactQualificationId);
  const impactOperationKey = enumValue(query.impactOperationKey, operationKeys);
  const impactPage = pageNumber(query.impactPage);

  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [
    summaryResult,
    employeesResult,
    qualificationsResult,
    settingsResult,
    organizationsResult,
    facilitiesResult,
    teamsResult,
    employeeOptionsResult,
    qualificationDefinitionsResult,
  ] = await Promise.all([
    get('/api/v1/workforce-compliance/summary', { params: { header } }),
    get('/api/v1/workforce-compliance/employees', {
      params: {
        query: {
          page: employeePage,
          pageSize: PAGE_SIZE,
          ...(employeeQ ? { q: employeeQ } : {}),
          ...(employeeStatus ? { status: employeeStatus } : {}),
          ...(employeeOrganizationId ? { organizationId: employeeOrganizationId } : {}),
          ...(employeeFacilityId ? { facilityId: employeeFacilityId } : {}),
          ...(employeeTeamId ? { teamId: employeeTeamId } : {}),
        },
        header,
      },
    }),
    get('/api/v1/workforce-compliance/qualifications', {
      params: {
        query: {
          page: qualificationPage,
          pageSize: PAGE_SIZE,
          ...(qualificationQ ? { q: qualificationQ } : {}),
          ...(qualificationStatus ? { status: qualificationStatus } : {}),
          ...(assignmentStatus ? { assignmentStatus } : {}),
          ...(qualificationOrganizationId ? { organizationId: qualificationOrganizationId } : {}),
          ...(qualificationFacilityId ? { facilityId: qualificationFacilityId } : {}),
          ...(qualificationTeamId ? { teamId: qualificationTeamId } : {}),
          ...(qualificationEmployeeId ? { employeeId: qualificationEmployeeId } : {}),
          ...(qualificationId ? { qualificationId } : {}),
          ...(expiresBefore ? { expiresBefore } : {}),
          ...(expiresWithinDays ? { expiresWithinDays } : {}),
        },
        header,
      },
    }),
    get('/api/v1/workforce-compliance/settings', { params: { header } }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/teams', { params: { header } }),
    get('/api/v1/workforce-compliance/employees', {
      params: { query: { page: 1, pageSize: 100 }, header },
    }),
    get('/api/v1/qualifications', { params: { header } }),
  ]);
  const impactResults = impactQualificationId
    ? await Promise.all([
        get('/api/v1/workforce-compliance/qualifications/{qualificationDefinitionId}/impact', {
          params: {
            path: { qualificationDefinitionId: impactQualificationId },
            query: {
              page: impactPage,
              pageSize: PAGE_SIZE,
              ...(impactOperationKey ? { operationKey: impactOperationKey } : {}),
            },
            header,
          },
        }),
        get('/api/v1/workforce-compliance/qualifications', {
          params: {
            query: { qualificationId: impactQualificationId, page: 1, pageSize: 1 },
            header,
          },
        }),
      ])
    : undefined;
  const summary = summaryResult.data;
  const employees = employeesResult.data;
  const qualifications = qualificationsResult.data;
  const settings = settingsResult.data;
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const teams = teamsResult.data ?? [];
  const employeeOptions = employeeOptionsResult.data?.items ?? [];
  const qualificationDefinitions = qualificationDefinitionsResult.data ?? [];
  const qualificationImpact = impactResults?.[0].data;
  const selectedQualification = impactResults?.[1].data?.items[0];
  return (
    <div className="grid gap-6">
      <WorkforceCompliancePageHeader
        section={t('section')}
        title={t('title')}
        description={t('description')}
      />
      <ActionNotice error={query.error} />
      <WorkforceComplianceNotice>{t('advisoryNotice')}</WorkforceComplianceNotice>
      <WorkforceComplianceNotice>{t('responsibilityNotice')}</WorkforceComplianceNotice>

      {settingsResult.error || !settings ? (
        <WorkforceComplianceSection
          title={t('settingsTitle')}
          description={t('settingsDescription')}
        >
          <p role="alert" className="text-sm text-red-800">
            {t('settingsLoadFailed')}
          </p>
        </WorkforceComplianceSection>
      ) : (
        <div className="grid gap-3">
          {query.updated ? (
            <p
              role="status"
              className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
            >
              {t('settingsUpdated')}
            </p>
          ) : null}
          <WorkforceComplianceSettingsForm
            criticalDays={settings.criticalDays}
            warningDays={settings.warningDays}
            reportingTimezone={settings.reportingTimezone}
            version={settings.version}
            canManage={settings.canManage}
            action={updateWorkforceComplianceSettingsAction}
            t={t}
          />
        </div>
      )}

      <WorkforceComplianceSection title={t('overviewTitle')} description={t('overviewDescription')}>
        {summaryResult.error || !summary ? (
          <p role="alert" className="text-sm text-red-800">
            {t('loadFailed')}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewValue label={t('employeeCount')} value={summary.employeeCount} />
              <OverviewValue
                label={t('employeesWithMissingRequirements')}
                value={summary.employeesWithMissingRequirements}
              />
              <OverviewValue
                label={t('expiredQualificationsSummary')}
                value={summary.expiredQualifications}
              />
              <OverviewValue
                label={t('expiringQualificationsSummary', { days: summary.horizonDays })}
                value={summary.expiringQualifications}
              />
              <OverviewValue
                label={t('operationsNeedingPolicyReview')}
                value={
                  summary.operations.filter((operation) => operation.policy.status !== 'active')
                    .length
                }
              />
              <OverviewValue
                label={t('reportingDate')}
                value={
                  formatDate(
                    summary.asOf ?? todayDateKey(settings?.reportingTimezone ?? 'Europe/Berlin'),
                    locale as Locale,
                    settings?.reportingTimezone ?? 'Europe/Berlin',
                  ) ?? ''
                }
              />
              <OverviewValue
                label={t('warningHorizon')}
                value={t('days', { count: summary.horizonDays })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {summary.operations.map((operation) => (
                <section key={operation.operationKey} className="grid gap-3 rounded-md border p-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{operationLabel(t, operation.operationKey)}</h3>
                      <p className="text-sm text-slate-600">
                        {policyStatusLabel(t, operation.policy.status)}
                        {operation.policy.policyVersion !== null
                          ? ` · ${t('policyVersion', { version: operation.policy.policyVersion })}`
                          : ''}
                      </p>
                    </div>
                    <PolicyStatusBadge
                      status={operation.policy.status}
                      label={policyStatusLabel(t, operation.policy.status)}
                    />
                  </header>
                  {operation.policy.status === 'active' ? (
                    <p className="text-sm text-slate-600">
                      {operation.policy.requirementMode === 'ALL'
                        ? t('requirementModeAll')
                        : t('requirementModeAny')}{' '}
                      · {t('requirementCount', { count: operation.policy.requirementCount })}
                    </p>
                  ) : null}
                  {operation.policy.status === 'active' ? (
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <ReadinessCount
                        status="ready"
                        label={t('statusReady')}
                        count={operation.readiness.ready}
                      />
                      <ReadinessCount
                        status="at_risk"
                        label={t('statusAtRisk')}
                        count={operation.readiness.atRisk}
                      />
                      <ReadinessCount
                        status="not_ready"
                        label={t('statusNotReady')}
                        count={operation.readiness.notReady}
                      />
                    </div>
                  ) : (
                    <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                      {t('readinessNotEvaluated')}{' '}
                      {t('policyFindingAffectedEmployees', {
                        count:
                          operation.findingCounts[
                            operation.policy.status === 'missing'
                              ? 'COMPETENCY_POLICY_MISSING'
                              : operation.policy.status === 'inactive'
                                ? 'COMPETENCY_POLICY_INACTIVE'
                                : 'COMPETENCY_POLICY_INVALID'
                          ] ?? 0,
                      })}
                    </p>
                  )}
                  {operation.policy.status === 'active' && operation.policy.requirements.length ? (
                    <ul className="grid gap-1 border-t pt-3 text-sm text-slate-600">
                      {operation.policy.requirements.map((requirement) => (
                        <li key={requirement.qualificationId}>
                          {requirement.name ?? requirement.qualificationId}
                          {requirement.code ? ` · ${requirement.code}` : ''}
                          {requirement.status !== 'active' ? (
                            <span className="ml-2 text-amber-800">
                              ({requirementDefinitionStatusLabel(t, requirement.status)})
                            </span>
                          ) : null}
                          <span className="ml-2 block text-xs text-slate-500">
                            {t('requirementMissingEmployees', {
                              count: requirement.missingEmployeeCount,
                            })}
                            {' · '}
                            {t('requirementExpiringEmployees', {
                              count: requirement.expiringEmployeeCount,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
            {summary.historyLimitations.length ? (
              <aside className="grid gap-2 rounded-md bg-slate-50 p-4 text-sm text-slate-600">
                <h3 className="font-semibold text-slate-900">{t('historyLimitationsTitle')}</h3>
                <ul className="grid list-disc gap-1 pl-5">
                  <li>{t('employeeHistoryCurrentOnly')}</li>
                  <li>{t('qualificationDatesNotPreserved')}</li>
                  <li>{t('qualificationDefinitionHistoryNotPreserved')}</li>
                  <li>{t('historicalSettingsTimezoneNotPreserved')}</li>
                  <li>{t('draftPolicyPreviewNotAvailable')}</li>
                </ul>
              </aside>
            ) : null}
          </>
        )}
      </WorkforceComplianceSection>

      <WorkforceComplianceSection
        title={t('employeesTitle')}
        description={t('employeesDescription')}
      >
        {employeesResult.error || !employees ? (
          <p role="alert" className="text-sm text-red-800">
            {t('employeesLoadFailed')}
          </p>
        ) : (
          <>
            <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-sm">
                {t('searchEmployees')}
                <input
                  className="h-10 rounded-md border px-3"
                  name="employeeQ"
                  maxLength={120}
                  defaultValue={employeeQ ?? ''}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('employeeStatusFilter')}
                <select
                  className="h-10 rounded-md border bg-white px-3"
                  name="employeeStatus"
                  defaultValue={employeeStatus ?? ''}
                >
                  <option value="">{t('allEmployeeStatuses')}</option>
                  {employeeStatuses.map((status) => (
                    <option key={status} value={status}>
                      {employeeStatusLabel(t, status)}
                    </option>
                  ))}
                </select>
              </label>
              <FilterSelect
                name="employeeOrganizationId"
                label={t('organizationFilter')}
                value={employeeOrganizationId ?? ''}
              >
                <option value="">{t('allOrganizations')}</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                name="employeeFacilityId"
                label={t('facilityFilter')}
                value={employeeFacilityId ?? ''}
              >
                <option value="">{t('allFacilities')}</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.organizationName} — {facility.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                name="employeeTeamId"
                label={t('teamFilter')}
                value={employeeTeamId ?? ''}
              >
                <option value="">{t('allTeams')}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.organizationName} — {team.name}
                  </option>
                ))}
              </FilterSelect>
              <div className="flex items-end lg:col-span-4">
                <Button type="submit">{t('applyFilters')}</Button>
              </div>
            </form>
            {employees.items.length ? (
              <div className="grid gap-3">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[46rem] text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('employeeName')}</th>
                        <th className="px-3 py-2 font-medium">{t('organization')}</th>
                        <th className="px-3 py-2 font-medium">{t('employeeStatus')}</th>
                        <th className="px-3 py-2 font-medium">{t('operations')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.items.map((employee) => (
                        <tr key={employee.employeeId} className="border-t align-top">
                          <td className="px-3 py-3">
                            <Link
                              href={`/employees/${employee.employeeId}`}
                              className="font-medium text-blue-900 underline-offset-4 hover:underline"
                            >
                              {employee.firstName} {employee.lastName}
                            </Link>
                          </td>
                          <td className="px-3 py-3">{employee.organizationName ?? '–'}</td>
                          <td className="px-3 py-3">{employeeStatusLabel(t, employee.status)}</td>
                          <td className="px-3 py-3">
                            <div className="grid gap-2">
                              {employee.operations.map((operation) => (
                                <div key={operation.operationKey} className="flex flex-wrap gap-2">
                                  <span>{operationLabel(t, operation.operationKey)}</span>
                                  <ReadinessBadge
                                    status={operation.readiness}
                                    label={readinessLabel(t, operation.readiness)}
                                  />
                                  {operation.readiness === null ? (
                                    <span className="text-sm text-amber-900">
                                      {operation.findingCodes.length
                                        ? findingLabel(t, operation.findingCodes[0]!)
                                        : t('readinessNotEvaluated')}
                                    </span>
                                  ) : null}
                                  {operation.projectedEligibilityEnd ? (
                                    <span className="text-slate-600">
                                      {t('throughDate', {
                                        date:
                                          formatDate(
                                            operation.projectedEligibilityEnd,
                                            locale as Locale,
                                          ) ?? operation.projectedEligibilityEnd,
                                      })}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={employees.page}
                  pageSize={employees.pageSize}
                  total={employees.total}
                  query={query}
                  pageKey="employeePage"
                  label={(values) => t('employeesShown', values)}
                  navigationLabel={t('pagination')}
                  previousLabel={t('previousPage')}
                  nextLabel={t('nextPage')}
                  href={pageHref}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-600">{t('emptyEmployees')}</p>
            )}
          </>
        )}
      </WorkforceComplianceSection>

      <WorkforceComplianceSection
        title={t('qualificationsTitle')}
        description={t('qualificationsDescription')}
      >
        {qualificationsResult.error || !qualifications ? (
          <p role="alert" className="text-sm text-red-800">
            {t('qualificationsLoadFailed')}
          </p>
        ) : (
          <>
            <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-sm">
                {t('searchQualifications')}
                <input
                  className="h-10 rounded-md border px-3"
                  name="qualificationQ"
                  maxLength={120}
                  defaultValue={qualificationQ ?? ''}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('qualificationStatusFilter')}
                <select
                  className="h-10 rounded-md border bg-white px-3"
                  name="qualificationStatus"
                  defaultValue={qualificationStatus ?? ''}
                >
                  <option value="">{t('allQualificationStatuses')}</option>
                  {qualificationStatuses.map((status) => (
                    <option key={status} value={status}>
                      {qualificationStatusLabel(t, status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t('assignmentStatusFilter')}
                <select
                  className="h-10 rounded-md border bg-white px-3"
                  name="assignmentStatus"
                  defaultValue={assignmentStatus ?? ''}
                >
                  <option value="">{t('allAssignmentStatuses')}</option>
                  {assignmentStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status === 'active' ? t('activeAssignment') : t('revokedAssignment')}
                    </option>
                  ))}
                </select>
              </label>
              <FilterSelect
                name="qualificationOrganizationId"
                label={t('organizationFilter')}
                value={qualificationOrganizationId ?? ''}
              >
                <option value="">{t('allOrganizations')}</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                name="qualificationFacilityId"
                label={t('facilityFilter')}
                value={qualificationFacilityId ?? ''}
              >
                <option value="">{t('allFacilities')}</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.organizationName} — {facility.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                name="qualificationTeamId"
                label={t('teamFilter')}
                value={qualificationTeamId ?? ''}
              >
                <option value="">{t('allTeams')}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.organizationName} — {team.name}
                  </option>
                ))}
              </FilterSelect>
              <label className="grid gap-1 text-sm">
                {t('employeeFilter')}
                <input
                  className="h-10 rounded-md border px-3"
                  name="qualificationEmployeeId"
                  list="workforce-compliance-employee-options"
                  defaultValue={qualificationEmployeeId ?? ''}
                />
                <span className="text-xs text-slate-600">{t('employeeFilterHint')}</span>
                <datalist id="workforce-compliance-employee-options">
                  {employeeOptions.map((employee) => (
                    <option
                      key={employee.employeeId}
                      value={employee.employeeId}
                      label={`${employee.firstName} ${employee.lastName}`}
                    />
                  ))}
                </datalist>
              </label>
              <FilterSelect
                name="qualificationId"
                label={t('qualificationDefinitionFilter')}
                value={qualificationId ?? ''}
              >
                <option value="">{t('allQualificationDefinitions')}</option>
                {qualificationDefinitions.map((qualification) => (
                  <option key={qualification.id} value={qualification.id}>
                    {qualification.name}
                    {qualification.code ? ` · ${qualification.code}` : ''}
                  </option>
                ))}
              </FilterSelect>
              <label className="grid gap-1 text-sm">
                {t('expiresBeforeFilter')}
                <input
                  className="h-10 rounded-md border bg-white px-3"
                  type="date"
                  name="expiresBefore"
                  defaultValue={expiresBefore ?? ''}
                />
              </label>
              {settings ? (
                <label className="grid gap-1 text-sm">
                  {t('expiryWindowFilter')}
                  <select
                    className="h-10 rounded-md border bg-white px-3"
                    name="expiresWithinDays"
                    defaultValue={expiresWithinDays?.toString() ?? ''}
                  >
                    <option value="">{t('allExpiryWindows')}</option>
                    <option value={settings.criticalDays}>
                      {t('withinDays', { count: settings.criticalDays })}
                    </option>
                    {settings.warningDays !== settings.criticalDays ? (
                      <option value={settings.warningDays}>
                        {t('withinDays', { count: settings.warningDays })}
                      </option>
                    ) : null}
                  </select>
                </label>
              ) : null}
              <div className="flex items-end lg:col-span-4">
                <Button type="submit">{t('applyFilters')}</Button>
              </div>
            </form>
            {qualifications.items.length ? (
              <div className="grid gap-3">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[52rem] text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('employeeName')}</th>
                        <th className="px-3 py-2 font-medium">{t('qualification')}</th>
                        <th className="px-3 py-2 font-medium">{t('organization')}</th>
                        <th className="px-3 py-2 font-medium">{t('status')}</th>
                        <th className="px-3 py-2 font-medium">{t('validUntil')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qualifications.items.map((qualification) => (
                        <tr key={qualification.assignmentId} className="border-t align-top">
                          <td className="px-3 py-3">
                            <Link
                              href={`/employees/${qualification.employeeId}`}
                              className="font-medium text-blue-900 underline-offset-4 hover:underline"
                            >
                              {qualification.employeeFirstName} {qualification.employeeLastName}
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-medium">{qualification.qualificationName}</span>
                            {qualification.qualificationCode ? (
                              <span className="block text-slate-600">
                                {qualification.qualificationCode}
                              </span>
                            ) : null}
                            <Link
                              href={qualificationImpactHref(query, qualification.qualificationId)}
                              className="mt-1 inline-block text-blue-900 underline underline-offset-4"
                            >
                              {t('reviewImpact')}
                            </Link>
                          </td>
                          <td className="px-3 py-3">{qualification.organizationName ?? '–'}</td>
                          <td className="px-3 py-3">
                            <QualificationStatusBadge
                              status={qualification.complianceStatus}
                              label={qualificationStatusLabel(t, qualification.complianceStatus)}
                            />
                            {qualification.assignmentStatus === 'revoked' ? (
                              <span className="mt-1 block text-xs text-slate-600">
                                {t('revokedAssignment')}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            {qualification.validUntil
                              ? formatDate(qualification.validUntil, locale as Locale)
                              : t('openEnded')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={qualifications.page}
                  pageSize={qualifications.pageSize}
                  total={qualifications.total}
                  query={query}
                  pageKey="qualificationPage"
                  label={(values) => t('qualificationsShown', values)}
                  navigationLabel={t('pagination')}
                  previousLabel={t('previousPage')}
                  nextLabel={t('nextPage')}
                  href={pageHref}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-600">{t('emptyQualifications')}</p>
            )}
          </>
        )}
      </WorkforceComplianceSection>

      {impactQualificationId ? (
        <WorkforceComplianceSection
          id="qualification-impact"
          title={t('impactTitle')}
          description={t('impactDescription')}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="font-medium">
              {selectedQualification
                ? `${selectedQualification.qualificationName}${selectedQualification.qualificationCode ? ` · ${selectedQualification.qualificationCode}` : ''}`
                : impactQualificationId}
            </p>
            <Button asChild variant="secondary" size="sm">
              <Link href={closeImpactHref(query)}>{t('closeImpact')}</Link>
            </Button>
          </div>
          <form method="get" className="grid gap-3 sm:grid-cols-[minmax(15rem,22rem)_auto]">
            <input type="hidden" name="impactQualificationId" value={impactQualificationId} />
            <label className="grid gap-1 text-sm">
              {t('impactOperationFilter')}
              <select
                className="h-10 rounded-md border bg-white px-3"
                name="impactOperationKey"
                defaultValue={impactOperationKey ?? ''}
              >
                <option value="">{t('allOperations')}</option>
                {operationKeys.map((operationKey) => (
                  <option key={operationKey} value={operationKey}>
                    {operationLabel(t, operationKey)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit">{t('applyFilters')}</Button>
            </div>
          </form>
          {!impactResults || impactResults[0].error || !qualificationImpact ? (
            <p role="alert" className="text-sm text-red-800">
              {t('impactLoadFailed')}
            </p>
          ) : qualificationImpact.items.length ? (
            <div className="grid gap-3">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[48rem] text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('employeeName')}</th>
                      <th className="px-3 py-2 font-medium">{t('organization')}</th>
                      <th className="px-3 py-2 font-medium">{t('readiness')}</th>
                      <th className="px-3 py-2 font-medium">{t('affectedOperations')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualificationImpact.items.map((employee) => (
                      <tr key={employee.employeeId} className="border-t align-top">
                        <td className="px-3 py-3">
                          <Link
                            href={`/employees/${employee.employeeId}`}
                            className="font-medium text-blue-900 underline-offset-4 hover:underline"
                          >
                            {employee.firstName} {employee.lastName}
                          </Link>
                        </td>
                        <td className="px-3 py-3">{employee.organizationName ?? '–'}</td>
                        <td className="px-3 py-3">
                          <ReadinessBadge
                            status={employee.readiness}
                            label={readinessLabel(t, employee.readiness)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="grid gap-2">
                            {employee.affectedOperations.map((operation) => (
                              <div key={operation.operationKey} className="flex flex-wrap gap-2">
                                <span>{operationLabel(t, operation.operationKey)}</span>
                                <ReadinessBadge
                                  status={operation.readiness}
                                  label={readinessLabel(t, operation.readiness)}
                                />
                                {operation.projectedEligibilityEnd ? (
                                  <span className="text-slate-600">
                                    {t('throughDate', {
                                      date:
                                        formatDate(
                                          operation.projectedEligibilityEnd,
                                          locale as Locale,
                                        ) ?? operation.projectedEligibilityEnd,
                                    })}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={qualificationImpact.page}
                pageSize={qualificationImpact.pageSize}
                total={qualificationImpact.total}
                query={query}
                pageKey="impactPage"
                label={(values) => t('impactEmployeesShown', values)}
                navigationLabel={t('pagination')}
                previousLabel={t('previousPage')}
                nextLabel={t('nextPage')}
                href={pageHref}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t('impactEmpty')}</p>
          )}
        </WorkforceComplianceSection>
      ) : null}
    </div>
  );
}

function OverviewValue({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="grid gap-1 rounded-md bg-slate-50 p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: Readonly<{
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={name}>
      {label}
      <select
        id={name}
        name={name}
        className="h-10 rounded-md border bg-white px-3"
        defaultValue={value}
      >
        {children}
      </select>
    </label>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  query,
  pageKey,
  label,
  navigationLabel,
  previousLabel,
  nextLabel,
  href,
}: Readonly<{
  page: number;
  pageSize: number;
  total: number;
  query: Query;
  pageKey: 'employeePage' | 'qualificationPage' | 'impactPage';
  label: (values: { from: number; to: number; total: number }) => string;
  navigationLabel: string;
  previousLabel: string;
  nextLabel: string;
  href: (
    query: Query,
    key: 'employeePage' | 'qualificationPage' | 'impactPage',
    page: number,
  ) => string;
}>) {
  const pageCount = Math.ceil(total / pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label={navigationLabel} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">{label({ from, to, total })}</p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={href(query, pageKey, page - 1)}>{previousLabel}</Link>
          </Button>
        ) : null}
        {page < pageCount ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={href(query, pageKey, page + 1)}>{nextLabel}</Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

function operationLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  operation: string,
) {
  return operation === 'care_plan.activate' ? t('operationActivate') : t('operationEvaluate');
}

function employeeStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  status: string,
) {
  switch (status) {
    case 'active':
      return t('employeeActive');
    case 'inactive':
      return t('employeeInactive');
    case 'archived':
      return t('employeeArchived');
    default:
      return status;
  }
}

function qualificationStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  status: string,
) {
  switch (status) {
    case 'valid':
      return t('statusValid');
    case 'expiring_soon':
      return t('statusExpiringSoon');
    case 'expired':
      return t('statusExpired');
    case 'not_yet_valid':
      return t('statusNotYetValid');
    case 'revoked':
      return t('statusRevoked');
    default:
      return status;
  }
}

function requirementDefinitionStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  status: string,
) {
  switch (status) {
    case 'active':
      return t('definitionActive');
    case 'inactive':
      return t('definitionInactive');
    default:
      return t('definitionMissing');
  }
}

function readinessLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  status: string | null,
) {
  if (status === null) return t('statusNotEvaluated');
  switch (status) {
    case 'ready':
      return t('statusReady');
    case 'at_risk':
      return t('statusAtRisk');
    case 'not_ready':
      return t('statusNotReady');
    default:
      return status;
  }
}

function findingLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  code: string,
) {
  switch (code) {
    case 'COMPETENCY_POLICY_MISSING':
      return t('findingPolicyMissing');
    case 'COMPETENCY_POLICY_INACTIVE':
      return t('findingPolicyInactive');
    case 'COMPETENCY_POLICY_INVALID':
      return t('findingPolicyInvalid');
    case 'EMPLOYEE_INACTIVE':
      return t('findingEmployeeInactive');
    case 'EMPLOYEE_LINK_MISSING':
      return t('findingEmployeeLinkMissing');
    case 'COMPETENCY_REQUIREMENT_UNMET':
      return t('findingRequirementUnmet');
    case 'COMPETENCY_ELIGIBILITY_EXPIRING':
      return t('findingEligibilityExpiring');
    default:
      return code;
  }
}

function policyStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'WorkforceCompliance'>>>,
  status: string,
) {
  switch (status) {
    case 'active':
      return t('policyActive');
    case 'missing':
      return t('policyMissing');
    case 'inactive':
      return t('policyInactive');
    default:
      return t('policyInvalid');
  }
}

function PolicyStatusBadge({ status, label }: Readonly<{ status: string; label: string }>) {
  const color = status === 'active' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-950';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{label}</span>;
}

function ReadinessCount({
  status,
  label,
  count,
}: Readonly<{ status: string; label: string; count: number }>) {
  return (
    <div className="grid gap-1 rounded-md border px-2 py-2">
      <ReadinessBadge status={status} label={label} />
      <span className="font-semibold tabular-nums">{count}</span>
    </div>
  );
}

function ReadinessBadge({ status, label }: Readonly<{ status: string | null; label: string }>) {
  const color =
    status === 'ready'
      ? 'bg-green-100 text-green-900'
      : status === 'at_risk' || status === null
        ? 'bg-amber-100 text-amber-950'
        : 'bg-red-100 text-red-900';
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function QualificationStatusBadge({ status, label }: Readonly<{ status: string; label: string }>) {
  const color =
    status === 'valid'
      ? 'bg-green-100 text-green-900'
      : status === 'expiring_soon' || status === 'not_yet_valid'
        ? 'bg-amber-100 text-amber-950'
        : 'bg-red-100 text-red-900';
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
