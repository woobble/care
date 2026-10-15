import { and, asc, desc, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import type { ClientRepresentationType } from '@care/clients';
import { clientContactRoles, clientContacts, clientRecords } from '@care/clients';
import {
  careDocuments,
  documentationAmendments,
  serviceEvidence as documentationEvidence,
} from '@care/care-documentation';
import { employeeRecords, employeeTeamMemberships } from '@care/employees';
import type { AuthorizationPrincipal } from '@care/permissions';
import { visitAssignments, visits } from '@care/scheduling';
import { performedServices, visitExecutions } from '@care/visit-execution';
import { acknowledgements, evidencePackages } from '@module/service-evidence/schema';

export interface EvidenceVisitContext {
  visit: typeof visits.$inferSelect;
  execution: typeof visitExecutions.$inferSelect | null;
  clientId: string;
  clientName: string;
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

  async worklistRows(
    transaction: DatabaseTransaction,
    tenantId: string,
    query: {
      from: Date;
      until: Date;
      page: number;
      pageSize: number;
      sort?: 'date' | 'client' | 'status' | 'acknowledgement';
      sortOrder?: 'asc' | 'desc';
      status?: string;
      visitId?: string;
      clientId?: string;
      clientQuery?: string;
      employeeId?: string;
      organizationId?: string;
      facilityId?: string;
      signatoryType?: string;
    },
    principal: AuthorizationPrincipal,
    caregiverEmployeeId?: string,
  ) {
    const filters: SQL[] = [
      sql`d.tenant_id = ${tenantId}`,
      sql`d.status = 'finalized'`,
      sql`v.planned_start >= ${query.from}`,
      sql`v.planned_start < ${query.until}`,
    ];
    if (query.visitId) filters.push(sql`v.id = ${query.visitId}`);
    if (query.clientId) filters.push(sql`v.client_id = ${query.clientId}`);
    if (query.organizationId) filters.push(sql`v.organization_id = ${query.organizationId}`);
    if (query.facilityId) filters.push(sql`v.facility_id = ${query.facilityId}`);

    const searchableEmployeeIds = [query.employeeId, caregiverEmployeeId].filter(
      (employeeId): employeeId is string => Boolean(employeeId),
    );
    for (const employeeId of searchableEmployeeIds) {
      filters.push(sql`(
        EXISTS (
          SELECT 1 FROM scheduling.visit_assignments AS assignment
          WHERE assignment.tenant_id = ${tenantId}
            AND assignment.visit_id = v.id
            AND assignment.employee_id = ${employeeId}
            AND assignment.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM visit_execution.performed_services AS performed
          WHERE performed.tenant_id = ${tenantId}
            AND performed.execution_id = d.execution_id
            AND performed.performed_by_employee_id = ${employeeId}
        )
        OR e.started_by_employee_id = ${employeeId}
        OR e.completed_by_employee_id = ${employeeId}
      )`);
    }

    const readableScopes: SQL[] = [];
    const readableGrants = principal.grants.filter(
      (grant) => grant.permission === 'service_evidence.read',
    );
    if (
      readableGrants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === tenantId)
    ) {
      readableScopes.push(sql`v.tenant_id = ${tenantId}`);
    }
    const organizationIds = [
      ...new Set(
        readableGrants
          .filter((grant) => grant.scopeType === 'organization')
          .map((grant) => grant.scopeId),
      ),
    ];
    if (organizationIds.length) {
      readableScopes.push(
        sql`v.organization_id IN (${sql.join(
          organizationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    const facilityIds = [
      ...new Set(
        readableGrants
          .filter((grant) => grant.scopeType === 'facility')
          .map((grant) => grant.scopeId),
      ),
    ];
    if (facilityIds.length) {
      readableScopes.push(
        sql`v.facility_id IN (${sql.join(
          facilityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    const teamIds = [
      ...new Set(
        readableGrants.filter((grant) => grant.scopeType === 'team').map((grant) => grant.scopeId),
      ),
    ];
    if (teamIds.length) {
      readableScopes.push(sql`EXISTS (
        SELECT 1
        FROM scheduling.visit_assignments AS team_assignment
        INNER JOIN employees.employee_team_memberships AS membership
          ON membership.tenant_id = team_assignment.tenant_id
         AND membership.employee_id = team_assignment.employee_id
         AND membership.status = 'active'
        WHERE team_assignment.tenant_id = ${tenantId}
          AND team_assignment.visit_id = v.id
          AND team_assignment.status = 'active'
          AND membership.team_id IN (${sql.join(
            teamIds.map((id) => sql`${id}`),
            sql`, `,
          )})
      )`);
    }
    filters.push(
      readableScopes.length ? sql`(${sql.join(readableScopes, sql` OR `)})` : sql`FALSE`,
    );

    const whereSql = sql.join(filters, sql` AND `);
    const filteredConditions: SQL[] = [];
    if (query.status) filteredConditions.push(sql`classified.status = ${query.status}`);
    if (query.signatoryType) {
      filteredConditions.push(sql`classified.signatory_type = ${query.signatoryType}`);
    }
    if (query.clientQuery) {
      filteredConditions.push(
        sql`COALESCE(classified.snapshot->>'clientName', classified.current_client_name) ILIKE ${`%${query.clientQuery.trim()}%`}`,
      );
    }

    const sortDirection = query.sortOrder === 'asc' ? sql.raw('ASC') : sql.raw('DESC');
    const sortColumn = (() => {
      switch (query.sort ?? 'date') {
        case 'client':
          return sql`classified.client_name`;
        case 'status':
          return sql`classified.status`;
        case 'acknowledgement':
          return sql`COALESCE(classified.acknowledged_at, classified.declined_at)`;
        case 'date':
        default:
          return sql`classified.planned_start`;
      }
    })();
    const offset = (query.page - 1) * query.pageSize;
    const result = await transaction.execute(sql`
      WITH source AS (
        SELECT
          d.id AS documentation_id,
          d.version AS documentation_version,
          d.execution_id,
          v.id AS visit_id,
          v.tenant_id,
          v.client_id,
          v.organization_id,
          v.facility_id,
          v.planned_start AS visit_planned_start,
          v.timezone AS visit_timezone,
          e.version AS execution_version,
          COALESCE(NULLIF(client.preferred_name, ''), client.first_name) || ' ' || client.last_name AS current_client_name,
          (
            SELECT count(*)::int
            FROM care_documentation.amendments AS amendment
            WHERE amendment.tenant_id = d.tenant_id
              AND amendment.documentation_id = d.id
          ) AS amendment_count
        FROM care_documentation.documents AS d
        INNER JOIN scheduling.visits AS v
          ON v.tenant_id = d.tenant_id AND v.id = d.visit_id
        INNER JOIN visit_execution.executions AS e
          ON e.tenant_id = d.tenant_id AND e.id = d.execution_id
        INNER JOIN clients.clients AS client
          ON client.tenant_id = v.tenant_id AND client.id = v.client_id
        WHERE ${whereSql}
      ),
      projected AS (
        SELECT
          source.*,
          package.id AS evidence_package_id,
          package.version AS package_version,
          package.documentation_version AS package_documentation_version,
          package.execution_version AS package_execution_version,
          package.amendment_count AS package_amendment_count,
          package.snapshot,
          package.snapshot_hash,
          COALESCE(package_summary.service_summary, live_summary.service_summary) AS service_summary,
          COALESCE(package_summary.caregiver_summary, live_summary.caregiver_summary) AS caregiver_summary,
          acknowledgement.signatory_type,
          acknowledgement.status AS acknowledgement_status,
          acknowledgement.signatory_name_snapshot AS signatory_name,
          acknowledgement.signatory_capacity AS capacity,
          acknowledgement.method,
          acknowledgement.acknowledged_at,
          acknowledgement.declined_at,
          acknowledgement.revoked_at,
          acknowledgement.signature_storage_key,
          row_number() OVER (
            PARTITION BY source.documentation_id
            ORDER BY package.version DESC NULLS LAST
          ) AS package_rank
        FROM source
        LEFT JOIN service_evidence.evidence_packages AS package
          ON package.tenant_id = source.tenant_id
         AND package.documentation_id = source.documentation_id
        LEFT JOIN LATERAL (
          SELECT
            (
              SELECT string_agg(DISTINCT item->>'serviceName', ', ' ORDER BY item->>'serviceName')
              FROM jsonb_array_elements(package.snapshot->'items') AS item
              WHERE NULLIF(item->>'serviceName', '') IS NOT NULL
            ) AS service_summary,
            (
              SELECT string_agg(DISTINCT
                COALESCE(NULLIF(employee.preferred_name, ''), employee.first_name) || ' ' || employee.last_name,
                ', ' ORDER BY COALESCE(NULLIF(employee.preferred_name, ''), employee.first_name) || ' ' || employee.last_name
              )
              FROM jsonb_array_elements(package.snapshot->'items') AS item
              INNER JOIN employees.employees AS employee
                ON employee.tenant_id = package.tenant_id
               AND employee.id = (item->>'performedByEmployeeId')::uuid
            ) AS caregiver_summary
        ) AS package_summary ON package.id IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT
            (
              SELECT string_agg(DISTINCT performed.service_name_snapshot, ', ' ORDER BY performed.service_name_snapshot)
              FROM visit_execution.performed_services AS performed
              WHERE performed.tenant_id = source.tenant_id
                AND performed.execution_id = source.execution_id
            ) AS service_summary,
            (
              SELECT string_agg(DISTINCT
                COALESCE(NULLIF(employee.preferred_name, ''), employee.first_name) || ' ' || employee.last_name,
                ', ' ORDER BY COALESCE(NULLIF(employee.preferred_name, ''), employee.first_name) || ' ' || employee.last_name
              )
              FROM visit_execution.performed_services AS performed
              INNER JOIN employees.employees AS employee
                ON employee.tenant_id = performed.tenant_id
               AND employee.id = performed.performed_by_employee_id
              WHERE performed.tenant_id = source.tenant_id
                AND performed.execution_id = source.execution_id
            ) AS caregiver_summary
        ) AS live_summary ON package.id IS NULL
        LEFT JOIN LATERAL (
          SELECT ack.*
          FROM service_evidence.acknowledgements AS ack
          WHERE ack.tenant_id = package.tenant_id
            AND ack.evidence_package_id = package.id
          ORDER BY ack.created_at DESC, ack.id DESC
          LIMIT 1
        ) AS acknowledgement ON TRUE
      ),
      classified AS (
        SELECT
          projected.*,
          CASE
            WHEN evidence_package_id IS NULL THEN 'awaiting_acknowledgement'
            WHEN package_documentation_version = documentation_version
             AND package_execution_version = execution_version
             AND package_amendment_count = amendment_count
              THEN CASE
                WHEN revoked_at IS NOT NULL THEN 'revoked'
                WHEN signatory_type IS NULL THEN 'awaiting_acknowledgement'
                WHEN acknowledgement_status = 'acknowledged' THEN 'acknowledged'
                WHEN acknowledgement_status = 'declined' THEN 'declined'
                ELSE 'awaiting_acknowledgement'
              END
            WHEN package_rank = 1 THEN 'outdated'
            ELSE 'superseded'
          END AS status,
          COALESCE(snapshot->>'clientId', client_id::text) AS projected_client_id,
          COALESCE(snapshot->>'clientName', current_client_name) AS client_name,
          COALESCE((snapshot->>'plannedStart')::timestamptz, visit_planned_start) AS planned_start,
          COALESCE(snapshot->>'timezone', visit_timezone) AS timezone
        FROM projected
      ),
      filtered AS (
        SELECT classified.*
        FROM classified
        ${filteredConditions.length ? sql`WHERE ${sql.join(filteredConditions, sql` AND `)}` : sql``}
      ),
      totals AS (
        SELECT count(*)::int AS total FROM filtered
      ),
      page AS (
        SELECT *
        FROM filtered AS classified
        ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, classified.documentation_id ASC, classified.package_version ASC NULLS FIRST
        LIMIT ${query.pageSize} OFFSET ${offset}
      )
      SELECT
        page.visit_id AS "visitId",
        page.documentation_id AS "documentationId",
        page.evidence_package_id AS "evidencePackageId",
        page.package_version AS "packageVersion",
        page.service_summary AS "serviceSummary",
        page.caregiver_summary AS "caregiverSummary",
        page.projected_client_id AS "clientId",
        page.client_name AS "clientName",
        page.planned_start AS "plannedStart",
        page.timezone AS "timezone",
        page.status AS "status",
        page.snapshot_hash AS "snapshotHash",
        page.signatory_type AS "signatoryType",
        page.signatory_name AS "signatoryName",
        page.capacity AS "capacity",
        page.method AS "method",
        COALESCE(page.acknowledged_at, page.declined_at) AS "acknowledgedAt",
        page.signature_storage_key IS NOT NULL AS "signatureAvailable",
        totals.total AS "total"
      FROM totals
      LEFT JOIN page ON TRUE
    `);
    const rows = result.rows as Array<{
      visitId: string | null;
      documentationId: string | null;
      evidencePackageId: string | null;
      packageVersion: number | null;
      serviceSummary: string | null;
      caregiverSummary: string | null;
      clientId: string | null;
      clientName: string | null;
      plannedStart: Date | string | null;
      timezone: string | null;
      status: string | null;
      snapshotHash: string | null;
      signatoryType: string | null;
      signatoryName: string | null;
      capacity: string | null;
      method: string | null;
      acknowledgedAt: Date | string | null;
      signatureAvailable: boolean | null;
      total: number;
    }>;
    const total = Number(rows[0]?.total ?? 0);
    return {
      total,
      items: rows
        .filter((row) => row.documentationId !== null)
        .map((row) => ({
          visitId: row.visitId!,
          documentationId: row.documentationId!,
          evidencePackageId: row.evidencePackageId,
          packageVersion: row.packageVersion,
          serviceSummary: row.serviceSummary,
          caregiverSummary: row.caregiverSummary,
          clientId: row.clientId!,
          clientName: row.clientName!,
          plannedStart:
            row.plannedStart instanceof Date
              ? row.plannedStart.toISOString()
              : new Date(row.plannedStart!).toISOString(),
          timezone: row.timezone!,
          status: row.status as
            | 'awaiting_acknowledgement'
            | 'acknowledged'
            | 'declined'
            | 'revoked'
            | 'outdated'
            | 'superseded',
          snapshotHash: row.snapshotHash,
          signatoryType: row.signatoryType as
            | 'client'
            | 'representative'
            | 'other_authorized_person'
            | null,
          signatoryName: row.signatoryName,
          capacity: row.capacity as
            | 'client'
            | 'legal_guardian'
            | 'authorized_representative'
            | 'relative'
            | 'other'
            | null,
          method: row.method,
          acknowledgedAt: row.acknowledgedAt
            ? row.acknowledgedAt instanceof Date
              ? row.acknowledgedAt.toISOString()
              : new Date(row.acknowledgedAt).toISOString()
            : null,
          signatureAvailable: row.signatureAvailable ?? false,
        })),
    };
  }
}
