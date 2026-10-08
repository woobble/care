'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const needCategories = [
  'personal_care',
  'mobility',
  'nutrition',
  'hydration',
  'communication',
  'cognition',
  'daily_living',
  'social_participation',
  'safety',
  'other',
] as const;
const needSources = [
  'client_report',
  'professional_observation',
  'representative_report',
  'clinical_record',
] as const;
const needPriorities = ['low', 'normal', 'high'] as const;
const needStatuses = ['active', 'addressed', 'deferred'] as const;
const resourceCategories = [
  'self_care',
  'mobility',
  'communication',
  'cognition',
  'daily_routine',
  'social_support',
  'personal_interest',
  'other',
] as const;
const resourceStatuses = ['available', 'needs_support', 'unavailable'] as const;
const goalStatuses = ['active', 'achieved', 'discontinued'] as const;
const measureCategories = [
  'personal_care',
  'assistance',
  'encouragement',
  'monitoring',
  'positioning',
  'communication',
  'other',
] as const;
const measureStatuses = ['active', 'discontinued'] as const;
const riskStatuses = ['addressed', 'monitor', 'accepted'] as const;
const recordKinds = ['measurement', 'observation', 'assessment', 'risk_assessment'] as const;
const evaluationResults = [
  'effective',
  'partially_effective',
  'not_effective',
  'changed_condition',
  'no_change',
] as const;
const planChanges = ['none', 'revision_required'] as const;
const goalOutcomes = ['achieved', 'partially_achieved', 'not_achieved', 'not_applicable'] as const;

export async function createCarePlanAction(formData: FormData): Promise<void> {
  const clientId = requireUuid(formData, 'clientId');
  const validFrom = readDate(formData, 'validFrom');
  const validUntil = readOptionalDate(formData, 'validUntil');
  if (!validFrom || validUntil === undefined || (validUntil && validUntil < validFrom)) {
    redirect(carePlanPath(clientId, undefined, 'INVALID_REQUEST', 'error'));
  }
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/clients/{clientId}/care-plans', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: { validFrom, ...(validUntil ? { validUntil } : {}) },
  });
  if (error || !data) {
    redirect(carePlanPath(clientId, undefined, error?.code ?? 'CARE_PLAN_INVALID', 'error'));
  }
  refresh(clientId);
  redirect(carePlanPath(clientId, data.plan.id, 'planCreated'));
}

export async function saveCarePlanAssessmentAction(formData: FormData): Promise<void> {
  const { clientId, planId, revisionId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  if (!expectedVersion) invalid(clientId, planId);
  const fields = [
    'clientConcerns',
    'clientWishes',
    'clientGoals',
    'clientHabits',
    'clientPreferences',
    'clientPriorities',
    'professionalObservedNeeds',
    'professionalResources',
    'professionalLimitations',
    'professionalRisks',
    'professionalRationale',
  ] as const;
  const body = Object.fromEntries(
    fields.map((field) => [field, readOptionalText(formData, field, 4000)]),
  );
  const api = await getApiClient();
  const { error } = await api.PATCH(
    '/api/v1/care-plans/{planId}/revisions/{revisionId}/assessment',
    {
      params: { path: { planId, revisionId }, header: await getTenantHeader() },
      body: { expectedVersion, ...body },
    },
  );
  if (error) fail(clientId, planId, error.code);
  finish(clientId, planId, 'assessmentSaved');
}

export async function createCarePlanRevisionAction(formData: FormData): Promise<void> {
  const { clientId, planId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  const effectiveFrom = readDate(formData, 'effectiveFrom');
  const reason = readRequiredText(formData, 'reason', 1000);
  if (!expectedVersion || !effectiveFrom || !reason) invalid(clientId, planId);
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-plans/{planId}/revisions', {
    params: { path: { planId }, header: await getTenantHeader() },
    body: { expectedVersion, effectiveFrom, reason },
  });
  if (error) fail(clientId, planId, error.code);
  finish(clientId, planId, 'revisionCreated');
}

export async function activateCarePlanRevisionAction(formData: FormData): Promise<void> {
  const { clientId, planId, revisionId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  if (!expectedVersion) invalid(clientId, planId);
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/activate', {
    params: { path: { planId, revisionId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) fail(clientId, planId, error.code);
  finish(clientId, planId, 'revisionActivated');
}

export async function saveCarePlanItemAction(formData: FormData): Promise<void> {
  const { clientId, planId, revisionId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  const kind = readChoice(formData, 'kind', [
    'need',
    'resource',
    'goal',
    'measure',
    'riskResponse',
    'sourceReference',
  ] as const);
  const rawItemId = readText(formData, 'itemId');
  const itemId = rawItemId ? validUuid(rawItemId) : undefined;
  if (!expectedVersion || !kind || (rawItemId && !itemId)) invalid(clientId, planId);

  const api = await getApiClient();
  const header = await getTenantHeader();
  let errorCode: string | undefined;

  if (kind === 'need') {
    const category = readChoice(formData, 'category', needCategories);
    const source = readChoice(formData, 'source', needSources);
    const priority = readChoice(formData, 'priority', needPriorities);
    const status = readChoice(formData, 'status', needStatuses);
    const title = readRequiredText(formData, 'title', 200);
    const description = readOptionalText(formData, 'description', 2000);
    if (!category || !source || !priority || !status || !title || description === undefined) {
      invalid(clientId, planId);
    }
    const body = { expectedVersion, category, source, priority, status, title, description };
    errorCode = itemId
      ? (
          await api.PATCH('/api/v1/care-plans/{planId}/revisions/{revisionId}/needs/{needId}', {
            params: { path: { planId, revisionId, needId: itemId }, header },
            body,
          })
        ).error?.code
      : (
          await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/needs', {
            params: { path: { planId, revisionId }, header },
            body,
          })
        ).error?.code;
  } else if (kind === 'resource') {
    const category = readChoice(formData, 'category', resourceCategories);
    const status = readChoice(formData, 'status', resourceStatuses);
    const description = readRequiredText(formData, 'description', 2000);
    if (!category || !status || !description) invalid(clientId, planId);
    const body = { expectedVersion, category, status, description };
    errorCode = itemId
      ? (
          await api.PATCH(
            '/api/v1/care-plans/{planId}/revisions/{revisionId}/resources/{resourceId}',
            { params: { path: { planId, revisionId, resourceId: itemId }, header }, body },
          )
        ).error?.code
      : (
          await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/resources', {
            params: { path: { planId, revisionId }, header },
            body,
          })
        ).error?.code;
  } else if (kind === 'goal') {
    const status = readChoice(formData, 'status', goalStatuses);
    const priority = readChoice(formData, 'priority', needPriorities);
    const title = readRequiredText(formData, 'title', 200);
    const description = readOptionalText(formData, 'description', 2000);
    const targetDate = readOptionalDate(formData, 'targetDate');
    const needIds = readUuidList(formData, 'needIds');
    if (
      !status ||
      !priority ||
      !title ||
      description === undefined ||
      targetDate === undefined ||
      !needIds
    ) {
      invalid(clientId, planId);
    }
    const body = { expectedVersion, status, priority, title, description, targetDate, needIds };
    errorCode = itemId
      ? (
          await api.PATCH('/api/v1/care-plans/{planId}/revisions/{revisionId}/goals/{goalId}', {
            params: { path: { planId, revisionId, goalId: itemId }, header },
            body,
          })
        ).error?.code
      : (
          await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/goals', {
            params: { path: { planId, revisionId }, header },
            body,
          })
        ).error?.code;
  } else if (kind === 'measure') {
    const category = readChoice(formData, 'category', measureCategories);
    const status = readChoice(formData, 'status', measureStatuses);
    const title = readRequiredText(formData, 'title', 200);
    const instruction = readRequiredText(formData, 'instruction', 4000);
    const validFrom = readDate(formData, 'validFrom');
    const validUntil = readOptionalDate(formData, 'validUntil');
    const serviceDefinitionId = readOptionalUuid(formData, 'serviceDefinitionId');
    const needIds = readUuidList(formData, 'needIds');
    const goalIds = readUuidList(formData, 'goalIds');
    const frequencyText = readOptionalText(formData, 'frequencyText', 200);
    const responsibleRole = readOptionalText(formData, 'responsibleRole', 120);
    if (
      !category ||
      !status ||
      !title ||
      !instruction ||
      !validFrom ||
      validUntil === undefined ||
      serviceDefinitionId === undefined ||
      !needIds ||
      !goalIds ||
      frequencyText === undefined ||
      responsibleRole === undefined ||
      (validUntil && validUntil < validFrom)
    ) {
      invalid(clientId, planId);
    }
    const body = {
      expectedVersion,
      category,
      status,
      title,
      instruction,
      validFrom,
      validUntil,
      serviceDefinitionId,
      needIds,
      goalIds,
      frequencyText,
      responsibleRole,
    };
    errorCode = itemId
      ? (
          await api.PATCH(
            '/api/v1/care-plans/{planId}/revisions/{revisionId}/measures/{measureId}',
            {
              params: { path: { planId, revisionId, measureId: itemId }, header },
              body,
            },
          )
        ).error?.code
      : (
          await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/measures', {
            params: { path: { planId, revisionId }, header },
            body,
          })
        ).error?.code;
  } else if (kind === 'riskResponse') {
    const clinicalRecordId = validUuid(readText(formData, 'clinicalRecordId'));
    const status = readChoice(formData, 'status', riskStatuses);
    const plannedResponse = readRequiredText(formData, 'plannedResponse', 2000);
    const needIds = readUuidList(formData, 'needIds');
    const measureIds = readUuidList(formData, 'measureIds');
    if (!clinicalRecordId || !status || !plannedResponse || !needIds || !measureIds) {
      invalid(clientId, planId);
    }
    const body = {
      expectedVersion,
      clinicalRecordId,
      status,
      plannedResponse,
      needIds,
      measureIds,
    };
    errorCode = itemId
      ? (
          await api.PATCH(
            '/api/v1/care-plans/{planId}/revisions/{revisionId}/risk-responses/{riskResponseId}',
            { params: { path: { planId, revisionId, riskResponseId: itemId }, header }, body },
          )
        ).error?.code
      : (
          await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/risk-responses', {
            params: { path: { planId, revisionId }, header },
            body,
          })
        ).error?.code;
  } else {
    const clinicalRecordId = validUuid(readText(formData, 'clinicalRecordId'));
    const recordKind = readChoice(formData, 'recordKind', recordKinds);
    const rationale = readOptionalText(formData, 'rationale', 1000);
    if (!clinicalRecordId || !recordKind || rationale === undefined || itemId) {
      invalid(clientId, planId);
    }
    const body = { expectedVersion, clinicalRecordId, recordKind, rationale };
    errorCode = (
      await api.POST('/api/v1/care-plans/{planId}/revisions/{revisionId}/source-references', {
        params: { path: { planId, revisionId }, header },
        body,
      })
    ).error?.code;
  }

  if (errorCode) fail(clientId, planId, errorCode);
  finish(clientId, planId, 'itemSaved');
}

export async function removeCarePlanItemAction(formData: FormData): Promise<void> {
  const { clientId, planId, revisionId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  const kind = readChoice(formData, 'kind', [
    'need',
    'resource',
    'goal',
    'measure',
    'riskResponse',
    'sourceReference',
  ] as const);
  const itemId = validUuid(readText(formData, 'itemId'));
  if (!expectedVersion || !kind || !itemId) invalid(clientId, planId);
  const api = await getApiClient();
  const header = await getTenantHeader();
  let errorCode: string | undefined;

  if (kind === 'need') {
    errorCode = (
      await api.DELETE('/api/v1/care-plans/{planId}/revisions/{revisionId}/needs/{needId}', {
        params: { path: { planId, revisionId, needId: itemId }, header },
        body: { expectedVersion },
      })
    ).error?.code;
  } else if (kind === 'resource') {
    errorCode = (
      await api.DELETE(
        '/api/v1/care-plans/{planId}/revisions/{revisionId}/resources/{resourceId}',
        {
          params: { path: { planId, revisionId, resourceId: itemId }, header },
          body: { expectedVersion },
        },
      )
    ).error?.code;
  } else if (kind === 'goal') {
    errorCode = (
      await api.DELETE('/api/v1/care-plans/{planId}/revisions/{revisionId}/goals/{goalId}', {
        params: { path: { planId, revisionId, goalId: itemId }, header },
        body: { expectedVersion },
      })
    ).error?.code;
  } else if (kind === 'measure') {
    errorCode = (
      await api.DELETE('/api/v1/care-plans/{planId}/revisions/{revisionId}/measures/{measureId}', {
        params: { path: { planId, revisionId, measureId: itemId }, header },
        body: { expectedVersion },
      })
    ).error?.code;
  } else if (kind === 'riskResponse') {
    errorCode = (
      await api.DELETE(
        '/api/v1/care-plans/{planId}/revisions/{revisionId}/risk-responses/{riskResponseId}',
        {
          params: { path: { planId, revisionId, riskResponseId: itemId }, header },
          body: { expectedVersion },
        },
      )
    ).error?.code;
  } else {
    errorCode = (
      await api.DELETE(
        '/api/v1/care-plans/{planId}/revisions/{revisionId}/source-references/{clinicalRecordId}',
        {
          params: { path: { planId, revisionId, clinicalRecordId: itemId }, header },
          body: { expectedVersion },
        },
      )
    ).error?.code;
  }

  if (errorCode) fail(clientId, planId, errorCode);
  finish(clientId, planId, 'itemRemoved');
}

export async function evaluateCarePlanAction(formData: FormData): Promise<void> {
  const { clientId, planId, revisionId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  const result = readChoice(formData, 'result', evaluationResults);
  const planChange = readChoice(formData, 'planChange', planChanges);
  const summary = readRequiredText(formData, 'summary', 4000);
  const nextEvaluationDue = readOptionalDate(formData, 'nextEvaluationDue');
  const goalIds = readUuidList(formData, 'goalIds');
  if (
    !expectedVersion ||
    !result ||
    !planChange ||
    !summary ||
    nextEvaluationDue === undefined ||
    !goalIds
  ) {
    invalid(clientId, planId);
  }
  const goals = [] as Array<{
    goalId: string;
    outcome: (typeof goalOutcomes)[number];
    note: string | null;
  }>;
  for (const goalId of goalIds) {
    const outcome = readChoice(formData, `outcome:${goalId}`, goalOutcomes);
    const note = readOptionalText(formData, `note:${goalId}`, 1000);
    if (!outcome || note === undefined) invalid(clientId, planId);
    goals.push({ goalId, outcome, note });
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-plans/{planId}/evaluations', {
    params: { path: { planId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      revisionId,
      result,
      planChange,
      summary,
      nextEvaluationDue,
      goals,
    },
  });
  if (error) fail(clientId, planId, error.code);
  finish(clientId, planId, 'evaluationSaved');
}

export async function endCarePlanAction(formData: FormData): Promise<void> {
  const { clientId, planId } = requireContext(formData);
  const expectedVersion = readPositiveInteger(formData, 'expectedVersion');
  const reason = readRequiredText(formData, 'reason', 1000);
  if (!expectedVersion || !reason) invalid(clientId, planId);
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-plans/{planId}/end', {
    params: { path: { planId }, header: await getTenantHeader() },
    body: { expectedVersion, reason },
  });
  if (error) fail(clientId, planId, error.code);
  finish(clientId, planId, 'planEnded');
}

function requireContext(formData: FormData): {
  clientId: string;
  planId: string;
  revisionId: string;
} {
  const clientId = validUuid(readText(formData, 'clientId'));
  const planId = validUuid(readText(formData, 'planId'));
  const revisionId = validUuid(readText(formData, 'revisionId'));
  if (!clientId || !planId || !revisionId) {
    redirect('/clients?error=INVALID_REQUEST');
  }
  return { clientId, planId, revisionId };
}

function requireUuid(formData: FormData, field: string): string {
  const id = validUuid(readText(formData, field));
  if (!id) redirect('/clients?error=INVALID_REQUEST');
  return id;
}

function validUuid(value: string): string | undefined {
  return uuidPattern.test(value) ? value : undefined;
}

function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function readRequiredText(
  formData: FormData,
  field: string,
  maxLength: number,
): string | undefined {
  const value = readText(formData, field);
  return value && value.length <= maxLength ? value : undefined;
}

function readOptionalText(
  formData: FormData,
  field: string,
  maxLength: number,
): string | null | undefined {
  const value = readText(formData, field);
  if (!value) return null;
  return value.length <= maxLength ? value : undefined;
}

function readDate(formData: FormData, field: string): string | undefined {
  const value = readText(formData, field);
  return validDate(value) ? value : undefined;
}

function readOptionalDate(formData: FormData, field: string): string | null | undefined {
  const value = readText(formData, field);
  if (!value) return null;
  return validDate(value) ? value : undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readPositiveInteger(formData: FormData, field: string): number | undefined {
  const value = readText(formData, field);
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalUuid(formData: FormData, field: string): string | null | undefined {
  const value = readText(formData, field);
  if (!value) return null;
  return validUuid(value);
}

function readUuidList(formData: FormData, field: string): string[] | undefined {
  const values = formData.getAll(field);
  if (values.some((value) => typeof value !== 'string' || !validUuid(value.trim()))) {
    return undefined;
  }
  return [...new Set(values.map((value) => (value as string).trim()))];
}

function readChoice<const Values extends readonly string[]>(
  formData: FormData,
  field: string,
  values: Values,
): Values[number] | undefined {
  const value = readText(formData, field);
  return values.includes(value) ? (value as Values[number]) : undefined;
}

function invalid(clientId: string, planId?: string): never {
  redirect(carePlanPath(clientId, planId, 'INVALID_REQUEST', 'error'));
}

function fail(clientId: string, planId: string, error: string): never {
  redirect(carePlanPath(clientId, planId, error, 'error'));
}

function refresh(clientId: string): void {
  revalidatePath('/care-plans');
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/care-plan`);
}

function finish(clientId: string, planId: string, notice: string): never {
  refresh(clientId);
  redirect(carePlanPath(clientId, planId, notice));
}

function carePlanPath(
  clientId: string,
  planId?: string,
  value?: string,
  kind: 'error' | 'notice' = 'notice',
): string {
  const query = new URLSearchParams();
  if (planId) query.set('planId', planId);
  if (value) query.set(kind, value);
  const suffix = query.toString();
  return `/clients/${clientId}/care-plan${suffix ? `?${suffix}` : ''}`;
}
