'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { visitDateTimeFromInput } from '@app/web/lib/care-date';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const contactMethods = ['phone', 'email', 'in_person', 'letter', 'other'] as const;
const fundingPlans = ['unknown', 'private_pay', 'benefits', 'other'] as const;
const stages = [
  'inquiry',
  'assessment',
  'preparation',
  'ready_for_admission',
  'declined',
  'withdrawn',
] as const;
const communicationDirections = ['inbound', 'outbound', 'internal'] as const;
const communicationChannels = ['phone', 'in_person', 'email', 'letter', 'portal', 'other'] as const;
const communicationCategories = [
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
] as const;
const communicationOutcomes = [
  'information_provided',
  'request_received',
  'action_required',
  'appointment_agreed',
  'no_answer',
  'resolved',
  'other',
] as const;
const checklistSources = ['automatic', 'manual', 'document'] as const;
const requirementTypes = ['policy', 'external'] as const;

export async function createAdmissionCaseAction(formData: FormData): Promise<boolean | void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const facilityId = optionalUuid(formData.get('facilityId'));
  const ownerEmployeeId = optionalUuid(formData.get('ownerEmployeeId'));
  const clientId = optionalUuid(formData.get('clientId'));
  const firstName = read(formData, 'firstName').trim();
  const lastName = read(formData, 'lastName').trim();
  const contactMethod = choice(formData, 'contactMethod', contactMethods);
  const inquirySource = read(formData, 'inquirySource').trim();
  const fundingPlan = choice(formData, 'fundingPlan', fundingPlans);
  const fundingPlanDetails = read(formData, 'fundingPlanDetails').trim();
  const nextFollowUpAt = read(formData, 'nextFollowUpAt');
  const timezone = read(formData, 'timezone') || 'Europe/Berlin';
  const followUp = nextFollowUpAt ? visitDateTimeFromInput(nextFollowUpAt, timezone) : null;
  if (
    !organizationId ||
    facilityId === undefined ||
    ownerEmployeeId === undefined ||
    clientId === undefined ||
    !firstName ||
    !lastName ||
    !contactMethod ||
    !inquirySource ||
    (nextFollowUpAt && !followUp)
  ) {
    return false;
  }
  const requestedServices = read(formData, 'requestedServices')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/onboarding/cases', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      firstName,
      lastName,
      contactMethod,
      inquirySource,
      ...(fundingPlan ? { fundingPlan } : {}),
      ...(fundingPlanDetails ? { fundingPlanDetails } : {}),
      ...(clientId ? { clientId } : {}),
      ...(facilityId ? { facilityId } : {}),
      ...(ownerEmployeeId ? { ownerEmployeeId } : {}),
      ...(read(formData, 'requesterName').trim()
        ? { requesterName: read(formData, 'requesterName').trim() }
        : {}),
      ...(read(formData, 'requesterRelationship').trim()
        ? { requesterRelationship: read(formData, 'requesterRelationship').trim() }
        : {}),
      ...(read(formData, 'contactEmail').trim()
        ? { contactEmail: read(formData, 'contactEmail').trim() }
        : {}),
      ...(read(formData, 'contactPhone').trim()
        ? { contactPhone: read(formData, 'contactPhone').trim() }
        : {}),
      ...(requestedServices.length ? { requestedServices } : {}),
      ...(read(formData, 'preferredStartDate')
        ? { preferredStartDate: read(formData, 'preferredStartDate') }
        : {}),
      ...(read(formData, 'serviceLocation').trim()
        ? { serviceLocation: read(formData, 'serviceLocation').trim() }
        : {}),
      ...(read(formData, 'initialNotes').trim()
        ? { initialNotes: read(formData, 'initialNotes').trim() }
        : {}),
      ...(followUp ? { nextFollowUpAt: followUp } : {}),
    },
  });
  if (error || !data || typeof data.id !== 'string') return false;
  revalidatePath('/admissions');
  redirect(`/admissions/${data.id}`);
}

export async function updateAdmissionCaseAction(formData: FormData): Promise<boolean | void> {
  const id = caseId(formData);
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const facilityId = optionalUuid(formData.get('facilityId'));
  const ownerEmployeeId = optionalUuid(formData.get('ownerEmployeeId'));
  const contactMethod = choice(formData, 'contactMethod', contactMethods);
  const fundingPlan = choice(formData, 'fundingPlan', fundingPlans);
  const fundingPlanDetails = read(formData, 'fundingPlanDetails').trim();
  const timezone = read(formData, 'timezone') || 'Europe/Berlin';
  const followUpValue = read(formData, 'nextFollowUpAt');
  const followUp = followUpValue ? visitDateTimeFromInput(followUpValue, timezone) : null;
  const firstName = read(formData, 'firstName').trim();
  const lastName = read(formData, 'lastName').trim();
  const inquirySource = read(formData, 'inquirySource').trim();
  if (
    !id ||
    !expectedVersion ||
    facilityId === undefined ||
    ownerEmployeeId === undefined ||
    !contactMethod ||
    !fundingPlan ||
    !firstName ||
    !lastName ||
    !inquirySource ||
    (followUpValue && !followUp)
  ) {
    return false;
  }
  const requestedServices = read(formData, 'requestedServices')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/onboarding/cases/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      firstName,
      lastName,
      contactMethod,
      inquirySource,
      fundingPlan,
      fundingPlanDetails: fundingPlanDetails || null,
      facilityId,
      ownerEmployeeId,
      requesterName: read(formData, 'requesterName').trim() || null,
      requesterRelationship: read(formData, 'requesterRelationship').trim() || null,
      contactEmail: read(formData, 'contactEmail').trim() || null,
      contactPhone: read(formData, 'contactPhone').trim() || null,
      requestedServices,
      preferredStartDate: read(formData, 'preferredStartDate') || null,
      serviceLocation: read(formData, 'serviceLocation').trim() || null,
      initialNotes: read(formData, 'initialNotes').trim() || null,
      nextFollowUpAt: followUp,
    },
  });
  if (error) return false;
  refreshAdmissionPage(id);
}

export async function linkAdmissionClientAction(formData: FormData): Promise<void> {
  const id = caseId(formData);
  const clientId = readUuid(formData.get('clientId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  if (!id || !clientId || !expectedVersion) redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/onboarding/cases/{id}/client-link', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      clientId,
      expectedVersion,
      ...(read(formData, 'reason').trim() ? { reason: read(formData, 'reason').trim() } : {}),
    },
  });
  if (error) redirect(casePath(id, error.code));
  refreshAdmissionPage(id);
}

export async function registerAdmissionClientAction(formData: FormData): Promise<void> {
  const id = caseId(formData);
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  if (!id || !expectedVersion) redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/onboarding/cases/{id}/register-client', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(casePath(id, error.code));
  refreshAdmissionPage(id);
  redirect(casePath(id, ''));
}

export async function saveAdmissionAssessmentAction(formData: FormData): Promise<boolean | void> {
  const id = caseId(formData);
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const visitsRaw = read(formData, 'visitsPerWeek').trim();
  const visitsPerWeek = visitsRaw ? Number(visitsRaw) : null;
  if (!id || !expectedVersion || (visitsPerWeek !== null && !Number.isFinite(visitsPerWeek)))
    return false;
  const requestedServices = read(formData, 'requestedServicesAssessment')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const preferredDays = stringValues(formData, 'preferredDays');
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/onboarding/cases/{id}/assessment', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      data: {
        requestedServices,
        householdSupport: read(formData, 'householdSupport'),
        everydayAssistance: read(formData, 'everydayAssistance'),
        accompaniment: read(formData, 'accompaniment'),
        preferredDays,
        preferredTimeStart: read(formData, 'preferredTimeStart') || null,
        preferredTimeEnd: read(formData, 'preferredTimeEnd') || null,
        visitsPerWeek,
        preferredStartDate: read(formData, 'assessmentPreferredStartDate') || null,
        accessibility: read(formData, 'accessibility'),
        preferences: read(formData, 'preferences'),
        organizationalNotes: read(formData, 'organizationalNotes'),
      },
    },
  });
  if (error) return false;
  refreshAdmissionPage(id);
}

export async function transitionAdmissionAction(formData: FormData): Promise<void> {
  const id = caseId(formData);
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const toStage = choice(formData, 'toStage', stages);
  if (!id || !expectedVersion || !toStage) redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/onboarding/cases/{id}/transitions', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      toStage,
      ...(read(formData, 'reason').trim() ? { reason: read(formData, 'reason').trim() } : {}),
    },
  });
  if (error) redirect(casePath(id, error.code));
  refreshAdmissionPage(id);
}

export async function admitCaseAction(formData: FormData): Promise<void> {
  const id = caseId(formData);
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  if (!id || !expectedVersion) redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/onboarding/cases/{id}/admit', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(casePath(id, error.code));
  revalidatePath('/clients');
  refreshAdmissionPage(id);
}

export async function respondAdmissionChecklistAction(formData: FormData): Promise<boolean | void> {
  const id = caseId(formData);
  const code = read(formData, 'itemCode');
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const status = choice(formData, 'status', ['complete', 'not_applicable'] as const);
  if (!id || !/^[a-z][a-z0-9_]{1,63}$/.test(code) || !expectedVersion || !status) return false;
  const reason = read(formData, 'reason').trim();
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/onboarding/cases/{id}/checklist/{code}', {
    params: { path: { id, code }, header: await getTenantHeader() },
    body: { expectedVersion, status, ...(status === 'not_applicable' && reason ? { reason } : {}) },
  });
  if (error) return false;
  refreshAdmissionPage(id);
}

export async function linkAdmissionSourceAction(formData: FormData): Promise<void> {
  const id = caseId(formData);
  const kind = read(formData, 'sourceKind');
  const value = read(formData, 'sourceId');
  if (!id || !readUuid(formData.get('sourceId')))
    redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const api = await getApiClient();
  const params = { path: { id }, header: await getTenantHeader() };
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  if (kind === 'visit' && !expectedVersion) redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const result =
    kind === 'document'
      ? await api.POST('/api/v1/onboarding/cases/{id}/documents', {
          params,
          body: { documentArtifactId: value, requirementCode: read(formData, 'requirementCode') },
        })
      : kind === 'task'
        ? await api.POST('/api/v1/onboarding/cases/{id}/tasks', { params, body: { taskId: value } })
        : kind === 'communication'
          ? await api.POST('/api/v1/onboarding/cases/{id}/communications', {
              params,
              body: { interactionId: value },
            })
          : await api.POST('/api/v1/onboarding/cases/{id}/first-visit', {
              params,
              body: { visitId: value, expectedVersion: expectedVersion! },
            });
  if (result.error) redirect(casePath(id, result.error.code));
  refreshAdmissionPage(id);
}

export async function recordAdmissionCommunicationAction(formData: FormData): Promise<void> {
  const id = caseId(formData);
  const direction = choice(formData, 'direction', communicationDirections);
  const channel = choice(formData, 'channel', communicationChannels);
  const category = choice(formData, 'category', communicationCategories);
  const outcome = choice(formData, 'outcome', communicationOutcomes);
  const subject = read(formData, 'subject').trim();
  const occurredAt = visitDateTimeFromInput(
    read(formData, 'occurredAt'),
    read(formData, 'timezone') || 'Europe/Berlin',
  );
  if (
    !id ||
    !direction ||
    !channel ||
    !category ||
    !outcome ||
    !subject ||
    subject.length > 200 ||
    !occurredAt
  ) {
    redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  }
  const summary = read(formData, 'summary').trim();
  if (summary.length > 4000) redirect(casePath(id, 'ONBOARDING_INVALID_INPUT'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/onboarding/cases/{id}/communications/records', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      direction,
      channel,
      category,
      subject,
      outcome,
      occurredAt,
      ...(summary ? { summary } : {}),
    },
  });
  if (error) redirect(casePath(id, error.code));
  refreshAdmissionPage(id);
}

export async function updateAdmissionTemplateAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('templateId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const name = read(formData, 'name').trim();
  const codes = stringValues(formData, 'code');
  const categories = stringValues(formData, 'category');
  const labels = stringValues(formData, 'label');
  const sources = stringValues(formData, 'source');
  const mandatory = stringValues(formData, 'mandatory');
  const types = stringValues(formData, 'requirementType');
  const length = codes.length;
  if (
    !id ||
    !expectedVersion ||
    !name ||
    name.length > 120 ||
    length < 6 ||
    length > 41 ||
    [categories, labels, sources, mandatory, types].some((values) => values.length !== length)
  ) {
    redirect('/admissions/templates?error=ONBOARDING_INVALID_CHECKLIST_TEMPLATE');
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const source = sources[index];
    const isMandatory = mandatory[index];
    const requirementType = types[index];
    const code = codes[index]?.trim();
    const category = categories[index]?.trim();
    const label = labels[index]?.trim();
    if (!code && !category && !label) continue;
    if (
      !source ||
      !(checklistSources as readonly string[]).includes(source) ||
      (isMandatory !== 'true' && isMandatory !== 'false') ||
      !requirementType ||
      !(requirementTypes as readonly string[]).includes(requirementType) ||
      !code ||
      code.length > 64 ||
      !category ||
      category.length > 80 ||
      !label ||
      label.length > 160
    ) {
      redirect('/admissions/templates?error=ONBOARDING_INVALID_CHECKLIST_TEMPLATE');
    }
    items.push({
      code,
      category,
      label,
      source: source as (typeof checklistSources)[number],
      mandatory: isMandatory === 'true',
      requirementType: requirementType as (typeof requirementTypes)[number],
    });
  }
  if (items.length < 6 || items.length > 40)
    redirect('/admissions/templates?error=ONBOARDING_INVALID_CHECKLIST_TEMPLATE');
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/onboarding/templates/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { expectedVersion, name, items },
  });
  if (error) redirect(`/admissions/templates?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/admissions');
  revalidatePath('/admissions/templates');
  redirect('/admissions/templates');
}

function refreshAdmissionPage(id: string) {
  revalidatePath('/admissions');
  revalidatePath(`/admissions/${id}`);
}

function casePath(id: string | null, error: string) {
  return id
    ? `/admissions/${id}${error ? `?error=${encodeURIComponent(error)}` : ''}`
    : '/admissions';
}

function caseId(formData: FormData) {
  return readUuid(formData.get('caseId'));
}

function read(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function stringValues(formData: FormData, name: string) {
  return formData.getAll(name).map((value) => (typeof value === 'string' ? value : ''));
}

function readUuid(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

function optionalUuid(value: FormDataEntryValue | null): string | null | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  return readUuid(raw) ?? undefined;
}

function positiveInteger(value: FormDataEntryValue | null): number | null {
  const parsed = Number(typeof value === 'string' ? value : '');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function choice<const T extends readonly string[]>(
  formData: FormData,
  name: string,
  values: T,
): T[number] | null {
  const value = read(formData, name);
  return (values as readonly string[]).includes(value) ? (value as T[number]) : null;
}
