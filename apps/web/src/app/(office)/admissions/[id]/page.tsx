import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import type { components } from '@care/api-client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Button } from '@care/ui/components/button';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatCurrency, formatDate, formatDateTime } from '@app/web/i18n/format';
import { visitDateTimeInputValue } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
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
  checklist: ChecklistItem[];
  readiness: {
    canAdmit: boolean;
    blockers: Finding[];
    warnings: Finding[];
    findings: Finding[];
    fundingBalance: string;
  };
  history: Transition[];
  documents: Array<{ link: { requirementCode: string }; artifact: { id: string; status: string } }>;
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

export default async function AdmissionCasePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    updated?: string;
    createdVisitId?: string;
    createdTaskId?: string;
  }>;
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
  const canScheduleCreate = hasClientPermission(
    permissions,
    'schedule.create',
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
  const linkedClientResult =
    admission.clientId && canReadClient && canScheduleCreate
      ? await api.GET('/api/v1/clients/{id}', {
          params: { path: { id: admission.clientId }, header },
        })
      : null;
  const linkedClient = linkedClientResult?.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const createdVisit = createdVisitResult.data as
    | components['schemas']['VisitResponseDto']
    | undefined;
  const createdTask = createdTaskResult.data as
    | components['schemas']['OperationsTaskResponseDto']
    | undefined;
  const canPlanFirstVisit =
    Boolean(linkedClient && linkedClient.status === 'active') &&
    canScheduleCreate &&
    canScheduleRead &&
    canManage &&
    ['preparation', 'ready_for_admission', 'admitted'].includes(admission.stage) &&
    !['declined', 'withdrawn'].includes(admission.stage);
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
    <div className="grid gap-6">
      <PageHeader
        eyebrow={<Link href="/admissions">{t('title')}</Link>}
        title={`${admission.firstName} ${admission.lastName}`}
        description={`${t(labelForStage(admission.stage))} · ${t('stage')} ${admission.version}`}
        actions={
          admission.clientId && canReadClient ? (
            <Button asChild variant="secondary">
              <Link href={`/clients/${admission.clientId}`}>
                {admission.clientName ?? translate('Resources.unavailableClient')}
              </Link>
            </Button>
          ) : undefined
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
        className="grid gap-4 rounded-lg border bg-card p-5"
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
        ) : null}
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
          <form action={admitCaseAction}>
            <HiddenCase admission={admission} />
            <Button type="submit">{t('admit')}</Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="details-title" className="grid gap-4 rounded-lg border bg-card p-5">
        <h2 id="details-title" className="text-xl font-semibold">
          {t('caseDetails')}
        </h2>
        <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
          <section aria-labelledby="service-pricing-title" className="grid gap-2 border-t pt-4">
            <h3 id="service-pricing-title" className="font-medium">
              {t('servicePricing')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('servicePricingNote')}</p>
            <ul className="grid gap-2 text-sm">
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
              className="mt-4 grid gap-4 rounded-md border p-4 md:grid-cols-2"
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
              <Field
                name="facilityId"
                label={t('facility')}
                defaultValue={admission.facilityId ?? ''}
              />
              <Field
                name="ownerEmployeeId"
                label={t('owner')}
                defaultValue={admission.ownerEmployeeId ?? ''}
              />
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
            className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto]"
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
              className="grid gap-2 rounded-md border p-4"
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
            {hasClientPermission(
              permissions,
              'benefits.read',
              tenantId,
              admission.organizationId,
              admission.facilityId,
            ) ? (
              <Link
                className="text-primary underline"
                href={`/clients/${admission.clientId}/benefits`}
              >
                {t('openFunding')}
              </Link>
            ) : null}
            {hasClientPermission(
              permissions,
              'service_agreement.read',
              tenantId,
              admission.organizationId,
              admission.facilityId,
            ) ? (
              <Link
                className="text-primary underline"
                href={`/clients/${admission.clientId}/service-agreements`}
              >
                {t('openAgreement')}
              </Link>
            ) : null}
            {canPlanFirstVisit ? (
              <Link
                className="text-primary underline"
                href={planningHref(
                  admission.id,
                  admission.clientId,
                  admission.preferredStartDate ?? admission.assessment?.preferredStartDate,
                  admission.organizationId,
                  admission.facilityId,
                )}
              >
                {t('openScheduling')}
              </Link>
            ) : null}
          </div>
        ) : null}
        {canManage && allowedStages.length && admission.stage !== 'admitted' ? (
          <RHFActionForm
            action={transitionAdmissionAction}
            className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto]"
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
            <Button type="submit" className="self-end">
              {t('moveTo')}
            </Button>
          </RHFActionForm>
        ) : null}
      </section>

      <section
        aria-labelledby="assessment-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="assessment-title" className="text-xl font-semibold">
          {t('assessment')}
        </h2>
        {canManage && admission.stage !== 'admitted' ? (
          <RHFActionForm
            action={saveAdmissionAssessmentAction}
            className="grid gap-4 md:grid-cols-2"
          >
            <HiddenCase admission={admission} />
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
            <Field
              name="preferredDays"
              label={t('preferredDays')}
              defaultValue={admission.assessment?.preferredDays.join(', ') ?? ''}
            />
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
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {assessmentSummary(admission.assessment)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('blockers')}</p>
        )}
      </section>

      <section
        aria-labelledby="checklist-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="checklist-title" className="text-xl font-semibold">
          {t('checklist')}
        </h2>
        <ul className="grid gap-3">
          {admission.checklist.map((item) => (
            <li
              key={item.code}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div>
                <p className="font-medium">{defaultChecklistLabels[item.code] ?? item.label}</p>
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
              </div>
              {canManage && item.source === 'manual' && admission.stage !== 'admitted' ? (
                <RHFActionForm
                  action={respondAdmissionChecklistAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <HiddenCase admission={admission} />
                  <input type="hidden" name="itemCode" value={item.code} />
                  <SelectField
                    name="status"
                    label={t('checklist')}
                    value={item.response?.status ?? 'complete'}
                  >
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

      <section aria-labelledby="sources-title" className="grid gap-4 rounded-lg border bg-card p-5">
        <h2 id="sources-title" className="text-xl font-semibold">
          {t('linkedSources')}
        </h2>
        <ul className="grid gap-2 text-sm">
          {admission.firstVisitId && admission.firstVisitStartsAt ? (
            <li>
              {t('firstScheduledVisit')}:{' '}
              <ResourceReference
                label={
                  formatDateTime(admission.firstVisitStartsAt, locale as Locale, timezone) ??
                  t('firstScheduledVisit')
                }
                href={canScheduleRead ? `/visits/${admission.firstVisitId}` : null}
              />
            </li>
          ) : null}
          {admission.documents.map(({ link, artifact }) => (
            <li key={artifact.id}>
              {t('document')}: {link.requirementCode} · {artifact.status}
            </li>
          ))}
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
          <div className="grid gap-3 border-t pt-4">
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
          className="grid gap-4 rounded-lg border bg-card p-5"
        >
          <h2 id="record-communication-title" className="text-xl font-semibold">
            {t('recordCommunication')}
          </h2>
          <RHFActionForm
            action={recordAdmissionCommunicationAction}
            className="grid gap-4 md:grid-cols-2"
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

      <section aria-labelledby="history-title" className="grid gap-3 rounded-lg border bg-card p-5">
        <h2 id="history-title" className="text-xl font-semibold">
          {t('history')}
        </h2>
        <ol className="grid gap-3">
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
    <div className="grid gap-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="grid gap-2">
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
    <label className="grid gap-1 text-sm font-medium">
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
    <label className="grid gap-1 text-sm font-medium">
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
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-card px-3 font-normal"
        name={name}
        defaultValue={value}
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
    <RHFActionForm action={linkAdmissionSourceAction} className="flex flex-wrap items-end gap-2">
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
