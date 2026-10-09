'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { components } from '@care/api-client';
import { getApiClient, getTenantHeader } from '../../lib/api';
import { visitDateTimeFromInput } from '../../lib/care-date';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const serviceStatuses = ['performed', 'partially_performed', 'not_performed'] as const;
const reasonCodes = [
  'client_declined',
  'client_not_present',
  'service_not_required',
  'time_constraint',
  'provider_decision',
  'other',
] as const;

type ClinicalMeasurementType = components['schemas']['ClinicalMeasurementDto']['measurementType'];
type ClinicalMeasurementUnit = components['schemas']['ClinicalMeasurementDto']['unit'];
type ClinicalMeasurementSource = components['schemas']['AddMeasurementRequestDto']['source'];
type ClinicalObservationCategory = components['schemas']['AddObservationRequestDto']['category'];
type ClinicalAssessmentType = components['schemas']['AddAssessmentRequestDto']['assessmentType'];
type ClinicalRiskType = components['schemas']['ClinicalRiskAssessmentDto']['riskType'];
type ClinicalRiskLevel = components['schemas']['ClinicalRiskAssessmentDto']['level'];

const measurementTypes = [
  'blood_pressure',
  'pulse',
  'temperature',
  'weight',
  'blood_glucose',
  'oxygen_saturation',
  'respiratory_rate',
] as const satisfies readonly ClinicalMeasurementType[];
const observationCategories = [
  'mobility',
  'orientation',
  'pain',
  'skin',
  'nutrition',
  'hydration',
  'elimination',
  'sleep',
  'mood',
  'general_condition',
] as const satisfies readonly ClinicalObservationCategory[];
const riskTypes = [
  'fall',
  'pressure_ulcer',
  'dehydration',
  'malnutrition',
] as const satisfies readonly ClinicalRiskType[];
const riskLevels = [
  'none',
  'low',
  'moderate',
  'high',
] as const satisfies readonly ClinicalRiskLevel[];
const observationCodes: Record<(typeof observationCategories)[number], readonly string[]> = {
  mobility: ['independent', 'assistance_required', 'bedbound'],
  orientation: ['oriented', 'disoriented'],
  pain: [],
  skin: ['intact', 'redness', 'altered'],
  nutrition: ['adequate', 'reduced', 'declined'],
  hydration: ['adequate', 'reduced', 'declined'],
  elimination: ['unchanged', 'changed', 'incontinence'],
  sleep: ['restful', 'disturbed'],
  mood: ['calm', 'anxious', 'low', 'agitated'],
  general_condition: ['stable', 'changed', 'declined'],
};

export async function startVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/execution/start', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'started'));
}

export async function recordMedicationOccurrenceAction(formData: FormData): Promise<void> {
  await recordMedicationAction(formData, false);
}

export async function recordPrnMedicationAction(formData: FormData): Promise<void> {
  await recordMedicationAction(formData, true);
}

async function recordMedicationAction(formData: FormData, prn: boolean): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const occurrenceId = prn ? null : readUuid(formData.get('occurrenceId'));
  const orderId = prn ? readUuid(formData.get('orderId')) : null;
  const outcome = readChoice(formData, 'outcome', ['administered', 'not_administered', 'refused', 'withheld'] as const);
  const actualDoseAmount = readString(formData, 'actualDoseAmount');
  const actualDoseUnit = readChoice(formData, 'actualDoseUnit', ['mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch'] as const);
  const reasonCode = readChoice(formData, 'reasonCode', ['client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other'] as const);
  const administrationReason = readNullableString(formData, 'administrationReason');
  const note = readNullableString(formData, 'note');
  const confirmed = formData.get('confirm') === 'on';
  if (!visitId || (!occurrenceId && !prn) || (!orderId && prn) || !outcome || note && note.length > 2000) {
    redirect(visitPath(visitId, 'MEDICATION_ADMINISTRATION_INVALID_OUTCOME'));
  }
  if (outcome === 'administered' && (!confirmed || !actualDoseAmount || !actualDoseUnit)) {
    redirect(visitPath(visitId, 'MEDICATION_ADMINISTRATION_INVALID_DOSE'));
  }
  if (outcome !== 'administered' && !reasonCode) {
    redirect(visitPath(visitId, 'MEDICATION_ADMINISTRATION_INVALID_OUTCOME'));
  }
  if (outcome !== 'administered' && reasonCode === 'other' && !administrationReason) {
    redirect(visitPath(visitId, 'MEDICATION_ADMINISTRATION_INVALID_OUTCOME'));
  }
  if (prn && !administrationReason) redirect(visitPath(visitId, 'MEDICATION_PRN_REASON_REQUIRED'));
  const body = {
    visitId,
    outcome,
    actualDoseAmount: outcome === 'administered' ? actualDoseAmount : null,
    actualDoseUnit: outcome === 'administered' ? actualDoseUnit : null,
    reasonCode: outcome === 'administered' ? null : reasonCode,
    administrationReason,
    note,
  };
  const api = await getApiClient();
  const header = await getTenantHeader();
  const result = prn
    ? await api.POST('/api/v1/medication-orders/{orderId}/prn-administrations', {
        params: { path: { orderId: orderId! }, header },
        body,
      })
    : await api.POST('/api/v1/medication-administrations/{occurrenceId}/record', {
        params: { path: { occurrenceId: occurrenceId! }, header },
        body,
      });
  if (result.error) redirect(visitPath(visitId, result.error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'medication-recorded'));
}

export async function recordPerformedServiceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const performedServiceId = readUuid(formData.get('performedServiceId'));
  const visitServiceId = readUuid(formData.get('visitServiceId'));
  const serviceDefinitionId = readUuid(formData.get('serviceDefinitionId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const status = readString(formData, 'status');
  const actualQuantity = readNullableString(formData, 'actualQuantity');
  const reason = readString(formData, 'reasonCode');
  if (
    !visitId ||
    !performedServiceId ||
    !expectedVersion ||
    !(serviceStatuses as readonly string[]).includes(status) ||
    (!visitServiceId && !serviceDefinitionId) ||
    (reason !== '' && !(reasonCodes as readonly string[]).includes(reason))
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.PUT(
    '/api/v1/visits/{visitId}/execution/services/{performedServiceId}',
    {
      params: {
        path: { visitId, performedServiceId },
        header: await getTenantHeader(),
      },
      body: {
        expectedVersion,
        ...(visitServiceId ? { visitServiceId } : {}),
        ...(serviceDefinitionId ? { serviceDefinitionId } : {}),
        status: status as (typeof serviceStatuses)[number],
        actualQuantity: status === 'not_performed' ? '0' : actualQuantity,
        reasonCode: reason ? (reason as (typeof reasonCodes)[number]) : null,
      },
    },
  );
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'service-saved'));
}

export async function completeVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !expectedVersion) redirect(visitPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/execution/complete', {
    params: { path: { visitId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'completed'));
}

export async function createDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/documentation', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'documentation-created'));
}

export async function addDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const type = readString(formData, 'type');
  const content = readString(formData, 'content');
  if (
    !visitId ||
    !documentationId ||
    !expectedVersion ||
    !content ||
    !['care_note', 'observation', 'deviation', 'incident'].includes(type)
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const severity = readString(formData, 'severity');
  if (type === 'incident' && !['low', 'moderate', 'high', 'critical'].includes(severity)) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-documentation/{id}/entries', {
    params: { path: { id: documentationId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      type: type as 'care_note' | 'observation' | 'deviation' | 'incident',
      content,
      ...(type === 'incident'
        ? {
            occurredAt: new Date().toISOString(),
            severity: severity as 'low' | 'moderate' | 'high' | 'critical',
          }
        : {}),
    },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'entry-saved'));
}

export async function updateDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const entryId = readUuid(formData.get('entryId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const content = readString(formData, 'content');
  if (!visitId || !documentationId || !entryId || !expectedVersion || !content) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/care-documentation/{id}/entries/{entryId}', {
    params: { path: { id: documentationId, entryId }, header: await getTenantHeader() },
    body: { expectedVersion, content },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'entry-saved'));
}

export async function removeDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const entryId = readUuid(formData.get('entryId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !documentationId || !entryId || !expectedVersion) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const { error } = await (
    await getApiClient()
  ).DELETE('/api/v1/care-documentation/{id}/entries/{entryId}', {
    params: { path: { id: documentationId, entryId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'entry-removed'));
}

export async function recordServiceEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const performedServiceId = readUuid(formData.get('performedServiceId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const note = readNullableString(formData, 'note');
  if (!visitId || !documentationId || !performedServiceId || !expectedVersion) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/care-documentation/{id}/evidence/{performedServiceId}', {
    params: {
      path: { id: documentationId, performedServiceId },
      header: await getTenantHeader(),
    },
    body: { expectedVersion, status: 'documented', note },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'evidence-saved'));
}

export async function finalizeDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !documentationId || !expectedVersion) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-documentation/{id}/finalize', {
    params: { path: { id: documentationId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'documentation-finalized'));
}

export async function saveClinicalRecordAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const recordId = readUuid(formData.get('recordId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const expectedRecordVersion = recordId
    ? readPositiveInteger(formData.get('expectedRecordVersion'))
    : null;
  const timezone = readString(formData, 'timezone');
  const kind = readString(formData, 'kind');
  if (
    !visitId ||
    !documentationId ||
    !expectedVersion ||
    !isTimezone(timezone) ||
    (recordId && !expectedRecordVersion)
  ) {
    redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
  }

  const api = await getApiClient();
  const header = await getTenantHeader();
  let errorCode: string | undefined;

  if (kind === 'measurement') {
    const measurementType = readString(formData, 'measurementType');
    const measuredAt = readClinicalTimestamp(formData, 'measuredAt', timezone);
    const source = readString(formData, 'source');
    const rawValue = readNullableString(formData, 'value');
    const integerValue = readOptionalInteger(formData.get('integerValue'));
    const systolic = readOptionalInteger(formData.get('systolic'));
    const diastolic = readOptionalInteger(formData.get('diastolic'));
    const glucoseUnit = readString(formData, 'glucoseUnit');
    if (
      !(measurementTypes as readonly string[]).includes(measurementType) ||
      !measuredAt ||
      (source !== 'manual' && source !== 'device')
    ) {
      redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
    }
    const typedMeasurementType = measurementType as ClinicalMeasurementType;
    const typedSource = source as ClinicalMeasurementSource;
    const value = ['temperature', 'weight', 'blood_glucose', 'oxygen_saturation'].includes(
      typedMeasurementType,
    )
      ? rawValue
      : null;
    const typedIntegerValue =
      typedMeasurementType === 'pulse' || typedMeasurementType === 'respiratory_rate'
        ? integerValue
        : null;
    const typedSystolic = typedMeasurementType === 'blood_pressure' ? systolic : null;
    const typedDiastolic = typedMeasurementType === 'blood_pressure' ? diastolic : null;
    const unit: ClinicalMeasurementUnit | null =
      typedMeasurementType === 'blood_pressure'
        ? 'mmHg'
        : typedMeasurementType === 'pulse'
          ? 'bpm'
          : typedMeasurementType === 'temperature'
            ? 'Cel'
            : typedMeasurementType === 'weight'
              ? 'kg'
              : typedMeasurementType === 'oxygen_saturation'
                ? '%'
                : typedMeasurementType === 'respiratory_rate'
                  ? '/min'
                  : glucoseUnit === 'mmol/L'
                    ? 'mmol/L'
                    : glucoseUnit === 'mg/dL'
                      ? 'mg/dL'
                      : null;
    if (
      unit === null ||
      (value !== null && !/^-?\d+(?:\.\d{1,3})?$/.test(value)) ||
      ((typedMeasurementType === 'pulse' || typedMeasurementType === 'respiratory_rate') &&
        integerValue === null) ||
      (typedMeasurementType === 'blood_pressure' && (systolic === null || diastolic === null)) ||
      (['temperature', 'weight', 'blood_glucose', 'oxygen_saturation'].includes(
        typedMeasurementType,
      ) &&
        value === null)
    ) {
      redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
    }
    const body = {
      expectedVersion,
      measurementType: typedMeasurementType,
      value,
      integerValue: typedIntegerValue,
      systolic: typedSystolic,
      diastolic: typedDiastolic,
      unit,
      measuredAt,
      source: typedSource,
      note: readNullableString(formData, 'note'),
    };
    const result = recordId
      ? await api.PATCH('/api/v1/care-documentation/{id}/measurements/{recordId}', {
          params: { path: { id: documentationId, recordId }, header },
          body: { ...body, expectedRecordVersion: expectedRecordVersion! },
        })
      : await api.POST('/api/v1/care-documentation/{id}/measurements', {
          params: { path: { id: documentationId }, header },
          body,
        });
    errorCode = result.error?.code;
  } else if (kind === 'observation') {
    const category = readString(formData, 'category');
    const observedAt = readClinicalTimestamp(formData, 'observedAt', timezone);
    const valueCode = readNullableString(formData, 'valueCode');
    const painScore = readOptionalInteger(formData.get('painScore'));
    const severity = readNullableString(formData, 'severity');
    if (
      !(observationCategories as readonly string[]).includes(category) ||
      !observedAt ||
      (category === 'pain'
        ? painScore === null || painScore < 0 || painScore > 10
        : !valueCode ||
          !observationCodes[category as (typeof observationCategories)[number]].includes(
            valueCode,
          )) ||
      (severity !== null && !['mild', 'moderate', 'severe'].includes(severity))
    ) {
      redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
    }
    const typedCategory = category as ClinicalObservationCategory;
    const body = {
      expectedVersion,
      category: typedCategory,
      valueCode: typedCategory === 'pain' ? null : valueCode,
      painScore: typedCategory === 'pain' ? painScore : null,
      location: typedCategory === 'pain' ? readNullableString(formData, 'location') : null,
      severity,
      observedAt,
      note: readNullableString(formData, 'note'),
    };
    const result = recordId
      ? await api.PATCH('/api/v1/care-documentation/{id}/observations/{recordId}', {
          params: { path: { id: documentationId, recordId }, header },
          body: { ...body, expectedRecordVersion: expectedRecordVersion! },
        })
      : await api.POST('/api/v1/care-documentation/{id}/observations', {
          params: { path: { id: documentationId }, header },
          body,
        });
    errorCode = result.error?.code;
  } else if (kind === 'assessment') {
    const assessmentType = readString(formData, 'assessmentType');
    const assessedAt = readClinicalTimestamp(formData, 'assessedAt', timezone);
    const validUntilInput = readString(formData, 'validUntil');
    const validUntil = validUntilInput ? visitDateTimeFromInput(validUntilInput, timezone) : null;
    const score = readNullableString(formData, 'score');
    const resultCode = readNullableString(formData, 'resultCode');
    if (
      (assessmentType !== 'general_condition' && assessmentType !== 'pain') ||
      !assessedAt ||
      (validUntilInput && !validUntil) ||
      (assessmentType === 'general_condition'
        ? !resultCode && !score
        : !score || !/^(?:0|[1-9]|10)$/.test(score)) ||
      (score !== null && !/^-?\d+(?:\.\d{1,3})?$/.test(score))
    ) {
      redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
    }
    if (
      assessmentType === 'general_condition' &&
      resultCode !== null &&
      !['stable', 'changed', 'declined'].includes(resultCode)
    ) {
      redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
    }
    const typedAssessmentType = assessmentType as ClinicalAssessmentType;
    const body = {
      expectedVersion,
      assessmentType: typedAssessmentType,
      resultCode: typedAssessmentType === 'general_condition' ? resultCode : null,
      score,
      assessedAt,
      validUntil,
      note: readNullableString(formData, 'note'),
    };
    const result = recordId
      ? await api.PATCH('/api/v1/care-documentation/{id}/assessments/{recordId}', {
          params: { path: { id: documentationId, recordId }, header },
          body: { ...body, expectedRecordVersion: expectedRecordVersion! },
        })
      : await api.POST('/api/v1/care-documentation/{id}/assessments', {
          params: { path: { id: documentationId }, header },
          body,
        });
    errorCode = result.error?.code;
  } else if (kind === 'risk_assessment') {
    const riskType = readString(formData, 'riskType');
    const level = readString(formData, 'level');
    const assessedAt = readClinicalTimestamp(formData, 'assessedAt', timezone);
    const validUntilInput = readString(formData, 'validUntil');
    const validUntil = validUntilInput ? visitDateTimeFromInput(validUntilInput, timezone) : null;
    if (
      !(riskTypes as readonly string[]).includes(riskType) ||
      !(riskLevels as readonly string[]).includes(level) ||
      !assessedAt ||
      (validUntilInput && !validUntil)
    ) {
      redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
    }
    const body = {
      expectedVersion,
      riskType: riskType as ClinicalRiskType,
      level: level as ClinicalRiskLevel,
      assessedAt,
      validUntil,
      source: readString(formData, 'source'),
      note: readNullableString(formData, 'note'),
    };
    const result = recordId
      ? await api.PATCH('/api/v1/care-documentation/{id}/risks/{recordId}', {
          params: { path: { id: documentationId, recordId }, header },
          body: { ...body, expectedRecordVersion: expectedRecordVersion! },
        })
      : await api.POST('/api/v1/care-documentation/{id}/risks', {
          params: { path: { id: documentationId }, header },
          body,
        });
    errorCode = result.error?.code;
  } else {
    redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
  }

  if (errorCode) redirect(visitPath(visitId, errorCode));
  refresh(visitId);
  redirect(visitPath(visitId, 'clinical-saved'));
}

export async function deleteClinicalRecordAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const recordId = readUuid(formData.get('recordId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const expectedRecordVersion = readPositiveInteger(formData.get('expectedRecordVersion'));
  const kind = readString(formData, 'kind');
  if (!visitId || !documentationId || !recordId || !expectedVersion || !expectedRecordVersion) {
    redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
  }
  const api = await getApiClient();
  const params = {
    path: { id: documentationId, recordId },
    header: await getTenantHeader(),
  };
  const body = { expectedVersion, expectedRecordVersion };
  const result =
    kind === 'measurement'
      ? await api.DELETE('/api/v1/care-documentation/{id}/measurements/{recordId}', {
          params,
          body,
        })
      : kind === 'observation'
        ? await api.DELETE('/api/v1/care-documentation/{id}/observations/{recordId}', {
            params,
            body,
          })
        : kind === 'assessment'
          ? await api.DELETE('/api/v1/care-documentation/{id}/assessments/{recordId}', {
              params,
              body,
            })
          : kind === 'risk_assessment'
            ? await api.DELETE('/api/v1/care-documentation/{id}/risks/{recordId}', {
                params,
                body,
              })
            : null;
  if (!result) redirect(visitPath(visitId, 'CLINICAL_RECORD_INVALID'));
  if (result.error) redirect(visitPath(visitId, result.error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'clinical-deleted'));
}

export async function prepareEvidencePackageAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const { data, error } = await (
    await getApiClient()
  ).POST('/api/v1/visits/{visitId}/evidence-package', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error || !data)
    redirect(evidencePath(visitId, error?.code ?? 'EVIDENCE_PACKAGE_INVALID_STATE'));
  revalidateEvidence(visitId, data.id);
  redirect(evidencePath(visitId, 'package-prepared'));
}

export async function acknowledgeEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const evidencePackageId = readUuid(formData.get('evidencePackageId'));
  const idempotencyKey = readUuid(formData.get('idempotencyKey'));
  const signatory = readSignatory(formData);
  const method = readString(formData, 'method');
  if (!visitId || !evidencePackageId || !idempotencyKey || !signatory) {
    redirect(evidencePath(visitId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const common = { idempotencyKey, signatory };
  const result =
    method === 'touch_signature'
      ? await api.POST('/api/v1/evidence-packages/{id}/acknowledgement', {
          params: { path: { id: evidencePackageId }, header: await getTenantHeader() },
          body: {
            ...common,
            method,
            strokes: parseSignatureStrokes(readString(formData, 'strokes')),
          },
        })
      : method === 'typed_confirmation'
        ? await api.POST('/api/v1/evidence-packages/{id}/acknowledgement', {
            params: { path: { id: evidencePackageId }, header: await getTenantHeader() },
            body: {
              ...common,
              method,
              confirmationName: readString(formData, 'confirmationName'),
            },
          })
        : null;

  if (!result) redirect(evidencePath(visitId, 'INVALID_REQUEST'));
  if (result.error) redirect(evidencePath(visitId, result.error.code));
  revalidateEvidence(visitId, evidencePackageId);
  redirect(evidencePath(visitId, 'acknowledged'));
}

export async function declineEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const evidencePackageId = readUuid(formData.get('evidencePackageId'));
  const idempotencyKey = readUuid(formData.get('idempotencyKey'));
  const signatory = readSignatory(formData);
  const reasonCode = readString(formData, 'reasonCode');
  const reasons = [
    'declined_without_reason',
    'disagrees_with_record',
    'unable_to_sign',
    'signatory_not_available',
    'other',
  ] as const;
  if (
    !visitId ||
    !evidencePackageId ||
    !idempotencyKey ||
    !signatory ||
    !(reasons as readonly string[]).includes(reasonCode)
  ) {
    redirect(evidencePath(visitId, 'INVALID_REQUEST'));
  }

  const { error } = await (
    await getApiClient()
  ).POST('/api/v1/evidence-packages/{id}/decline', {
    params: { path: { id: evidencePackageId }, header: await getTenantHeader() },
    body: {
      idempotencyKey,
      signatory,
      reasonCode: reasonCode as (typeof reasons)[number],
      note: readNullableString(formData, 'note'),
    },
  });
  if (error) redirect(evidencePath(visitId, error.code));
  revalidateEvidence(visitId, evidencePackageId);
  redirect(evidencePath(visitId, 'declined'));
}

function readUuid(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return uuidPattern.test(normalized) ? normalized : null;
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readChoice<const Values extends readonly string[]>(formData: FormData, name: string, values: Values): Values[number] | null {
  const value = readString(formData, name);
  return values.includes(value) ? value as Values[number] : null;
}

function readNullableString(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

function readPositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readOptionalInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readClinicalTimestamp(formData: FormData, name: string, timezone: string): string | null {
  return visitDateTimeFromInput(readString(formData, name), timezone);
}

function isTimezone(value: string): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

function readSignatory(
  formData: FormData,
):
  | { type: 'client' }
  | { type: 'representative' | 'other_authorized_person'; contactId: string }
  | null {
  const value = readString(formData, 'signatory');
  if (value === 'client') return { type: 'client' };
  const separator = value.indexOf(':');
  const type = value.slice(0, separator);
  const contactId = readUuid(separator > -1 ? value.slice(separator + 1) : null);
  if (!contactId || (type !== 'representative' && type !== 'other_authorized_person')) {
    return null;
  }
  return { type, contactId };
}

function parseSignatureStrokes(value: string): { x: number; y: number }[][] {
  if (!value || value.length > 48_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > 32) return [];
  let count = 0;
  for (const stroke of parsed) {
    if (!Array.isArray(stroke)) return [];
    count += stroke.length;
    if (count > 2_000) return [];
    for (const point of stroke) {
      if (
        typeof point !== 'object' ||
        point === null ||
        !('x' in point) ||
        !('y' in point) ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1
      ) {
        return [];
      }
    }
  }
  return parsed as { x: number; y: number }[][];
}

function evidencePath(visitId: string | null, value: string): string {
  return visitId
    ? `/care/visits/${visitId}/evidence?notice=${encodeURIComponent(value)}`
    : '/care/today?error=' + encodeURIComponent(value);
}

function revalidateEvidence(visitId: string, evidencePackageId: string): void {
  revalidatePath('/care/today');
  revalidatePath('/care/visits/' + visitId);
  revalidatePath('/care/visits/' + visitId + '/evidence');
  revalidatePath('/service-evidence');
  revalidatePath('/service-evidence/' + evidencePackageId);
}

function visitPath(visitId: string | null, value: string): string {
  return visitId
    ? '/care/visits/' + visitId + '?notice=' + encodeURIComponent(value)
    : '/care/today?error=' + encodeURIComponent(value);
}

function refresh(visitId: string): void {
  revalidatePath('/care/today');
  revalidatePath('/care/visits/' + visitId);
  revalidatePath('/visits/' + visitId);
}
