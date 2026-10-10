import { v7 as uuidv7 } from 'uuid';

export interface EventPayloadMap {
  'operations.task_created': { taskId: string; organizationId: string; clientId: string | null };
  'operations.task_updated': { taskId: string; changedFields: string[] };
  'operations.task_assigned': { taskId: string; employeeId: string | null };
  'operations.task_completed': { taskId: string };
  'operations.task_reopened': { taskId: string };
  'operations.task_cancelled': { taskId: string };
  'operations.exception_acknowledged': { issueKey: string };
  'operations.exception_snoozed': { issueKey: string; snoozedUntil: string };
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
  'communication.recorded': { interactionId: string; clientId: string };
  'communication.prospect_recorded': { interactionId: string; caseId: string };
  'communication.amended': { interactionId: string; clientId: string; version: number };
  'communication.preferences_updated': { clientId: string; version: number };
  'service.category_created': { categoryId: string };
  'service.category_updated': { categoryId: string; changedFields: string[] };
  'service.category_archived': { categoryId: string };
  'service.created': { serviceId: string };
  'service.updated': { serviceId: string; changedFields: string[] };
  'service.archived': { serviceId: string };
  'service.availability_changed': { serviceId: string; changedOrganizationIds: string[] };
  'service.price_recorded': {
    serviceId: string;
    priceId: string;
    organizationId: string;
    facilityId: string | null;
    priceCents: number;
    pricingUnit: 'hour' | 'minute' | 'visit' | 'fixed';
    validFrom: string;
  };
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
  'scheduling.availability_changed': {
    employeeId: string;
    previousVersion: number;
    version: number;
    operation: 'weekly_hours_updated' | 'exception_added' | 'exception_removed';
  };
  'scheduling.absence_recorded': {
    employeeId: string;
    absenceId: string;
    reason: 'vacation' | 'sick_leave' | 'training' | 'personal_unavailability' | 'other';
  };
  'scheduling.absence_cancelled': { employeeId: string; absenceId: string };
  'scheduling.visit_substituted': {
    visitId: string;
    originalEmployeeId: string;
    substituteEmployeeId: string;
  };
  'scheduling.substitution_changed': {
    visitId: string;
    substitutionId: string;
    originalEmployeeId: string;
    substituteEmployeeId: string;
    status: 'proposed' | 'confirmed' | 'cancelled';
  };
  'scheduling.tour_created': {
    tourId: string;
    employeeId: string;
    localDate: string;
    visitIds: string[];
    version: number;
  };
  'scheduling.tour_reordered': {
    tourId: string;
    employeeId: string;
    localDate: string;
    visitIds: string[];
    version: number;
  };
  'scheduling.tour_published': {
    tourId: string;
    employeeId: string;
    localDate: string;
    version: number;
    visitIds: string[];
  };
  'scheduling.preferences_changed': {
    subjectType: 'client' | 'employee';
    subjectId: string;
  };
  'scheduling.routing_location_updated': { clientId: string };
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
  'benefit.entitlement_created': {
    entitlementId: string;
    clientId: string;
    benefitType: string;
    version: number;
  };
  'benefit.entitlement_updated': {
    entitlementId: string;
    clientId: string;
    benefitType: string;
    version: number;
  };
  'benefit.entitlement_period_allocated': {
    entitlementId: string;
    clientId: string;
    benefitType: string;
    period: string;
    amountCents: number;
    ruleVersion: number;
  };
  'benefit.funding_source_created': {
    fundingSourceId: string;
    clientId: string;
    sourceType: string;
  };
  'benefit.opening_balance_recorded': {
    ledgerEntryId: string;
    clientId: string;
    fundingSourceId: string;
    amountCents: number;
    verificationStatus: string;
  };
  'benefit.adjustment_recorded': {
    ledgerEntryId: string;
    clientId: string;
    amountCents: number;
    entryType: string;
  };
  'benefit.service_allocated': {
    allocationId: string;
    performedServiceId: string;
    clientId: string;
    amountCents: number;
    status: string;
  };
  'benefit.allocation_reversed': {
    allocationId: string;
    reversalId: string;
    performedServiceId: string;
    clientId: string;
  };
  'benefit.provider_recognition_created': {
    recognitionId: string;
    organizationId: string;
    jurisdiction: string;
  };
  'invoice.created': { invoiceId: string; clientId: string; organizationId: string };
  'invoice.updated': { invoiceId: string; version: number; changedFields: string[] };
  'invoice.issued': {
    invoiceId: string;
    invoiceNumber: string;
    clientId: string;
    grandTotalCents: number;
    currency: 'EUR';
  };
  'invoice.cancelled': { invoiceId: string; clientId: string; reason: string };
  'invoice.corrected': {
    invoiceId: string;
    correctionId: string;
    correctionNumber: string;
    amountCents: number;
  };
  'payment.recorded': { paymentId: string; organizationId: string; amountCents: number };
  'payment.allocated': {
    allocationId: string;
    paymentId: string;
    invoiceId: string;
    amountCents: number;
  };
  'payment.allocation_reversed': {
    allocationId: string;
    paymentId: string;
    invoiceId: string;
    amountCents: number;
  };
  'billing.profile.updated': { profileId: string; organizationId: string; version: number };
  'billing.payer_arrangement.created': {
    arrangementId: string;
    clientId: string;
    organizationId: string;
    arrangementType: string;
  };
  'billing.payer_arrangement.updated': {
    arrangementId: string;
    clientId: string;
    version: number;
    mandateStatus: string;
  };
  'claim.payer_created': {
    payerId: string;
    organizationId: string;
    payerType: string;
  };
  'claim.payer_updated': {
    payerId: string;
    organizationId: string;
    version: number;
  };
  'claim.payer_profile_versioned': {
    payerId: string;
    profileId: string;
    version: number;
    channel: string;
    fundingSourceType: string;
  };
  'claim.created': {
    claimId: string;
    invoiceId: string;
    payerId: string;
    organizationId: string;
  };
  'claim.prepared': {
    claimId: string;
    packageVersion: number;
    documentCount: number;
    packageHash: string;
  };
  'claim.submitted': {
    claimId: string;
    submissionId: string;
    channel: string;
    amountCents: number;
    packageVersion: number;
  };
  'claim.decision_recorded': {
    claimId: string;
    decisionId: string;
    decision: string;
    acceptedCents: number;
    rejectedCents: number;
  };
  'claim.resubmitted': {
    previousClaimId: string;
    claimId: string;
    submissionId: string;
  };
  'claim.cancelled': { claimId: string };
  'claim.payment_linked': {
    claimId: string;
    paymentAllocationId: string;
    amountCents: number;
  };
  'document.generated': {
    artifactId: string;
    clientId: string | null;
    documentType: string;
    sourceEntityType: string;
    sourceEntityId: string;
    templateVersion: number;
    locale: 'de' | 'en';
    sha256: string;
  };
  'document.template_updated': {
    organizationId: string;
    documentType: string;
    version: number;
  };
  'document.artifact_superseded': {
    artifactId: string;
    sourceEntityType: string;
    sourceEntityId: string;
    documentType: string;
  };
  'billing.export_generated': { organizationId: string; exportType: string; rowCount: number };
  'benefits.export_generated': { clientId: string | null; exportType: string; rowCount: number };
  'onboarding.case_created': { caseId: string; version: number };
  'onboarding.case_updated': { caseId: string; changedFields: string[]; version: number };
  'onboarding.assessment_updated': { caseId: string; version: number };
  'onboarding.checklist_updated': { caseId: string; itemCode: string; version: number };
  'onboarding.template_updated': { templateId: string; version: number };
  'onboarding.stage_changed': {
    caseId: string;
    fromStage: string;
    toStage: string;
    version: number;
  };
  'onboarding.admitted': { caseId: string; clientId: string; version: number };
  'onboarding.declined': { caseId: string; version: number };
  'onboarding.withdrawn': { caseId: string; version: number };
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
    | 'benefit'
    | 'service_evidence'
    | 'invoice'
    | 'payment'
    | 'billing_profile'
    | 'payer_arrangement'
    | 'claim'
    | 'payer'
    | 'payer_profile'
    | 'document'
    | 'schedule_generation'
    | 'employee_availability'
    | 'visit_substitution'
    | 'tour'
    | 'tenant_membership'
    | 'tenant_invitation'
    | 'operations'
    | 'onboarding';
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
