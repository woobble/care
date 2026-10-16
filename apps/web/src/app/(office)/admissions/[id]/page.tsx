import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { ReactNode } from 'react';

import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import {
  admitCaseAction,
  linkAdmissionClientAction,
  linkAdmissionSourceAction,
  recordAdmissionCommunicationAction,
  registerAdmissionClientAction,
  respondAdmissionChecklistAction,
  saveAdmissionAssessmentAction,
  transitionAdmissionAction,
  updateAdmissionCaseAction,
} from '@app/web/app/(office)/admissions/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatCurrency, formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { todayDateKey, visitDateTimeInputValue } from '@app/web/lib/care-date';
import type { components } from '@care/api-client';
import { Badge } from '@care/ui/components/badge';
import { Button } from '@care/ui/components/button';
import { NativeSelect } from '@care/ui/components/native-select';
import { Textarea } from '@care/ui/components/textarea';

type Finding = {
  code: string;
  label: string;
  category: string;
  severity: 'blocker' | 'warning' | 'complete' | 'not_applicable';
  mandatory: boolean;
  detail?: string;
  detailCode?: string;
};
type ChecklistItem = {
  code: string;
  label: string;
  category: string;
  source: 'automatic' | 'manual' | 'document';
  mandatory: boolean;
  response: { status: 'complete' | 'not_applicable'; reason: string | null } | null;
  finding: Finding | null;
};
type Transition = {
  fromStage: string | null;
  toStage: string;
  reason: string | null;
  occurredAt: string;
  actorUserId: string;
  actorName?: string | null;
};
type AdmissionCaseDetail = {
  id: string;
  organizationId: string;
  facilityId: string | null;
  ownerEmployeeId: string | null;
  clientId: string | null;
  clientName?: string | null;
  organizationName?: string | null;
  facilityName?: string | null;
  ownerEmployeeName?: string | null;
  firstVisitId: string | null;
  firstVisitStartsAt?: string | null;
  firstName: string;
  lastName: string;
  contactMethod: string;
  requesterName: string | null;
  requesterRelationship: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requestedServices: string[];
  servicePricing: Array<{
    requestedService: string;
    serviceId: string | null;
    serviceName: string | null;
    status: 'available' | 'price_missing' | 'service_unavailable' | 'ambiguous' | 'access_required';
    priceCents: number | null;
    pricingUnit: string | null;
  }>;
  preferredStartDate: string | null;
  serviceLocation: string | null;
  inquirySource: string;
  fundingPlan: string;
  fundingPlanDetails: string | null;
  initialNotes: string | null;
  stage: string;
  version: number;
  nextFollowUpAt: string | null;
  lastActivityAt: string;
  admittedAt: string | null;
  assessment: {
    requestedServices: string[];
    householdSupport: string;
    everydayAssistance: string;
    accompaniment: string;
    preferredDays: string[];
    preferredTimeStart: string | null;
    preferredTimeEnd: string | null;
    visitsPerWeek: number | null;
    preferredStartDate: string | null;
    accessibility: string;
    preferences: string;
    organizationalNotes: string;
  } | null;
  assessmentUpdatedAt?: string | null;
  checklist: ChecklistItem[];
  readiness: {
    canAdmit: boolean;
    blockers: Finding[];
    warnings: Finding[];
    findings: Finding[];
    fundingBalance: string;
  };
  history: Transition[];
  documents: Array<{
    link: { requirementCode: string };
    artifact: { id: string; status: 'pending' | 'ready' | 'failed' | 'superseded' };
  }>;
  tasks: Array<{ task: { id: string; title: string; status: string } }>;
  communications: Array<{
    interaction: { id: string; subject: string; occurredAt: string; summary?: string | null };
  }>;
};

const stageValues = [
  'inquiry',
  'assessment',
  'preparation',
  'ready_for_admission',
  'admitted',
  'declined',
  'withdrawn',
] as const;
const emptyChecklistItems: ChecklistItem[] = [];

type AdmissionSearchParams = {
  error?: string;
  updated?: string;
  createdVisitId?: string;
  createdTaskId?: string;
};

type AdmissionCaseSummary = Pick<
  AdmissionCaseDetail,
  | 'id'
  | 'organizationId'
  | 'facilityId'
  | 'ownerEmployeeId'
  | 'clientId'
  | 'clientName'
  | 'organizationName'
  | 'facilityName'
  | 'ownerEmployeeName'
  | 'firstName'
  | 'lastName'
  | 'contactEmail'
  | 'contactPhone'
  | 'requesterName'
  | 'requestedServices'
  | 'preferredStartDate'
  | 'fundingPlan'
  | 'firstVisitId'
  | 'version'
  | 'stage'
  | 'nextFollowUpAt'
  | 'lastActivityAt'
>;

export default async function AdmissionCasePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<AdmissionSearchParams>;
}>) {
  const { id } = await params;
  const [t, translate, locale] = await Promise.all([
    getTranslations('Onboarding'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'onboarding.read')) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }
  const summaryResult = await api.GET('/api/v1/onboarding/cases/{id}/summary', {
    params: { path: { id }, header },
  });
  if ((summaryResult.error as { code?: string } | undefined)?.code === 'ONBOARDING_CASE_NOT_FOUND')
    notFound();
  const summary = summaryResult.data as unknown as AdmissionCaseSummary | undefined;
  if (!summary) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('loadFailed')}
      </p>
    );
  }
  const tenantId = header['X-Tenant-Id'];
  const canReadClient = hasClientPermission(
    permissions,
    'client.read',
    tenantId,
    summary.organizationId,
    summary.facilityId,
  );
  const clientName = summary.clientName ?? translate('Resources.unavailableClient');
  const organizationName =
    summary.organizationName ?? translate('Resources.unavailableOrganization');
  const facilityName = summary.facilityId
    ? (summary.facilityName ?? translate('Resources.unavailableFacility'))
    : null;
  const nextAction = nextActionForStage(summary.stage);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <PageHeader
        eyebrow={<Link href="/admissions">{t('title')}</Link>}
        title={`${summary.firstName} ${summary.lastName}`}
        description={[organizationName, facilityName].filter(Boolean).join(' · ')}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge data-testid="admission-stage" variant={stageBadgeVariant(summary.stage)}>
              {t(labelForStage(summary.stage))}
            </Badge>
            {summary.ownerEmployeeId ? (
              <span className="text-sm text-muted-foreground">
                {t('owner')}:{' '}
                {summary.ownerEmployeeName ?? translate('Resources.unavailableEmployee')}
              </span>
            ) : null}
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {summary.clientId && canReadClient ? (
              <Button asChild variant="secondary">
                <Link href={`/clients/${summary.clientId}`}>{clientName}</Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/admissions">{t('backToWorklist')}</Link>
            </Button>
          </div>
        }
      />

      <nav
        aria-label={t('workspaceNavigation')}
        className="flex w-full max-w-full min-w-0 gap-1 overflow-x-auto rounded-lg border bg-card p-1 text-sm"
      >
        {[
          ['overview', '#overview'],
          ['readinessNav', '#readiness-title'],
          ['assessmentNav', '#assessment-title'],
          ['checklistNav', '#checklist-title'],
          ['fundingNav', '#funding-title'],
          ['agreementNav', '#agreement-title'],
          ['firstVisitNav', '#first-visit-title'],
          ['historyNav', '#history-title'],
        ].map(([label, href]) => (
          <a
            key={label}
            className="min-h-10 shrink-0 rounded-md px-3 py-2 hover:bg-accent"
            href={href}
          >
            {t(
              label as
                | 'overview'
                | 'readinessNav'
                | 'assessmentNav'
                | 'checklistNav'
                | 'fundingNav'
                | 'agreementNav'
                | 'firstVisitNav'
                | 'historyNav',
            )}
          </a>
        ))}
      </nav>

      <section
        id="overview"
        aria-labelledby="overview-title"
        className="grid min-w-0 scroll-mt-4 gap-4 rounded-lg border bg-card p-5"
      >
        <div className="grid min-w-0 gap-1">
          <h2 id="overview-title" className="text-xl font-semibold">
            {t('overview')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('nextAction')}:{' '}
            <Link className="text-primary underline" href={nextAction.href}>
              {t(nextAction.label)}
            </Link>
          </p>
        </div>
        <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <Data
            label={t('primaryContact')}
            value={summary.requesterName || summary.contactEmail || summary.contactPhone}
          />
          <Data
            label={t('followUp')}
            value={formatDateTime(summary.nextFollowUpAt, locale as Locale, 'Europe/Berlin')}
          />
          <Data
            label={t('lastActivity')}
            value={formatDate(summary.lastActivityAt, locale as Locale)}
          />
          <Data label={t('requestedServices')} value={summary.requestedServices.join(', ')} />
        </dl>
      </section>

      <Suspense fallback={<AdmissionWorkspaceSkeleton />}>
        <AdmissionFundingSummary admission={summary} />
      </Suspense>
      <Suspense fallback={<AdmissionWorkspaceSkeleton />}>
        <AdmissionAgreementsSummary admission={summary} />
      </Suspense>
      <Suspense fallback={<AdmissionWorkspaceSkeleton />}>
        <AdmissionFirstVisitSummary admission={summary} />
      </Suspense>
      <Suspense key={`${summary.id}:${summary.version}`} fallback={<AdmissionWorkspaceSkeleton />}>
        <AdmissionCaseWorkspaceContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AdmissionCaseWorkspaceContent({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<AdmissionSearchParams>;
}>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, translate, locale] = await Promise.all([
    getTranslations('Onboarding'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'onboarding.read')) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }
  const result = await api.GET('/api/v1/onboarding/cases/{id}', {
    params: { path: { id }, header },
  });
  if ((result.error as { code?: string } | undefined)?.code === 'ONBOARDING_CASE_NOT_FOUND')
    notFound();
  const admission = result.data as unknown as AdmissionCaseDetail | undefined;
  if (!admission)
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('loadFailed')}
      </p>
    );
  const canManage = hasPermission(permissions, 'onboarding.manage');
  const canAdmit = hasPermission(permissions, 'onboarding.admit');
  const tenantId = header['X-Tenant-Id'];
  const canReadClient = hasClientPermission(
    permissions,
    'client.read',
    tenantId,
    admission.organizationId,
    admission.facilityId,
  );
  const canCreateClient = hasClientPermission(
    permissions,
    'client.create',
    tenantId,
    admission.organizationId,
    admission.facilityId,
  );
  const canScheduleRead = hasClientPermission(
    permissions,
    'schedule.read',
    tenantId,
    admission.organizationId,
    admission.facilityId,
  );
  const [createdVisitResult, createdTaskResult] = await Promise.all([
    query.createdVisitId && canScheduleRead
      ? api.GET('/api/v1/visits/{id}', {
          params: { path: { id: query.createdVisitId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    query.createdTaskId && hasPermission(permissions, 'operations.read')
      ? api.GET('/api/v1/operations/tasks/{id}', {
          params: { path: { id: query.createdTaskId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const createdVisit = createdVisitResult.data as
    | components['schemas']['VisitResponseDto']
    | undefined;
  const createdTask = createdTaskResult.data as
    | components['schemas']['OperationsTaskResponseDto']
    | undefined;
  const timezone = 'Europe/Berlin';
  const allowedStages = transitionsFrom(admission.stage);
  const defaultChecklistLabels: Record<string, string> = {
    client_identity: t('clientIdentityComplete'),
    primary_contact: t('primaryContactRecorded'),
    provider_document_evidence: t('requiredDocumentsEvidence'),
    needs_assessment: t('needsAssessmentComplete'),
    funding_arrangement: t('fundingDocumented'),
    service_agreement: t('serviceAgreementAccepted'),
    first_visit: t('firstVisitPlanned'),
  };

  return (
    <div className="grid min-w-0 gap-6">
      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated === 'first_visit' ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('firstVisitPlanned')}
        </p>
      ) : null}
      {query.updated === 'task_created' ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('followUpTaskCreated')}
        </p>
      ) : null}
      {query.createdVisitId ? (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning-muted p-3 text-warning-foreground"
        >
          {t('visitCreatedButUnlinked')} {t('createdVisit')}:{' '}
          <ResourceReference
            label={
              createdVisit
                ? (formatDateTime(createdVisit.plannedStart, locale as Locale, timezone) ??
                  t('createdVisit'))
                : translate('Resources.unavailableVisit')
            }
            href={createdVisit ? `/visits/${query.createdVisitId}` : null}
          />
        </p>
      ) : null}
      {query.createdTaskId ? (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning-muted p-3 text-warning-foreground"
        >
          {t('taskCreatedButUnlinked')}{' '}
          <ResourceReference
            label={createdTask?.title ?? translate('Resources.unavailableTask')}
            href={createdTask ? `/operations/tasks/${query.createdTaskId}` : null}
          />
        </p>
      ) : null}
      {result.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="readiness-title"
        className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="readiness-title" className="text-xl font-semibold">
            {t('readinessTitle')}
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${admission.readiness.canAdmit ? 'bg-success-muted text-success-foreground' : 'bg-warning-muted text-warning-foreground'}`}
          >
            {admission.readiness.canAdmit ? t('ready') : t('blocked')}
          </span>
        </div>
        {admission.readiness.blockers.length ? (
          <FindingList
            title={t('blockers')}
            findings={admission.readiness.blockers.map((finding) => localizeFinding(t, finding))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('noBlockers')}</p>
        )}
        {admission.readiness.warnings.length ? (
          <FindingList
            title={t('warnings')}
            findings={admission.readiness.warnings.map((finding) => localizeFinding(t, finding))}
          />
        ) : null}
        {canAdmit &&
        admission.stage === 'ready_for_admission' &&
        admission.readiness.canAdmit &&
        admission.clientId ? (
          <RHFActionForm action={admitCaseAction} refreshOnSuccess>
            <HiddenCase admission={admission} />
            <ConfirmSubmitButton confirmation={t('admitConfirmation')} variant="default">
              {t('admit')}
            </ConfirmSubmitButton>
          </RHFActionForm>
        ) : null}
      </section>

      <section
        aria-labelledby="details-title"
        className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="details-title" className="text-xl font-semibold">
          {t('caseDetails')}
        </h2>
        <dl className="grid min-w-0 gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Data
            label={t('organization')}
            value={
              <ResourceReference
                label={admission.organizationName ?? translate('Resources.unavailableOrganization')}
                href={
                  admission.organizationName
                    ? `/administration/organizations/${admission.organizationId}`
                    : null
                }
              />
            }
          />
          <Data
            label={t('facility')}
            value={
              admission.facilityId ? (
                <ResourceReference
                  label={admission.facilityName ?? translate('Resources.unavailableFacility')}
                  href={
                    admission.facilityName
                      ? `/administration/facilities/${admission.facilityId}`
                      : null
                  }
                />
              ) : null
            }
          />
          <Data
            label={t('owner')}
            value={
              admission.ownerEmployeeId ? (
                <ResourceReference
                  label={admission.ownerEmployeeName ?? translate('Resources.unavailableEmployee')}
                  href={
                    admission.ownerEmployeeName ? `/employees/${admission.ownerEmployeeId}` : null
                  }
                />
              ) : null
            }
          />
          <Data
            label={t('contactMethod')}
            value={t(
              admission.contactMethod as 'phone' | 'email' | 'in_person' | 'letter' | 'other',
            )}
          />
          <Data label={t('requesterName')} value={admission.requesterName} />
          <Data label={t('requesterRelationship')} value={admission.requesterRelationship} />
          <Data label={t('contactEmail')} value={admission.contactEmail} />
          <Data label={t('contactPhone')} value={admission.contactPhone} />
          <Data label={t('inquirySource')} value={admission.inquirySource} />
          <Data
            label={t('fundingPlan')}
            value={t(
              admission.fundingPlan === 'other'
                ? 'fundingOther'
                : (admission.fundingPlan as 'unknown' | 'private_pay' | 'benefits'),
            )}
          />
          <Data label={t('fundingPlanDetails')} value={admission.fundingPlanDetails} />
          <Data
            label={t('preferredStartDate')}
            value={formatDate(admission.preferredStartDate, locale as Locale)}
          />
          <Data
            label={t('followUp')}
            value={formatDateTime(admission.nextFollowUpAt, locale as Locale, timezone)}
          />
          <Data
            label={t('requestedServices')}
            value={admission.requestedServices.join(', ') || null}
          />
          <Data label={t('serviceLocation')} value={admission.serviceLocation} />
          <Data label={t('initialNotes')} value={admission.initialNotes} />
        </dl>
        {admission.servicePricing.length ? (
          <section
            aria-labelledby="service-pricing-title"
            className="grid min-w-0 gap-2 border-t pt-4"
          >
            <h3 id="service-pricing-title" className="font-medium">
              {t('servicePricing')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('servicePricingNote')}</p>
            <ul className="grid min-w-0 gap-2 text-sm">
              {admission.servicePricing.map((item) => (
                <li key={item.requestedService} className="flex flex-wrap gap-x-2">
                  <span>{item.serviceName ?? item.requestedService}</span>
                  <span className="text-muted-foreground">
                    {t(
                      `pricing_${item.status}` as
                        | 'pricing_available'
                        | 'pricing_price_missing'
                        | 'pricing_service_unavailable'
                        | 'pricing_ambiguous'
                        | 'pricing_access_required',
                    )}
                    {item.priceCents !== null
                      ? ` · ${formatCurrency(item.priceCents / 100, locale as Locale)} / ${item.pricingUnit}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {canManage && admission.stage !== 'admitted' ? (
          <details>
            <summary className="cursor-pointer font-medium text-primary">{t('saveCase')}</summary>
            <RHFActionForm
              action={updateAdmissionCaseAction}
              refreshOnSuccess
              className="mt-4 grid gap-4 rounded-md border p-4 md:grid-cols-2"
              warnOnUnsavedChanges
            >
              <HiddenCase admission={admission} timezone={timezone} />
              <Field
                name="firstName"
                label={t('firstName')}
                defaultValue={admission.firstName}
                required
              />
              <Field
                name="lastName"
                label={t('lastName')}
                defaultValue={admission.lastName}
                required
              />
              {hasPermission(permissions, 'facility.read') ? (
                <AsyncEntityCombobox
                  name="facilityId"
                  label={t('facility')}
                  entity="facilities"
                  organizationId={admission.organizationId}
                  placeholder={t('noFacility')}
                  {...(admission.facilityId && admission.facilityName
                    ? { initialOption: { id: admission.facilityId, label: admission.facilityName } }
                    : {})}
                />
              ) : (
                <input type="hidden" name="facilityId" value={admission.facilityId ?? ''} />
              )}
              {hasPermission(permissions, 'employee.read') ? (
                <AsyncEntityCombobox
                  name="ownerEmployeeId"
                  label={t('owner')}
                  entity="employees"
                  placeholder={t('unassigned')}
                  {...(admission.ownerEmployeeId && admission.ownerEmployeeName
                    ? {
                        initialOption: {
                          id: admission.ownerEmployeeId,
                          label: admission.ownerEmployeeName,
                        },
                      }
                    : {})}
                />
              ) : (
                <input
                  type="hidden"
                  name="ownerEmployeeId"
                  value={admission.ownerEmployeeId ?? ''}
                />
              )}
              <SelectField
                name="contactMethod"
                label={t('contactMethod')}
                value={admission.contactMethod}
              >
                {(['phone', 'email', 'in_person', 'letter', 'other'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </SelectField>
              <Field
                name="requesterName"
                label={t('requesterName')}
                defaultValue={admission.requesterName ?? ''}
              />
              <Field
                name="requesterRelationship"
                label={t('requesterRelationship')}
                defaultValue={admission.requesterRelationship ?? ''}
              />
              <Field
                name="contactEmail"
                label={t('contactEmail')}
                type="email"
                defaultValue={admission.contactEmail ?? ''}
              />
              <Field
                name="contactPhone"
                label={t('contactPhone')}
                type="tel"
                defaultValue={admission.contactPhone ?? ''}
              />
              <Field
                name="inquirySource"
                label={t('inquirySource')}
                defaultValue={admission.inquirySource}
                required
              />
              <SelectField
                name="fundingPlan"
                label={t('fundingPlan')}
                value={admission.fundingPlan}
              >
                {(['unknown', 'private_pay', 'benefits', 'other'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(value === 'other' ? 'fundingOther' : value)}
                  </option>
                ))}
              </SelectField>
              <TextArea
                name="fundingPlanDetails"
                label={t('fundingPlanDetails')}
                defaultValue={admission.fundingPlanDetails ?? ''}
              />
              <Field
                name="preferredStartDate"
                label={t('preferredStartDate')}
                type="date"
                defaultValue={admission.preferredStartDate ?? ''}
              />
              <Field
                name="nextFollowUpAt"
                label={t('followUp')}
                type="datetime-local"
                defaultValue={
                  admission.nextFollowUpAt
                    ? visitDateTimeInputValue(admission.nextFollowUpAt, timezone)
                    : ''
                }
              />
              <TextArea
                name="requestedServices"
                label={t('requestedServices')}
                defaultValue={admission.requestedServices.join('\n')}
              />
              <TextArea
                name="serviceLocation"
                label={t('serviceLocation')}
                defaultValue={admission.serviceLocation ?? ''}
              />
              <TextArea
                name="initialNotes"
                label={t('initialNotes')}
                defaultValue={admission.initialNotes ?? ''}
              />
              <Button type="submit" className="md:col-span-2">
                {t('saveCase')}
              </Button>
            </RHFActionForm>
          </details>
        ) : null}
        {canManage && canReadClient && !admission.clientId ? (
          <RHFActionForm
            action={linkAdmissionClientAction}
            refreshOnSuccess
            className="grid min-w-0 gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto]"
          >
            <HiddenCase admission={admission} />
            <AsyncEntityCombobox
              name="clientId"
              entity="clients"
              label={t('clientId')}
              placeholder={t('selectExistingClient')}
              organizationId={admission.organizationId}
              facilityId={admission.facilityId ?? undefined}
            />
            <Field name="reason" label={t('linkReason')} />
            <Button type="submit" className="self-end">
              {t('linkClient')}
            </Button>
          </RHFActionForm>
        ) : null}
        {canManage && canCreateClient && !admission.clientId && admission.stage !== 'admitted' ? (
          admission.facilityId ? (
            <form
              action={registerAdmissionClientAction}
              className="grid min-w-0 gap-2 rounded-md border p-4"
            >
              <HiddenCase admission={admission} />
              <p className="text-sm text-muted-foreground">{t('registerClientHelp')}</p>
              <Button type="submit" className="w-fit">
                {t('registerClient')}
              </Button>
            </form>
          ) : (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              {translate('Errors.onboardingFacilityRequired')}
            </p>
          )
        ) : null}
        {admission.clientId && canReadClient ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-sm">
            <Link className="text-primary underline" href={`/clients/${admission.clientId}`}>
              {admission.clientName ?? translate('Resources.unavailableClient')}
            </Link>
            {hasClientPermission(
              permissions,
              'client.update',
              tenantId,
              admission.organizationId,
              admission.facilityId,
            ) ? (
              <Link
                className="text-primary underline"
                href={`/clients/${admission.clientId}#contacts`}
              >
                {t('openContacts')}
              </Link>
            ) : null}
            {hasClientPermission(
              permissions,
              'communications.preferences.manage',
              tenantId,
              admission.organizationId,
              admission.facilityId,
            ) ? (
              <Link
                className="text-primary underline"
                href={`/clients/${admission.clientId}/communications#communication-preferences-title`}
              >
                {t('openCommunicationPreferences')}
              </Link>
            ) : null}
          </div>
        ) : null}
        {canManage && allowedStages.length && admission.stage !== 'admitted' ? (
          <RHFActionForm
            action={transitionAdmissionAction}
            refreshOnSuccess
            className="grid min-w-0 gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto]"
          >
            <HiddenCase admission={admission} />
            <SelectField name="toStage" label={t('moveTo')} value={allowedStages[0]!}>
              {allowedStages.map((stage) => (
                <option key={stage} value={stage}>
                  {t(labelForStage(stage))}
                </option>
              ))}
            </SelectField>
            <Field name="reason" label={t('reason')} />
            <ConfirmSubmitButton confirmation={t('moveStageConfirmation')} variant="secondary">
              {t('moveTo')}
            </ConfirmSubmitButton>
          </RHFActionForm>
        ) : null}
      </section>

      <section
        aria-labelledby="assessment-title"
        className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="assessment-title" className="text-xl font-semibold">
          {t('assessment')}
        </h2>
        {canManage && admission.stage !== 'admitted' ? (
          <RHFActionForm
            action={saveAdmissionAssessmentAction}
            refreshOnSuccess
            className="grid min-w-0 gap-4 md:grid-cols-2"
            warnOnUnsavedChanges
          >
            <HiddenCase admission={admission} />
            {admission.assessmentUpdatedAt ? (
              <p className="text-sm text-muted-foreground md:col-span-2">
                {t('assessmentLastUpdated', {
                  date:
                    formatDateTime(admission.assessmentUpdatedAt, locale as Locale, timezone) ??
                    '—',
                })}
              </p>
            ) : null}
            <p className="font-semibold md:col-span-2">{t('requestedServicesAssessment')}</p>
            <TextArea
              name="requestedServicesAssessment"
              label={t('requestedServicesAssessment')}
              defaultValue={
                admission.assessment?.requestedServices.join('\n') ??
                admission.requestedServices.join('\n')
              }
            />
            <TextArea
              name="householdSupport"
              label={t('householdSupport')}
              defaultValue={admission.assessment?.householdSupport ?? ''}
            />
            <TextArea
              name="everydayAssistance"
              label={t('everydayAssistance')}
              defaultValue={admission.assessment?.everydayAssistance ?? ''}
            />
            <TextArea
              name="accompaniment"
              label={t('accompaniment')}
              defaultValue={admission.assessment?.accompaniment ?? ''}
            />
            <fieldset className="grid min-w-0 gap-2 md:col-span-2">
              <legend className="text-sm font-medium">{t('preferredDays')}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    'monday',
                    'tuesday',
                    'wednesday',
                    'thursday',
                    'friday',
                    'saturday',
                    'sunday',
                  ] as const
                ).map((day) => (
                  <label
                    key={day}
                    className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="preferredDays"
                      value={day}
                      defaultChecked={admission.assessment?.preferredDays.includes(day) ?? false}
                    />
                    {t(
                      `weekday_${day}` as
                        | 'weekday_monday'
                        | 'weekday_tuesday'
                        | 'weekday_wednesday'
                        | 'weekday_thursday'
                        | 'weekday_friday'
                        | 'weekday_saturday'
                        | 'weekday_sunday',
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="font-semibold md:col-span-2">{t('preferredTimeWindows')}</p>
            <Field
              name="preferredTimeStart"
              label={t('preferredTimeStart')}
              type="time"
              defaultValue={admission.assessment?.preferredTimeStart ?? ''}
            />
            <Field
              name="preferredTimeEnd"
              label={t('preferredTimeEnd')}
              type="time"
              defaultValue={admission.assessment?.preferredTimeEnd ?? ''}
            />
            <Field
              name="visitsPerWeek"
              label={t('visitsPerWeek')}
              type="number"
              defaultValue={admission.assessment?.visitsPerWeek?.toString() ?? ''}
            />
            <Field
              name="assessmentPreferredStartDate"
              label={t('preferredStartDate')}
              type="date"
              defaultValue={admission.assessment?.preferredStartDate ?? ''}
            />
            <TextArea
              name="accessibility"
              label={t('accessibility')}
              defaultValue={admission.assessment?.accessibility ?? ''}
            />
            <TextArea
              name="preferences"
              label={t('preferences')}
              defaultValue={admission.assessment?.preferences ?? ''}
            />
            <TextArea
              name="organizationalNotes"
              label={t('organizationalNotes')}
              defaultValue={admission.assessment?.organizationalNotes ?? ''}
            />
            <Button type="submit" className="md:col-span-2">
              {t('saveAssessment')}
            </Button>
          </RHFActionForm>
        ) : admission.assessment ? (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {assessmentSummary(admission.assessment)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('blockers')}</p>
        )}
      </section>

      <section
        aria-labelledby="checklist-title"
        className="grid min-w-0 gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="checklist-title" className="text-xl font-semibold">
          {t('checklist')}
        </h2>
        <ul className="grid min-w-0 gap-3">
          {admission.checklist.map((item) => (
            <li
              key={item.code}
              className={`grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto] md:items-center ${item.finding?.severity === 'blocker' ? 'border-warning/70 bg-warning-muted/20' : item.finding?.severity === 'complete' || item.finding?.severity === 'not_applicable' ? 'bg-muted/30' : ''}`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{defaultChecklistLabels[item.code] ?? item.label}</p>
                  <Badge variant={item.mandatory ? 'warning' : 'secondary'}>
                    {item.mandatory ? t('requiredItem') : t('optionalItem')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(item.source)} ·{' '}
                  {item.finding
                    ? t(
                        `status_${item.finding.severity}` as
                          | 'status_blocker'
                          | 'status_warning'
                          | 'status_complete'
                          | 'status_not_applicable',
                      )
                    : '—'}
                  {item.finding?.detail
                    ? ` · ${localizeFinding(t, item.finding).detail ?? item.finding.detail}`
                    : item.finding?.detailCode
                      ? ` · ${localizeFinding(t, item.finding).detail}`
                      : ''}
                </p>
                <Link
                  className="mt-1 inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline"
                  href={checklistTarget(item.code)}
                >
                  {t('reviewSection')}
                </Link>
              </div>
              {canManage && item.source === 'manual' && admission.stage !== 'admitted' ? (
                <RHFActionForm
                  action={respondAdmissionChecklistAction}
                  refreshOnSuccess
                  className="flex flex-wrap items-end gap-2"
                >
                  <HiddenCase admission={admission} />
                  <input type="hidden" name="itemCode" value={item.code} />
                  <SelectField
                    name="status"
                    label={t('checklist')}
                    value={item.response?.status ?? ''}
                    required
                  >
                    <option value="" disabled>
                      {t('chooseChecklistStatus')}
                    </option>
                    <option value="complete">{t('complete')}</option>
                    <option value="not_applicable">{t('notApplicable')}</option>
                  </SelectField>
                  <Field
                    name="reason"
                    label={t('notApplicableReason')}
                    defaultValue={item.response?.reason ?? ''}
                  />
                  <Button type="submit">{t('saveResponse')}</Button>
                </RHFActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="sources-title"
        className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="sources-title" className="text-xl font-semibold">
          {t('linkedSources')}
        </h2>
        <ul className="grid min-w-0 gap-2 text-sm">
          {admission.documents.map(({ link, artifact }) => {
            const documentTitle =
              admission.checklist.find((item) => item.code === link.requirementCode)?.label ??
              translate('Documents.title');
            const documentStatus =
              artifact.status === 'ready'
                ? translate('Documents.status.ready')
                : artifact.status === 'pending'
                  ? translate('Documents.status.pending')
                  : artifact.status === 'failed'
                    ? translate('Documents.status.failed')
                    : translate('Documents.status.superseded');
            return (
              <li key={artifact.id}>
                {t('document')}:{' '}
                {artifact.status === 'ready' ? (
                  <Link
                    className="text-primary underline"
                    href={'/documents/' + artifact.id + '/pdf'}
                  >
                    {documentTitle}
                  </Link>
                ) : (
                  documentTitle
                )}{' '}
                · {documentStatus}
              </li>
            );
          })}
          {admission.tasks.map(({ task }) => (
            <li key={task.id}>
              {t('linkTask')}:{' '}
              <Link className="text-primary underline" href={`/operations/tasks/${task.id}`}>
                {task.title}
              </Link>{' '}
              · {task.status}
            </li>
          ))}
          {admission.communications.map(({ interaction }) => (
            <li key={interaction.id}>
              <p>
                {t('linkCommunication')}: {interaction.subject} ·{' '}
                {formatDateTime(interaction.occurredAt, locale as Locale, timezone)}
              </p>
              {interaction.summary ? (
                <p className="whitespace-pre-wrap text-muted-foreground">{interaction.summary}</p>
              ) : null}
            </li>
          ))}
          {!admission.documents.length &&
          !admission.tasks.length &&
          !admission.communications.length ? (
            <li className="text-muted-foreground">—</li>
          ) : null}
        </ul>
        {canManage ? (
          <div className="grid min-w-0 gap-3 border-t pt-4">
            {admission.stage !== 'admitted' ? (
              <>
                {hasPermission(permissions, 'documents.read') &&
                canReadClient &&
                admission.checklist.some((item) => item.source === 'document') ? (
                  <SourceForm
                    admission={admission}
                    kind="document"
                    t={t}
                    documentCodes={admission.checklist.filter((item) => item.source === 'document')}
                  />
                ) : null}
                {hasPermission(permissions, 'communications.read') &&
                canReadClient &&
                admission.clientId ? (
                  <SourceForm admission={admission} kind="communication" t={t} />
                ) : null}
              </>
            ) : null}
            {hasPermission(permissions, 'operations.read') ? (
              <SourceForm
                admission={admission}
                kind="task"
                t={t}
                defaultSourceId={query.createdTaskId ?? ''}
              />
            ) : null}
            {canScheduleRead &&
            canReadClient &&
            admission.clientId &&
            ['preparation', 'ready_for_admission', 'admitted'].includes(admission.stage) &&
            !['declined', 'withdrawn'].includes(admission.stage) ? (
              <SourceForm
                admission={admission}
                kind="visit"
                t={t}
                defaultSourceId={query.createdVisitId ?? ''}
              />
            ) : null}
          </div>
        ) : null}
        {canManage &&
        hasPermission(permissions, 'operations.tasks.create') &&
        !['declined', 'withdrawn'].includes(admission.stage) ? (
          <Button asChild variant="secondary" className="w-fit">
            <Link href={`/operations/tasks?admissionCaseId=${admission.id}`}>
              {t('createFollowUpTask')}
            </Link>
          </Button>
        ) : null}
      </section>

      {canManage &&
      hasPermission(permissions, 'communications.create') &&
      admission.stage !== 'admitted' ? (
        <section
          aria-labelledby="record-communication-title"
          className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
        >
          <h2 id="record-communication-title" className="text-xl font-semibold">
            {t('recordCommunication')}
          </h2>
          <RHFActionForm
            action={recordAdmissionCommunicationAction}
            refreshOnSuccess
            className="grid min-w-0 gap-4 md:grid-cols-2"
          >
            <HiddenCase admission={admission} timezone={timezone} />
            <SelectField name="direction" label={t('direction')} value="inbound">
              {(['inbound', 'outbound', 'internal'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(
                    `direction_${value}` as
                      | 'direction_inbound'
                      | 'direction_outbound'
                      | 'direction_internal',
                  )}
                </option>
              ))}
            </SelectField>
            <SelectField name="channel" label={t('channel')} value="phone">
              {(['phone', 'in_person', 'email', 'letter', 'portal', 'other'] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {t(
                      `channel_${value}` as
                        | 'channel_phone'
                        | 'channel_in_person'
                        | 'channel_email'
                        | 'channel_letter'
                        | 'channel_portal'
                        | 'channel_other',
                    )}
                  </option>
                ),
              )}
            </SelectField>
            <SelectField name="category" label={t('category')} value="general_inquiry">
              {(
                [
                  'general_inquiry',
                  'appointment_coordination',
                  'cancellation_rescheduling',
                  'service_request',
                  'service_agreement',
                  'documentation',
                  'billing_payment',
                  'benefits_payer',
                  'complaint_feedback',
                  'other',
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {t(
                    `communicationCategory_${value}` as
                      | 'communicationCategory_general_inquiry'
                      | 'communicationCategory_appointment_coordination'
                      | 'communicationCategory_cancellation_rescheduling'
                      | 'communicationCategory_service_request'
                      | 'communicationCategory_service_agreement'
                      | 'communicationCategory_documentation'
                      | 'communicationCategory_billing_payment'
                      | 'communicationCategory_benefits_payer'
                      | 'communicationCategory_complaint_feedback'
                      | 'communicationCategory_other',
                  )}
                </option>
              ))}
            </SelectField>
            <SelectField name="outcome" label={t('outcome')} value="information_provided">
              {(
                [
                  'information_provided',
                  'request_received',
                  'action_required',
                  'appointment_agreed',
                  'no_answer',
                  'resolved',
                  'other',
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {t(
                    `communicationOutcome_${value}` as
                      | 'communicationOutcome_information_provided'
                      | 'communicationOutcome_request_received'
                      | 'communicationOutcome_action_required'
                      | 'communicationOutcome_appointment_agreed'
                      | 'communicationOutcome_no_answer'
                      | 'communicationOutcome_resolved'
                      | 'communicationOutcome_other',
                  )}
                </option>
              ))}
            </SelectField>
            <Field name="subject" label={t('communicationSubject')} required />
            <Field
              name="occurredAt"
              label={t('communicationOccurredAt')}
              type="datetime-local"
              required
            />
            <TextArea name="summary" label={t('communicationSummary')} defaultValue="" />
            <Button type="submit" className="md:col-span-2">
              {t('recordCommunication')}
            </Button>
          </RHFActionForm>
        </section>
      ) : null}

      <section
        aria-labelledby="history-title"
        className="grid min-w-0 gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="history-title" className="text-xl font-semibold">
          {t('history')}
        </h2>
        <ol className="grid min-w-0 gap-3">
          {admission.history.map((entry) => (
            <li
              key={`${entry.toStage}-${entry.occurredAt}`}
              className="border-l-2 border-primary/20 pl-3"
            >
              <p className="font-medium">
                {entry.fromStage ? `${t(labelForStage(entry.fromStage))} → ` : ''}
                {t(labelForStage(entry.toStage))}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(entry.occurredAt, locale as Locale, timezone)} ·{' '}
                {entry.actorName ?? translate('Resources.unavailableUser')}
                {entry.reason ? ` · ${entry.reason}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
      <Button asChild variant="secondary">
        <Link href="/admissions">{t('backToWorklist')}</Link>
      </Button>
    </div>
  );
}

async function AdmissionFundingSummary({ admission }: { admission: AdmissionCaseSummary }) {
  const [t, locale] = await Promise.all([getTranslations('Onboarding'), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canReadBenefits = Boolean(
    admission.clientId &&
    hasClientPermission(
      permissions,
      'benefits.read',
      header['X-Tenant-Id'],
      admission.organizationId,
      admission.facilityId,
    ),
  );
  const [readinessResult, budgetResult, insurancesResult, gradesResult] = await Promise.all([
    api.GET('/api/v1/onboarding/cases/{id}/readiness', {
      params: { path: { id: admission.id }, header },
    }),
    canReadBenefits
      ? api.GET('/api/v1/clients/{clientId}/budgets', {
          params: { path: { clientId: admission.clientId! }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadBenefits
      ? api.GET('/api/v1/clients/{clientId}/insurances', {
          params: { path: { clientId: admission.clientId! }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    canReadBenefits
      ? api.GET('/api/v1/clients/{clientId}/pflegegrade', {
          params: { path: { clientId: admission.clientId! }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const readiness = readinessResult.data as AdmissionCaseDetail['readiness'] | undefined;
  const budget = budgetResult.data as components['schemas']['BenefitBudgetResponseDto'] | undefined;
  const insurances = (insurancesResult.data ??
    []) as components['schemas']['ClientInsuranceResponseDto'][];
  const grades = (gradesResult.data ?? []) as components['schemas']['PflegegradResponseDto'][];
  const today = todayDateKey('Europe/Berlin');
  const currentGrade = grades
    .filter(
      (grade) =>
        grade.status === 'confirmed' &&
        grade.validFrom <= today &&
        (!grade.validUntil || grade.validUntil >= today),
    )
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
  const fundingFindings = (readiness?.findings ?? []).filter((finding) =>
    finding.code.toLowerCase().includes('funding'),
  );
  const intakePlan = fundingPlanLabel(t, admission.fundingPlan);
  const benefitsFailed = Boolean(
    budgetResult.error || insurancesResult.error || gradesResult.error,
  );

  return (
    <section
      id="funding-title"
      aria-labelledby="funding-heading"
      className="grid scroll-mt-4 gap-3 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id="funding-heading" className="text-xl font-semibold">
            {t('fundingSummary')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('fundingPlanReported', { plan: intakePlan })}
          </p>
        </div>
        {canReadBenefits ? (
          <Button asChild variant="secondary">
            <Link href={`/clients/${admission.clientId}/benefits`}>{t('openFunding')}</Link>
          </Button>
        ) : null}
      </div>
      {!admission.clientId ? (
        <p className="text-sm text-muted-foreground">{t('fundingAvailableAfterClient')}</p>
      ) : !canReadBenefits ? (
        <p className="text-sm text-muted-foreground">{t('fundingAccessRequired')}</p>
      ) : benefitsFailed ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('fundingSummaryUnavailable')}
        </p>
      ) : (
        <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-3">
          <Data
            label={t('careLevel')}
            value={
              currentGrade ? t('careLevelNumber', { grade: currentGrade.grade }) : t('notConfirmed')
            }
          />
          <Data
            label={t('healthInsurer')}
            value={
              insurances.find((insurance) => insurance.isPrimary)?.insurerName ??
              t('notRecordedYet')
            }
          />
          <Data
            label={t('benefitFundingSources')}
            value={
              budget?.fundingSources.length
                ? budget.fundingSources
                    .map(
                      (source) =>
                        source.label ??
                        t(
                          `fundingSourceType_${source.sourceType}` as
                            | 'fundingSourceType_statutory_long_term_care_insurance'
                            | 'fundingSourceType_private_long_term_care_insurance'
                            | 'fundingSourceType_self_pay'
                            | 'fundingSourceType_other',
                        ),
                    )
                    .join(', ')
                : t('notRecordedYet')
            }
          />
        </dl>
      )}
      {readinessResult.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('readinessUnavailable')}
        </p>
      ) : fundingFindings.length ? (
        <ul className="grid min-w-0 gap-2 text-sm">
          {fundingFindings.map((finding) => {
            const localized = localizeFinding(t, finding);
            return (
              <li key={finding.code} className="rounded-md bg-background p-3">
                <p className="font-medium">{localized.label}</p>
                {localized.detail ? (
                  <p className="text-muted-foreground">{localized.detail}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t('fundingBalanceNotDisplayed', {
          date: formatDate(budget?.asOf ?? null, locale as Locale) ?? '—',
        })}
      </p>
    </section>
  );
}

async function AdmissionAgreementsSummary({ admission }: { admission: AdmissionCaseSummary }) {
  const [t, locale] = await Promise.all([getTranslations('Onboarding'), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canReadAgreements = Boolean(
    admission.clientId &&
    hasClientPermission(
      permissions,
      'service_agreement.read',
      header['X-Tenant-Id'],
      admission.organizationId,
      admission.facilityId,
    ),
  );
  const canCreateAgreement = Boolean(
    admission.clientId &&
    hasClientPermission(
      permissions,
      'service_agreement.create',
      header['X-Tenant-Id'],
      admission.organizationId,
      admission.facilityId,
    ),
  );
  const result = canReadAgreements
    ? await api.GET('/api/v1/clients/{clientId}/service-agreements', {
        params: {
          path: { clientId: admission.clientId! },
          query: { page: 1, pageSize: 5, sortBy: 'validFrom', sortOrder: 'desc' },
          header,
        },
      })
    : null;
  const data = result?.data as components['schemas']['ServiceAgreementListResponseDto'] | undefined;
  return (
    <section
      id="agreement-title"
      aria-labelledby="agreement-heading"
      className="grid scroll-mt-4 gap-3 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id="agreement-heading" className="text-xl font-semibold">
            {t('agreementSummary')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('agreementHandoffHelp')}</p>
        </div>
        {admission.clientId && canReadAgreements ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={`/clients/${admission.clientId}/service-agreements#agreements`}>
                {t('openAgreement')}
              </Link>
            </Button>
            {canCreateAgreement ? (
              <Button asChild>
                <Link href={`/clients/${admission.clientId}/service-agreements#agreements`}>
                  {t('createAgreement')}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {!admission.clientId ? (
        <p className="text-sm text-muted-foreground">{t('agreementAvailableAfterClient')}</p>
      ) : !canReadAgreements ? (
        <p className="text-sm text-muted-foreground">{t('agreementAccessRequired')}</p>
      ) : result?.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('agreementSummaryUnavailable')}
        </p>
      ) : data?.items.length ? (
        <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((agreement) => (
            <li key={agreement.id} className="grid min-w-0 gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  href={`/clients/${admission.clientId}/service-agreements?findServicesFor=${agreement.id}#agreements`}
                >
                  {agreement.reference ||
                    t('agreementPeriod', {
                      from: formatDate(agreement.validFrom, locale as Locale) ?? '—',
                      until:
                        formatDate(agreement.validUntil ?? null, locale as Locale) ??
                        t('openEnded'),
                    })}
                </Link>
                <Badge variant={agreementStatusVariant(agreement.status)}>
                  {t(
                    `agreementStatus_${agreement.status}` as
                      | 'agreementStatus_draft'
                      | 'agreementStatus_active'
                      | 'agreementStatus_suspended'
                      | 'agreementStatus_ended',
                  )}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                {t('agreementServicesCount', { count: agreement.serviceCount })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noAgreementsYet')}</p>
      )}
    </section>
  );
}

async function AdmissionFirstVisitSummary({ admission }: { admission: AdmissionCaseSummary }) {
  const [t, locale] = await Promise.all([getTranslations('Onboarding'), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canReadVisit = hasClientPermission(
    permissions,
    'schedule.read',
    tenantId,
    admission.organizationId,
    admission.facilityId,
  );
  const canCreateVisit = hasClientPermission(
    permissions,
    'schedule.create',
    tenantId,
    admission.organizationId,
    admission.facilityId,
  );
  const canManage = hasPermission(permissions, 'onboarding.manage');
  const [visitResult, clientResult] = await Promise.all([
    admission.firstVisitId && canReadVisit
      ? api.GET('/api/v1/visits/{id}', {
          params: { path: { id: admission.firstVisitId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
    admission.clientId && canCreateVisit
      ? api.GET('/api/v1/clients/{id}', {
          params: { path: { id: admission.clientId }, header },
        })
      : Promise.resolve({ data: undefined, error: undefined }),
  ]);
  const visit = visitResult.data as components['schemas']['VisitResponseDto'] | undefined;
  const client = clientResult.data as components['schemas']['ClientResponseDto'] | undefined;
  const canPlan = Boolean(
    !admission.firstVisitId &&
    admission.clientId &&
    client?.status === 'active' &&
    canReadVisit &&
    canCreateVisit &&
    canManage &&
    ['preparation', 'ready_for_admission', 'admitted'].includes(admission.stage),
  );
  return (
    <section
      id="first-visit-title"
      aria-labelledby="first-visit-heading"
      className="grid scroll-mt-4 gap-3 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id="first-visit-heading" className="text-xl font-semibold">
            {t('firstVisitSummary')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('firstVisitHandoffHelp')}</p>
        </div>
        {canPlan && admission.clientId ? (
          <Button asChild>
            <Link
              href={planningHref(
                admission.id,
                admission.clientId,
                admission.preferredStartDate,
                admission.organizationId,
                admission.facilityId,
              )}
            >
              {t('openScheduling')}
            </Link>
          </Button>
        ) : null}
      </div>
      {admission.firstVisitId ? (
        !canReadVisit ? (
          <p className="text-sm text-muted-foreground">{t('firstVisitAccessRequired')}</p>
        ) : visit ? (
          <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
            <Data
              label={t('firstScheduledVisit')}
              value={
                <ResourceReference
                  label={
                    formatDateTime(visit.plannedStart, locale as Locale, visit.timezone) ??
                    t('firstScheduledVisit')
                  }
                  href={`/visits/${visit.id}`}
                />
              }
            />
            <Data
              label={t('assignedEmployee')}
              value={
                visit.assignments
                  .filter((assignment) => assignment.status === 'active')
                  .map((assignment) => assignment.employeeDisplayName)
                  .filter(Boolean)
                  .join(', ') || t('unassigned')
              }
            />
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('firstVisitUnavailable')}
          </p>
        )
      ) : canPlan ? null : admission.clientId && admission.stage !== 'admitted' ? (
        <p className="text-sm text-muted-foreground">{t('scheduleAfterAdmission')}</p>
      ) : !admission.clientId ? (
        <p className="text-sm text-muted-foreground">{t('linkOrCreateClientBeforeScheduling')}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('firstVisitNotScheduled')}</p>
      )}
    </section>
  );
}

function AdmissionWorkspaceSkeleton() {
  return (
    <section aria-busy="true" className="grid min-w-0 gap-3 rounded-lg border bg-card p-5">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-md bg-muted/70" />
    </section>
  );
}

function stageBadgeVariant(stage: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (stage === 'ready_for_admission' || stage === 'admitted') return 'success';
  if (stage === 'declined' || stage === 'withdrawn') return 'secondary';
  if (stage === 'preparation') return 'warning';
  return 'secondary';
}

function agreementStatusVariant(
  status: string,
): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'active') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'suspended') return 'destructive';
  return 'secondary';
}

function fundingPlanLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Onboarding'>>>,
  fundingPlan: string,
) {
  if (fundingPlan === 'other') return t('fundingOther');
  if (fundingPlan === 'private_pay' || fundingPlan === 'benefits' || fundingPlan === 'unknown')
    return t(fundingPlan);
  return t('unknown');
}

function nextActionForStage(stage: string) {
  if (stage === 'inquiry')
    return { label: 'nextAction_inquiry' as const, href: '#assessment-title' };
  if (stage === 'assessment')
    return { label: 'nextAction_assessment' as const, href: '#checklist-title' };
  if (stage === 'preparation')
    return { label: 'nextAction_preparation' as const, href: '#readiness-title' };
  if (stage === 'ready_for_admission')
    return { label: 'nextAction_ready' as const, href: '#readiness-title' };
  if (stage === 'admitted')
    return { label: 'nextAction_admitted' as const, href: '#first-visit-title' };
  return { label: 'nextAction_closed' as const, href: '#history-title' };
}

function checklistTarget(code: string) {
  if (code === 'needs_assessment') return '#assessment-title';
  if (code === 'funding_arrangement') return '#funding-title';
  if (code === 'service_agreement') return '#agreement-title';
  if (code === 'first_visit') return '#first-visit-title';
  if (code === 'provider_document_evidence') return '#sources-title';
  return '#details-title';
}

function HiddenCase({
  admission,
  timezone,
}: {
  admission: AdmissionCaseDetail;
  timezone?: string;
}) {
  return (
    <>
      <input type="hidden" name="caseId" value={admission.id} />
      <input type="hidden" name="expectedVersion" value={admission.version} />
      {timezone ? <input type="hidden" name="timezone" value={timezone} /> : null}
    </>
  );
}

function localizeFinding(
  t: Awaited<ReturnType<typeof getTranslations<'Onboarding'>>>,
  finding: Finding,
): Finding {
  let label = finding.label;
  switch (finding.code) {
    case 'client_identity':
      label = t('clientIdentityComplete');
      break;
    case 'primary_contact':
      label = t('primaryContactRecorded');
      break;
    case 'needs_assessment':
      label = t('needsAssessmentComplete');
      break;
    case 'funding_arrangement':
      label = t('fundingDocumented');
      break;
    case 'service_agreement':
      label = t('serviceAgreementAccepted');
      break;
    case 'first_visit':
      label = t('firstVisitPlanned');
      break;
    case 'CONTACT_AUTHORITY_UNCONFIRMED':
      label = t('findingLabels.CONTACT_AUTHORITY_UNCONFIRMED');
      break;
    case 'FUNDING_BALANCE_UNKNOWN':
      label = t('findingLabels.FUNDING_BALANCE_UNKNOWN');
      break;
    case 'FUNDING_INSURANCE_UNKNOWN':
      label = t('findingLabels.FUNDING_INSURANCE_UNKNOWN');
      break;
    case 'FUNDING_CARE_GRADE_UNKNOWN':
      label = t('findingLabels.FUNDING_CARE_GRADE_UNKNOWN');
      break;
    case 'FUNDING_ARRANGEMENT_REQUIRES_REVIEW':
      label = t('findingLabels.FUNDING_ARRANGEMENT_REQUIRES_REVIEW');
      break;
  }

  let detail = finding.detail;
  switch (finding.detailCode) {
    case 'CLIENT_ACCESS_REQUIRED_IDENTITY':
      detail = t('findingDetails.CLIENT_ACCESS_REQUIRED_IDENTITY');
      break;
    case 'CLIENT_ACCESS_REQUIRED_CONTACT':
      detail = t('findingDetails.CLIENT_ACCESS_REQUIRED_CONTACT');
      break;
    case 'BENEFITS_ACCESS_REQUIRED':
      detail = t('findingDetails.BENEFITS_ACCESS_REQUIRED');
      break;
    case 'FUNDING_SOURCE_MISSING':
      detail = t('findingDetails.FUNDING_SOURCE_MISSING');
      break;
    case 'ENTITLEMENT_MISSING':
      detail = t('findingDetails.ENTITLEMENT_MISSING');
      break;
    case 'FUNDING_PLAN_MISSING':
      detail = t('findingDetails.FUNDING_PLAN_MISSING');
      break;
    case 'FUNDING_PLAN_DETAILS_MISSING':
      detail = t('findingDetails.FUNDING_PLAN_DETAILS_MISSING');
      break;
    case 'AGREEMENT_ACCESS_REQUIRED':
      detail = t('findingDetails.AGREEMENT_ACCESS_REQUIRED');
      break;
    case 'AGREEMENT_DRAFT':
      detail = t('findingDetails.AGREEMENT_DRAFT');
      break;
    case 'AGREEMENT_MISSING':
      detail = t('findingDetails.AGREEMENT_MISSING');
      break;
    case 'AGREEMENT_SERVICES_MISSING':
      detail = t('findingDetails.AGREEMENT_SERVICES_MISSING');
      break;
    case 'DOCUMENT_ACCESS_REQUIRED':
      detail = t('findingDetails.DOCUMENT_ACCESS_REQUIRED');
      break;
    case 'DOCUMENT_EVIDENCE_MISSING':
      detail = t('findingDetails.DOCUMENT_EVIDENCE_MISSING');
      break;
    case 'UNKNOWN_BALANCE_NOT_GUARANTEE':
      detail = t('findingDetails.UNKNOWN_BALANCE_NOT_GUARANTEE');
      break;
  }
  return { ...finding, label, ...(detail ? { detail } : {}) };
}

function FindingList({ title, findings }: { title: string; findings: Finding[] }) {
  return (
    <div className="grid min-w-0 gap-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="grid min-w-0 gap-2">
        {findings.map((finding) => (
          <li key={finding.code} className="rounded-md bg-background p-3">
            <span className="font-medium">{finding.label}</span>
            {finding.detail ? (
              <p className="text-sm text-muted-foreground">{finding.detail}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Data({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words">{value || '—'}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = 'text',
  required = false,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-md border px-3 font-normal"
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <Textarea
        className="min-h-20 rounded-md border p-3 font-normal"
        name={name}
        defaultValue={defaultValue}
        maxLength={4000}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  value,
  children,
  required = false,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-card px-3 font-normal"
        name={name}
        defaultValue={value}
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

function SourceForm({
  admission,
  kind,
  t,
  documentCodes = emptyChecklistItems,
  defaultSourceId,
}: {
  admission: AdmissionCaseDetail;
  kind: 'document' | 'task' | 'communication' | 'visit';
  t: Awaited<ReturnType<typeof getTranslations<'Onboarding'>>>;
  documentCodes?: ChecklistItem[];
  defaultSourceId?: string;
}) {
  return (
    <RHFActionForm
      action={linkAdmissionSourceAction}
      refreshOnSuccess
      className="flex flex-wrap items-end gap-2"
    >
      <HiddenCase admission={admission} />
      <input type="hidden" name="sourceKind" value={kind} />
      <Field
        name="sourceId"
        label={t(
          kind === 'document'
            ? 'linkDocument'
            : kind === 'task'
              ? 'linkTask'
              : kind === 'communication'
                ? 'linkCommunication'
                : 'linkVisit',
        )}
        required
        defaultValue={defaultSourceId ?? ''}
      />
      {kind === 'document' ? (
        <SelectField
          name="requirementCode"
          label={t('document')}
          value={documentCodes[0]?.code ?? ''}
        >
          {documentCodes.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <Button type="submit">{t('linkAction')}</Button>
    </RHFActionForm>
  );
}

function labelForStage(
  stage: string,
):
  | 'inquiry'
  | 'assessmentStage'
  | 'preparation'
  | 'ready_for_admission'
  | 'admitted'
  | 'declined'
  | 'withdrawn' {
  return stage === 'assessment' ? 'assessmentStage' : (stage as ReturnType<typeof labelForStage>);
}

function planningHref(
  caseId: string,
  clientId: string,
  preferredStartDate: string | null | undefined,
  organizationId: string,
  facilityId: string | null,
) {
  const query = new URLSearchParams({ clientId, admissionCaseId: caseId });
  query.set('organizationId', organizationId);
  if (facilityId) query.set('facilityId', facilityId);
  if (preferredStartDate && /^\d{4}-\d{2}-\d{2}$/.test(preferredStartDate))
    query.set('date', preferredStartDate);
  return `/planning?${query.toString()}`;
}

function transitionsFrom(stage: string): Array<(typeof stageValues)[number]> {
  switch (stage) {
    case 'inquiry':
      return ['assessment', 'declined', 'withdrawn'];
    case 'assessment':
      return ['inquiry', 'preparation', 'declined', 'withdrawn'];
    case 'preparation':
      return ['assessment', 'ready_for_admission', 'declined', 'withdrawn'];
    case 'ready_for_admission':
      return ['preparation', 'declined', 'withdrawn'];
    case 'declined':
    case 'withdrawn':
      return ['inquiry', 'assessment'];
    default:
      return [];
  }
}

function assessmentSummary(value: AdmissionCaseDetail['assessment']) {
  if (!value) return '';
  return [
    ...value.requestedServices,
    value.householdSupport,
    value.everydayAssistance,
    value.accompaniment,
    value.accessibility,
    value.preferences,
    value.organizationalNotes,
  ]
    .filter(Boolean)
    .join('\n');
}
