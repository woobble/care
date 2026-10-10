import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import type { ClientRepresentationType } from '@care/clients';
import { clientContactRoles, clientContacts, clientRecords } from '@care/clients';
import {
  careDocuments,
  documentationAmendments,
  serviceEvidence as documentationEvidence,
} from '@care/care-documentation';
import { employeeRecords, employeeTeamMemberships } from '@care/employees';
import { visitAssignments, visits } from '@care/scheduling';
import { performedServices, visitExecutions } from '@care/visit-execution';
import { acknowledgements, evidencePackages } from '@module/service-evidence/schema';

export interface EvidenceVisitContext {
  visit: typeof visits.$inferSelect;
  execution: typeof visitExecutions.$inferSelect | null;
  clientId: string;
  clientName: string;
}

export interface EvidenceWorklistSourceRow {
  documentation: typeof careDocuments.$inferSelect;
  visit: typeof visits.$inferSelect;
  execution: typeof visitExecutions.$inferSelect;
  clientName: string;
  amendmentCount: number;
}

export interface EligibleContactRow {
  id: string;
  firstName: string;
  lastName: string;
  relationshipType: string;
  representationType: ClientRepresentationType | null;
  representationValidFrom: string | null;
  representationValidUntil: string | null;
  roles: string[];
}

export class ServiceEvidenceRepository {
  async visitContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<EvidenceVisitContext | null> {
    const [row] = await transaction
      .select({
        visit: visits,
        execution: visitExecutions,
        clientId: clientRecords.id,
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
      clientId: row.clientId,
      clientName: `${row.clientPreferredName || row.clientFirstName} ${row.clientLastName}`,
    };
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

  async executionById(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(visitExecutions)
      .where(and(eq(visitExecutions.tenantId, tenantId), eq(visitExecutions.id, executionId)))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async lockVisit(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    const [row] = await transaction
      .select()
      .from(visits)
      .where(and(eq(visits.tenantId, tenantId), eq(visits.id, visitId)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async lockClient(transaction: DatabaseTransaction, tenantId: string, clientId: string) {
    const [row] = await transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, clientId)))
      .limit(1)
      .for('update');
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
      .orderBy(asc(performedServices.id));
  }

  async evidenceForDocument(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentId: string,
  ) {
    return transaction
      .select()
      .from(documentationEvidence)
      .where(
        and(
          eq(documentationEvidence.tenantId, tenantId),
          eq(documentationEvidence.documentationId, documentId),
        ),
      )
      .orderBy(asc(documentationEvidence.performedServiceId));
  }

  async amendmentCount(transaction: DatabaseTransaction, tenantId: string, documentId: string) {
    const [row] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(documentationAmendments)
      .where(
        and(
          eq(documentationAmendments.tenantId, tenantId),
          eq(documentationAmendments.documentationId, documentId),
        ),
      );
    return row?.count ?? 0;
  }

  async latestPackage(transaction: DatabaseTransaction, tenantId: string, documentId: string) {
    const query = transaction
      .select()
      .from(evidencePackages)
      .where(
        and(
          eq(evidencePackages.tenantId, tenantId),
          eq(evidencePackages.documentationId, documentId),
        ),
      )
      .orderBy(desc(evidencePackages.version))
      .limit(1);
    const [row] = await query;
    return row ?? null;
  }

  async packageById(transaction: DatabaseTransaction, tenantId: string, evidencePackageId: string) {
    const query = transaction
      .select()
      .from(evidencePackages)
      .where(
        and(eq(evidencePackages.tenantId, tenantId), eq(evidencePackages.id, evidencePackageId)),
      )
      .limit(1);
    const [row] = await query;
    return row ?? null;
  }

  async packagesForDocuments(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentIds: string[],
  ) {
    if (documentIds.length === 0) return [];
    return transaction
      .select()
      .from(evidencePackages)
      .where(
        and(
          eq(evidencePackages.tenantId, tenantId),
          inArray(evidencePackages.documentationId, documentIds),
        ),
      )
      .orderBy(asc(evidencePackages.documentationId), asc(evidencePackages.version));
  }

  async acknowledgementById(
    transaction: DatabaseTransaction,
    tenantId: string,
    acknowledgementId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(acknowledgements)
      .where(
        and(eq(acknowledgements.tenantId, tenantId), eq(acknowledgements.id, acknowledgementId)),
      )
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async acknowledgementByIdempotencyKey(
    transaction: DatabaseTransaction,
    tenantId: string,
    idempotencyKey: string,
  ) {
    const [row] = await transaction
      .select()
      .from(acknowledgements)
      .where(
        and(
          eq(acknowledgements.tenantId, tenantId),
          eq(acknowledgements.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async acknowledgementForPackage(
    transaction: DatabaseTransaction,
    tenantId: string,
    evidencePackageId: string,
    includeRevoked = false,
  ) {
    const query = transaction
      .select()
      .from(acknowledgements)
      .where(
        and(
          eq(acknowledgements.tenantId, tenantId),
          eq(acknowledgements.evidencePackageId, evidencePackageId),
          ...(includeRevoked ? [] : [isNull(acknowledgements.revokedAt)]),
        ),
      )
      .orderBy(desc(acknowledgements.createdAt), desc(acknowledgements.id))
      .limit(1);
    const [row] = await query;
    return row ?? null;
  }

  async acknowledgementsForPackages(
    transaction: DatabaseTransaction,
    tenantId: string,
    packageIds: string[],
  ) {
    if (packageIds.length === 0) return [];
    return transaction
      .select()
      .from(acknowledgements)
      .where(
        and(
          eq(acknowledgements.tenantId, tenantId),
          inArray(acknowledgements.evidencePackageId, packageIds),
        ),
      )
      .orderBy(asc(acknowledgements.createdAt), asc(acknowledgements.id));
  }

  async eligibleContacts(transaction: DatabaseTransaction, tenantId: string, clientId: string) {
    const rows = await transaction
      .select({
        id: clientContacts.id,
        firstName: clientContacts.firstName,
        lastName: clientContacts.lastName,
        relationshipType: clientContacts.relationshipType,
        representationType: clientContacts.representationType,
        representationValidFrom: clientContacts.representationValidFrom,
        representationValidUntil: clientContacts.representationValidUntil,
        role: clientContactRoles.role,
      })
      .from(clientContacts)
      .innerJoin(
        clientContactRoles,
        and(
          eq(clientContactRoles.tenantId, clientContacts.tenantId),
          eq(clientContactRoles.clientId, clientContacts.clientId),
          eq(clientContactRoles.contactId, clientContacts.id),
        ),
      )
      .where(
        and(
          eq(clientContacts.tenantId, tenantId),
          eq(clientContacts.clientId, clientId),
          eq(clientContactRoles.role, 'legal_representative'),
        ),
      )
      .orderBy(asc(clientContacts.lastName), asc(clientContacts.firstName), asc(clientContacts.id));
    const byId = new Map<string, EligibleContactRow>();
    for (const row of rows) {
      const existing = byId.get(row.id);
      if (existing) existing.roles.push(row.role);
      else {
        byId.set(row.id, {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          relationshipType: row.relationshipType,
          representationType: row.representationType,
          representationValidFrom: row.representationValidFrom,
          representationValidUntil: row.representationValidUntil,
          roles: [row.role],
        });
      }
    }
    return [...byId.values()];
  }

  async contactForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    contactId: string,
    lock = false,
  ) {
    const query = transaction
      .select({
        id: clientContacts.id,
        firstName: clientContacts.firstName,
        lastName: clientContacts.lastName,
        relationshipType: clientContacts.relationshipType,
        representationType: clientContacts.representationType,
        representationValidFrom: clientContacts.representationValidFrom,
        representationValidUntil: clientContacts.representationValidUntil,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.tenantId, tenantId),
          eq(clientContacts.clientId, clientId),
          eq(clientContacts.id, contactId),
        ),
      )
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    if (!row) return null;
    const roles = await transaction
      .select({ role: clientContactRoles.role })
      .from(clientContactRoles)
      .where(
        and(
          eq(clientContactRoles.tenantId, tenantId),
          eq(clientContactRoles.clientId, clientId),
          eq(clientContactRoles.contactId, contactId),
        ),
      );
    return { ...row, roles: roles.map((item) => item.role) };
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

    const [participation] = await transaction
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
    return participation !== undefined;
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

  async teamIdsForVisits(transaction: DatabaseTransaction, tenantId: string, visitIds: string[]) {
    const result = new Map<string, string[]>();
    if (visitIds.length === 0) return result;
    const rows = await transaction
      .selectDistinct({ visitId: visitAssignments.visitId, teamId: employeeTeamMemberships.teamId })
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
          inArray(visitAssignments.visitId, visitIds),
          eq(visitAssignments.status, 'active'),
        ),
      );
    for (const row of rows) {
      const current = result.get(row.visitId) ?? [];
      current.push(row.teamId);
      result.set(row.visitId, current);
    }
    return result;
  }

  async caregiverVisitIds(transaction: DatabaseTransaction, tenantId: string, employeeId: string) {
    const assignments = await transaction
      .selectDistinct({ visitId: visitAssignments.visitId })
      .from(visitAssignments)
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.employeeId, employeeId),
          eq(visitAssignments.status, 'active'),
        ),
      );
    const participation = await transaction
      .selectDistinct({ visitId: visitExecutions.visitId })
      .from(visitExecutions)
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
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
      );
    return new Set([...assignments, ...participation].map((row) => row.visitId));
  }

  async finalizedDocumentationRows(
    transaction: DatabaseTransaction,
    tenantId: string,
    query: {
      from: Date;
      until: Date;
      visitId?: string;
      clientId?: string;
      clientQuery?: string;
      employeeId?: string;
      organizationId?: string;
      facilityId?: string;
    },
  ): Promise<EvidenceWorklistSourceRow[]> {
    const conditions = [
      eq(careDocuments.tenantId, tenantId),
      eq(careDocuments.status, 'finalized'),
      gte(visits.plannedStart, query.from),
      lt(visits.plannedStart, query.until),
    ];
    if (query.visitId) conditions.push(eq(visits.id, query.visitId));
    if (query.clientId) conditions.push(eq(visits.clientId, query.clientId));
    if (query.organizationId) conditions.push(eq(visits.organizationId, query.organizationId));
    if (query.facilityId) conditions.push(eq(visits.facilityId, query.facilityId));
    if (query.clientQuery) {
      const pattern = `%${query.clientQuery.trim()}%`;
      conditions.push(
        or(
          ilike(clientRecords.firstName, pattern),
          ilike(clientRecords.preferredName, pattern),
          ilike(clientRecords.lastName, pattern),
          sql`(coalesce(nullif(${clientRecords.preferredName}, ''), ${clientRecords.firstName}) || ' ' || ${clientRecords.lastName}) ILIKE ${pattern}`,
        )!,
      );
    }
    if (query.employeeId) {
      conditions.push(
        or(
          exists(
            transaction
              .select({ id: visitAssignments.id })
              .from(visitAssignments)
              .where(
                and(
                  eq(visitAssignments.tenantId, tenantId),
                  eq(visitAssignments.visitId, visits.id),
                  eq(visitAssignments.employeeId, query.employeeId),
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
                  eq(performedServices.executionId, careDocuments.executionId),
                  eq(performedServices.performedByEmployeeId, query.employeeId),
                ),
              ),
          ),
          eq(visitExecutions.startedByEmployeeId, query.employeeId),
          eq(visitExecutions.completedByEmployeeId, query.employeeId),
        )!,
      );
    }
    const rows = await transaction
      .select({
        documentation: careDocuments,
        visit: visits,
        execution: visitExecutions,
        clientFirstName: clientRecords.firstName,
        clientPreferredName: clientRecords.preferredName,
        clientLastName: clientRecords.lastName,
        amendmentCount: sql<number>`(
          SELECT count(*)::int
          FROM care_documentation.amendments AS amendment
          WHERE amendment.tenant_id = ${careDocuments.tenantId}
            AND amendment.documentation_id = ${careDocuments.id}
        )`,
      })
      .from(careDocuments)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, careDocuments.tenantId), eq(visits.id, careDocuments.visitId)),
      )
      .innerJoin(
        visitExecutions,
        and(
          eq(visitExecutions.tenantId, careDocuments.tenantId),
          eq(visitExecutions.id, careDocuments.executionId),
        ),
      )
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .where(and(...conditions))
      .orderBy(desc(visits.plannedStart), asc(careDocuments.id))
      .limit(5_000);

    return rows.map((row) => ({
      documentation: row.documentation,
      visit: row.visit,
      execution: row.execution,
      clientName: `${row.clientPreferredName || row.clientFirstName} ${row.clientLastName}`,
      amendmentCount: row.amendmentCount,
    }));
  }
}
