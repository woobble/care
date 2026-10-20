import type { Permission, ResourceContext } from '@care/permissions';
import type { tasks } from '@module/operations/schema';
import type {
  SourceType,
  OperationsSourceReference,
  OperationsTaskInput,
  OperationsTaskPatch,
} from './task.contracts';
export function validTaskInput(input: OperationsTaskInput): boolean {
  return (
    typeof input.title === 'string' &&
    input.title.trim().length > 0 &&
    input.title.trim().length <= 200 &&
    (input.description == null ||
      (typeof input.description === 'string' && input.description.length <= 8000)) &&
    (input.priority === undefined ||
      ['low', 'normal', 'high', 'urgent'].includes(input.priority)) &&
    (input.dueAt === undefined || input.dueAt === null || Number.isFinite(input.dueAt.getTime())) &&
    (input.source === undefined ||
      input.source === null ||
      (validSourceType(input.source.type) && isUuid(input.source.id)))
  );
}

export function validPatch(input: OperationsTaskPatch): boolean {
  return (
    (input.title === undefined ||
      (typeof input.title === 'string' &&
        input.title.trim().length > 0 &&
        input.title.trim().length <= 200)) &&
    (input.description === undefined ||
      input.description === null ||
      (typeof input.description === 'string' && input.description.length <= 8000)) &&
    (input.priority === undefined ||
      ['low', 'normal', 'high', 'urgent'].includes(input.priority)) &&
    (input.assignedEmployeeId === undefined ||
      input.assignedEmployeeId === null ||
      isUuid(input.assignedEmployeeId)) &&
    (input.dueAt === undefined || input.dueAt === null || Number.isFinite(input.dueAt.getTime()))
  );
}

export function validSourceType(value: string): value is SourceType {
  return [
    'client',
    'visit',
    'service_agreement',
    'service_evidence',
    'invoice',
    'claim',
    'benefit_entitlement',
    'document',
    'communication',
  ].includes(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function taskResource(
  task: Pick<typeof tasks.$inferSelect, 'tenantId' | 'organizationId' | 'facilityId' | 'clientId'>,
): ResourceContext {
  return {
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    ...(task.facilityId ? { facilityId: task.facilityId } : {}),
    ...(task.clientId ? { clientId: task.clientId } : {}),
  };
}

export function sourcePermission(type: SourceType): Permission {
  switch (type) {
    case 'client':
      return 'client.read';
    case 'visit':
      return 'schedule.read';
    case 'service_agreement':
      return 'service_agreement.read';
    case 'service_evidence':
      return 'service_evidence.read';
    case 'invoice':
      return 'billing.read';
    case 'claim':
      return 'claims.read';
    case 'benefit_entitlement':
      return 'benefits.read';
    case 'document':
      return 'documents.read';
    case 'communication':
      return 'communications.read';
  }
}

export function sourceColumnsFor(source: OperationsSourceReference | null) {
  return {
    sourceClientId: source?.type === 'client' ? source.id : null,
    sourceVisitId: source?.type === 'visit' ? source.id : null,
    sourceAgreementId: source?.type === 'service_agreement' ? source.id : null,
    sourceEvidencePackageId: source?.type === 'service_evidence' ? source.id : null,
    sourceInvoiceId: source?.type === 'invoice' ? source.id : null,
    sourceClaimId: source?.type === 'claim' ? source.id : null,
    sourceEntitlementId: source?.type === 'benefit_entitlement' ? source.id : null,
    sourceDocumentId: source?.type === 'document' ? source.id : null,
    sourceCommunicationId: source?.type === 'communication' ? source.id : null,
  };
}

export function sourceIdFromRow(task: typeof tasks.$inferSelect): string | null {
  switch (task.sourceType) {
    case 'client':
      return task.sourceClientId;
    case 'visit':
      return task.sourceVisitId;
    case 'service_agreement':
      return task.sourceAgreementId;
    case 'service_evidence':
      return task.sourceEvidencePackageId;
    case 'invoice':
      return task.sourceInvoiceId;
    case 'claim':
      return task.sourceClaimId;
    case 'benefit_entitlement':
      return task.sourceEntitlementId;
    case 'document':
      return task.sourceDocumentId;
    case 'communication':
      return task.sourceCommunicationId;
    default:
      return null;
  }
}
