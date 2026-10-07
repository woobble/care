import { and, asc, count, eq, gt, inArray, lt, not, or, desc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { clientRecords } from '@care/clients';
import { employeeRecords } from '@care/employees';
import { facilities, organizationsTable } from '@care/organizations';
import { auditEntries } from '@care/audit';
import {
  employeeUnavailability,
  scheduleGenerations,
  visitAssignments,
  visitServices,
  visits,
} from '../schema';
import type { VisitAssignmentSnapshot, VisitData, VisitServiceData } from '../domain/visit';

export interface VisitReadScope {
  schedule: {
    tenantWide: boolean;
    organizationIds: readonly string[];
    facilityIds: readonly string[];
    teamIds: readonly string[];
  };
  client: {
    tenantWide: boolean;
    organizationIds: readonly string[];
    facilityIds: readonly string[];
  };
}

export interface VisitSearchFilter {
  tenantId: string;
  from: Date;
  until: Date;
  scope: VisitReadScope;
  clientId?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  status?: 'planned' | 'confirmed' | 'cancelled';
  serviceDefinitionId?: string;
  unassigned?: boolean;
  origin?: 'agreement_generated' | 'manual';
  visitId?: string;
  page: number;
  pageSize: number;
  sortBy: 'plannedStart' | 'clientName' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

export interface VisitCalendarRow extends VisitData {
  clientDisplayName: string;
  organizationName: string;
  facilityName: string;
  services: VisitServiceData[];
  assignments: Array<VisitAssignmentSnapshot & { employeeDisplayName: string }>;
}

export interface VisitSearchResult {
  items: VisitCalendarRow[];
  total: number;
}

export class SchedulingRepository {
  async insertVisit(transaction: DatabaseTransaction, visit: VisitData): Promise<void> {
    await transaction.insert(visits).values(visit);
  }

  async updateVisit(transaction: DatabaseTransaction, visit: VisitData): Promise<void> {
    await transaction
      .update(visits)
      .set({
        status: visit.status,
        plannedStart: visit.plannedStart,
        plannedEnd: visit.plannedEnd,
        timeWindowStart: visit.timeWindowStart,
        timeWindowEnd: visit.timeWindowEnd,
        timezone: visit.timezone,
        note: visit.note,
        manuallyAdjusted: visit.manuallyAdjusted,
        updatedAt: visit.updatedAt,
      })
      .where(and(eq(visits.tenantId, visit.tenantId), eq(visits.id, visit.id)));
  }

  async insertService(transaction: DatabaseTransaction, service: VisitServiceData): Promise<void> {
    await transaction.insert(visitServices).values(service);
  }

  async insertAssignment(
    transaction: DatabaseTransaction,
    assignment: VisitAssignmentSnapshot,
  ): Promise<void> {
    await transaction.insert(visitAssignments).values(assignment);
  }

  async unassign(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    assignmentId: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(visitAssignments)
      .set({ status: 'unassigned', unassignedAt: now })
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.id, assignmentId),
          eq(visitAssignments.status, 'active'),
        ),
      );
  }

  async get(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<VisitData | null> {
    const query = transaction
      .select()
      .from(visits)
      .where(and(eq(visits.tenantId, tenantId), eq(visits.id, id)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? ({ ...row } as VisitData) : null;
  }

  async servicesForVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<VisitServiceData[]> {
    const rows = await transaction
      .select()
      .from(visitServices)
      .where(and(eq(visitServices.tenantId, tenantId), eq(visitServices.visitId, visitId)))
      .orderBy(asc(visitServices.createdAt), asc(visitServices.id));
    return rows.map((row) => ({ ...row }) as VisitServiceData);
  }

  async activeEmployeeIds(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<string[]> {
    const rows = await transaction
      .select({ employeeId: visitAssignments.employeeId })
      .from(visitAssignments)
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.status, 'active'),
        ),
      )
      .orderBy(asc(visitAssignments.employeeId));
    return rows.map((row) => row.employeeId);
  }

  async hasGenerationKey(
    transaction: DatabaseTransaction,
    tenantId: string,
    generationKey: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitServices.id })
      .from(visitServices)
      .where(
        and(eq(visitServices.tenantId, tenantId), eq(visitServices.generationKey, generationKey)),
      )
      .limit(1);
    return row !== undefined;
  }

  async existingGenerationKeys(
    transaction: DatabaseTransaction,
    tenantId: string,
    generationKeys: readonly string[],
  ): Promise<Set<string>> {
    if (generationKeys.length === 0) return new Set();
    const rows = await transaction
      .select({ generationKey: visitServices.generationKey })
      .from(visitServices)
      .where(
        and(
          eq(visitServices.tenantId, tenantId),
          inArray(visitServices.generationKey, [...generationKeys]),
        ),
      );
    return new Set(rows.flatMap((row) => (row.generationKey ? [row.generationKey] : [])));
  }

  async saveGeneration(
    transaction: DatabaseTransaction,
    input: typeof scheduleGenerations.$inferInsert,
  ): Promise<void> {
    await transaction.insert(scheduleGenerations).values(input);
  }

  async list(
    transaction: DatabaseTransaction,
    filter: VisitSearchFilter,
  ): Promise<VisitSearchResult> {
    const where = this.where(filter);
    const order = filter.sortOrder === 'asc' ? asc : desc;
    const sort =
      filter.sortBy === 'clientName'
        ? [
            order(clientRecords.lastName),
            order(clientRecords.firstName),
            asc(visits.plannedStart),
            asc(visits.id),
          ]
        : filter.sortBy === 'createdAt'
          ? [order(visits.createdAt), asc(visits.id)]
          : [order(visits.plannedStart), asc(visits.id)];
    const rows = await transaction
      .select({
        visit: visits,
        firstName: clientRecords.firstName,
        preferredName: clientRecords.preferredName,
        lastName: clientRecords.lastName,
        organizationName: organizationsTable.name,
        facilityName: facilities.name,
      })
      .from(visits)
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .innerJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, visits.tenantId),
          eq(organizationsTable.id, visits.organizationId),
        ),
      )
      .innerJoin(
        facilities,
        and(eq(facilities.tenantId, visits.tenantId), eq(facilities.id, visits.facilityId)),
      )
      .where(where)
      .orderBy(...sort)
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    const [totalRow] = await transaction
      .select({ total: count() })
      .from(visits)
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .where(where);
    const visitIds = rows.map((row) => row.visit.id);
    const services = visitIds.length
      ? await this.servicesForVisits(transaction, filter.tenantId, visitIds)
      : [];
    const assignments = visitIds.length
      ? await this.assignmentsForVisits(transaction, filter.tenantId, visitIds)
      : [];
    const byVisitServices = groupBy(services, (service) => service.visitId);
    const byVisitAssignments = groupBy(assignments, (assignment) => assignment.visitId);
    return {
      items: rows.map((row) => ({
        ...(row.visit as VisitData),
        clientDisplayName: `${row.preferredName || row.firstName} ${row.lastName}`,
        organizationName: row.organizationName,
        facilityName: row.facilityName,
        services: byVisitServices.get(row.visit.id) ?? [],
        assignments: byVisitAssignments.get(row.visit.id) ?? [],
      })),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async getCalendarEntry(
    transaction: DatabaseTransaction,
    filter: VisitSearchFilter,
    visitId: string,
  ): Promise<VisitCalendarRow | null> {
    const result = await this.list(transaction, {
      ...filter,
      page: 1,
      pageSize: 1,
      visitId,
    });
    const row = result.items[0];
    return row ?? null;
  }

  async findClientConflict(
    transaction: DatabaseTransaction,
    input: {
      tenantId: string;
      clientId: string;
      plannedStart: Date;
      plannedEnd: Date;
      excludeVisitId?: string;
    },
  ): Promise<VisitData | null> {
    const filters = [
      eq(visits.tenantId, input.tenantId),
      eq(visits.clientId, input.clientId),
      inArray(visits.status, ['planned', 'confirmed'] as const),
      lt(visits.plannedStart, input.plannedEnd),
      gt(visits.plannedEnd, input.plannedStart),
    ];
    if (input.excludeVisitId) filters.push(not(eq(visits.id, input.excludeVisitId)));
    const [row] = await transaction
      .select()
      .from(visits)
      .where(and(...filters))
      .limit(1);
    return row ? ({ ...row } as VisitData) : null;
  }

  async findEmployeeConflict(
    transaction: DatabaseTransaction,
    input: {
      tenantId: string;
      employeeId: string;
      plannedStart: Date;
      plannedEnd: Date;
      excludeVisitId?: string;
    },
  ): Promise<{ visit: VisitData; clientDisplayName: string } | null> {
    const filters = [
      eq(visitAssignments.tenantId, input.tenantId),
      eq(visitAssignments.employeeId, input.employeeId),
      eq(visitAssignments.status, 'active'),
      inArray(visits.status, ['planned', 'confirmed'] as const),
      lt(visits.plannedStart, input.plannedEnd),
      gt(visits.plannedEnd, input.plannedStart),
    ];
    if (input.excludeVisitId) filters.push(not(eq(visits.id, input.excludeVisitId)));
    const [row] = await transaction
      .select({
        visit: visits,
        firstName: clientRecords.firstName,
        preferredName: clientRecords.preferredName,
        lastName: clientRecords.lastName,
      })
      .from(visitAssignments)
      .innerJoin(
        visits,
        and(
          eq(visits.tenantId, visitAssignments.tenantId),
          eq(visits.id, visitAssignments.visitId),
        ),
      )
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .where(and(...filters))
      .limit(1);
    if (!row) return null;
    return {
      visit: row.visit as VisitData,
      clientDisplayName: `${row.preferredName || row.firstName} ${row.lastName}`,
    };
  }

  async isEmployeeUnavailable(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: employeeUnavailability.id })
      .from(employeeUnavailability)
      .where(
        and(
          eq(employeeUnavailability.tenantId, tenantId),
          eq(employeeUnavailability.employeeId, employeeId),
          lt(employeeUnavailability.startsAt, endsAt),
          gt(employeeUnavailability.endsAt, startsAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async listUnavailability(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    from: Date,
    until: Date,
  ) {
    return transaction
      .select()
      .from(employeeUnavailability)
      .where(
        and(
          eq(employeeUnavailability.tenantId, tenantId),
          eq(employeeUnavailability.employeeId, employeeId),
          lt(employeeUnavailability.startsAt, until),
          gt(employeeUnavailability.endsAt, from),
        ),
      )
      .orderBy(asc(employeeUnavailability.startsAt), asc(employeeUnavailability.id));
  }

  async insertUnavailability(
    transaction: DatabaseTransaction,
    input: typeof employeeUnavailability.$inferInsert,
  ): Promise<void> {
    await transaction.insert(employeeUnavailability).values(input);
  }

  async assignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    assignmentId: string,
  ): Promise<VisitAssignmentSnapshot | null> {
    const [row] = await transaction
      .select()
      .from(visitAssignments)
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.id, assignmentId),
        ),
      )
      .limit(1);
    return row ? ({ ...row } as VisitAssignmentSnapshot) : null;
  }

  async listAssignments(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    return transaction
      .select({
        assignment: visitAssignments,
        firstName: employeeRecords.firstName,
        preferredName: employeeRecords.preferredName,
        lastName: employeeRecords.lastName,
      })
      .from(visitAssignments)
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, visitAssignments.tenantId),
          eq(employeeRecords.id, visitAssignments.employeeId),
        ),
      )
      .where(and(eq(visitAssignments.tenantId, tenantId), eq(visitAssignments.visitId, visitId)))
      .orderBy(asc(visitAssignments.assignedAt), asc(visitAssignments.id));
  }

  async history(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    const rows = await transaction
      .select({
        id: auditEntries.id,
        actorId: auditEntries.actorId,
        action: auditEntries.action,
        timestamp: auditEntries.timestamp,
      })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, tenantId),
          or(
            and(eq(auditEntries.resourceType, 'visit'), eq(auditEntries.resourceId, visitId)),
            and(
              inArray(auditEntries.action, [
                'visit_execution.started',
                'visit_execution.completed',
              ]),
              sql`${auditEntries.metadata}->>'visitId' = ${visitId}`,
            ),
          ),
        ),
      )
      .orderBy(asc(auditEntries.timestamp), asc(auditEntries.id));
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      timestamp: row.timestamp,
    }));
  }

  private async servicesForVisits(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ): Promise<VisitServiceData[]> {
    const rows = await transaction
      .select()
      .from(visitServices)
      .where(and(eq(visitServices.tenantId, tenantId), inArray(visitServices.visitId, visitIds)))
      .orderBy(asc(visitServices.createdAt), asc(visitServices.id));
    return rows.map((row) => ({ ...row }) as VisitServiceData);
  }

  private async assignmentsForVisits(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ) {
    const rows = await transaction
      .select({
        assignment: visitAssignments,
        firstName: employeeRecords.firstName,
        preferredName: employeeRecords.preferredName,
        lastName: employeeRecords.lastName,
      })
      .from(visitAssignments)
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, visitAssignments.tenantId),
          eq(employeeRecords.id, visitAssignments.employeeId),
        ),
      )
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          inArray(visitAssignments.visitId, visitIds),
          eq(visitAssignments.status, 'active'),
        ),
      )
      .orderBy(asc(employeeRecords.lastName), asc(employeeRecords.firstName));
    return rows.map((row) => ({
      ...(row.assignment as VisitAssignmentSnapshot),
      employeeDisplayName: `${row.preferredName || row.firstName} ${row.lastName}`,
    }));
  }

  private where(filter: VisitSearchFilter): SQL {
    const filters: SQL[] = [
      eq(visits.tenantId, filter.tenantId),
      gt(visits.plannedEnd, filter.from),
      lt(visits.plannedStart, filter.until),
      providerScope(filter.scope.client),
    ];
    if (filter.scope.schedule.tenantWide) {
      // Tenant schedule grants include every team and provider in the tenant.
    } else {
      const scheduleScopes: SQL[] = [];
      if (
        filter.scope.schedule.organizationIds.length ||
        filter.scope.schedule.facilityIds.length
      ) {
        scheduleScopes.push(providerScope(filter.scope.schedule));
      }
      if (filter.scope.schedule.teamIds.length) {
        scheduleScopes.push(teamAssignmentScope(filter.scope.schedule.teamIds));
      }
      if (scheduleScopes.length === 0) scheduleScopes.push(sql`false`);
      filters.push(or(...scheduleScopes)!);
    }
    if (filter.clientId) filters.push(eq(visits.clientId, filter.clientId));
    if (filter.organizationId) filters.push(eq(visits.organizationId, filter.organizationId));
    if (filter.facilityId) filters.push(eq(visits.facilityId, filter.facilityId));
    if (filter.status) filters.push(eq(visits.status, filter.status));
    if (filter.origin) filters.push(eq(visits.origin, filter.origin));
    if (filter.visitId) filters.push(eq(visits.id, filter.visitId));
    if (filter.employeeId) {
      filters.push(
        sql`exists (SELECT 1 FROM scheduling.visit_assignments va WHERE va.tenant_id = ${filter.tenantId} AND va.visit_id = ${visits.id} AND va.employee_id = ${filter.employeeId} AND va.status = 'active')`,
      );
    }
    if (filter.serviceDefinitionId) {
      filters.push(
        sql`exists (SELECT 1 FROM scheduling.visit_services vs WHERE vs.tenant_id = ${filter.tenantId} AND vs.visit_id = ${visits.id} AND vs.service_definition_id = ${filter.serviceDefinitionId})`,
      );
    }
    if (filter.unassigned === true) {
      filters.push(
        sql`not exists (SELECT 1 FROM scheduling.visit_assignments va WHERE va.tenant_id = ${filter.tenantId} AND va.visit_id = ${visits.id} AND va.status = 'active')`,
      );
    } else if (filter.unassigned === false) {
      filters.push(
        sql`exists (SELECT 1 FROM scheduling.visit_assignments va WHERE va.tenant_id = ${filter.tenantId} AND va.visit_id = ${visits.id} AND va.status = 'active')`,
      );
    }
    if (filter.teamId) filters.push(teamAssignmentScope([filter.teamId]));
    return and(...filters)!;
  }
}

function providerScope(scope: {
  tenantWide: boolean;
  organizationIds: readonly string[];
  facilityIds: readonly string[];
}): SQL {
  if (scope.tenantWide) return sql`true`;
  const clauses: SQL[] = [];
  if (scope.organizationIds.length)
    clauses.push(inArray(visits.organizationId, [...scope.organizationIds]));
  if (scope.facilityIds.length) clauses.push(inArray(visits.facilityId, [...scope.facilityIds]));
  if (clauses.length === 0) return sql`false`;
  return or(...clauses)!;
}

function teamAssignmentScope(teamIds: readonly string[]): SQL {
  if (teamIds.length === 0) return sql`false`;
  const teamIdList = sql.join(
    teamIds.map((teamId) => sql`${teamId}::uuid`),
    sql`, `,
  );
  return sql`exists (SELECT 1
      FROM scheduling.visit_assignments va
      INNER JOIN employees.employee_team_memberships etm
        ON etm.tenant_id = va.tenant_id AND etm.employee_id = va.employee_id
      INNER JOIN organizations.teams t
        ON t.tenant_id = etm.tenant_id AND t.id = etm.team_id
      WHERE va.tenant_id = ${visits.tenantId}
        AND va.visit_id = ${visits.id}
        AND va.status = 'active'
        AND etm.status = 'active'
        AND t.status = 'active'
        AND etm.team_id = ANY(ARRAY[${teamIdList}])
        AND (etm.valid_from IS NULL OR etm.valid_from <= (${visits.plannedStart} AT TIME ZONE ${visits.timezone})::date)
        AND (etm.valid_until IS NULL OR etm.valid_until >= (${visits.plannedStart} AT TIME ZONE ${visits.timezone})::date))`;
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const group = groups.get(key(value)) ?? [];
    group.push(value);
    groups.set(key(value), group);
  }
  return groups;
}
