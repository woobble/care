import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { clientRecords } from '@care/clients';
import { employeeRecords, employeeTeamMemberships } from '@care/employees';
import { visitAssignments, visits } from '@care/scheduling';
import { performedServices, visitExecutions } from '@care/visit-execution';
import {
  careDocuments,
  documentationAmendments,
  documentationEntries,
  documentationHistory,
  serviceEvidence,
} from '../schema';

export class CareDocumentationRepository {
  async visitContext(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    const [row] = await transaction
      .select({
        visit: visits,
        execution: visitExecutions,
        clientFirstName: clientRecords.firstName,
        clientPreferredName: clientRecords.preferredName,
        clientLastName: clientRecords.lastName,
      })
      .from(visits)
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .leftJoin(
        visitExecutions,
        and(eq(visitExecutions.tenantId, visits.tenantId), eq(visitExecutions.visitId, visits.id)),
      )
      .where(and(eq(visits.tenantId, tenantId), eq(visits.id, visitId)))
      .limit(1);
    if (!row) return null;
    return {
      visit: row.visit,
      execution: row.execution,
      clientDisplayName: `${row.clientPreferredName || row.clientFirstName} ${row.clientLastName}`,
    };
  }

  async documentationsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ) {
    return transaction
      .select({
        documentationId: careDocuments.id,
        documentationStatus: careDocuments.status,
        documentationVersion: careDocuments.version,
        visit: visits,
      })
      .from(careDocuments)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, careDocuments.tenantId), eq(visits.id, careDocuments.visitId)),
      )
      .where(and(eq(careDocuments.tenantId, tenantId), eq(visits.clientId, clientId)));
  }

  async employeeForUser(transaction: DatabaseTransaction, tenantId: string, userId: string) {
    const [employee] = await transaction
      .select({ id: employeeRecords.id })
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, tenantId),
          eq(employeeRecords.userId, userId),
          eq(employeeRecords.status, 'active'),
        ),
      )
      .limit(1);
    return employee ?? null;
  }

  async hasCaregiverRelationship(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    employeeId: string,
  ): Promise<boolean> {
    const [assignment] = await transaction
      .select({ id: visitAssignments.id })
      .from(visitAssignments)
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.employeeId, employeeId),
          eq(visitAssignments.status, 'active'),
        ),
      )
      .limit(1);
    if (assignment) return true;

    const [row] = await transaction
      .select({ id: visitExecutions.id })
      .from(visitExecutions)
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
          eq(visitExecutions.visitId, visitId),
          or(
            eq(visitExecutions.startedByEmployeeId, employeeId),
            eq(visitExecutions.completedByEmployeeId, employeeId),
            exists(
              transaction
                .select({ id: performedServices.id })
                .from(performedServices)
                .where(
                  and(
                    eq(performedServices.tenantId, tenantId),
                    eq(performedServices.executionId, visitExecutions.id),
                    eq(performedServices.performedByEmployeeId, employeeId),
                  ),
                ),
            ),
          ),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async teamIdsForVisit(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    const rows = await transaction
      .selectDistinct({ teamId: employeeTeamMemberships.teamId })
      .from(visitAssignments)
      .innerJoin(
        employeeTeamMemberships,
        and(
          eq(employeeTeamMemberships.tenantId, visitAssignments.tenantId),
          eq(employeeTeamMemberships.employeeId, visitAssignments.employeeId),
          eq(employeeTeamMemberships.status, 'active'),
        ),
      )
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.status, 'active'),
        ),
      );
    return rows.map((row) => row.teamId);
  }

  async documentForVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(careDocuments)
      .where(and(eq(careDocuments.tenantId, tenantId), eq(careDocuments.visitId, visitId)))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async documentById(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(careDocuments)
      .where(and(eq(careDocuments.tenantId, tenantId), eq(careDocuments.id, documentId)))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async performedServices(transaction: DatabaseTransaction, tenantId: string, executionId: string) {
    return transaction
      .select()
      .from(performedServices)
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          eq(performedServices.executionId, executionId),
        ),
      )
      .orderBy(asc(performedServices.createdAt), asc(performedServices.id));
  }

  async performedServicesForExecutions(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionIds: string[],
  ) {
    if (executionIds.length === 0) return [];
    return transaction
      .select()
      .from(performedServices)
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          inArray(performedServices.executionId, executionIds),
        ),
      )
      .orderBy(asc(performedServices.createdAt), asc(performedServices.id));
  }

  async evidenceForDocuments(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentIds: string[],
  ) {
    if (documentIds.length === 0) return [];
    return transaction
      .select()
      .from(serviceEvidence)
      .where(
        and(
          eq(serviceEvidence.tenantId, tenantId),
          inArray(serviceEvidence.documentationId, documentIds),
        ),
      );
  }

  async entries(transaction: DatabaseTransaction, tenantId: string, documentId: string) {
    return transaction
      .select()
      .from(documentationEntries)
      .where(
        and(
          eq(documentationEntries.tenantId, tenantId),
          eq(documentationEntries.documentationId, documentId),
        ),
      )
      .orderBy(asc(documentationEntries.createdAt), asc(documentationEntries.id));
  }

  async evidence(transaction: DatabaseTransaction, tenantId: string, documentId: string) {
    return transaction
      .select()
      .from(serviceEvidence)
      .where(
        and(
          eq(serviceEvidence.tenantId, tenantId),
          eq(serviceEvidence.documentationId, documentId),
        ),
      )
      .orderBy(asc(serviceEvidence.createdAt), asc(serviceEvidence.id));
  }

  async evidenceForService(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentId: string,
    performedServiceId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(serviceEvidence)
      .where(
        and(
          eq(serviceEvidence.tenantId, tenantId),
          eq(serviceEvidence.documentationId, documentId),
          eq(serviceEvidence.performedServiceId, performedServiceId),
        ),
      )
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async performedService(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionId: string,
    performedServiceId: string,
  ) {
    const [row] = await transaction
      .select()
      .from(performedServices)
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          eq(performedServices.executionId, executionId),
          eq(performedServices.id, performedServiceId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async entry(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentId: string,
    entryId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(documentationEntries)
      .where(
        and(
          eq(documentationEntries.tenantId, tenantId),
          eq(documentationEntries.documentationId, documentId),
          eq(documentationEntries.id, entryId),
        ),
      )
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async amendments(transaction: DatabaseTransaction, tenantId: string, documentId: string) {
    return transaction
      .select()
      .from(documentationAmendments)
      .where(
        and(
          eq(documentationAmendments.tenantId, tenantId),
          eq(documentationAmendments.documentationId, documentId),
        ),
      )
      .orderBy(asc(documentationAmendments.createdAt), asc(documentationAmendments.id));
  }

  async history(transaction: DatabaseTransaction, tenantId: string, documentId: string) {
    return transaction
      .select()
      .from(documentationHistory)
      .where(
        and(
          eq(documentationHistory.tenantId, tenantId),
          eq(documentationHistory.documentationId, documentId),
        ),
      )
      .orderBy(desc(documentationHistory.occurredAt), desc(documentationHistory.id));
  }

  async employeeNames(transaction: DatabaseTransaction, tenantId: string, employeeIds: string[]) {
    if (employeeIds.length === 0) return new Map<string, string>();
    const rows = await transaction
      .select({
        id: employeeRecords.id,
        firstName: employeeRecords.firstName,
        preferredName: employeeRecords.preferredName,
        lastName: employeeRecords.lastName,
      })
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, tenantId), inArray(employeeRecords.id, employeeIds)));
    return new Map(
      rows.map((row) => [row.id, `${row.preferredName || row.firstName} ${row.lastName}`]),
    );
  }

  async worklistRows(
    transaction: DatabaseTransaction,
    tenantId: string,
    input: {
      from: Date;
      until: Date;
      clientQuery?: string;
      facilityId?: string;
      employeeId?: string;
      status?: 'draft' | 'finalized' | 'missing';
    },
  ) {
    const conditions = [
      eq(visits.tenantId, tenantId),
      gte(visits.plannedStart, input.from),
      lt(visits.plannedStart, input.until),
    ];
    if (input.clientQuery?.trim()) {
      const escaped = input.clientQuery
        .trim()
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      const pattern = `%${escaped}%`;
      conditions.push(
        ilike(
          sql`concat_ws(' ', coalesce(${clientRecords.preferredName}, ${clientRecords.firstName}), ${clientRecords.lastName})`,
          pattern,
        ),
      );
    }
    if (input.facilityId) conditions.push(eq(visits.facilityId, input.facilityId));
    if (input.employeeId) {
      conditions.push(
        or(
          eq(visitExecutions.startedByEmployeeId, input.employeeId),
          eq(visitExecutions.completedByEmployeeId, input.employeeId),
          exists(
            transaction
              .select({ id: visitAssignments.id })
              .from(visitAssignments)
              .where(
                and(
                  eq(visitAssignments.tenantId, tenantId),
                  eq(visitAssignments.visitId, visits.id),
                  eq(visitAssignments.employeeId, input.employeeId),
                  eq(visitAssignments.status, 'active'),
                ),
              ),
          ),
          exists(
            transaction
              .select({ id: performedServices.id })
              .from(performedServices)
              .where(
                and(
                  eq(performedServices.tenantId, tenantId),
                  eq(performedServices.executionId, visitExecutions.id),
                  eq(performedServices.performedByEmployeeId, input.employeeId),
                ),
              ),
          ),
        )!,
      );
    }
    if (input.status === 'missing') conditions.push(isNull(careDocuments.id));
    if (input.status === 'draft') conditions.push(eq(careDocuments.status, 'draft'));
    if (input.status === 'finalized') conditions.push(eq(careDocuments.status, 'finalized'));

    return transaction
      .select({
        visit: visits,
        execution: visitExecutions,
        document: careDocuments,
        clientFirstName: clientRecords.firstName,
        clientPreferredName: clientRecords.preferredName,
        clientLastName: clientRecords.lastName,
      })
      .from(visits)
      .innerJoin(
        visitExecutions,
        and(eq(visitExecutions.tenantId, visits.tenantId), eq(visitExecutions.visitId, visits.id)),
      )
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .leftJoin(
        careDocuments,
        and(
          eq(careDocuments.tenantId, visitExecutions.tenantId),
          eq(careDocuments.executionId, visitExecutions.id),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(visits.plannedStart), asc(visits.id))
      .limit(5000);
  }
}
