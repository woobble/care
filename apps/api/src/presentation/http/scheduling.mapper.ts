import type { VisitCalendarRow } from '@care/scheduling';
import type { VisitAssignmentSnapshot } from '@care/scheduling';
import type { VisitSnapshot } from '@care/scheduling';

export function visitMutationResponse(visit: VisitSnapshot) {
  return {
    id: visit.id,
    clientId: visit.clientId,
    organizationId: visit.organizationId,
    facilityId: visit.facilityId,
    origin: visit.origin,
    serviceAgreementId: visit.serviceAgreementId,
    status: visit.status,
    plannedStart: visit.plannedStart.toISOString(),
    plannedEnd: visit.plannedEnd.toISOString(),
    timezone: visit.timezone,
    manuallyAdjusted: visit.manuallyAdjusted,
    note: visit.note,
    services: visit.services.map((service) => ({
      id: service.id,
      serviceDefinitionId: service.serviceDefinitionId,
      agreementServiceId: service.agreementServiceId,
      serviceCode: service.serviceCodeSnapshot,
      serviceName: service.serviceNameSnapshot,
      unit: service.unitSnapshot,
      plannedQuantity: service.plannedQuantity,
      plannedDurationMinutes: service.plannedDurationMinutes,
    })),
  };
}

export function visitResponse(visit: VisitCalendarRow) {
  return {
    id: visit.id,
    clientId: visit.clientId,
    clientDisplayName: visit.clientDisplayName,
    organizationId: visit.organizationId,
    organizationName: visit.organizationName,
    facilityId: visit.facilityId,
    facilityName: visit.facilityName,
    origin: visit.origin,
    serviceAgreementId: visit.serviceAgreementId,
    status: visit.status,
    plannedStart: visit.plannedStart.toISOString(),
    plannedEnd: visit.plannedEnd.toISOString(),
    timeWindowStart: visit.timeWindowStart?.toISOString() ?? null,
    timeWindowEnd: visit.timeWindowEnd?.toISOString() ?? null,
    timezone: visit.timezone,
    manuallyAdjusted: visit.manuallyAdjusted,
    note: visit.note,
    services: visit.services.map((service) => ({
      id: service.id,
      serviceDefinitionId: service.serviceDefinitionId,
      agreementServiceId: service.agreementServiceId,
      serviceCode: service.serviceCodeSnapshot,
      serviceName: service.serviceNameSnapshot,
      unit: service.unitSnapshot,
      plannedQuantity: service.plannedQuantity,
      plannedDurationMinutes: service.plannedDurationMinutes,
    })),
    assignments: visit.assignments.map(assignmentResponse),
  };
}

export function visitDetailResponse(input: {
  visit: VisitCalendarRow;
  assignmentHistory: Array<VisitAssignmentSnapshot & { employeeDisplayName: string }>;
  history: Array<{ id: string; action: string; timestamp: Date }>;
}) {
  return {
    ...visitResponse(input.visit),
    assignmentHistory: input.assignmentHistory.map(assignmentResponse),
    history: input.history.map(({ id, action, timestamp }) => ({
      id,
      action,
      timestamp: timestamp.toISOString(),
    })),
  };
}

export function visitAssignmentMutationResponse(assignment: VisitAssignmentSnapshot) {
  return {
    id: assignment.id,
    visitId: assignment.visitId,
    employeeId: assignment.employeeId,
    role: assignment.role,
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
  };
}

function assignmentResponse(assignment: VisitAssignmentSnapshot & { employeeDisplayName: string }) {
  return {
    id: assignment.id,
    employeeId: assignment.employeeId,
    employeeDisplayName: assignment.employeeDisplayName,
    role: assignment.role,
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
  };
}
