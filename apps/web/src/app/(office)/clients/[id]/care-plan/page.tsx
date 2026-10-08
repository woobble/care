import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { components } from '@care/api-client';
import { errorMessageKey } from '../../../../../i18n/errors';
import { formatDate, formatDateTime } from '../../../../../i18n/format';
import type { Locale } from '../../../../../i18n/config';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '../../../../../lib/api';
import { ConfirmSubmitButton } from '../../../administration/confirm-submit-button';
import {
  activateCarePlanRevisionAction,
  createCarePlanAction,
  createCarePlanRevisionAction,
  endCarePlanAction,
  evaluateCarePlanAction,
  removeCarePlanItemAction,
  saveCarePlanAssessmentAction,
  saveCarePlanItemAction,
} from './actions';

type SearchParams = Promise<{
  error?: string;
  notice?: string;
  planId?: string;
  revisionId?: string;
  fromRevisionId?: string;
  toRevisionId?: string;
}>;

type CarePlanDetail = components['schemas']['CarePlanDetailDto'];
type CarePlanRevisionDetail = components['schemas']['CarePlanRevisionDetailDto'];
type CarePlanDiff = components['schemas']['CarePlanRevisionDiffDto'];
type Need = CarePlanRevisionDetail['needs'][number];
type Resource = CarePlanRevisionDetail['resources'][number];
type Goal = CarePlanRevisionDetail['goals'][number];
type Measure = CarePlanRevisionDetail['measures'][number];
type RiskResponse = CarePlanRevisionDetail['riskResponses'][number];
type SourceReference = CarePlanRevisionDetail['sourceReferences'][number];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const planStatusKeys: Record<string, string> = {
  draft: 'statuses.draft',
  active: 'statuses.active',
  under_review: 'statuses.underReview',
  ended: 'statuses.ended',
};
const revisionStatusKeys: Record<string, string> = {
  draft: 'statuses.draft',
  active: 'statuses.active',
  historical: 'statuses.historical',
};
const needCategoryKeys: Record<string, string> = {
  personal_care: 'options.needCategory.personalCare',
  mobility: 'options.needCategory.mobility',
  nutrition: 'options.needCategory.nutrition',
  hydration: 'options.needCategory.hydration',
  communication: 'options.needCategory.communication',
  cognition: 'options.needCategory.cognition',
  daily_living: 'options.needCategory.dailyLiving',
  social_participation: 'options.needCategory.socialParticipation',
  safety: 'options.needCategory.safety',
  other: 'options.needCategory.other',
};
const needSourceKeys: Record<string, string> = {
  client_report: 'options.needSource.clientReport',
  professional_observation: 'options.needSource.professionalObservation',
  representative_report: 'options.needSource.representativeReport',
  clinical_record: 'options.needSource.clinicalRecord',
};
const resourceCategoryKeys: Record<string, string> = {
  self_care: 'options.resourceCategory.selfCare',
  mobility: 'options.resourceCategory.mobility',
  communication: 'options.resourceCategory.communication',
  cognition: 'options.resourceCategory.cognition',
  daily_routine: 'options.resourceCategory.dailyRoutine',
  social_support: 'options.resourceCategory.socialSupport',
  personal_interest: 'options.resourceCategory.personalInterest',
  other: 'options.resourceCategory.other',
};
const measureCategoryKeys: Record<string, string> = {
  personal_care: 'options.measureCategory.personalCare',
  assistance: 'options.measureCategory.assistance',
  encouragement: 'options.measureCategory.encouragement',
  monitoring: 'options.measureCategory.monitoring',
  positioning: 'options.measureCategory.positioning',
  communication: 'options.measureCategory.communication',
  other: 'options.measureCategory.other',
};
const priorityKeys: Record<string, string> = {
  low: 'options.priority.low',
  normal: 'options.priority.normal',
  high: 'options.priority.high',
};
const commonStatusKeys: Record<string, string> = {
  active: 'statuses.active',
  addressed: 'statuses.addressed',
  deferred: 'statuses.deferred',
  available: 'statuses.available',
  needs_support: 'statuses.needsSupport',
  unavailable: 'statuses.unavailable',
  achieved: 'statuses.achieved',
  discontinued: 'statuses.discontinued',
  accepted: 'statuses.accepted',
  monitor: 'statuses.monitor',
};
const evaluationResultKeys: Record<string, string> = {
  effective: 'statuses.effective',
  partially_effective: 'statuses.partiallyEffective',
  not_effective: 'statuses.notEffective',
  changed_condition: 'statuses.changedCondition',
  no_change: 'statuses.noChange',
};
const goalOutcomeKeys: Record<string, string> = {
  achieved: 'options.goalOutcome.achieved',
  partially_achieved: 'options.goalOutcome.partiallyAchieved',
  not_achieved: 'options.goalOutcome.notAchieved',
  not_applicable: 'options.goalOutcome.notApplicable',
};
const recordKindKeys: Record<string, string> = {
  measurement: 'sourceReferences.kinds.measurement',
  observation: 'sourceReferences.kinds.observation',
  assessment: 'sourceReferences.kinds.assessment',
  risk_assessment: 'sourceReferences.kinds.riskAssessment',
};
const noticeKeys: Record<string, string> = {
  planCreated: 'notices.planCreated',
  assessmentSaved: 'notices.assessmentSaved',
  revisionCreated: 'notices.revisionCreated',
  revisionActivated: 'notices.revisionActivated',
  itemSaved: 'notices.itemSaved',
  itemRemoved: 'notices.itemRemoved',
  evaluationSaved: 'notices.evaluationSaved',
  planEnded: 'notices.planEnded',
};
const assessmentFields = [
  { key: 'clientConcerns', label: 'assessment.clientConcerns', group: 'client' },
  { key: 'clientWishes', label: 'assessment.clientWishes', group: 'client' },
  { key: 'clientGoals', label: 'assessment.clientGoals', group: 'client' },
  { key: 'clientHabits', label: 'assessment.clientHabits', group: 'client' },
  { key: 'clientPreferences', label: 'assessment.clientPreferences', group: 'client' },
  { key: 'clientPriorities', label: 'assessment.clientPriorities', group: 'client' },
  {
    key: 'professionalObservedNeeds',
    label: 'assessment.professionalObservedNeeds',
    group: 'professional',
  },
  {
    key: 'professionalResources',
    label: 'assessment.professionalResources',
    group: 'professional',
  },
  {
    key: 'professionalLimitations',
    label: 'assessment.professionalLimitations',
    group: 'professional',
  },
  { key: 'professionalRisks', label: 'assessment.professionalRisks', group: 'professional' },
  {
    key: 'professionalRationale',
    label: 'assessment.professionalRationale',
    group: 'professional',
  },
] as const;

export default async function ClientCarePlanPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id: clientId } = await params;
  const query = await searchParams;
  const [t, allT, locale] = await Promise.all([
    getTranslations('CarePlanning'),
    getTranslations(),
    getLocale() as Promise<Locale>,
  ]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [clientResult, plansResult, permissions] = await Promise.all([
    get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
    get('/api/v1/clients/{clientId}/care-plans', {
      params: { path: { clientId }, query: { page: 1, pageSize: 100 }, header },
    }),
    getPermissionGrants(api),
  ]);
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();
  const client = clientResult.data;
  if (!client) {
    return <LoadError message={t('client.loadFailed')} />;
  }

  const tenantId = header['X-Tenant-Id'];
  const canRead = hasClientPermission(
    permissions,
    'care_plan.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  if (!canRead) {
    return <LoadError message={t('client.noAccess')} />;
  }
  const canCreate =
    client.status !== 'archived' &&
    hasClientPermission(
      permissions,
      'care_plan.create',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canUpdate =
    client.status !== 'archived' &&
    hasClientPermission(
      permissions,
      'care_plan.update',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canActivate =
    client.status !== 'archived' &&
    hasClientPermission(
      permissions,
      'care_plan.activate',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canEvaluate =
    client.status !== 'archived' &&
    hasClientPermission(
      permissions,
      'care_plan.evaluate',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canEnd =
    client.status !== 'archived' &&
    hasClientPermission(
      permissions,
      'care_plan.end',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canReviewHistory = hasClientPermission(
    permissions,
    'care_plan.review_history',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const plans = plansResult.data?.items ?? [];
  const requestedPlanId = validUuid(query.planId);
  const selectedPlanItem = requestedPlanId
    ? plans.find((item) => item.id === requestedPlanId)
    : plans[0];
  const selectedPlanId = selectedPlanItem?.id;
  const selectedPlanResult = selectedPlanId
    ? await get('/api/v1/care-plans/{planId}', {
        params: { path: { planId: selectedPlanId }, header },
      })
    : undefined;
  const detail = selectedPlanResult?.data;
  const historyResult =
    selectedPlanId && canReviewHistory
      ? await get('/api/v1/care-plans/{planId}/revisions', {
          params: { path: { planId: selectedPlanId }, header },
        })
      : undefined;
  const history = historyResult?.data;
  const revisions = history?.revisions ?? [];
  const requestedRevisionId = validUuid(query.revisionId);
  const selectedRevision =
    revisions.find((item) => item.revision.id === requestedRevisionId) ??
    detail?.draftRevision ??
    detail?.activeRevision ??
    undefined;
  const isDraft =
    selectedRevision !== undefined &&
    detail?.draftRevision?.revision.id === selectedRevision.revision.id;
  const editableDraft = Boolean(isDraft && canUpdate && detail);
  const diffFromId = validUuid(query.fromRevisionId);
  const diffToId = validUuid(query.toRevisionId);
  const hasDiffRevisions =
    diffFromId !== undefined &&
    diffToId !== undefined &&
    diffFromId !== diffToId &&
    revisions.some((item) => item.revision.id === diffFromId) &&
    revisions.some((item) => item.revision.id === diffToId);
  const diffResult =
    selectedPlanId && canReviewHistory && hasDiffRevisions
      ? await get('/api/v1/care-plans/{planId}/revisions/diff', {
          params: {
            path: { planId: selectedPlanId },
            query: { fromRevisionId: diffFromId, toRevisionId: diffToId },
            header,
          },
        })
      : undefined;
  const error =
    query.error ??
    (clientResult.error ? 'CLIENT_LOAD_FAILED' : undefined) ??
    plansResult.error?.code ??
    (selectedPlanId && selectedPlanResult?.error ? 'CARE_PLAN_LOAD_FAILED' : undefined);
  const notice = query.notice;
  const clientName = [client.preferredName || client.firstName, client.lastName]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href={'/clients/' + client.id}>{t('client.title')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">{t('client.title')}</h1>
          <p className="text-slate-700">{clientName}</p>
        </div>
        <Link
          className="rounded-md border px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          href={'/clients/' + client.id}
        >
          {t('client.backToClient')}
        </Link>
      </header>

      <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-950">
        {t('client.genericModelNotice')}
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {allT(errorMessageKey(error))}
        </p>
      ) : null}
      {notice && noticeKeys[notice] ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t(noticeKeys[notice] as never)}
        </p>
      ) : null}
      {plansResult.error ? <LoadError message={t('client.loadFailed')} /> : null}

      <section aria-labelledby="care-plan-list-title" className="grid gap-3">
        <h2 id="care-plan-list-title" className="text-xl font-semibold">
          {t('client.planList')}
        </h2>
        {plans.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {plans.map((plan) => (
              <li key={plan.id}>
                <Link
                  aria-current={plan.id === selectedPlanId ? 'page' : undefined}
                  className={
                    'grid gap-1 rounded-lg border p-4 hover:border-blue-400 hover:bg-blue-50 ' +
                    (plan.id === selectedPlanId ? 'border-blue-500 bg-blue-50' : 'bg-white')
                  }
                  href={'/clients/' + client.id + '/care-plan?planId=' + plan.id}
                >
                  <span className="font-semibold">
                    {planStatusLabel(t, plan.status)} · {t('client.validFrom')}:{' '}
                    {formatDate(plan.validFrom, locale)}
                  </span>
                  <span className="text-sm text-slate-700">
                    {plan.validUntil
                      ? t('client.validUntil') + ': ' + formatDate(plan.validUntil, locale)
                      : t('client.noEndDate')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-white p-4 text-sm text-slate-700">
            {t('client.noPlans')}
          </p>
        )}
      </section>

      {canCreate &&
      !plansResult.error &&
      !plans.some((plan) => plan.status === 'active' || plan.status === 'under_review') ? (
        <section className="grid gap-3 rounded-lg border bg-white p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('client.createTitle')}</h2>
            <p className="mt-1 text-sm text-slate-700">{t('client.createDescription')}</p>
          </div>
          <form action={createCarePlanAction} className="grid gap-3 sm:grid-cols-3">
            <HiddenField name="clientId" value={client.id} />
            <DateField name="validFrom" label={t('client.validFrom')} required />
            <DateField name="validUntil" label={t('client.validUntil')} />
            <button className="self-end rounded-md bg-blue-800 px-4 py-2 font-medium text-white hover:bg-blue-900">
              {t('client.create')}
            </button>
          </form>
        </section>
      ) : null}

      {selectedPlanId && selectedPlanResult?.error ? (
        <LoadError message={t('client.loadFailed')} />
      ) : null}
      {detail ? (
        <>
          <section
            aria-labelledby="care-plan-overview-title"
            className="grid gap-4 rounded-lg border bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <h2 id="care-plan-overview-title" className="text-xl font-semibold">
                  {t('client.overview')}
                </h2>
                <p className="text-sm text-slate-700">
                  {t('client.status')}: {planStatusLabel(t, detail.plan.status)}
                </p>
              </div>
              {canEnd &&
              (detail.plan.status === 'active' || detail.plan.status === 'under_review') ? (
                <form action={endCarePlanAction} className="flex flex-wrap items-end gap-2">
                  <HiddenField name="clientId" value={client.id} />
                  <HiddenField name="planId" value={detail.plan.id} />
                  <HiddenField name="revisionId" value={detail.activeRevision?.revision.id ?? ''} />
                  <HiddenField name="expectedVersion" value={String(detail.plan.version)} />
                  <TextField
                    name="reason"
                    label={t('client.endReason')}
                    maxLength={1000}
                    required
                  />
                  <ConfirmSubmitButton confirmation={t('client.endConfirmation')}>
                    {t('client.end')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Definition
                label={t('client.validFrom')}
                value={formatDate(detail.plan.validFrom, locale)}
              />
              <Definition
                label={t('client.validUntil')}
                value={
                  detail.plan.validUntil
                    ? formatDate(detail.plan.validUntil, locale)
                    : t('client.noEndDate')
                }
              />
              <Definition label={t('client.version')} value={String(detail.plan.version)} />
              <Definition
                label={t('client.createdAt')}
                value={formatDateTime(detail.plan.createdAt, locale)}
              />
              <Definition label={t('client.createdBy')} value={detail.plan.createdByEmployeeName} />
              <Definition
                label={t('client.updatedAt')}
                value={formatDateTime(detail.plan.updatedAt, locale)}
              />
              <Definition
                label={t('client.nextEvaluationDue')}
                value={
                  detail.nextEvaluationDue ? formatDate(detail.nextEvaluationDue, locale) : null
                }
              />
              {detail.plan.endedAt ? (
                <Definition
                  label={t('client.endedAt')}
                  value={formatDateTime(detail.plan.endedAt, locale)}
                />
              ) : null}
              {detail.plan.endedReason ? (
                <Definition label={t('client.endReason')} value={detail.plan.endedReason} />
              ) : null}
            </dl>
            {detail.latestEvaluation ? (
              <div className="rounded-md bg-slate-50 p-3">
                <h3 className="font-semibold">{t('evaluation.latest')}</h3>
                <p className="text-sm text-slate-700">
                  {evaluationResultLabel(t, detail.latestEvaluation.result)} ·{' '}
                  {formatDateTime(detail.latestEvaluation.evaluatedAt, locale)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {detail.latestEvaluation.summary}
                </p>
              </div>
            ) : null}
          </section>

          {historyResult?.error ? <LoadError message={t('client.loadHistoryFailed')} /> : null}
          <section aria-labelledby="revision-select-title" className="grid gap-3">
            <h2 id="revision-select-title" className="text-xl font-semibold">
              {t('revision.history')}
            </h2>
            {selectedRevision ? (
              <RevisionSummary
                clientId={client.id}
                planId={detail.plan.id}
                selected={selectedRevision}
                revisions={revisions}
                locale={locale}
                canReviewHistory={canReviewHistory}
                t={t}
              />
            ) : (
              <p className="rounded-lg border bg-white p-4 text-sm text-slate-700">
                {t('client.noRevision')}
              </p>
            )}
          </section>

          {selectedRevision ? (
            <RevisionEditor
              clientId={client.id}
              detail={detail}
              revision={selectedRevision}
              editable={editableDraft}
              canUpdate={canUpdate}
              canActivate={canActivate}
              locale={locale}
              t={t}
            />
          ) : null}

          {detail.activeRevision && canEvaluate ? (
            <EvaluationForm
              clientId={client.id}
              detail={detail}
              revision={detail.activeRevision}
              locale={locale}
              t={t}
            />
          ) : null}

          {canUpdate &&
          detail.activeRevision &&
          !detail.draftRevision &&
          (detail.plan.status === 'active' || detail.plan.status === 'under_review') ? (
            <section className="grid gap-3 rounded-lg border bg-white p-4">
              <div>
                <h2 className="text-lg font-semibold">{t('revision.new')}</h2>
                <p className="mt-1 text-sm text-slate-700">
                  {t('revision.copyForwardDescription')}
                </p>
              </div>
              <form action={createCarePlanRevisionAction} className="grid gap-3 sm:grid-cols-3">
                <HiddenField name="clientId" value={client.id} />
                <HiddenField name="planId" value={detail.plan.id} />
                <HiddenField name="revisionId" value={detail.activeRevision.revision.id} />
                <HiddenField name="expectedVersion" value={String(detail.plan.version)} />
                <DateField name="effectiveFrom" label={t('revision.effectiveFrom')} required />
                <TextField name="reason" label={t('revision.reason')} maxLength={1000} required />
                <button className="self-end rounded-md border px-4 py-2 font-medium hover:bg-slate-50">
                  {t('revision.create')}
                </button>
              </form>
            </section>
          ) : null}

          {canReviewHistory && history ? (
            <HistorySection
              clientId={client.id}
              planId={detail.plan.id}
              history={history}
              diff={diffResult?.data}
              fromRevisionId={diffFromId}
              toRevisionId={diffToId}
              locale={locale}
              t={t}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

async function RevisionSummary({
  clientId,
  planId,
  selected,
  revisions,
  locale,
  canReviewHistory,
  t,
}: {
  clientId: string;
  planId: string;
  selected: CarePlanRevisionDetail;
  revisions: CarePlanRevisionDetail[];
  locale: Locale;
  canReviewHistory: boolean;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {t('revision.number', { number: selected.revision.revisionNumber })} ·{' '}
            {revisionStatusLabel(t, selected.revision.status)}
          </h3>
          <p className="text-sm text-slate-700">
            {t('revision.effectiveFrom')}: {formatDate(selected.revision.effectiveFrom, locale)}
          </p>
        </div>
        {selected.revision.reason ? (
          <p className="max-w-xl text-sm text-slate-700">{selected.revision.reason}</p>
        ) : null}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <Definition label={t('revision.author')} value={selected.revision.authorEmployeeName} />
        <Definition
          label={t('revision.createdAt')}
          value={formatDateTime(selected.revision.createdAt, locale)}
        />
        <Definition
          label={t('revision.activatedAt')}
          value={
            selected.revision.activatedAt
              ? formatDateTime(selected.revision.activatedAt, locale)
              : null
          }
        />
      </dl>
      {canReviewHistory ? (
        <div className="grid gap-2">
          <h4 className="font-medium">{t('history.details')}</h4>
          <p className="text-sm text-slate-700">
            {t('sourceReferences.title')}: {selected.sourceReferences.length}
          </p>
          {selected.sourceReferences.length ? (
            <ul className="grid gap-2">
              {selected.sourceReferences.map((reference) => (
                <li key={reference.id}>
                  <SourceReferenceCard reference={reference} t={t} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">{t('sourceReferences.empty')}</p>
          )}
          <Link
            className="w-fit text-sm font-medium text-blue-800 underline"
            href={'/clients/' + clientId + '#clinical'}
          >
            {t('sourceReferences.openClinicalHistory')}
          </Link>
        </div>
      ) : null}
      {canReviewHistory && revisions.length > 1 ? (
        <nav aria-label={t('revision.history')} className="flex flex-wrap gap-2 border-t pt-3">
          {revisions.map((revision) => (
            <Link
              key={revision.revision.id}
              aria-current={revision.revision.id === selected.revision.id ? 'page' : undefined}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              href={
                '/clients/' +
                clientId +
                '/care-plan?planId=' +
                planId +
                '&revisionId=' +
                revision.revision.id
              }
            >
              {t('revision.number', { number: revision.revision.revisionNumber })}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

async function RevisionEditor({
  clientId,
  detail,
  revision,
  editable,
  canUpdate,
  canActivate,
  locale,
  t,
}: {
  clientId: string;
  detail: CarePlanDetail;
  revision: CarePlanRevisionDetail;
  editable: boolean;
  canUpdate: boolean;
  canActivate: boolean;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  const statusLabel = (value: string) => translated(t, commonStatusKeys, value);
  const needCategoryOptions = enumOptions(t, needCategoryKeys);
  const needSourceOptions = enumOptions(t, needSourceKeys);
  const resourceCategoryOptions = enumOptions(t, resourceCategoryKeys);
  const measureCategoryOptions = enumOptions(t, measureCategoryKeys);
  const priorityOptions = enumOptions(t, priorityKeys);
  const needsOptions = revision.needs.map((need) => ({ value: need.id, label: need.title }));
  const goalsOptions = revision.goals.map((goal) => ({ value: goal.id, label: goal.title }));
  const measuresOptions = revision.measures.map((measure) => ({
    value: measure.id,
    label: measure.title,
  }));
  const statusOptions = {
    need: [
      { value: 'active', label: statusLabel('active') },
      { value: 'addressed', label: statusLabel('addressed') },
      { value: 'deferred', label: statusLabel('deferred') },
    ],
    resource: [
      { value: 'available', label: statusLabel('available') },
      { value: 'needs_support', label: statusLabel('needs_support') },
      { value: 'unavailable', label: statusLabel('unavailable') },
    ],
    goal: [
      { value: 'active', label: statusLabel('active') },
      { value: 'achieved', label: statusLabel('achieved') },
      { value: 'discontinued', label: statusLabel('discontinued') },
    ],
    measure: [
      { value: 'active', label: statusLabel('active') },
      { value: 'discontinued', label: statusLabel('discontinued') },
    ],
    risk: [
      { value: 'addressed', label: statusLabel('addressed') },
      { value: 'monitor', label: statusLabel('monitor') },
      { value: 'accepted', label: statusLabel('accepted') },
    ],
  };
  const recordKindOptions = [
    { value: 'measurement', label: t('sourceReferences.kinds.measurement') },
    { value: 'observation', label: t('sourceReferences.kinds.observation') },
    { value: 'assessment', label: t('sourceReferences.kinds.assessment') },
    { value: 'risk_assessment', label: t('sourceReferences.kinds.riskAssessment') },
  ];
  const assessmentReadOnly = !editable;

  return (
    <div className="grid gap-5">
      <section
        aria-labelledby="assessment-title"
        className="grid gap-4 rounded-lg border bg-white p-4"
      >
        <div>
          <h2 id="assessment-title" className="text-xl font-semibold">
            {t('assessment.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-700">{t('assessment.description')}</p>
        </div>
        {assessmentReadOnly && canUpdate && detail.draftRevision ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
            {t('revision.editDraftOnly')}
          </p>
        ) : null}
        {editable ? (
          <form action={saveCarePlanAssessmentAction} className="grid gap-4">
            <FormContext
              clientId={clientId}
              planId={detail.plan.id}
              revisionId={revision.revision.id}
              version={detail.plan.version}
            />
            {(['client', 'professional'] as const).map((group) => (
              <fieldset key={group} className="grid gap-3">
                <legend className="font-semibold">
                  {group === 'client'
                    ? t('assessment.clientPerspective')
                    : t('assessment.professionalPerspective')}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {assessmentFields
                    .filter((field) => field.group === group)
                    .map((field) => (
                      <TextareaField
                        key={field.key}
                        name={field.key}
                        label={t(field.label)}
                        value={revision.assessment[field.key]}
                        maxLength={4000}
                      />
                    ))}
                </div>
              </fieldset>
            ))}
            <button className="w-fit rounded-md bg-blue-800 px-4 py-2 font-medium text-white hover:bg-blue-900">
              {t('assessment.save')}
            </button>
          </form>
        ) : (
          <div className="grid gap-4">
            {(['client', 'professional'] as const).map((group) => (
              <section key={group} className="grid gap-2">
                <h3 className="font-semibold">
                  {group === 'client'
                    ? t('assessment.clientPerspective')
                    : t('assessment.professionalPerspective')}
                </h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {assessmentFields
                    .filter((field) => field.group === group)
                    .map((field) => (
                      <Definition
                        key={field.key}
                        label={t(field.label)}
                        value={revision.assessment[field.key]}
                        multiline
                      />
                    ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </section>

      <ItemSection
        title={t('needs.title')}
        empty={t('needs.empty')}
        addLabel={t('needs.add')}
        items={revision.needs}
        editable={editable}
        renderItem={(need) => (
          <NeedCard
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            need={need}
            editable={editable}
            categoryOptions={needCategoryOptions}
            sourceOptions={needSourceOptions}
            priorityOptions={priorityOptions}
            statusOptions={statusOptions.need}
            t={t}
          />
        )}
        addForm={
          <NeedForm
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            categoryOptions={needCategoryOptions}
            sourceOptions={needSourceOptions}
            priorityOptions={priorityOptions}
            statusOptions={statusOptions.need}
            t={t}
          />
        }
      />

      <ItemSection
        title={t('resources.title')}
        empty={t('resources.empty')}
        addLabel={t('resources.add')}
        items={revision.resources}
        editable={editable}
        renderItem={(resource) => (
          <ResourceCard
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            resource={resource}
            editable={editable}
            categoryOptions={resourceCategoryOptions}
            statusOptions={statusOptions.resource}
            t={t}
          />
        )}
        addForm={
          <ResourceForm
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            categoryOptions={resourceCategoryOptions}
            statusOptions={statusOptions.resource}
            t={t}
          />
        }
      />

      <ItemSection
        title={t('goals.title')}
        empty={t('goals.empty')}
        addLabel={t('goals.add')}
        items={revision.goals}
        editable={editable}
        renderItem={(goal) => (
          <GoalCard
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            goal={goal}
            needs={needsOptions}
            editable={editable}
            statusOptions={statusOptions.goal}
            priorityOptions={priorityOptions}
            locale={locale}
            t={t}
          />
        )}
        addForm={
          <GoalForm
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            needs={needsOptions}
            statusOptions={statusOptions.goal}
            priorityOptions={priorityOptions}
            t={t}
          />
        }
      />

      <ItemSection
        title={t('measures.title')}
        empty={t('measures.empty')}
        addLabel={t('measures.add')}
        items={revision.measures}
        editable={editable}
        renderItem={(measure) => (
          <MeasureCard
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            measure={measure}
            needs={needsOptions}
            goals={goalsOptions}
            editable={editable}
            categoryOptions={measureCategoryOptions}
            statusOptions={statusOptions.measure}
            locale={locale}
            t={t}
          />
        )}
        addForm={
          <MeasureForm
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            needs={needsOptions}
            goals={goalsOptions}
            categoryOptions={measureCategoryOptions}
            statusOptions={statusOptions.measure}
            t={t}
          />
        }
      />

      <RiskResponseSection
        clientId={clientId}
        detail={detail}
        revision={revision}
        editable={editable}
        needs={needsOptions}
        measures={measuresOptions}
        statusOptions={statusOptions.risk}
        recordKindOptions={recordKindOptions}
        t={t}
      />

      {canActivate && editable ? (
        <form action={activateCarePlanRevisionAction} className="flex flex-wrap items-end gap-3">
          <FormContext
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
          />
          <button className="rounded-md bg-green-800 px-4 py-2 font-medium text-white hover:bg-green-900">
            {t('revision.activate')}
          </button>
          <p className="text-sm text-slate-600">{t('revision.activationIncomplete')}</p>
        </form>
      ) : null}
      {!editable && detail.draftRevision && canUpdate ? (
        <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-950">
          {t('revision.editDraftOnly')}
        </p>
      ) : null}
    </div>
  );
}

async function NeedCard({
  clientId,
  planId,
  revisionId,
  version,
  need,
  editable,
  categoryOptions,
  sourceOptions,
  priorityOptions,
  statusOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  need: Need;
  editable: boolean;
  categoryOptions: ChoiceOption[];
  sourceOptions: ChoiceOption[];
  priorityOptions: ChoiceOption[];
  statusOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <h3 className="font-semibold">{need.title}</h3>
      <p className="text-sm text-slate-700">
        {translated(t, needCategoryKeys, need.category)} ·{' '}
        {translated(t, needSourceKeys, need.source)} · {translated(t, priorityKeys, need.priority)}{' '}
        · {translated(t, commonStatusKeys, need.status)}
      </p>
      {need.description ? <p className="whitespace-pre-wrap text-sm">{need.description}</p> : null}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer">{t('needs.edit')}</summary>
            <NeedForm
              clientId={clientId}
              planId={planId}
              revisionId={revisionId}
              version={version}
              item={need}
              categoryOptions={categoryOptions}
              sourceOptions={sourceOptions}
              priorityOptions={priorityOptions}
              statusOptions={statusOptions}
              t={t}
            />
          </details>
          <RemoveItem
            clientId={clientId}
            planId={planId}
            revisionId={revisionId}
            version={version}
            kind="need"
            itemId={need.id}
            label={t('needs.remove')}
          />
        </div>
      ) : null}
    </li>
  );
}

async function NeedForm({
  clientId,
  planId,
  revisionId,
  version,
  item,
  categoryOptions,
  sourceOptions,
  priorityOptions,
  statusOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  item?: Need;
  categoryOptions: ChoiceOption[];
  sourceOptions: ChoiceOption[];
  priorityOptions: ChoiceOption[];
  statusOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <form action={saveCarePlanItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <FormContext clientId={clientId} planId={planId} revisionId={revisionId} version={version} />
      <HiddenField name="kind" value="need" />
      {item ? <HiddenField name="itemId" value={item.id} /> : null}
      <SelectField
        name="category"
        label={t('needs.category')}
        options={categoryOptions}
        value={item?.category}
        required
      />
      <TextField
        name="title"
        label={t('needs.titleField')}
        value={item?.title}
        required
        maxLength={200}
      />
      <TextareaField
        name="description"
        label={t('needs.description')}
        value={item?.description}
        maxLength={2000}
      />
      <SelectField
        name="source"
        label={t('needs.source')}
        options={sourceOptions}
        value={item?.source}
        required
      />
      <SelectField
        name="priority"
        label={t('needs.priority')}
        options={priorityOptions}
        value={item?.priority}
        required
      />
      <SelectField
        name="status"
        label={t('needs.status')}
        options={statusOptions}
        value={item?.status}
        required
      />
      <button className="w-fit rounded-md bg-blue-800 px-3 py-2 font-medium text-white">
        {t('needs.save')}
      </button>
    </form>
  );
}

async function ResourceCard({
  clientId,
  planId,
  revisionId,
  version,
  resource,
  editable,
  categoryOptions,
  statusOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  resource: Resource;
  editable: boolean;
  categoryOptions: ChoiceOption[];
  statusOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <p className="font-semibold">{resource.description}</p>
      <p className="text-sm text-slate-700">
        {translated(t, resourceCategoryKeys, resource.category)} ·{' '}
        {translated(t, commonStatusKeys, resource.status)}
      </p>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer">{t('resources.edit')}</summary>
            <ResourceForm
              clientId={clientId}
              planId={planId}
              revisionId={revisionId}
              version={version}
              item={resource}
              categoryOptions={categoryOptions}
              statusOptions={statusOptions}
              t={t}
            />
          </details>
          <RemoveItem
            clientId={clientId}
            planId={planId}
            revisionId={revisionId}
            version={version}
            kind="resource"
            itemId={resource.id}
            label={t('resources.remove')}
          />
        </div>
      ) : null}
    </li>
  );
}

async function ResourceForm({
  clientId,
  planId,
  revisionId,
  version,
  item,
  categoryOptions,
  statusOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  item?: Resource;
  categoryOptions: ChoiceOption[];
  statusOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <form action={saveCarePlanItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <FormContext clientId={clientId} planId={planId} revisionId={revisionId} version={version} />
      <HiddenField name="kind" value="resource" />
      {item ? <HiddenField name="itemId" value={item.id} /> : null}
      <SelectField
        name="category"
        label={t('resources.category')}
        options={categoryOptions}
        value={item?.category}
        required
      />
      <TextareaField
        name="description"
        label={t('resources.description')}
        value={item?.description}
        required
        maxLength={2000}
      />
      <SelectField
        name="status"
        label={t('resources.status')}
        options={statusOptions}
        value={item?.status}
        required
      />
      <button className="w-fit rounded-md bg-blue-800 px-3 py-2 font-medium text-white">
        {t('resources.save')}
      </button>
    </form>
  );
}

async function GoalCard({
  clientId,
  planId,
  revisionId,
  version,
  goal,
  needs,
  editable,
  statusOptions,
  priorityOptions,
  locale,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  goal: Goal;
  needs: ChoiceOption[];
  editable: boolean;
  statusOptions: ChoiceOption[];
  priorityOptions: ChoiceOption[];
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <h3 className="font-semibold">{goal.title}</h3>
      <p className="text-sm text-slate-700">
        {translated(t, priorityKeys, goal.priority)} ·{' '}
        {translated(t, commonStatusKeys, goal.status)}
        {goal.targetDate ? ' · ' + formatDate(goal.targetDate, locale) : ''}
      </p>
      {goal.description ? <p className="whitespace-pre-wrap text-sm">{goal.description}</p> : null}
      <p className="text-sm text-slate-700">
        {t('goals.needs')}:{' '}
        {goal.needIds
          .map((id) => needs.find((need) => need.value === id)?.label ?? id)
          .join(', ') || '—'}
      </p>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer">{t('goals.edit')}</summary>
            <GoalForm
              clientId={clientId}
              planId={planId}
              revisionId={revisionId}
              version={version}
              item={goal}
              needs={needs}
              statusOptions={statusOptions}
              priorityOptions={priorityOptions}
              t={t}
            />
          </details>
          <RemoveItem
            clientId={clientId}
            planId={planId}
            revisionId={revisionId}
            version={version}
            kind="goal"
            itemId={goal.id}
            label={t('goals.remove')}
          />
        </div>
      ) : null}
    </li>
  );
}

async function GoalForm({
  clientId,
  planId,
  revisionId,
  version,
  item,
  needs,
  statusOptions,
  priorityOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  item?: Goal;
  needs: ChoiceOption[];
  statusOptions: ChoiceOption[];
  priorityOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <form action={saveCarePlanItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <FormContext clientId={clientId} planId={planId} revisionId={revisionId} version={version} />
      <HiddenField name="kind" value="goal" />
      {item ? <HiddenField name="itemId" value={item.id} /> : null}
      <TextField
        name="title"
        label={t('goals.titleField')}
        value={item?.title}
        required
        maxLength={200}
      />
      <TextareaField
        name="description"
        label={t('goals.description')}
        value={item?.description}
        maxLength={2000}
      />
      <DateField name="targetDate" label={t('goals.targetDate')} value={item?.targetDate} />
      <SelectField
        name="status"
        label={t('goals.status')}
        options={statusOptions}
        value={item?.status}
        required
      />
      <SelectField
        name="priority"
        label={t('goals.priority')}
        options={priorityOptions}
        value={item?.priority}
        required
      />
      <MultiSelectField
        name="needIds"
        label={t('goals.needs')}
        options={needs}
        selected={item?.needIds ?? []}
        empty={t('needs.empty')}
        hint={t('form.multiSelectHint')}
      />
      <button className="w-fit rounded-md bg-blue-800 px-3 py-2 font-medium text-white">
        {t('goals.save')}
      </button>
    </form>
  );
}

async function MeasureCard({
  clientId,
  planId,
  revisionId,
  version,
  measure,
  needs,
  goals,
  editable,
  categoryOptions,
  statusOptions,
  locale,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  measure: Measure;
  needs: ChoiceOption[];
  goals: ChoiceOption[];
  editable: boolean;
  categoryOptions: ChoiceOption[];
  statusOptions: ChoiceOption[];
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <h3 className="font-semibold">{measure.title}</h3>
      <p className="whitespace-pre-wrap text-sm text-slate-800">{measure.instruction}</p>
      <p className="text-sm text-slate-700">
        {translated(t, measureCategoryKeys, measure.category)} ·{' '}
        {translated(t, commonStatusKeys, measure.status)} · {t('measures.validFrom')}:{' '}
        {formatDate(measure.validFrom, locale)}
        {measure.validUntil
          ? ' · ' + t('measures.validUntil') + ': ' + formatDate(measure.validUntil, locale)
          : ''}
      </p>
      {measure.frequencyText ? (
        <p className="text-sm text-slate-700">
          {t('measures.frequency')}: {measure.frequencyText}
        </p>
      ) : null}
      {measure.responsibleRole ? (
        <p className="text-sm text-slate-700">
          {t('measures.responsibleRole')}: {measure.responsibleRole}
        </p>
      ) : null}
      <p className="text-sm text-slate-700">
        {t('measures.needs')}:{' '}
        {measure.needIds
          .map((id) => needs.find((need) => need.value === id)?.label ?? id)
          .join(', ') || '—'}
      </p>
      <p className="text-sm text-slate-700">
        {t('measures.goals')}:{' '}
        {measure.goalIds
          .map((id) => goals.find((goal) => goal.value === id)?.label ?? id)
          .join(', ') || '—'}
      </p>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer">{t('measures.edit')}</summary>
            <MeasureForm
              clientId={clientId}
              planId={planId}
              revisionId={revisionId}
              version={version}
              item={measure}
              needs={needs}
              goals={goals}
              categoryOptions={categoryOptions}
              statusOptions={statusOptions}
              t={t}
            />
          </details>
          <RemoveItem
            clientId={clientId}
            planId={planId}
            revisionId={revisionId}
            version={version}
            kind="measure"
            itemId={measure.id}
            label={t('measures.remove')}
          />
        </div>
      ) : null}
    </li>
  );
}

async function MeasureForm({
  clientId,
  planId,
  revisionId,
  version,
  item,
  needs,
  goals,
  categoryOptions,
  statusOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  item?: Measure;
  needs: ChoiceOption[];
  goals: ChoiceOption[];
  categoryOptions: ChoiceOption[];
  statusOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <form action={saveCarePlanItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <FormContext clientId={clientId} planId={planId} revisionId={revisionId} version={version} />
      <HiddenField name="kind" value="measure" />
      {item ? <HiddenField name="itemId" value={item.id} /> : null}
      <TextField
        name="title"
        label={t('measures.titleField')}
        value={item?.title}
        required
        maxLength={200}
      />
      <TextareaField
        name="instruction"
        label={t('measures.instruction')}
        value={item?.instruction}
        required
        maxLength={4000}
      />
      <SelectField
        name="category"
        label={t('measures.category')}
        options={categoryOptions}
        value={item?.category}
        required
      />
      <SelectField
        name="status"
        label={t('measures.status')}
        options={statusOptions}
        value={item?.status}
        required
      />
      <MultiSelectField
        name="needIds"
        label={t('measures.needs')}
        options={needs}
        selected={item?.needIds ?? []}
        empty={t('needs.empty')}
        hint={t('form.multiSelectHint')}
      />
      <MultiSelectField
        name="goalIds"
        label={t('measures.goals')}
        options={goals}
        selected={item?.goalIds ?? []}
        empty={t('goals.empty')}
        hint={t('form.multiSelectHint')}
      />
      <HiddenField name="serviceDefinitionId" value={item?.serviceDefinitionId ?? ''} />
      <TextField
        name="frequencyText"
        label={t('measures.frequency')}
        value={item?.frequencyText}
        maxLength={200}
      />
      <TextField
        name="responsibleRole"
        label={t('measures.responsibleRole')}
        value={item?.responsibleRole}
        maxLength={120}
      />
      <DateField
        name="validFrom"
        label={t('measures.validFrom')}
        value={item?.validFrom}
        required
      />
      <DateField name="validUntil" label={t('measures.validUntil')} value={item?.validUntil} />
      <button className="w-fit rounded-md bg-blue-800 px-3 py-2 font-medium text-white">
        {t('measures.save')}
      </button>
    </form>
  );
}

async function RiskResponseSection({
  clientId,
  detail,
  revision,
  editable,
  needs,
  measures,
  statusOptions,
  recordKindOptions,
  t,
}: {
  clientId: string;
  detail: CarePlanDetail;
  revision: CarePlanRevisionDetail;
  editable: boolean;
  needs: ChoiceOption[];
  measures: ChoiceOption[];
  statusOptions: ChoiceOption[];
  recordKindOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <section
      aria-labelledby="risk-response-title"
      className="grid gap-4 rounded-lg border bg-white p-4"
    >
      <div>
        <h2 id="risk-response-title" className="text-xl font-semibold">
          {t('riskResponses.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-700">{t('riskResponses.referenceHelp')}</p>
      </div>
      {revision.riskResponses.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {revision.riskResponses.map((response) => (
            <RiskResponseCard
              key={response.id}
              clientId={clientId}
              planId={detail.plan.id}
              revisionId={revision.revision.id}
              version={detail.plan.version}
              response={response}
              needs={needs}
              measures={measures}
              statusOptions={statusOptions}
              editable={editable}
              t={t}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-700">{t('riskResponses.empty')}</p>
      )}
      {editable ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer font-medium">{t('riskResponses.add')}</summary>
          <RiskResponseForm
            clientId={clientId}
            planId={detail.plan.id}
            revisionId={revision.revision.id}
            version={detail.plan.version}
            needs={needs}
            measures={measures}
            statusOptions={statusOptions}
            t={t}
          />
        </details>
      ) : null}

      <section aria-labelledby="source-references-title" className="grid gap-3 border-t pt-4">
        <div>
          <h3 id="source-references-title" className="text-lg font-semibold">
            {t('sourceReferences.title')}
          </h3>
          <p className="mt-1 text-sm text-slate-700">{t('sourceReferences.description')}</p>
        </div>
        {revision.sourceReferences.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {revision.sourceReferences.map((reference) => (
              <li key={reference.id}>
                <SourceReferenceCard reference={reference} t={t} />
                {editable ? (
                  <RemoveItem
                    clientId={clientId}
                    planId={detail.plan.id}
                    revisionId={revision.revision.id}
                    version={detail.plan.version}
                    kind="sourceReference"
                    itemId={reference.clinicalRecordId}
                    label={t('sourceReferences.remove')}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-700">{t('sourceReferences.empty')}</p>
        )}
        <Link
          className="w-fit text-sm font-medium text-blue-800 underline"
          href={'/clients/' + clientId + '#clinical'}
        >
          {t('sourceReferences.openClinicalHistory')}
        </Link>
        {editable ? (
          <form
            action={saveCarePlanItemAction}
            className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-2"
          >
            <FormContext
              clientId={clientId}
              planId={detail.plan.id}
              revisionId={revision.revision.id}
              version={detail.plan.version}
            />
            <HiddenField name="kind" value="sourceReference" />
            <TextField
              name="clinicalRecordId"
              label={t('sourceReferences.recordId')}
              maxLength={36}
              required
            />
            <SelectField
              name="recordKind"
              label={t('sourceReferences.recordKind')}
              options={recordKindOptions}
              required
            />
            <TextField name="rationale" label={t('sourceReferences.rationale')} maxLength={1000} />
            <button className="w-fit rounded-md bg-blue-800 px-3 py-2 font-medium text-white">
              {t('sourceReferences.add')}
            </button>
          </form>
        ) : null}
      </section>
    </section>
  );
}

async function RiskResponseCard({
  clientId,
  planId,
  revisionId,
  version,
  response,
  needs,
  measures,
  statusOptions,
  editable,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  response: RiskResponse;
  needs: ChoiceOption[];
  measures: ChoiceOption[];
  statusOptions: ChoiceOption[];
  editable: boolean;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        {t('riskResponses.clinicalRecordId')}: {response.clinicalRecordId}
      </p>
      <p className="text-sm">{response.plannedResponse}</p>
      <p className="text-sm text-slate-700">
        {t('riskResponses.status')}: {translated(t, commonStatusKeys, response.status)}
      </p>
      <p className="text-sm text-slate-700">
        {t('riskResponses.needs')}:{' '}
        {response.needIds
          .map((id) => needs.find((need) => need.value === id)?.label ?? id)
          .join(', ') || '—'}
      </p>
      <p className="text-sm text-slate-700">
        {t('riskResponses.measures')}:{' '}
        {response.measureIds
          .map((id) => measures.find((measure) => measure.value === id)?.label ?? id)
          .join(', ') || '—'}
      </p>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer">{t('riskResponses.edit')}</summary>
            <RiskResponseForm
              clientId={clientId}
              planId={planId}
              revisionId={revisionId}
              version={version}
              item={response}
              needs={needs}
              measures={measures}
              statusOptions={statusOptions}
              t={t}
            />
          </details>
          <RemoveItem
            clientId={clientId}
            planId={planId}
            revisionId={revisionId}
            version={version}
            kind="riskResponse"
            itemId={response.id}
            label={t('riskResponses.remove')}
          />
        </div>
      ) : null}
    </li>
  );
}

async function RiskResponseForm({
  clientId,
  planId,
  revisionId,
  version,
  item,
  needs,
  measures,
  statusOptions,
  t,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  item?: RiskResponse;
  needs: ChoiceOption[];
  measures: ChoiceOption[];
  statusOptions: ChoiceOption[];
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <form action={saveCarePlanItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <FormContext clientId={clientId} planId={planId} revisionId={revisionId} version={version} />
      <HiddenField name="kind" value="riskResponse" />
      {item ? <HiddenField name="itemId" value={item.id} /> : null}
      <TextField
        name="clinicalRecordId"
        label={t('riskResponses.clinicalRecordId')}
        value={item?.clinicalRecordId}
        maxLength={36}
        required
      />
      <SelectField
        name="status"
        label={t('riskResponses.status')}
        options={statusOptions}
        value={item?.status}
        required
      />
      <TextareaField
        name="plannedResponse"
        label={t('riskResponses.plannedResponse')}
        value={item?.plannedResponse}
        maxLength={2000}
        required
      />
      <MultiSelectField
        name="needIds"
        label={t('riskResponses.needs')}
        options={needs}
        selected={item?.needIds ?? []}
        empty={t('needs.empty')}
        hint={t('form.multiSelectHint')}
      />
      <MultiSelectField
        name="measureIds"
        label={t('riskResponses.measures')}
        options={measures}
        selected={item?.measureIds ?? []}
        empty={t('measures.empty')}
        hint={t('form.multiSelectHint')}
      />
      <button className="w-fit rounded-md bg-blue-800 px-3 py-2 font-medium text-white">
        {t('riskResponses.save')}
      </button>
    </form>
  );
}

async function EvaluationForm({
  clientId,
  detail,
  revision,
  locale,
  t,
}: {
  clientId: string;
  detail: CarePlanDetail;
  revision: CarePlanRevisionDetail;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  const resultOptions = [
    { value: 'effective', label: t('statuses.effective') },
    { value: 'partially_effective', label: t('statuses.partiallyEffective') },
    { value: 'not_effective', label: t('statuses.notEffective') },
    { value: 'changed_condition', label: t('statuses.changedCondition') },
    { value: 'no_change', label: t('statuses.noChange') },
  ];
  const outcomeOptions = enumOptions(t, goalOutcomeKeys);
  return (
    <section
      aria-labelledby="evaluation-title"
      className="grid gap-3 rounded-lg border bg-white p-4"
    >
      <div>
        <h2 id="evaluation-title" className="text-xl font-semibold">
          {t('evaluation.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-700">{t('evaluation.description')}</p>
      </div>
      {detail.latestEvaluation ? (
        <p className="text-sm text-slate-700">
          {t('evaluation.latest')}: {evaluationResultLabel(t, detail.latestEvaluation.result)} ·{' '}
          {formatDateTime(detail.latestEvaluation.evaluatedAt, locale)}
        </p>
      ) : null}
      <form action={evaluateCarePlanAction} className="grid gap-3 sm:grid-cols-2">
        <FormContext
          clientId={clientId}
          planId={detail.plan.id}
          revisionId={revision.revision.id}
          version={detail.plan.version}
        />
        <SelectField
          name="result"
          label={t('evaluation.result')}
          options={resultOptions}
          required
        />
        <SelectField
          name="planChange"
          label={t('evaluation.planChange')}
          options={[
            { value: 'none', label: t('evaluation.noRevision') },
            { value: 'revision_required', label: t('evaluation.revisionRequired') },
          ]}
          required
        />
        <TextareaField name="summary" label={t('evaluation.summary')} required maxLength={4000} />
        <DateField name="nextEvaluationDue" label={t('evaluation.nextDue')} />
        {revision.goals.length ? (
          <fieldset className="grid gap-3 sm:col-span-2">
            <legend className="font-semibold">{t('evaluation.goalOutcomes')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {revision.goals.map((goal) => (
                <div key={goal.id} className="grid gap-2 rounded-md border p-3">
                  <input type="hidden" name="goalIds" value={goal.id} />
                  <p className="font-medium">{goal.title}</p>
                  <SelectField
                    name={'outcome:' + goal.id}
                    label={t('evaluation.outcome')}
                    options={outcomeOptions}
                    required
                  />
                  <TextField
                    name={'note:' + goal.id}
                    label={t('evaluation.note')}
                    maxLength={1000}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        ) : null}
        <button className="w-fit rounded-md bg-blue-800 px-4 py-2 font-medium text-white">
          {t('evaluation.save')}
        </button>
      </form>
    </section>
  );
}

async function HistorySection({
  clientId,
  planId,
  history,
  diff,
  fromRevisionId,
  toRevisionId,
  locale,
  t,
}: {
  clientId: string;
  planId: string;
  history: components['schemas']['CarePlanHistoryDto'];
  diff: CarePlanDiff | undefined;
  fromRevisionId: string | undefined;
  toRevisionId: string | undefined;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  const revisions = history.revisions;
  const fromRevision = revisions.find((item) => item.revision.id === fromRevisionId);
  const toRevision = revisions.find((item) => item.revision.id === toRevisionId);
  const groups = [
    ['needs', t('history.needs')],
    ['resources', t('history.resources')],
    ['riskResponses', t('history.riskResponses')],
    ['goals', t('history.goals')],
    ['measures', t('history.measures')],
    ['sourceReferences', t('history.sourceReferences')],
  ] as const;
  return (
    <section aria-labelledby="history-title" className="grid gap-4 rounded-lg border bg-white p-4">
      <h2 id="history-title" className="text-xl font-semibold">
        {t('history.title')}
      </h2>
      {revisions.length ? (
        <ol className="grid gap-3">
          {revisions.map((revision) => (
            <li key={revision.revision.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {t('revision.number', { number: revision.revision.revisionNumber })} ·{' '}
                    {revisionStatusLabel(t, revision.revision.status)}
                  </p>
                  <p className="text-sm text-slate-700">
                    {t('revision.effectiveFrom')}:{' '}
                    {formatDate(revision.revision.effectiveFrom, locale)}
                    {revision.revision.reason ? ' · ' + revision.revision.reason : ''}
                  </p>
                </div>
                <Link
                  className="text-sm font-medium text-blue-800 underline"
                  href={
                    '/clients/' +
                    clientId +
                    '/care-plan?planId=' +
                    planId +
                    '&revisionId=' +
                    revision.revision.id
                  }
                >
                  {t('history.details')}
                </Link>
              </div>
              <p className="mt-2 text-sm text-slate-700">
                {t('sourceReferences.title')}: {revision.sourceReferences.length}
              </p>
              {revision.sourceReferences.length ? (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {revision.sourceReferences.map((reference) => (
                    <li key={reference.id}>
                      <SourceReferenceCard reference={reference} t={t} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-700">{t('revision.noHistory')}</p>
      )}

      <form method="get" className="grid gap-3 border-t pt-4 sm:grid-cols-3">
        <HiddenField name="planId" value={planId} />
        <SelectField
          name="fromRevisionId"
          label={t('history.from')}
          value={fromRevisionId}
          options={revisions.map((revision) => ({
            value: revision.revision.id,
            label: t('revision.number', { number: revision.revision.revisionNumber }),
          }))}
          required
        />
        <SelectField
          name="toRevisionId"
          label={t('history.to')}
          value={toRevisionId}
          options={revisions.map((revision) => ({
            value: revision.revision.id,
            label: t('revision.number', { number: revision.revision.revisionNumber }),
          }))}
          required
        />
        <button className="self-end rounded-md border px-4 py-2 font-medium hover:bg-slate-50">
          {t('history.compareButton')}
        </button>
      </form>
      {diffResultError(diff, hasValidPair(fromRevision, toRevision)) ? (
        <LoadError message={t('client.loadHistoryFailed')} />
      ) : null}
      {diff && fromRevision && toRevision ? (
        <div className="grid gap-3 border-t pt-4">
          <h3 className="font-semibold">
            {t('history.compareTitle', {
              from: fromRevision.revision.revisionNumber,
              to: toRevision.revision.revisionNumber,
            })}
          </h3>
          {diff.assessmentChanged ? (
            <p className="text-sm">{t('history.assessmentChanged')}</p>
          ) : null}
          {groups.map(([group, label]) => {
            const changes = diff[group];
            const changed = changes.added.length + changes.changed.length + changes.removed.length;
            return (
              <section key={group} className="grid gap-1">
                <h4 className="font-medium">{label}</h4>
                {changed === 0 ? (
                  <p className="text-sm text-slate-600">{t('history.noChanges')}</p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {changes.added.map((id) => (
                      <li key={'added-' + id}>
                        <span className="font-medium">{t('history.added')}:</span>{' '}
                        {diffItemLabel(group, id, fromRevision, toRevision)}
                      </li>
                    ))}
                    {changes.changed.map((id) => (
                      <li key={'changed-' + id}>
                        <span className="font-medium">{t('history.changed')}:</span>{' '}
                        {diffItemLabel(group, id, fromRevision, toRevision)}
                      </li>
                    ))}
                    {changes.removed.map((id) => (
                      <li key={'removed-' + id}>
                        <span className="font-medium">{t('history.removed')}:</span>{' '}
                        {diffItemLabel(group, id, fromRevision, toRevision)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      <section className="grid gap-2 border-t pt-4">
        <h3 className="font-semibold">{t('evaluation.history')}</h3>
        {history.evaluations.length ? (
          <ol className="grid gap-2">
            {history.evaluations.map((evaluation) => (
              <li key={evaluation.id} className="rounded-md bg-slate-50 p-3">
                <p className="font-medium">
                  {evaluationResultLabel(t, evaluation.result)} ·{' '}
                  {formatDateTime(evaluation.evaluatedAt, locale)}
                </p>
                <p className="whitespace-pre-wrap text-sm">{evaluation.summary}</p>
                <p className="text-sm text-slate-700">
                  {t('evaluation.nextDue')}:{' '}
                  {evaluation.nextEvaluationDue
                    ? formatDate(evaluation.nextEvaluationDue, locale)
                    : t('evaluation.notScheduled')}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-700">{t('evaluation.noHistory')}</p>
        )}
      </section>
    </section>
  );
}

function diffResultError(diff: CarePlanDiff | undefined, validPair: boolean): boolean {
  return validPair && diff === undefined;
}

function hasValidPair(
  from: CarePlanRevisionDetail | undefined,
  to: CarePlanRevisionDetail | undefined,
): boolean {
  return Boolean(from && to && from.revision.id !== to.revision.id);
}

function diffItemLabel(
  group: keyof CarePlanDiff,
  id: string,
  from: CarePlanRevisionDetail,
  to: CarePlanRevisionDetail,
): string {
  const revision = group === 'sourceReferences' ? to : to;
  if (group === 'needs') {
    return (
      to.needs.find((item) => item.id === id)?.title ??
      from.needs.find((item) => item.id === id)?.title ??
      id
    );
  }
  if (group === 'resources') {
    return (
      to.resources.find((item) => item.id === id)?.description ??
      from.resources.find((item) => item.id === id)?.description ??
      id
    );
  }
  if (group === 'riskResponses') {
    return (
      to.riskResponses.find((item) => item.id === id)?.plannedResponse ??
      from.riskResponses.find((item) => item.id === id)?.plannedResponse ??
      id
    );
  }
  if (group === 'goals') {
    return (
      to.goals.find((item) => item.id === id)?.title ??
      from.goals.find((item) => item.id === id)?.title ??
      id
    );
  }
  if (group === 'measures') {
    return (
      to.measures.find((item) => item.id === id)?.title ??
      from.measures.find((item) => item.id === id)?.title ??
      id
    );
  }
  const source =
    revision.sourceReferences.find((item) => item.clinicalRecordId === id) ??
    from.sourceReferences.find((item) => item.clinicalRecordId === id);
  return source ? source.recordKind + ' · ' + source.clinicalRecordId : id;
}

function SourceReferenceCard({
  reference,
  t,
}: {
  reference: SourceReference;
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>;
}) {
  return (
    <div className="grid gap-1 rounded-md border bg-white p-3 text-sm">
      <p className="font-medium">{translated(t, recordKindKeys, reference.recordKind)}</p>
      <p className="break-all text-slate-700">
        {t('sourceReferences.recordId')}: {reference.clinicalRecordId}
      </p>
      {reference.rationale ? <p className="text-slate-700">{reference.rationale}</p> : null}
    </div>
  );
}

async function ItemSection<T>({
  title,
  empty,
  addLabel,
  items,
  editable,
  addForm,
  renderItem,
}: {
  title: string;
  empty: string;
  addLabel: string;
  items: T[];
  editable: boolean;
  addForm: React.ReactNode;
  renderItem: (item: T) => React.ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-lg border bg-white p-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {items.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">{items.map((item) => renderItem(item))}</ul>
      ) : (
        <p className="text-sm text-slate-700">{empty}</p>
      )}
      {editable ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer font-medium">{addLabel}</summary>
          {addForm}
        </details>
      ) : null}
    </section>
  );
}

type ChoiceOption = { value: string; label: string };

function enumOptions(
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>,
  labels: Record<string, string>,
): ChoiceOption[] {
  return Object.keys(labels).map((value) => ({ value, label: translated(t, labels, value) }));
}

function translated(
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>,
  labels: Record<string, string>,
  value: string,
): string {
  const key = labels[value];
  return key ? t(key as never) : value;
}

function planStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>,
  status: string,
): string {
  return translated(t, planStatusKeys, status);
}

function revisionStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>,
  status: string,
): string {
  return translated(t, revisionStatusKeys, status);
}

function evaluationResultLabel(
  t: Awaited<ReturnType<typeof getTranslations<'CarePlanning'>>>,
  result: string,
): string {
  return translated(t, evaluationResultKeys, result);
}

function FormContext({
  clientId,
  planId,
  revisionId,
  version,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
}) {
  return (
    <>
      <HiddenField name="clientId" value={clientId} />
      <HiddenField name="planId" value={planId} />
      <HiddenField name="revisionId" value={revisionId} />
      <HiddenField name="expectedVersion" value={String(version)} />
    </>
  );
}

function HiddenField({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

function TextField({
  name,
  label,
  value,
  required = false,
  type = 'text',
  maxLength,
}: {
  name: string;
  label: string;
  value?: string | null | undefined;
  required?: boolean | undefined;
  type?: 'text' | 'date' | undefined;
  maxLength?: number | undefined;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="min-w-0 rounded-md border px-3 py-2 font-normal"
        type={type}
        name={name}
        defaultValue={value ?? ''}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

function DateField({
  name,
  label,
  value,
  required = false,
}: {
  name: string;
  label: string;
  value?: string | null | undefined;
  required?: boolean | undefined;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="min-w-0 rounded-md border px-3 py-2 font-normal"
        type="date"
        name={name}
        defaultValue={value ?? ''}
        required={required}
      />
    </label>
  );
}

function TextareaField({
  name,
  label,
  value,
  required = false,
  maxLength,
}: {
  name: string;
  label: string;
  value?: string | null | undefined;
  required?: boolean | undefined;
  maxLength?: number | undefined;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <textarea
        className="min-h-24 min-w-0 rounded-md border px-3 py-2 font-normal"
        name={name}
        defaultValue={value ?? ''}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  value,
  required = false,
}: {
  name: string;
  label: string;
  options: ChoiceOption[];
  value?: string | undefined;
  required?: boolean | undefined;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="min-w-0 rounded-md border bg-white px-3 py-2 font-normal"
        name={name}
        defaultValue={value ?? options[0]?.value ?? ''}
        required={required}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MultiSelectField({
  name,
  label,
  options,
  selected,
  empty,
  hint,
}: {
  name: string;
  label: string;
  options: ChoiceOption[];
  selected: string[];
  empty: string;
  hint: string;
}) {
  if (!options.length) {
    return <p className="text-sm text-slate-600">{empty}</p>;
  }
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="min-w-0 rounded-md border bg-white px-3 py-2 font-normal"
        name={name}
        multiple
        defaultValue={selected}
        size={Math.min(Math.max(options.length, 2), 5)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="font-normal text-slate-600">{hint}</span>
    </label>
  );
}

function RemoveItem({
  clientId,
  planId,
  revisionId,
  version,
  kind,
  itemId,
  label,
}: {
  clientId: string;
  planId: string;
  revisionId: string;
  version: number;
  kind: 'need' | 'resource' | 'goal' | 'measure' | 'riskResponse' | 'sourceReference';
  itemId: string;
  label: string;
}) {
  return (
    <form action={removeCarePlanItemAction}>
      <FormContext clientId={clientId} planId={planId} revisionId={revisionId} version={version} />
      <HiddenField name="kind" value={kind} />
      <HiddenField name="itemId" value={itemId} />
      <button className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-900 hover:bg-red-50">
        {label}
      </button>
    </form>
  );
}

function Definition({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm font-medium text-slate-700">{label}</dt>
      <dd className={(multiline ? 'whitespace-pre-wrap ' : '') + 'text-sm'}>{value || '—'}</dd>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
      {message}
    </p>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}
