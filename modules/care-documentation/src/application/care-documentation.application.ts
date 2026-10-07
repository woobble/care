import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent, type DomainEvent } from '@care/events';
import {
  assertCan,
  can,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  evaluateDocumentationCompleteness,
  normalizeDocumentationText,
  validateDocumentationEntry,
  validateServiceEvidence,
  type DocumentationCompleteness,
  type DocumentationEntryType,
  type EvidenceStatus,
  type IncidentSeverity,
  type MissingDocumentationRequirement,
} from '../domain/care-documentation';
import {
  careDocuments,
  documentationAmendments,
  documentationEntries,
  documentationHistory,
  serviceEvidence,
} from '../schema';
import { CareDocumentationRepository } from '../infrastructure/care-documentation.repository';

type AuditContext = { ip?: string; userAgent?: string };

export interface AddDocumentationEntryInput {
  expectedVersion: number;
  type: DocumentationEntryType;
  content: string;
  occurredAt?: Date | null;
  severity?: IncidentSeverity | null;
}

export interface UpdateDocumentationEntryInput {
  expectedVersion: number;
  type?: DocumentationEntryType;
  content?: string;
  occurredAt?: Date | null;
  severity?: IncidentSeverity | null;
}

export interface RecordServiceEvidenceInput {
  expectedVersion: number;
  status: EvidenceStatus;
  note?: string | null;
}

export interface AddDocumentationAmendmentInput {
  reason: string;
  correction: string;
}

export interface DocumentationWorklistQuery {
  from: Date;
  until: Date;
  clientQuery?: string;
  facilityId?: string;
  employeeId?: string;
  status?: 'draft' | 'finalized' | 'missing';
  incomplete?: boolean;
  page: number;
  pageSize: number;
}

export interface CareDocumentationDetail {
  visit: {
    id: string;
    clientId: string;
    clientDisplayName: string;
    organizationId: string;
    facilityId: string;
    status: 'planned' | 'confirmed' | 'cancelled';
    plannedStart: string;
    plannedEnd: string;
    timezone: string;
  };
  execution: {
    id: string | null;
    status: 'not_started' | 'in_progress' | 'completed';
    actualStart: string | null;
    actualEnd: string | null;
  };
  documentation: {
    id: string;
    status: 'draft' | 'finalized';
    createdByEmployeeId: string;
    createdByEmployeeName: string | null;
    finalizedByEmployeeId: string | null;
    finalizedByEmployeeName: string | null;
    finalizedAt: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  services: Array<{
    performedServiceId: string;
    serviceName: string;
    serviceCode: string;
    status: 'performed' | 'partially_performed' | 'not_performed';
    reasonCode: string | null;
    actualQuantity: string | null;
    unit: 'occurrence' | 'minute' | 'hour' | 'day';
    evidence: {
      id: string;
      status: 'documented' | 'not_required';
      documentedByEmployeeId: string;
      documentedByEmployeeName: string | null;
      note: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
  }>;
  entries: Array<{
    id: string;
    type: DocumentationEntryType;
    authorEmployeeId: string;
    authorEmployeeName: string | null;
    occurredAt: string | null;
    severity: IncidentSeverity | null;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>;
  amendments: Array<{
    id: string;
    authorUserId: string;
    reason: string;
    correction: string;
    createdAt: string;
  }>;
  history: Array<{
    id: string;
    actorUserId: string;
    actorEmployeeId: string | null;
    action: string;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }>;
  completeness: DocumentationCompleteness;
}

export interface DocumentationWorklistItem {
  visitId: string;
  clientId: string;
  clientDisplayName: string;
  facilityId: string;
  organizationId: string;
  plannedStart: string;
  timezone: string;
  executionStatus: 'in_progress' | 'completed';
  documentationId: string | null;
  documentationStatus: 'missing' | 'draft' | 'finalized';
  documentationVersion: number | null;
  employeeId: string;
  employeeName: string | null;
  missing: MissingDocumentationRequirement[];
}

export interface DocumentationWorklist {
  items: DocumentationWorklistItem[];
  page: number;
  pageSize: number;
  total: number;
}

export class CareDocumentationApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository = new CareDocumentationRepository(),
  ) {}

  async getForVisit(
    principal: AuthorizationPrincipal,
    visitId: string,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisitContext(transaction, principal.tenantId, visitId);
      await this.authorizeVisit(principal, transaction, context, 'care_documentation.read');
      const document = await this.repository.documentForVisit(
        transaction,
        principal.tenantId,
        visitId,
      );
      return this.detail(transaction, principal.tenantId, context, document);
    });
  }

  async getById(
    principal: AuthorizationPrincipal,
    documentId: string,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const document = await this.repository.documentById(
        transaction,
        principal.tenantId,
        documentId,
      );
      if (!document) throw new CareDocumentationNotFoundError();
      const context = await this.requireVisitContext(
        transaction,
        principal.tenantId,
        document.visitId,
      );
      await this.authorizeVisit(principal, transaction, context, 'care_documentation.read');
      return this.detail(transaction, principal.tenantId, context, document);
    });
  }

  async createForVisit(
    principal: AuthorizationPrincipal,
    visitId: string,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisitContext(transaction, principal.tenantId, visitId);
      await this.authorizeVisit(principal, transaction, context, 'care_documentation.create');
      if (!context.execution) throw new VisitExecutionRequiredError();
      const employee = await this.requireEmployee(transaction, principal);
      const existing = await this.repository.documentForVisit(
        transaction,
        principal.tenantId,
        visitId,
      );
      if (existing) return this.detail(transaction, principal.tenantId, context, existing);

      const now = new Date();
      const candidate = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        visitId,
        executionId: context.execution.id,
        status: 'draft' as const,
        createdByEmployeeId: employee.id,
        finalizedByEmployeeId: null,
        finalizedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const [created] = await transaction
        .insert(careDocuments)
        .values(candidate)
        .onConflictDoNothing({ target: [careDocuments.tenantId, careDocuments.executionId] })
        .returning();
      const document =
        created ??
        (await this.repository.documentForVisit(transaction, principal.tenantId, visitId));
      if (!document) throw new CareDocumentationInvalidStateError();
      if (!created) return this.detail(transaction, principal.tenantId, context, document);

      const event = this.event({
        type: 'care_documentation.created',
        principal,
        request,
        document,
        context,
        payload: {
          documentationId: document.id,
          visitId,
          executionId: document.executionId,
          clientId: context.visit.clientId,
          version: document.version,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'care_documentation.created',
        document,
        context,
        employeeId: employee.id,
        metadata: { documentationId: document.id, visitId, executionId: document.executionId },
      });
      return this.detail(transaction, principal.tenantId, context, document);
    });
  }

  async addEntry(
    principal: AuthorizationPrincipal,
    documentId: string,
    input: AddDocumentationEntryInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { document, context, employee } = await this.mutableDocument(
        transaction,
        principal,
        documentId,
        'care_documentation.update',
        input.expectedVersion,
      );
      validateDocumentationEntry(input);
      const now = new Date();
      const entry = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        documentationId: document.id,
        type: input.type,
        authorEmployeeId: employee.id,
        occurredAt: input.occurredAt ?? null,
        severity: input.type === 'incident' ? (input.severity ?? null) : null,
        content: normalizeDocumentationText(input.content),
        createdAt: now,
        updatedAt: now,
      };
      await transaction.insert(documentationEntries).values(entry);
      const next = await this.bumpVersion(transaction, document, now);
      const eventType =
        input.type === 'incident' ? 'incident.recorded' : 'care_documentation.entry_added';
      const payload =
        input.type === 'incident'
          ? {
              documentationId: document.id,
              visitId: context.visit.id,
              clientId: context.visit.clientId,
              incidentId: entry.id,
              severity: entry.severity!,
              version: next.version,
            }
          : {
              documentationId: document.id,
              visitId: context.visit.id,
              clientId: context.visit.clientId,
              entryId: entry.id,
              entryType: entry.type,
              version: next.version,
            };
      const event = this.event({ type: eventType, principal, request, document, context, payload });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: input.type === 'incident' ? 'incident.recorded' : 'care_documentation.entry_added',
        document: next,
        context,
        employeeId: employee.id,
        metadata: {
          documentationId: document.id,
          visitId: context.visit.id,
          entryId: entry.id,
          type: entry.type,
        },
      });
      return this.detail(transaction, principal.tenantId, context, next);
    });
  }

  async updateEntry(
    principal: AuthorizationPrincipal,
    documentId: string,
    entryId: string,
    input: UpdateDocumentationEntryInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { document, context, employee } = await this.mutableDocument(
        transaction,
        principal,
        documentId,
        'care_documentation.update',
        input.expectedVersion,
      );
      const entry = await this.repository.entry(
        transaction,
        principal.tenantId,
        documentId,
        entryId,
        true,
      );
      if (!entry) throw new DocumentationEntryNotFoundError();
      const type = input.type ?? entry.type;
      const content = input.content ?? entry.content;
      const occurredAt = input.occurredAt === undefined ? entry.occurredAt : input.occurredAt;
      const severity = input.severity === undefined ? entry.severity : input.severity;
      validateDocumentationEntry({ type, content, occurredAt, severity });
      const now = new Date();
      const changedFields: string[] = [];
      if (type !== entry.type) changedFields.push('type');
      if (content !== entry.content) changedFields.push('content');
      if (occurredAt?.getTime() !== entry.occurredAt?.getTime()) changedFields.push('occurredAt');
      if (severity !== entry.severity) changedFields.push('severity');
      if (changedFields.length === 0)
        return this.detail(transaction, principal.tenantId, context, document);
      await transaction
        .update(documentationEntries)
        .set({
          type,
          content: normalizeDocumentationText(content),
          occurredAt,
          severity,
          updatedAt: now,
        })
        .where(
          and(
            eq(documentationEntries.tenantId, principal.tenantId),
            eq(documentationEntries.id, entry.id),
          ),
        );
      const next = await this.bumpVersion(transaction, document, now);
      const event = this.event({
        type: 'care_documentation.entry_updated',
        principal,
        request,
        document: next,
        context,
        payload: {
          documentationId: document.id,
          visitId: context.visit.id,
          clientId: context.visit.clientId,
          entryId: entry.id,
          changedFields,
          version: next.version,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'care_documentation.entry_updated',
        document: next,
        context,
        employeeId: employee.id,
        metadata: {
          documentationId: document.id,
          visitId: context.visit.id,
          entryId: entry.id,
          changedFields,
        },
      });
      return this.detail(transaction, principal.tenantId, context, next);
    });
  }

  async removeEntry(
    principal: AuthorizationPrincipal,
    documentId: string,
    entryId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { document, context, employee } = await this.mutableDocument(
        transaction,
        principal,
        documentId,
        'care_documentation.update',
        expectedVersion,
      );
      const entry = await this.repository.entry(
        transaction,
        principal.tenantId,
        documentId,
        entryId,
        true,
      );
      if (!entry) throw new DocumentationEntryNotFoundError();
      const now = new Date();
      await transaction
        .delete(documentationEntries)
        .where(
          and(
            eq(documentationEntries.tenantId, principal.tenantId),
            eq(documentationEntries.id, entry.id),
          ),
        );
      const next = await this.bumpVersion(transaction, document, now);
      const event = this.event({
        type: 'care_documentation.entry_removed',
        principal,
        request,
        document: next,
        context,
        payload: {
          documentationId: document.id,
          visitId: context.visit.id,
          clientId: context.visit.clientId,
          entryId: entry.id,
          entryType: entry.type,
          version: next.version,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'care_documentation.entry_removed',
        document: next,
        context,
        employeeId: employee.id,
        metadata: {
          documentationId: document.id,
          visitId: context.visit.id,
          entryId: entry.id,
          type: entry.type,
        },
      });
      return this.detail(transaction, principal.tenantId, context, next);
    });
  }

  async recordEvidence(
    principal: AuthorizationPrincipal,
    documentId: string,
    performedServiceId: string,
    input: RecordServiceEvidenceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { document, context, employee } = await this.mutableDocument(
        transaction,
        principal,
        documentId,
        'care_documentation.update',
        input.expectedVersion,
      );
      const service = await this.repository.performedService(
        transaction,
        principal.tenantId,
        document.executionId,
        performedServiceId,
      );
      if (!service) throw new ServiceEvidenceNotFoundError();
      validateServiceEvidence({
        status: input.status,
        serviceStatus: service.status,
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
      const existing = await this.repository.evidenceForService(
        transaction,
        principal.tenantId,
        document.id,
        performedServiceId,
        true,
      );
      const note = input.note?.trim() || null;
      if (existing && existing.status === input.status && existing.note === note) {
        return this.detail(transaction, principal.tenantId, context, document);
      }
      const now = new Date();
      const evidenceId = existing?.id ?? uuidv7();
      if (existing) {
        await transaction
          .update(serviceEvidence)
          .set({ status: input.status, note, documentedByEmployeeId: employee.id, updatedAt: now })
          .where(
            and(
              eq(serviceEvidence.tenantId, principal.tenantId),
              eq(serviceEvidence.id, existing.id),
            ),
          );
      } else {
        await transaction.insert(serviceEvidence).values({
          id: evidenceId,
          tenantId: principal.tenantId,
          documentationId: document.id,
          executionId: document.executionId,
          performedServiceId,
          status: input.status,
          documentedByEmployeeId: employee.id,
          note,
          createdAt: now,
          updatedAt: now,
        });
      }
      const next = await this.bumpVersion(transaction, document, now);
      const eventType = existing ? 'service_evidence.updated' : 'service_evidence.recorded';
      const event = this.event({
        type: eventType,
        principal,
        request,
        document: next,
        context,
        payload: {
          documentationId: document.id,
          visitId: context.visit.id,
          clientId: context.visit.clientId,
          evidenceId,
          performedServiceId,
          version: next.version,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: eventType,
        document: next,
        context,
        employeeId: employee.id,
        metadata: {
          documentationId: document.id,
          visitId: context.visit.id,
          evidenceId,
          performedServiceId,
        },
      });
      return this.detail(transaction, principal.tenantId, context, next);
    });
  }

  async finalize(
    principal: AuthorizationPrincipal,
    documentId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const document = await this.repository.documentById(
        transaction,
        principal.tenantId,
        documentId,
        true,
      );
      if (!document) throw new CareDocumentationNotFoundError();
      const context = await this.requireVisitContext(
        transaction,
        principal.tenantId,
        document.visitId,
      );
      await this.authorizeVisit(principal, transaction, context, 'care_documentation.finalize');
      if (!context.execution) throw new VisitExecutionRequiredError();
      if (document.status === 'finalized')
        return this.detail(transaction, principal.tenantId, context, document);
      if (expectedVersion !== document.version) throw new CareDocumentationVersionConflictError();
      if (context.execution.status !== 'completed') throw new VisitExecutionNotCompletedError();
      const employee = await this.requireEmployee(transaction, principal);
      const detail = await this.detail(transaction, principal.tenantId, context, document);
      if (!detail.completeness.isComplete) {
        throw new CareDocumentationIncompleteError(detail.completeness.missing);
      }
      const now = new Date();
      const [finalized] = await transaction
        .update(careDocuments)
        .set({
          status: 'finalized',
          finalizedAt: now,
          finalizedByEmployeeId: employee.id,
          version: document.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(careDocuments.tenantId, principal.tenantId),
            eq(careDocuments.id, document.id),
            eq(careDocuments.version, document.version),
            eq(careDocuments.status, 'draft'),
          ),
        )
        .returning();
      if (!finalized) throw new CareDocumentationVersionConflictError();
      const event = this.event({
        type: 'care_documentation.finalized',
        principal,
        request,
        document: finalized,
        context,
        payload: {
          documentationId: document.id,
          visitId: context.visit.id,
          executionId: document.executionId,
          clientId: context.visit.clientId,
          version: finalized.version,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'care_documentation.finalized',
        document: finalized,
        context,
        employeeId: employee.id,
        metadata: {
          documentationId: document.id,
          visitId: context.visit.id,
          version: finalized.version,
        },
      });
      return this.detail(transaction, principal.tenantId, context, finalized);
    });
  }

  async amend(
    principal: AuthorizationPrincipal,
    documentId: string,
    input: AddDocumentationAmendmentInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CareDocumentationDetail> {
    const reason = input.reason.trim();
    const correction = input.correction.trim();
    if (
      reason.length < 1 ||
      reason.length > 500 ||
      correction.length < 1 ||
      correction.length > 4000
    ) {
      throw new AmendmentReasonRequiredError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const document = await this.repository.documentById(
        transaction,
        principal.tenantId,
        documentId,
        true,
      );
      if (!document) throw new CareDocumentationNotFoundError();
      const context = await this.requireVisitContext(
        transaction,
        principal.tenantId,
        document.visitId,
      );
      await this.authorizeVisit(principal, transaction, context, 'care_documentation.amend');
      if (document.status !== 'finalized') throw new CareDocumentationNotFinalizedError();
      const now = new Date();
      const amendment = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        documentationId: document.id,
        authorUserId: principal.userId,
        reason,
        correction,
        createdAt: now,
      };
      await transaction.insert(documentationAmendments).values(amendment);
      const event = this.event({
        type: 'care_documentation.amended',
        principal,
        request,
        document,
        context,
        payload: {
          documentationId: document.id,
          visitId: context.visit.id,
          clientId: context.visit.clientId,
          amendmentId: amendment.id,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'care_documentation.amended',
        document,
        context,
        employeeId: null,
        metadata: {
          documentationId: document.id,
          visitId: context.visit.id,
          amendmentId: amendment.id,
        },
      });
      return this.detail(transaction, principal.tenantId, context, document);
    });
  }

  async worklist(
    principal: AuthorizationPrincipal,
    query: DocumentationWorklistQuery,
    caregiverOnly = false,
  ): Promise<DocumentationWorklist> {
    validateWorklistQuery(query);
    const action: Permission = caregiverOnly
      ? 'care_documentation.read'
      : 'care_documentation.review';
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await this.repository.worklistRows(transaction, principal.tenantId, query);
      const allowedRows: typeof rows = [];
      const employee = caregiverOnly ? await this.requireEmployee(transaction, principal) : null;
      // Resource grants can differ by provider and team, so filter before returning any personal data.
      // oxlint-disable no-await-in-loop
      for (const row of rows) {
        const resource = await this.resourceForVisit(transaction, row.visit);
        if (!can(principal, { action, resource })) continue;
        if (caregiverOnly && employee) {
          const related = await this.repository.hasCaregiverRelationship(
            transaction,
            principal.tenantId,
            row.visit.id,
            employee.id,
          );
          if (!related) continue;
        }
        allowedRows.push(row);
      }
      // oxlint-enable no-await-in-loop

      const executionIds = allowedRows.map((row) => row.execution.id);
      const documentIds = allowedRows.flatMap((row) => (row.document ? [row.document.id] : []));
      const serviceRows = await this.repository.performedServicesForExecutions(
        transaction,
        principal.tenantId,
        executionIds,
      );
      const evidenceRows = await this.repository.evidenceForDocuments(
        transaction,
        principal.tenantId,
        documentIds,
      );
      const evidenceByService = new Map(
        evidenceRows.map((evidence) => [
          `${evidence.documentationId}:${evidence.performedServiceId}`,
          evidence,
        ]),
      );
      const servicesByExecution = groupBy(serviceRows, (service) => service.executionId);
      const employeeIds = allowedRows.flatMap((row) =>
        [
          row.document?.createdByEmployeeId,
          row.execution.completedByEmployeeId,
          row.execution.startedByEmployeeId,
        ].filter((id): id is string => id !== null && id !== undefined),
      );
      const employeeNames = await this.repository.employeeNames(transaction, principal.tenantId, [
        ...new Set(employeeIds),
      ]);
      const projected = allowedRows.map((row): DocumentationWorklistItem => {
        const services = servicesByExecution.get(row.execution.id) ?? [];
        const completeness = evaluateDocumentationCompleteness({
          hasExecution: true,
          hasDocumentation: row.document !== null,
          services: services.map((service) => {
            const evidence = row.document
              ? evidenceByService.get(`${row.document.id}:${service.id}`)
              : undefined;
            return {
              performedServiceId: service.id,
              status: service.status,
              reasonCode: service.reasonCode,
              evidence: evidence ? { status: evidence.status, note: evidence.note } : null,
            };
          }),
        });
        const documentationStatus = row.document?.status ?? 'missing';
        return {
          visitId: row.visit.id,
          clientId: row.visit.clientId,
          clientDisplayName: `${row.clientPreferredName || row.clientFirstName} ${row.clientLastName}`,
          facilityId: row.visit.facilityId,
          organizationId: row.visit.organizationId,
          plannedStart: row.visit.plannedStart.toISOString(),
          timezone: row.visit.timezone,
          executionStatus: row.execution.status,
          documentationId: row.document?.id ?? null,
          documentationStatus,
          documentationVersion: row.document?.version ?? null,
          employeeId: row.execution.completedByEmployeeId ?? row.execution.startedByEmployeeId,
          employeeName:
            employeeNames.get(row.document?.createdByEmployeeId ?? '') ??
            employeeNames.get(row.execution.completedByEmployeeId ?? '') ??
            employeeNames.get(row.execution.startedByEmployeeId) ??
            null,
          missing: completeness.missing,
        };
      });
      const filtered = query.incomplete
        ? projected.filter((item) => item.missing.length > 0)
        : projected;
      const offset = (query.page - 1) * query.pageSize;
      return {
        items: filtered.slice(offset, offset + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: filtered.length,
      };
    });
  }

  private async detail(
    transaction: DatabaseTransaction,
    tenantId: string,
    context: NonNullable<Awaited<ReturnType<CareDocumentationRepository['visitContext']>>>,
    document: typeof careDocuments.$inferSelect | null,
  ): Promise<CareDocumentationDetail> {
    const serviceRows = context.execution
      ? await this.repository.performedServices(transaction, tenantId, context.execution.id)
      : [];
    const entryRows = document
      ? await this.repository.entries(transaction, tenantId, document.id)
      : [];
    const evidenceRows = document
      ? await this.repository.evidence(transaction, tenantId, document.id)
      : [];
    const amendmentRows = document
      ? await this.repository.amendments(transaction, tenantId, document.id)
      : [];
    const historyRows = document
      ? await this.repository.history(transaction, tenantId, document.id)
      : [];
    const evidenceByService = new Map(
      evidenceRows.map((evidence) => [evidence.performedServiceId, evidence]),
    );
    const employeeIds = [
      document?.createdByEmployeeId,
      document?.finalizedByEmployeeId,
      ...entryRows.map((entry) => entry.authorEmployeeId),
      ...evidenceRows.map((evidence) => evidence.documentedByEmployeeId),
    ].filter((id): id is string => id !== null && id !== undefined);
    const employeeNames = await this.repository.employeeNames(transaction, tenantId, [
      ...new Set(employeeIds),
    ]);
    const serviceView = serviceRows.map((service) => {
      const evidence = evidenceByService.get(service.id);
      return {
        performedServiceId: service.id,
        serviceName: service.serviceNameSnapshot,
        serviceCode: service.serviceCodeSnapshot,
        status: service.status,
        reasonCode: service.reasonCode,
        actualQuantity: service.actualQuantity,
        unit: service.unitSnapshot,
        evidence: evidence
          ? {
              id: evidence.id,
              status: evidence.status,
              documentedByEmployeeId: evidence.documentedByEmployeeId,
              documentedByEmployeeName: employeeNames.get(evidence.documentedByEmployeeId) ?? null,
              note: evidence.note,
              createdAt: evidence.createdAt.toISOString(),
              updatedAt: evidence.updatedAt.toISOString(),
            }
          : null,
      };
    });
    const completeness = evaluateDocumentationCompleteness({
      hasExecution: context.execution !== null,
      hasDocumentation: document !== null,
      services: serviceView.map((service) => ({
        performedServiceId: service.performedServiceId,
        status: service.status,
        reasonCode: service.reasonCode,
        evidence: service.evidence
          ? { status: service.evidence.status, note: service.evidence.note }
          : null,
      })),
    });

    return {
      visit: {
        id: context.visit.id,
        clientId: context.visit.clientId,
        clientDisplayName: context.clientDisplayName,
        organizationId: context.visit.organizationId,
        facilityId: context.visit.facilityId,
        status: context.visit.status,
        plannedStart: context.visit.plannedStart.toISOString(),
        plannedEnd: context.visit.plannedEnd.toISOString(),
        timezone: context.visit.timezone,
      },
      execution: {
        id: context.execution?.id ?? null,
        status: context.execution?.status ?? 'not_started',
        actualStart: context.execution?.actualStart.toISOString() ?? null,
        actualEnd: context.execution?.actualEnd?.toISOString() ?? null,
      },
      documentation: document
        ? {
            id: document.id,
            status: document.status,
            createdByEmployeeId: document.createdByEmployeeId,
            createdByEmployeeName: employeeNames.get(document.createdByEmployeeId) ?? null,
            finalizedByEmployeeId: document.finalizedByEmployeeId,
            finalizedByEmployeeName: document.finalizedByEmployeeId
              ? (employeeNames.get(document.finalizedByEmployeeId) ?? null)
              : null,
            finalizedAt: document.finalizedAt?.toISOString() ?? null,
            version: document.version,
            createdAt: document.createdAt.toISOString(),
            updatedAt: document.updatedAt.toISOString(),
          }
        : null,
      services: serviceView,
      entries: entryRows.map((entry) => ({
        id: entry.id,
        type: entry.type,
        authorEmployeeId: entry.authorEmployeeId,
        authorEmployeeName: employeeNames.get(entry.authorEmployeeId) ?? null,
        occurredAt: entry.occurredAt?.toISOString() ?? null,
        severity: entry.severity,
        content: entry.content,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
      amendments: amendmentRows.map((amendment) => ({
        id: amendment.id,
        authorUserId: amendment.authorUserId,
        reason: amendment.reason,
        correction: amendment.correction,
        createdAt: amendment.createdAt.toISOString(),
      })),
      history: historyRows.map((history) => ({
        id: history.id,
        actorUserId: history.actorUserId,
        actorEmployeeId: history.actorEmployeeId,
        action: history.action,
        metadata: history.metadata,
        occurredAt: history.occurredAt.toISOString(),
      })),
      completeness,
    };
  }

  private async mutableDocument(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    documentId: string,
    permission: Permission,
    expectedVersion: number,
  ) {
    const document = await this.repository.documentById(
      transaction,
      principal.tenantId,
      documentId,
      true,
    );
    if (!document) throw new CareDocumentationNotFoundError();
    const context = await this.requireVisitContext(
      transaction,
      principal.tenantId,
      document.visitId,
    );
    await this.authorizeVisit(principal, transaction, context, permission);
    if (document.status !== 'draft') throw new CareDocumentationAlreadyFinalizedError();
    if (document.version !== expectedVersion) throw new CareDocumentationVersionConflictError();
    const employee = await this.requireEmployee(transaction, principal);
    return { document, context, employee };
  }

  private async bumpVersion(
    transaction: DatabaseTransaction,
    document: typeof careDocuments.$inferSelect,
    now: Date,
  ) {
    const [updated] = await transaction
      .update(careDocuments)
      .set({ version: document.version + 1, updatedAt: now })
      .where(
        and(
          eq(careDocuments.tenantId, document.tenantId),
          eq(careDocuments.id, document.id),
          eq(careDocuments.version, document.version),
          eq(careDocuments.status, 'draft'),
        ),
      )
      .returning();
    if (!updated) throw new CareDocumentationVersionConflictError();
    return updated;
  }

  private async requireVisitContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ) {
    const context = await this.repository.visitContext(transaction, tenantId, visitId);
    if (!context) throw new CareDocumentationNotFoundError();
    return context;
  }

  private async authorizeVisit(
    principal: AuthorizationPrincipal,
    transaction: DatabaseTransaction,
    context: NonNullable<Awaited<ReturnType<CareDocumentationRepository['visitContext']>>>,
    permission: Permission,
  ) {
    const resource = await this.resourceForVisit(transaction, context.visit);
    assertCan(principal, { action: permission, resource });
    if (principal.roles?.includes('Caregiver')) {
      const employee = await this.requireEmployee(transaction, principal);
      const related = await this.repository.hasCaregiverRelationship(
        transaction,
        principal.tenantId,
        context.visit.id,
        employee.id,
      );
      if (!related) throw new CareDocumentationVisitRelationshipRequiredError();
    }
  }

  private async resourceForVisit(
    transaction: DatabaseTransaction,
    visit: NonNullable<Awaited<ReturnType<CareDocumentationRepository['visitContext']>>>['visit'],
  ): Promise<ResourceContext> {
    return {
      tenantId: visit.tenantId,
      clientId: visit.clientId,
      organizationId: visit.organizationId,
      facilityId: visit.facilityId,
      teamIds: await this.repository.teamIdsForVisit(transaction, visit.tenantId, visit.id),
    };
  }

  private async requireEmployee(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
  ) {
    const employee = await this.repository.employeeForUser(
      transaction,
      principal.tenantId,
      principal.userId,
    );
    if (!employee) throw new CareDocumentationEmployeeLinkRequiredError();
    return employee;
  }

  private event(input: {
    type: DomainEvent['type'];
    principal: AuthorizationPrincipal;
    request: RequestContext;
    document: typeof careDocuments.$inferSelect;
    context: NonNullable<Awaited<ReturnType<CareDocumentationRepository['visitContext']>>>;
    payload: unknown;
  }) {
    return createDomainEvent({
      type: input.type,
      tenantId: input.principal.tenantId,
      aggregateType: 'care_documentation',
      aggregateId: input.document.id,
      actor: { type: 'user', id: input.principal.userId },
      correlationId: input.request.correlationId,
      payload: input.payload,
    } as never) as DomainEvent;
  }

  private async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: {
      event: DomainEvent;
      action: string;
      document: typeof careDocuments.$inferSelect;
      context: NonNullable<Awaited<ReturnType<CareDocumentationRepository['visitContext']>>>;
      employeeId: string | null;
      metadata: Record<string, unknown>;
    },
  ) {
    await this.audit.append(transaction, {
      id: input.event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'client',
      resourceId: input.context.visit.clientId,
      timestamp: new Date(input.event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: { clientId: input.context.visit.clientId, ...input.metadata },
    });
    await transaction.insert(documentationHistory).values({
      id: input.event.id,
      tenantId: principal.tenantId,
      documentationId: input.document.id,
      actorUserId: principal.userId,
      actorEmployeeId: input.employeeId,
      action: input.action,
      metadata: input.metadata,
      occurredAt: new Date(input.event.occurredAt),
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

export class CareDocumentationNotFoundError extends Error {
  readonly code = 'CARE_DOCUMENTATION_NOT_FOUND';
  constructor() {
    super('Care documentation was not found');
    this.name = 'CareDocumentationNotFoundError';
  }
}

export class CareDocumentationAlreadyFinalizedError extends Error {
  readonly code = 'CARE_DOCUMENTATION_ALREADY_FINALIZED';
  constructor() {
    super('Finalized care documentation cannot be edited');
    this.name = 'CareDocumentationAlreadyFinalizedError';
  }
}

export class CareDocumentationNotFinalizedError extends Error {
  readonly code = 'CARE_DOCUMENTATION_NOT_FINALIZED';
  constructor() {
    super('Care documentation must be finalized before it can be amended');
    this.name = 'CareDocumentationNotFinalizedError';
  }
}

export class CareDocumentationIncompleteError extends Error {
  readonly code = 'CARE_DOCUMENTATION_INCOMPLETE';
  constructor(readonly missing: MissingDocumentationRequirement[]) {
    super('Care documentation is incomplete');
    this.name = 'CareDocumentationIncompleteError';
  }
}

export class CareDocumentationVersionConflictError extends Error {
  readonly code = 'CARE_DOCUMENTATION_VERSION_CONFLICT';
  constructor() {
    super('Care documentation changed since it was loaded');
    this.name = 'CareDocumentationVersionConflictError';
  }
}

export class CareDocumentationInvalidStateError extends Error {
  readonly code = 'CARE_DOCUMENTATION_INVALID_STATE';
  constructor() {
    super('Care documentation is not in a valid state');
    this.name = 'CareDocumentationInvalidStateError';
  }
}

export class VisitExecutionRequiredError extends Error {
  readonly code = 'VISIT_EXECUTION_REQUIRED';
  constructor() {
    super('Visit execution is required for care documentation');
    this.name = 'VisitExecutionRequiredError';
  }
}

export class VisitExecutionNotCompletedError extends Error {
  readonly code = 'VISIT_EXECUTION_NOT_COMPLETED';
  constructor() {
    super('Visit execution must be completed before documentation can be finalized');
    this.name = 'VisitExecutionNotCompletedError';
  }
}

export class DocumentationEntryNotFoundError extends Error {
  readonly code = 'DOCUMENTATION_ENTRY_NOT_FOUND';
  constructor() {
    super('Documentation entry was not found');
    this.name = 'DocumentationEntryNotFoundError';
  }
}

export class ServiceEvidenceNotFoundError extends Error {
  readonly code = 'SERVICE_EVIDENCE_NOT_FOUND';
  constructor() {
    super('Performed service was not found for this execution');
    this.name = 'ServiceEvidenceNotFoundError';
  }
}

export class AmendmentReasonRequiredError extends Error {
  readonly code = 'AMENDMENT_REASON_REQUIRED';
  constructor() {
    super('A valid reason and correction are required for an amendment');
    this.name = 'AmendmentReasonRequiredError';
  }
}

export class InvalidDocumentationWorklistQueryError extends Error {
  readonly code = 'CARE_DOCUMENTATION_INVALID_QUERY';
  constructor() {
    super('The documentation worklist query is invalid');
    this.name = 'InvalidDocumentationWorklistQueryError';
  }
}

export class CareDocumentationEmployeeLinkRequiredError extends Error {
  readonly code = 'CARE_DOCUMENTATION_EMPLOYEE_LINK_REQUIRED';
  constructor() {
    super('An active employee link is required');
    this.name = 'CareDocumentationEmployeeLinkRequiredError';
  }
}

export class CareDocumentationVisitRelationshipRequiredError extends Error {
  readonly code = 'CARE_DOCUMENTATION_VISIT_RELATIONSHIP_REQUIRED';
  constructor() {
    super('A caregiver relationship to the visit is required');
    this.name = 'CareDocumentationVisitRelationshipRequiredError';
  }
}

function validateWorklistQuery(query: DocumentationWorklistQuery): void {
  if (
    !Number.isFinite(query.from.getTime()) ||
    !Number.isFinite(query.until.getTime()) ||
    query.until <= query.from ||
    query.until.getTime() - query.from.getTime() > 31 * 24 * 60 * 60 * 1000 ||
    (query.clientQuery !== undefined &&
      (query.clientQuery.trim().length === 0 || query.clientQuery.length > 120)) ||
    !Number.isInteger(query.page) ||
    query.page < 1 ||
    !Number.isInteger(query.pageSize) ||
    query.pageSize < 1 ||
    query.pageSize > 100
  ) {
    throw new InvalidDocumentationWorklistQueryError();
  }
}

function groupBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const value of values) {
    const group = key(value);
    const items = result.get(group) ?? [];
    items.push(value);
    result.set(group, items);
  }
  return result;
}

export function createCareDocumentationApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
): CareDocumentationApplicationService {
  return new CareDocumentationApplicationService(unitOfWork, audit, outbox);
}
