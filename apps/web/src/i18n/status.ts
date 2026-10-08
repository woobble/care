const statusKeys = {
  pending: 'Common.status.pending',
  active: 'Common.status.active',
  inactive: 'Common.status.inactive',
  revoked: 'Common.status.revoked',
  archived: 'Common.status.archived',
  accepted: 'Common.status.accepted',
  confirmed: 'Common.status.confirmed',
  expired: 'Common.status.expired',
} as const;

export function statusLabelKey(
  status: string,
): (typeof statusKeys)[keyof typeof statusKeys] | 'Common.status.unknown' {
  return status in statusKeys
    ? statusKeys[status as keyof typeof statusKeys]
    : 'Common.status.unknown';
}

const unitKeys = {
  occurrence: 'Common.units.occurrence',
  minute: 'Common.units.minute',
  hour: 'Common.units.hour',
  day: 'Common.units.day',
} as const;

export function unitLabelKey(
  unit: string,
): (typeof unitKeys)[keyof typeof unitKeys] | 'Common.units.unknown' {
  return unit in unitKeys ? unitKeys[unit as keyof typeof unitKeys] : 'Common.units.unknown';
}

const quantityUnitKeys = {
  occurrence: 'Common.units.occurrences',
  minute: 'Common.units.minutes',
  hour: 'Common.units.hours',
  day: 'Common.units.days',
} as const;

export function quantityUnitKey(
  unit: string,
): (typeof quantityUnitKeys)[keyof typeof quantityUnitKeys] | 'Common.units.unknownQuantity' {
  return unit in quantityUnitKeys
    ? quantityUnitKeys[unit as keyof typeof quantityUnitKeys]
    : 'Common.units.unknownQuantity';
}

const serviceAgreementStatusKeys = {
  draft: 'ServiceAgreements.status.draft',
  active: 'ServiceAgreements.status.active',
  suspended: 'ServiceAgreements.status.suspended',
  ended: 'ServiceAgreements.status.ended',
} as const;

export function serviceAgreementStatusKey(
  status: string,
):
  | (typeof serviceAgreementStatusKeys)[keyof typeof serviceAgreementStatusKeys]
  | 'Common.status.unknown' {
  return status in serviceAgreementStatusKeys
    ? serviceAgreementStatusKeys[status as keyof typeof serviceAgreementStatusKeys]
    : 'Common.status.unknown';
}

const visitStatusKeys = {
  planned: 'Common.status.planned',
  confirmed: 'Common.status.confirmed',
  cancelled: 'Common.status.cancelled',
  completed: 'Common.status.completed',
} as const;

export function visitStatusKey(
  status: string,
): (typeof visitStatusKeys)[keyof typeof visitStatusKeys] | 'Common.status.unknown' {
  return status in visitStatusKeys
    ? visitStatusKeys[status as keyof typeof visitStatusKeys]
    : 'Common.status.unknown';
}

const executionStatusKeys = {
  not_started: 'VisitExecution.executionStatus.notStarted',
  in_progress: 'VisitExecution.executionStatus.inProgress',
  completed: 'VisitExecution.executionStatus.completed',
} as const;

export function executionStatusKey(
  status: string,
):
  | (typeof executionStatusKeys)[keyof typeof executionStatusKeys]
  | 'VisitExecution.executionStatus.unknown' {
  return status in executionStatusKeys
    ? executionStatusKeys[status as keyof typeof executionStatusKeys]
    : 'VisitExecution.executionStatus.unknown';
}

const executionServiceStatusKeys = {
  not_recorded: 'VisitExecution.serviceStatus.notRecorded',
  performed: 'VisitExecution.serviceStatus.performed',
  partially_performed: 'VisitExecution.serviceStatus.partiallyPerformed',
  not_performed: 'VisitExecution.serviceStatus.notPerformed',
} as const;

export function executionServiceStatusKey(
  status: string,
):
  | (typeof executionServiceStatusKeys)[keyof typeof executionServiceStatusKeys]
  | 'VisitExecution.serviceStatus.unknown' {
  return status in executionServiceStatusKeys
    ? executionServiceStatusKeys[status as keyof typeof executionServiceStatusKeys]
    : 'VisitExecution.serviceStatus.unknown';
}

const executionReasonKeys = {
  client_declined: 'VisitExecution.reasons.clientDeclined',
  client_not_present: 'VisitExecution.reasons.clientNotPresent',
  service_not_required: 'VisitExecution.reasons.serviceNotRequired',
  time_constraint: 'VisitExecution.reasons.timeConstraint',
  provider_decision: 'VisitExecution.reasons.providerDecision',
  other: 'VisitExecution.reasons.other',
} as const;

export function executionReasonKey(
  status: string,
):
  | (typeof executionReasonKeys)[keyof typeof executionReasonKeys]
  | 'VisitExecution.reasons.unknown' {
  return status in executionReasonKeys
    ? executionReasonKeys[status as keyof typeof executionReasonKeys]
    : 'VisitExecution.reasons.unknown';
}

const documentationRequirementKeys = {
  DOCUMENTATION_REQUIRED: 'CareDocumentation.missingRequirements.documentation',
  VISIT_EXECUTION_REQUIRED: 'CareDocumentation.missingRequirements.execution',
  SERVICE_EVIDENCE_REQUIRED: 'CareDocumentation.missingRequirements.serviceEvidence',
  NOT_PERFORMED_REASON_REQUIRED: 'CareDocumentation.missingRequirements.reason',
  PARTIAL_SERVICE_EXPLANATION_REQUIRED: 'CareDocumentation.missingRequirements.explanation',
} as const;

export function documentationRequirementKey(
  code: string,
):
  | (typeof documentationRequirementKeys)[keyof typeof documentationRequirementKeys]
  | 'CareDocumentation.missingRequirements.unknown' {
  return code in documentationRequirementKeys
    ? documentationRequirementKeys[code as keyof typeof documentationRequirementKeys]
    : 'CareDocumentation.missingRequirements.unknown';
}

const documentationEntryTypeKeys = {
  care_note: 'CareDocumentation.visit.entryTypes.careNote',
  observation: 'CareDocumentation.visit.entryTypes.observation',
  deviation: 'CareDocumentation.visit.entryTypes.deviation',
  incident: 'CareDocumentation.visit.entryTypes.incident',
} as const;

export function documentationEntryTypeKey(
  type: string,
):
  | (typeof documentationEntryTypeKeys)[keyof typeof documentationEntryTypeKeys]
  | 'CareDocumentation.visit.entryTypes.unknown' {
  return type in documentationEntryTypeKeys
    ? documentationEntryTypeKeys[type as keyof typeof documentationEntryTypeKeys]
    : 'CareDocumentation.visit.entryTypes.unknown';
}

const documentationSeverityKeys = {
  low: 'CareDocumentation.visit.severityValues.low',
  moderate: 'CareDocumentation.visit.severityValues.moderate',
  high: 'CareDocumentation.visit.severityValues.high',
  critical: 'CareDocumentation.visit.severityValues.critical',
} as const;

export function documentationSeverityKey(
  severity: string,
):
  | (typeof documentationSeverityKeys)[keyof typeof documentationSeverityKeys]
  | 'CareDocumentation.visit.severityValues.unknown' {
  return severity in documentationSeverityKeys
    ? documentationSeverityKeys[severity as keyof typeof documentationSeverityKeys]
    : 'CareDocumentation.visit.severityValues.unknown';
}
