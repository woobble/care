export const DOCUMENTATION_ENTRY_TYPES = [
  'care_note',
  'observation',
  'deviation',
  'incident',
] as const;

export type DocumentationEntryType = (typeof DOCUMENTATION_ENTRY_TYPES)[number];
export type DocumentationStatus = 'draft' | 'finalized';
export type EvidenceStatus = 'documented' | 'not_required';
export type IncidentSeverity = 'low' | 'moderate' | 'high' | 'critical';

export interface DocumentationServiceForCompleteness {
  performedServiceId: string;
  status: 'performed' | 'partially_performed' | 'not_performed';
  reasonCode: string | null;
  evidence: { status: EvidenceStatus; note: string | null } | null;
}

export interface MissingDocumentationRequirement {
  code:
    | 'DOCUMENTATION_REQUIRED'
    | 'VISIT_EXECUTION_REQUIRED'
    | 'SERVICE_EVIDENCE_REQUIRED'
    | 'NOT_PERFORMED_REASON_REQUIRED'
    | 'PARTIAL_SERVICE_EXPLANATION_REQUIRED';
  performedServiceId?: string;
}

export interface DocumentationCompleteness {
  isComplete: boolean;
  missing: MissingDocumentationRequirement[];
}

export function evaluateDocumentationCompleteness(input: {
  hasExecution: boolean;
  hasDocumentation: boolean;
  services: readonly DocumentationServiceForCompleteness[];
}): DocumentationCompleteness {
  const missing: MissingDocumentationRequirement[] = [];
  if (!input.hasExecution) {
    missing.push({ code: 'VISIT_EXECUTION_REQUIRED' });
  } else if (!input.hasDocumentation) {
    missing.push({ code: 'DOCUMENTATION_REQUIRED' });
  }

  for (const service of input.services) {
    const evidenceIsApplicable =
      service.evidence !== null &&
      (service.evidence.status === 'documented' || service.status === 'not_performed');
    if (!evidenceIsApplicable) {
      missing.push({
        code: 'SERVICE_EVIDENCE_REQUIRED',
        performedServiceId: service.performedServiceId,
      });
    }
    if (service.status === 'not_performed' && !service.reasonCode) {
      missing.push({
        code: 'NOT_PERFORMED_REASON_REQUIRED',
        performedServiceId: service.performedServiceId,
      });
    }
    if (
      service.status === 'partially_performed' &&
      !service.reasonCode &&
      !(evidenceIsApplicable && service.evidence?.note?.trim())
    ) {
      missing.push({
        code: 'PARTIAL_SERVICE_EXPLANATION_REQUIRED',
        performedServiceId: service.performedServiceId,
      });
    }
  }

  return { isComplete: missing.length === 0, missing };
}

export function validateDocumentationEntry(input: {
  type: DocumentationEntryType;
  content: string;
  occurredAt?: Date | null;
  severity?: IncidentSeverity | null;
}): void {
  if (!DOCUMENTATION_ENTRY_TYPES.includes(input.type)) throw new InvalidDocumentationEntryError();
  if (input.content.trim().length === 0 || input.content.trim().length > 4000) {
    throw new InvalidDocumentationEntryError();
  }
  if (input.type === 'incident') {
    if (!input.severity || !input.occurredAt || Number.isNaN(input.occurredAt.getTime())) {
      throw new InvalidDocumentationEntryError();
    }
  } else if (input.severity != null) {
    throw new InvalidDocumentationEntryError();
  }
  if (input.occurredAt != null && Number.isNaN(input.occurredAt.getTime())) {
    throw new InvalidDocumentationEntryError();
  }
}

export function validateServiceEvidence(input: {
  status: EvidenceStatus;
  serviceStatus: DocumentationServiceForCompleteness['status'];
  note?: string | null;
}): void {
  if (input.status === 'not_required') {
    if (input.serviceStatus !== 'not_performed' || !input.note?.trim()) {
      throw new InvalidServiceEvidenceError();
    }
  }
  if (input.note != null && input.note.trim().length > 1000) {
    throw new InvalidServiceEvidenceError();
  }
}

export function normalizeDocumentationText(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4000) {
    throw new InvalidDocumentationEntryError();
  }
  return normalized;
}

export class InvalidDocumentationEntryError extends Error {
  readonly code = 'DOCUMENTATION_ENTRY_INVALID';

  constructor() {
    super('The documentation entry is invalid');
    this.name = 'InvalidDocumentationEntryError';
  }
}

export class InvalidServiceEvidenceError extends Error {
  readonly code = 'SERVICE_EVIDENCE_INVALID';

  constructor() {
    super('The service evidence is invalid');
    this.name = 'InvalidServiceEvidenceError';
  }
}
