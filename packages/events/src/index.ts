import { v7 as uuidv7 } from 'uuid';

export interface EventPayloadMap {
  'organization.created': { organizationId: string };
  'organization.updated': { organizationId: string; changedFields: string[] };
  'organization.activated': { organizationId: string };
  'organization.archived': { organizationId: string };
  'facility.created': { facilityId: string; organizationId: string };
  'facility.updated': { facilityId: string; changedFields: string[] };
  'facility.activated': { facilityId: string };
  'facility.archived': { facilityId: string };
  'team.created': { teamId: string; organizationId: string };
  'team.updated': { teamId: string; changedFields: string[] };
  'team.activated': { teamId: string };
  'team.archived': { teamId: string };
  'employee.created': { employeeId: string; organizationId: string };
  'employee.updated': { employeeId: string; changedFields: string[] };
  'employee.status_changed': {
    employeeId: string;
    previousStatus: 'active' | 'inactive';
    status: 'active' | 'inactive' | 'archived';
  };
  'employee.user_linked': { employeeId: string; userId: string };
  'employee.user_unlinked': { employeeId: string };
  'employee.facility_assignment_changed': {
    employeeId: string;
    facilityId: string;
    operation: 'assigned' | 'unassigned' | 'primary_changed';
  };
  'employee.team_membership_changed': {
    employeeId: string;
    teamId: string;
    operation: 'assigned' | 'unassigned';
  };
  'employee.qualification_changed': {
    employeeId: string;
    qualificationId: string;
    operation: 'added' | 'updated' | 'removed';
  };
  'employee.skill_changed': { employeeId: string; skillId: string; operation: 'added' | 'removed' };
  'qualification.created': { qualificationId: string };
  'qualification.updated': { qualificationId: string; changedFields: string[] };
  'qualification.archived': { qualificationId: string };
  'workforce_compliance.settings_updated': {
    settingsVersion: number;
    changedFields: string[];
  };
  'medication_order.created': { orderId: string; clientId: string; version: number };
  'medication_order.activated': { orderId: string; clientId: string; version: number };
  'medication_order.changed': { orderId: string; clientId: string; version: number };
  'medication_order.paused': { orderId: string; clientId: string; version: number };
  'medication_order.resumed': { orderId: string; clientId: string; version: number };
  'medication_order.discontinued': { orderId: string; clientId: string; version: number };
  'medication_administration.recorded': { recordId: string; clientId: string; orderId: string };
  'medication_administration.corrected': {
    recordId: string;
    correctionId: string;
    clientId: string;
    orderId: string;
    version: number;
  };
  'medication_reconciliation.created': {
    reconciliationId: string;
    clientId: string;
    version: number;
  };
  'medication_reconciliation.source_added': {
    reconciliationId: string;
    clientId: string;
    sourceId: string;
    version: number;
  };
  'medication_reconciliation.entry_added': {
    reconciliationId: string;
    clientId: string;
    entryId: string;
    sourceId: string;
    version: number;
  };
  'medication_reconciliation.reviewed': {
    reconciliationId: string;
    clientId: string;
    version: number;
    comparisonVersion?: number;
    discrepancyId?: string;
  };
  'medication_reconciliation.change_applied': {
    reconciliationId: string;
    clientId: string;
    actionId: string;
    version: number;
    applicationCount: number;
  };
  'medication_reconciliation.completed': {
    reconciliationId: string;
    clientId: string;
    version: number;
    reviewerEmployeeId: string;
  };
  'medication_reconciliation.cancelled': {
    reconciliationId: string;
    clientId: string;
    version: number;
  };
  'skill.created': { skillId: string };
  'skill.updated': { skillId: string; changedFields: string[] };
  'skill.archived': { skillId: string };
  'client.created': { clientId: string };
  'client.updated': { clientId: string; changedFields: string[] };
  'client.activated': { clientId: string };
  'client.archived': { clientId: string };
  'client.provider_context_changed': {
    clientId: string;
    previousOrganizationId: string | null;
    previousFacilityId: string | null;
    organizationId: string;
    primaryFacilityId: string;
  };
  'client.address_changed': {
    clientId: string;
    addressId: string;
    operation: 'added' | 'updated' | 'removed';
  };
  'client.contact_changed': {
    clientId: string;
    contactId: string;
    operation: 'added' | 'updated' | 'removed';
  };
  'client.insurance_changed': {
    clientId: string;
    insuranceId: string;
    operation: 'added' | 'updated';
  };
  'client.pflegegrad_changed': {
    clientId: string;
    recordId: string;
    operation: 'added' | 'updated';
  };
  'service.category_created': { categoryId: string };
  'service.category_updated': { categoryId: string; changedFields: string[] };
  'service.category_archived': { categoryId: string };
  'service.created': { serviceId: string };
  'service.updated': { serviceId: string; changedFields: string[] };
  'service.archived': { serviceId: string };
  'service.availability_changed': { serviceId: string; changedOrganizationIds: string[] };
  'service_agreement.created': {
    agreementId: string;
    clientId: string;
    organizationId: string;
    facilityId: string;
  };
  'service_agreement.updated': { agreementId: string; clientId: string; changedFields: string[] };
  'service_agreement.activated': { agreementId: string; clientId: string };
  'service_agreement.suspended': { agreementId: string; clientId: string };
  'service_agreement.resumed': { agreementId: string; clientId: string };
  'service_agreement.ended': { agreementId: string; clientId: string };
  'service_agreement.service_added': {
    agreementId: string;
    clientId: string;
    agreementServiceId: string;
    serviceDefinitionId: string;
  };
  'service_agreement.service_changed': {
    agreementId: string;
    clientId: string;
    agreementServiceId: string;
    serviceDefinitionId: string;
    changedFields: string[];
  };
  'service_agreement.service_ended': {
    agreementId: string;
    clientId: string;
    agreementServiceId: string;
    serviceDefinitionId: string;
  };
  'visit.created': { visitId: string; clientId: string };
  'visit.generated': { visitId: string; agreementId: string; clientId: string };
  'visit.updated': { visitId: string; clientId: string; changedFields: string[] };
  'visit.rescheduled': { visitId: string; clientId: string };
  'visit.confirmed': { visitId: string; clientId: string };
  'visit.unconfirmed': { visitId: string; clientId: string };
  'visit.cancelled': { visitId: string; clientId: string };
  'visit.assignment_changed': {
    visitId: string;
    clientId: string;
    employeeId: string;
    operation: 'assigned' | 'unassigned';
  };
  'visit_execution.started': {
    executionId: string;
    visitId: string;
    clientId: string;
    actualStart: string;
    version: number;
  };
  'visit_execution.completed': {
    executionId: string;
    visitId: string;
    clientId: string;
    actualStart: string;
    actualEnd: string;
    performedCount: number;
    notPerformedCount: number;
    version: number;
  };
  'visit_execution.corrected': {
    executionId: string;
    visitId: string;
    clientId: string;
    changedFields: string[];
    version: number;
  };
  'care_documentation.created': {
    documentationId: string;
    visitId: string;
    executionId: string;
    clientId: string;
    version: number;
  };
  'care_documentation.entry_added': {
    documentationId: string;
    visitId: string;
    clientId: string;
    entryId: string;
    entryType: string;
    version: number;
  };
  'care_documentation.entry_updated': {
    documentationId: string;
    visitId: string;
    clientId: string;
    entryId: string;
    changedFields: string[];
    version: number;
  };
  'care_documentation.entry_removed': {
    documentationId: string;
    visitId: string;
    clientId: string;
    entryId: string;
    entryType: string;
    version: number;
  };
  'care_documentation.finalized': {
    documentationId: string;
    visitId: string;
    executionId: string;
    clientId: string;
    version: number;
  };
  'care_documentation.amended': {
    documentationId: string;
    visitId: string;
    clientId: string;
    amendmentId: string;
  };
  'care_plan.created': { planId: string; clientId: string; revisionId: string };
  'care_plan.revision_created': {
    planId: string;
    clientId: string;
    revisionId: string;
    revisionNumber: number;
  };
  'care_plan.revision_activated': {
    planId: string;
    clientId: string;
    revisionId: string;
    revisionNumber: number;
    professionalAuthorization: {
      operationKey: string;
      policyId: string;
      policyVersion: number;
      employeeId: string;
      matchedQualificationIds: string[];
      evaluatedAt: string;
    };
  };
  'care_plan.evaluated': {
    planId: string;
    clientId: string;
    evaluationId: string;
    revisionId: string;
    result:
      | 'effective'
      | 'partially_effective'
      | 'not_effective'
      | 'changed_condition'
      | 'no_change';
    professionalAuthorization: {
      operationKey: string;
      policyId: string;
      policyVersion: number;
      employeeId: string;
      matchedQualificationIds: string[];
      evaluatedAt: string;
    };
  };
  'competency_policy.created': { policyId: string; operationKey: string; version: number };
  'competency_policy.updated': { policyId: string; operationKey: string; version: number };
  'competency_policy.activated': { policyId: string; operationKey: string; version: number };
  'competency_policy.deactivated': { policyId: string; operationKey: string; version: number };
  'care_plan.ended': { planId: string; clientId: string };
  'clinical.measurement_recorded': {
    documentationId: string;
    recordId: string;
    measurementType: string;
    version: number;
  };
  'clinical.measurement_updated': {
    documentationId: string;
    recordId: string;
    measurementType: string;
    changedFields: string[];
    version: number;
  };
  'clinical.observation_recorded': {
    documentationId: string;
    recordId: string;
    category: string;
    version: number;
  };
  'clinical.observation_updated': {
    documentationId: string;
    recordId: string;
    category: string;
    changedFields: string[];
    version: number;
  };
  'clinical.assessment_recorded': {
    documentationId: string;
    recordId: string;
    assessmentType: string;
    version: number;
  };
  'clinical.assessment_updated': {
    documentationId: string;
    recordId: string;
    assessmentType: string;
    changedFields: string[];
    version: number;
  };
  'clinical.risk_recorded': {
    documentationId: string;
    recordId: string;
    riskType: string;
    version: number;
  };
  'clinical.risk_updated': {
    documentationId: string;
    recordId: string;
    riskType: string;
    changedFields: string[];
    version: number;
  };
  'clinical.record_amended': {
    documentationId: string;
    recordId: string;
    replacementRecordId: string;
    recordType: string;
    version: number;
  };
  'clinical.record_deleted': {
    documentationId: string;
    recordId: string;
    recordType: string;
    version: number;
  };
  'evidence_package.created': {
    evidencePackageId: string;
    documentationId: string;
    visitId: string;
    clientId: string;
    version: number;
    snapshotHash: string;
  };
  'evidence_package.superseded': {
    evidencePackageId: string;
    supersedesEvidencePackageId: string;
    documentationId: string;
    visitId: string;
    clientId: string;
    version: number;
    snapshotHash: string;
  };
  'service_evidence.acknowledged': {
    acknowledgementId: string;
    evidencePackageId: string;
    documentationId: string;
    visitId: string;
    clientId: string;
    evidencePackageHash: string;
    status: 'acknowledged';
    signatoryType: string;
    signatoryCapacity: string;
    signatureSha256?: string;
  };
  'service_evidence.declined': {
    acknowledgementId: string;
    evidencePackageId: string;
    documentationId: string;
    visitId: string;
    clientId: string;
    evidencePackageHash: string;
    status: 'declined';
    signatoryType: string;
    signatoryCapacity: string;
  };
  'service_evidence.acknowledgement_revoked': {
    acknowledgementId: string;
    evidencePackageId: string;
    documentationId: string;
    visitId: string;
    clientId: string;
    evidencePackageHash: string;
  };
  'service_evidence.recorded': {
    documentationId: string;
    visitId: string;
    clientId: string;
    evidenceId: string;
    performedServiceId: string;
    version: number;
  };
  'service_evidence.updated': {
    documentationId: string;
    visitId: string;
    clientId: string;
    evidenceId: string;
    performedServiceId: string;
    version: number;
  };
  'incident.recorded': {
    documentationId: string;
    visitId: string;
    clientId: string;
    incidentId: string;
    severity: 'low' | 'moderate' | 'high' | 'critical';
    version: number;
  };
  'performed_service.recorded': {
    executionId: string;
    visitId: string;
    performedServiceId: string;
    status: 'performed' | 'partially_performed' | 'not_performed';
    version: number;
  };
  'performed_service.updated': {
    executionId: string;
    visitId: string;
    performedServiceId: string;
    status: 'performed' | 'partially_performed' | 'not_performed';
    version: number;
  };
  'performed_service.marked_not_performed': {
    executionId: string;
    visitId: string;
    performedServiceId: string;
    reasonCode: string;
    version: number;
  };
  'performed_service.unplanned_added': {
    executionId: string;
    visitId: string;
    performedServiceId: string;
    status: 'performed' | 'partially_performed' | 'not_performed';
    version: number;
  };
  'schedule.generation_completed': {
    generationId: string;
    agreementId: string;
    generatedCount: number;
    alreadyExistingCount: number;
    requiresManualPlacementCount: number;
  };
  'employee.unavailability_created': { employeeId: string; unavailabilityId: string };
  'tenant.invitation.created': { invitationId: string };
  'tenant.invitation.accepted': { invitationId: string; membershipId: string };
  'tenant.invitation.expired': { invitationId: string };
  'tenant.invitation.revoked': { invitationId: string };
  'tenant.member.invited': { membershipId: string; invitationId: string };
  'tenant.member.activated': { membershipId: string };
  'tenant.member.deactivated': { membershipId: string };
  'tenant.member.revoked': { membershipId: string };
  'tenant.member.role_changed': {
    membershipId: string;
    addedRoleIds: string[];
    removedRoleIds: string[];
  };
  'tenant.member.scope_changed': {
    membershipId: string;
    addedScopes: Array<{ scopeType: string; scopeId: string }>;
    removedScopes: Array<{ scopeType: string; scopeId: string }>;
  };
}

export type EventName = keyof EventPayloadMap;

export interface DomainEvent<T extends EventName = EventName> {
  id: string;
  type: T;
  version: 1;
  tenantId: string;
  aggregateType:
    | 'organization'
    | 'facility'
    | 'team'
    | 'employee'
    | 'qualification'
    | 'skill'
    | 'client'
    | 'service_category'
    | 'service'
    | 'service_agreement'
    | 'visit'
    | 'visit_execution'
    | 'care_documentation'
    | 'care_plan'
    | 'clinical_documentation'
    | 'competency_policy'
    | 'workforce_compliance'
    | 'medication_order'
    | 'medication_administration'
    | 'medication_reconciliation'
    | 'service_evidence'
    | 'schedule_generation'
    | 'employee_availability'
    | 'tenant_membership'
    | 'tenant_invitation';
  aggregateId: string;
  occurredAt: string;
  actor: { type: 'user' | 'system'; id?: string };
  correlationId: string;
  causationId?: string;
  payload: EventPayloadMap[T];
}

export function createDomainEvent<T extends EventName>(
  input: Omit<DomainEvent<T>, 'id' | 'version' | 'occurredAt'> & {
    id?: string;
    occurredAt?: string;
  },
): DomainEvent<T> {
  return {
    ...input,
    id: input.id ?? uuidv7(),
    version: 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export class EventDispatcher {
  private readonly handlers = new Map<EventName, EventHandler[]>();

  subscribe(type: EventName, handler: EventHandler): void {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    if (event.version !== 1) throw new UnsupportedEventVersionError(event.type, event.version);
    const handlers = this.handlers.get(event.type) ?? [];
    if (handlers.length === 0) throw new MissingEventHandlerError(event.type);
    // Preserve subscription order; handlers may rely on earlier side effects.
    // oxlint-disable-next-line no-await-in-loop
    for (const handler of handlers) await handler(event);
  }
}

export class MissingEventHandlerError extends Error {
  constructor(type: EventName) {
    super(`No handler registered for ${type}`);
    this.name = 'MissingEventHandlerError';
  }
}

export class UnsupportedEventVersionError extends Error {
  constructor(type: EventName, version: number) {
    super(`Unsupported ${type} version ${version}`);
    this.name = 'UnsupportedEventVersionError';
  }
}
