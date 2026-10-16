import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lt, not, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { auditEntries } from '@care/audit';
import { clientRecords } from '@care/clients';
import type { DatabaseTransaction } from '@care/database';
import { employeeRecords } from '@care/employees';
import { facilities, organizationsTable } from '@care/organizations';
import type {
  AvailabilityException,
  AvailabilityWindow,
  EmployeeAvailability,
} from '@module/scheduling/domain/availability';
import type {
  VisitAssignmentSnapshot,
  VisitData,
  VisitServiceData,
} from '@module/scheduling/domain/visit';
import {
  employeeAvailability,
  employeeAvailabilityExceptions,
  employeeAvailabilityWindows,
  employeeUnavailability,
  clientRoutingLocations,
  clientSchedulingPreferences,
  employeeSchedulingPreferences,
  scheduleGenerations,
  tourPublications,
  tourStops,
  tours,
  visitSubstitutions,
  visitAssignments,
  visitServices,
  visits,
} from '@module/scheduling/schema';

// Preserve transaction connection order while rotating unique stop sequences and writing route estimates.
// oxlint-disable no-await-in-loop

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
  search?: string;
  unassigned?: boolean;
  origin?: 'agreement_generated' | 'manual';
  visitId?: string;
  relatedToVisitId?: string;
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

  async assignedVisitsForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    from: Date,
    until: Date,
    excludeVisitId?: string,
  ): Promise<VisitData[]> {
    const filters = [
      eq(visitAssignments.tenantId, tenantId),
      eq(visitAssignments.employeeId, employeeId),
      eq(visitAssignments.status, 'active'),
      inArray(visits.status, ['planned', 'confirmed'] as const),
      gt(visits.plannedEnd, from),
      lt(visits.plannedStart, until),
    ];
    if (excludeVisitId) filters.push(not(eq(visits.id, excludeVisitId)));
    const rows = await transaction
      .select({ visit: visits })
      .from(visitAssignments)
      .innerJoin(
        visits,
        and(
          eq(visits.tenantId, visitAssignments.tenantId),
          eq(visits.id, visitAssignments.visitId),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(visits.plannedStart), asc(visits.id));
    return rows.map((row) => row.visit as VisitData);
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
          eq(employeeUnavailability.status, 'active'),
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

  async cancelUnavailability(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    absenceId: string,
    updatedAt: Date,
    updatedBy: string,
  ): Promise<boolean> {
    const rows = await transaction
      .update(employeeUnavailability)
      .set({ status: 'cancelled', updatedAt, updatedBy })
      .where(
        and(
          eq(employeeUnavailability.tenantId, tenantId),
          eq(employeeUnavailability.employeeId, employeeId),
          eq(employeeUnavailability.id, absenceId),
          eq(employeeUnavailability.status, 'active'),
        ),
      )
      .returning({ id: employeeUnavailability.id });
    return rows.length > 0;
  }

  async availabilityForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<{ id: string; version: number; value: EmployeeAvailability } | null> {
    const [profile] = await transaction
      .select()
      .from(employeeAvailability)
      .where(
        and(
          eq(employeeAvailability.tenantId, tenantId),
          eq(employeeAvailability.employeeId, employeeId),
        ),
      )
      .limit(1);
    if (!profile) return null;

    const windows = await transaction
      .select()
      .from(employeeAvailabilityWindows)
      .where(
        and(
          eq(employeeAvailabilityWindows.tenantId, tenantId),
          eq(employeeAvailabilityWindows.availabilityId, profile.id),
        ),
      )
      .orderBy(asc(employeeAvailabilityWindows.weekday), asc(employeeAvailabilityWindows.startsAt));
    const exceptions = await transaction
      .select()
      .from(employeeAvailabilityExceptions)
      .where(
        and(
          eq(employeeAvailabilityExceptions.tenantId, tenantId),
          eq(employeeAvailabilityExceptions.employeeId, employeeId),
        ),
      )
      .orderBy(
        asc(employeeAvailabilityExceptions.localDate),
        asc(employeeAvailabilityExceptions.id),
      );
    return {
      id: profile.id,
      version: profile.version,
      value: {
        timezone: profile.timezone,
        maxDailyMinutes: profile.maxDailyMinutes,
        travelBufferMinutes: profile.travelBufferMinutes,
        windows: windows.map((window): AvailabilityWindow => ({
          weekday: window.weekday,
          startsAt: window.startsAt.slice(0, 5),
          endsAt: window.endsAt.slice(0, 5),
        })),
        exceptions: exceptions.map((exception): AvailabilityException => ({
          id: exception.id,
          localDate: exception.localDate,
          kind: exception.kind,
          startsAt: exception.startsAt?.slice(0, 5) ?? null,
          endsAt: exception.endsAt?.slice(0, 5) ?? null,
        })),
      },
    };
  }

  async insertAvailabilityProfile(
    transaction: DatabaseTransaction,
    input: typeof employeeAvailability.$inferInsert,
  ): Promise<void> {
    await transaction.insert(employeeAvailability).values(input);
  }

  async updateAvailabilityProfile(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    expectedVersion: number,
    input: Pick<
      typeof employeeAvailability.$inferInsert,
      'timezone' | 'maxDailyMinutes' | 'travelBufferMinutes' | 'updatedAt'
    >,
  ): Promise<boolean> {
    const rows = await transaction
      .update(employeeAvailability)
      .set({ ...input, version: expectedVersion + 1 })
      .where(
        and(
          eq(employeeAvailability.tenantId, tenantId),
          eq(employeeAvailability.employeeId, employeeId),
          eq(employeeAvailability.version, expectedVersion),
        ),
      )
      .returning({ id: employeeAvailability.id });
    return rows.length > 0;
  }

  async replaceAvailabilityWindows(
    transaction: DatabaseTransaction,
    tenantId: string,
    availabilityId: string,
    windows: Array<typeof employeeAvailabilityWindows.$inferInsert>,
  ): Promise<void> {
    await transaction
      .delete(employeeAvailabilityWindows)
      .where(
        and(
          eq(employeeAvailabilityWindows.tenantId, tenantId),
          eq(employeeAvailabilityWindows.availabilityId, availabilityId),
        ),
      );
    if (windows.length > 0) await transaction.insert(employeeAvailabilityWindows).values(windows);
  }

  async insertAvailabilityException(
    transaction: DatabaseTransaction,
    input: typeof employeeAvailabilityExceptions.$inferInsert,
  ): Promise<void> {
    await transaction.insert(employeeAvailabilityExceptions).values(input);
  }

  async deleteAvailabilityException(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    exceptionId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .delete(employeeAvailabilityExceptions)
      .where(
        and(
          eq(employeeAvailabilityExceptions.tenantId, tenantId),
          eq(employeeAvailabilityExceptions.employeeId, employeeId),
          eq(employeeAvailabilityExceptions.id, exceptionId),
        ),
      )
      .returning({ id: employeeAvailabilityExceptions.id });
    return rows.length > 0;
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

  async insertTour(
    transaction: DatabaseTransaction,
    input: typeof tours.$inferInsert,
  ): Promise<void> {
    await transaction.insert(tours).values(input);
  }

  async getTour(transaction: DatabaseTransaction, tenantId: string, tourId: string, lock = false) {
    const query = transaction
      .select()
      .from(tours)
      .where(and(eq(tours.tenantId, tenantId), eq(tours.id, tourId)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ?? null;
  }

  async getTourForEmployeeDate(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    localDate: string,
  ) {
    const [row] = await transaction
      .select()
      .from(tours)
      .where(
        and(
          eq(tours.tenantId, tenantId),
          eq(tours.employeeId, employeeId),
          eq(tours.localDate, localDate),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listTours(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    from: string,
    until: string,
  ) {
    return transaction
      .select()
      .from(tours)
      .where(
        and(
          eq(tours.tenantId, tenantId),
          eq(tours.employeeId, employeeId),
          gte(tours.localDate, from),
          lt(tours.localDate, until),
        ),
      )
      .orderBy(asc(tours.localDate), asc(tours.id))
      .limit(100);
  }

  async tourStops(transaction: DatabaseTransaction, tenantId: string, tourId: string) {
    return transaction
      .select({
        stop: tourStops,
        visit: visits,
        latitude: clientRoutingLocations.latitude,
        longitude: clientRoutingLocations.longitude,
      })
      .from(tourStops)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, tourStops.tenantId), eq(visits.id, tourStops.visitId)),
      )
      .leftJoin(
        clientRoutingLocations,
        and(
          eq(clientRoutingLocations.tenantId, visits.tenantId),
          eq(clientRoutingLocations.clientId, visits.clientId),
        ),
      )
      .where(and(eq(tourStops.tenantId, tenantId), eq(tourStops.tourId, tourId)))
      .orderBy(asc(tourStops.sequence), asc(tourStops.id));
  }

  async insertTourStops(
    transaction: DatabaseTransaction,
    stopRows: Array<typeof tourStops.$inferInsert>,
  ): Promise<void> {
    if (stopRows.length > 0) await transaction.insert(tourStops).values(stopRows);
  }

  async replaceTourStops(
    transaction: DatabaseTransaction,
    tenantId: string,
    tourId: string,
    stopRows: Array<{ visitId: string; sequence: number; dispatcherNote: string | null }>,
  ): Promise<void> {
    const existing = await transaction
      .select()
      .from(tourStops)
      .where(and(eq(tourStops.tenantId, tenantId), eq(tourStops.tourId, tourId)));
    if (existing.length > 0) {
      await transaction
        .update(tourStops)
        .set({ sequence: sql`${tourStops.sequence} + 1000` })
        .where(and(eq(tourStops.tenantId, tenantId), eq(tourStops.tourId, tourId)));
    }
    const existingByVisit = new Map(existing.map((stop) => [stop.visitId, stop]));
    const desired = new Set(stopRows.map((stop) => stop.visitId));
    for (const stop of stopRows) {
      const prior = existingByVisit.get(stop.visitId);
      if (prior) {
        await transaction
          .update(tourStops)
          .set({
            sequence: stop.sequence,
            dispatcherNote: stop.dispatcherNote,
            estimatedTravelMinutes: null,
            estimatedDistanceMeters: null,
            routeStatus: 'unknown',
          })
          .where(and(eq(tourStops.tenantId, tenantId), eq(tourStops.id, prior.id)));
      } else {
        await transaction.insert(tourStops).values({
          id: uuidv7(),
          tenantId,
          tourId,
          visitId: stop.visitId,
          sequence: stop.sequence,
          dispatcherNote: stop.dispatcherNote,
          estimatedTravelMinutes: null,
          estimatedDistanceMeters: null,
          routeStatus: 'unknown',
        });
      }
    }
    const removed = existing.filter((stop) => !desired.has(stop.visitId)).map((stop) => stop.id);
    if (removed.length > 0) {
      await transaction
        .delete(tourStops)
        .where(and(eq(tourStops.tenantId, tenantId), inArray(tourStops.id, removed)));
    }
  }

  async updateTourVersion(
    transaction: DatabaseTransaction,
    tenantId: string,
    tourId: string,
    expectedVersion: number,
    updatedAt: Date,
    updatedBy: string,
    status?: 'draft' | 'published',
  ): Promise<boolean> {
    const rows = await transaction
      .update(tours)
      .set({
        version: expectedVersion + 1,
        updatedAt,
        updatedBy,
        ...(status ? { status } : {}),
      })
      .where(
        and(eq(tours.tenantId, tenantId), eq(tours.id, tourId), eq(tours.version, expectedVersion)),
      )
      .returning({ id: tours.id });
    return rows.length > 0;
  }

  async updateTourStopEstimates(
    transaction: DatabaseTransaction,
    tenantId: string,
    tourId: string,
    legs: Array<{
      toVisitId: string;
      travelMinutes: number;
      distanceMeters: number;
      routeStatus: 'available' | 'unavailable' | 'unresolved';
    }>,
    routeStatus: 'unknown' | 'available' | 'unavailable' | 'unresolved',
  ): Promise<void> {
    const estimatedStatus = routeStatus === 'available' ? 'unknown' : routeStatus;
    await transaction
      .update(tourStops)
      .set({
        estimatedTravelMinutes: null,
        estimatedDistanceMeters: null,
        routeStatus: estimatedStatus,
      })
      .where(and(eq(tourStops.tenantId, tenantId), eq(tourStops.tourId, tourId)));
    for (const leg of legs) {
      await transaction
        .update(tourStops)
        .set({
          estimatedTravelMinutes: leg.travelMinutes,
          estimatedDistanceMeters: leg.distanceMeters,
          routeStatus: leg.routeStatus,
        })
        .where(
          and(
            eq(tourStops.tenantId, tenantId),
            eq(tourStops.tourId, tourId),
            eq(tourStops.visitId, leg.toVisitId),
          ),
        );
    }
  }

  async latestTourPublication(transaction: DatabaseTransaction, tenantId: string, tourId: string) {
    const [row] = await transaction
      .select()
      .from(tourPublications)
      .where(and(eq(tourPublications.tenantId, tenantId), eq(tourPublications.tourId, tourId)))
      .orderBy(desc(tourPublications.version))
      .limit(1);
    return row ?? null;
  }

  async tourPublicationsForTour(
    transaction: DatabaseTransaction,
    tenantId: string,
    tourId: string,
  ) {
    return transaction
      .select()
      .from(tourPublications)
      .where(and(eq(tourPublications.tenantId, tenantId), eq(tourPublications.tourId, tourId)))
      .orderBy(desc(tourPublications.version));
  }

  async toursForVisit(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    return transaction
      .select({ tour: tours })
      .from(tourStops)
      .innerJoin(tours, and(eq(tours.tenantId, tourStops.tenantId), eq(tours.id, tourStops.tourId)))
      .where(and(eq(tourStops.tenantId, tenantId), eq(tourStops.visitId, visitId)))
      .orderBy(asc(tours.id));
  }

  async listTourStopsForEmployeeDate(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    localDate: string,
  ) {
    return transaction
      .select({ stop: tourStops, tour: tours })
      .from(tourStops)
      .innerJoin(tours, and(eq(tours.tenantId, tourStops.tenantId), eq(tours.id, tourStops.tourId)))
      .where(
        and(
          eq(tourStops.tenantId, tenantId),
          eq(tours.employeeId, employeeId),
          eq(tours.localDate, localDate),
        ),
      )
      .orderBy(asc(tourStops.sequence), asc(tourStops.id));
  }

  async tourStopsForVisits(transaction: DatabaseTransaction, tenantId: string, visitIds: string[]) {
    if (visitIds.length === 0) return [];
    return transaction
      .select({ stop: tourStops, tour: tours })
      .from(tourStops)
      .innerJoin(tours, and(eq(tours.tenantId, tourStops.tenantId), eq(tours.id, tourStops.tourId)))
      .where(and(eq(tourStops.tenantId, tenantId), inArray(tourStops.visitId, visitIds)))
      .orderBy(asc(tours.localDate), asc(tours.employeeId), asc(tourStops.sequence));
  }

  async insertTourPublication(
    transaction: DatabaseTransaction,
    input: typeof tourPublications.$inferInsert,
  ): Promise<void> {
    await transaction.insert(tourPublications).values(input);
  }

  async insertVisitSubstitution(
    transaction: DatabaseTransaction,
    input: typeof visitSubstitutions.$inferInsert,
  ): Promise<void> {
    await transaction.insert(visitSubstitutions).values(input);
  }

  async getVisitSubstitution(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(visitSubstitutions)
      .where(and(eq(visitSubstitutions.tenantId, tenantId), eq(visitSubstitutions.id, id)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ?? null;
  }

  async activeProposedSubstitution(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ) {
    const [row] = await transaction
      .select()
      .from(visitSubstitutions)
      .where(
        and(
          eq(visitSubstitutions.tenantId, tenantId),
          eq(visitSubstitutions.visitId, visitId),
          eq(visitSubstitutions.status, 'proposed'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async proposedSubstitutionsForVisits(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ) {
    if (visitIds.length === 0) return [];
    return transaction
      .select()
      .from(visitSubstitutions)
      .where(
        and(
          eq(visitSubstitutions.tenantId, tenantId),
          inArray(visitSubstitutions.visitId, visitIds),
          eq(visitSubstitutions.status, 'proposed'),
        ),
      )
      .orderBy(asc(visitSubstitutions.createdAt), asc(visitSubstitutions.id));
  }

  async unavailabilityForEmployees(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeIds: string[],
    from: Date,
    until: Date,
  ) {
    if (employeeIds.length === 0) return [];
    return transaction
      .select()
      .from(employeeUnavailability)
      .where(
        and(
          eq(employeeUnavailability.tenantId, tenantId),
          inArray(employeeUnavailability.employeeId, employeeIds),
          eq(employeeUnavailability.status, 'active'),
          lt(employeeUnavailability.startsAt, until),
          gt(employeeUnavailability.endsAt, from),
        ),
      )
      .orderBy(asc(employeeUnavailability.startsAt), asc(employeeUnavailability.id));
  }

  async employeeByUser(transaction: DatabaseTransaction, tenantId: string, userId: string) {
    const [row] = await transaction
      .select()
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async activeEmployeesForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ) {
    return transaction
      .select()
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, tenantId),
          eq(employeeRecords.organizationId, organizationId),
          eq(employeeRecords.status, 'active'),
        ),
      )
      .orderBy(
        asc(employeeRecords.lastName),
        asc(employeeRecords.firstName),
        asc(employeeRecords.id),
      )
      .limit(100);
  }

  async employeePreferences(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ) {
    const [row] = await transaction
      .select()
      .from(employeeSchedulingPreferences)
      .where(
        and(
          eq(employeeSchedulingPreferences.tenantId, tenantId),
          eq(employeeSchedulingPreferences.employeeId, employeeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async clientPreferences(transaction: DatabaseTransaction, tenantId: string, clientId: string) {
    const [row] = await transaction
      .select()
      .from(clientSchedulingPreferences)
      .where(
        and(
          eq(clientSchedulingPreferences.tenantId, tenantId),
          eq(clientSchedulingPreferences.clientId, clientId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async employeePreferencesForEmployees(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeIds: string[],
  ) {
    if (employeeIds.length === 0) return [];
    return transaction
      .select()
      .from(employeeSchedulingPreferences)
      .where(
        and(
          eq(employeeSchedulingPreferences.tenantId, tenantId),
          inArray(employeeSchedulingPreferences.employeeId, employeeIds),
        ),
      );
  }

  async clientPreferencesForClients(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientIds: string[],
  ) {
    if (clientIds.length === 0) return [];
    return transaction
      .select()
      .from(clientSchedulingPreferences)
      .where(
        and(
          eq(clientSchedulingPreferences.tenantId, tenantId),
          inArray(clientSchedulingPreferences.clientId, clientIds),
        ),
      );
  }

  async updateVisitSubstitution(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: 'confirmed' | 'cancelled',
    resolvedAt: Date,
    resolvedBy: string,
  ): Promise<boolean> {
    const rows = await transaction
      .update(visitSubstitutions)
      .set({ status, resolvedAt, resolvedBy })
      .where(
        and(
          eq(visitSubstitutions.tenantId, tenantId),
          eq(visitSubstitutions.id, id),
          eq(visitSubstitutions.status, 'proposed'),
        ),
      )
      .returning({ id: visitSubstitutions.id });
    return rows.length > 0;
  }

  async upsertClientRoutingLocation(
    transaction: DatabaseTransaction,
    input: typeof clientRoutingLocations.$inferInsert,
  ): Promise<void> {
    await transaction
      .insert(clientRoutingLocations)
      .values(input)
      .onConflictDoUpdate({
        target: [clientRoutingLocations.tenantId, clientRoutingLocations.clientId],
        set: {
          latitude: input.latitude,
          longitude: input.longitude,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
  }

  async clientRoutingLocation(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ) {
    const [row] = await transaction
      .select({
        latitude: clientRoutingLocations.latitude,
        longitude: clientRoutingLocations.longitude,
      })
      .from(clientRoutingLocations)
      .where(
        and(
          eq(clientRoutingLocations.tenantId, tenantId),
          eq(clientRoutingLocations.clientId, clientId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async upsertEmployeeSchedulingPreferences(
    transaction: DatabaseTransaction,
    input: typeof employeeSchedulingPreferences.$inferInsert,
  ): Promise<void> {
    await transaction
      .insert(employeeSchedulingPreferences)
      .values(input)
      .onConflictDoUpdate({
        target: [employeeSchedulingPreferences.tenantId, employeeSchedulingPreferences.employeeId],
        set: {
          preferredWeekdays: input.preferredWeekdays,
          preferredTimeWindows: input.preferredTimeWindows,
          preferredStartLatitude: input.preferredStartLatitude,
          preferredStartLongitude: input.preferredStartLongitude,
          travelMode: input.travelMode,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
  }

  async upsertClientSchedulingPreferences(
    transaction: DatabaseTransaction,
    input: typeof clientSchedulingPreferences.$inferInsert,
  ): Promise<void> {
    await transaction
      .insert(clientSchedulingPreferences)
      .values(input)
      .onConflictDoUpdate({
        target: [clientSchedulingPreferences.tenantId, clientSchedulingPreferences.clientId],
        set: {
          preferredWeekdays: input.preferredWeekdays,
          preferredTimeWindows: input.preferredTimeWindows,
          preferredEmployeeId: input.preferredEmployeeId,
          avoidedEmployeeIds: input.avoidedEmployeeIds,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
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
    if (filter.relatedToVisitId) {
      filters.push(sql`(
        ${visits.id} = ${filter.relatedToVisitId}
        OR ${visits.clientId} = (
          SELECT target.client_id
          FROM scheduling.visits AS target
          WHERE target.tenant_id = ${filter.tenantId}
            AND target.id = ${filter.relatedToVisitId}
        )
        OR EXISTS (
          SELECT 1
          FROM scheduling.visit_assignments AS target_assignment
          INNER JOIN scheduling.visit_assignments AS related_assignment
            ON related_assignment.tenant_id = target_assignment.tenant_id
           AND related_assignment.employee_id = target_assignment.employee_id
           AND related_assignment.status = 'active'
          WHERE target_assignment.tenant_id = ${filter.tenantId}
            AND target_assignment.visit_id = ${filter.relatedToVisitId}
            AND target_assignment.status = 'active'
            AND related_assignment.visit_id = ${visits.id}
        )
      )`);
    }
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
    if (filter.search) {
      const terms = filter.search.trim().split(/\s+/).filter(Boolean).slice(0, 8);
      for (const term of terms) {
        const pattern = `%${term}%`;
        filters.push(
          or(
            ilike(clientRecords.firstName, pattern),
            ilike(clientRecords.preferredName, pattern),
            ilike(clientRecords.lastName, pattern),
            ilike(visits.note, pattern),
            sql`exists (
              select 1
              from scheduling.visit_services search_service
              where search_service.tenant_id = ${filter.tenantId}
                and search_service.visit_id = ${visits.id}
                and (
                  search_service.service_code_snapshot ilike ${pattern}
                  or search_service.service_name_snapshot ilike ${pattern}
                )
            )`,
            sql`exists (
              select 1
              from scheduling.visit_assignments search_assignment
              inner join employees.employees search_employee
                on search_employee.tenant_id = search_assignment.tenant_id
               and search_employee.id = search_assignment.employee_id
              where search_assignment.tenant_id = ${filter.tenantId}
                and search_assignment.visit_id = ${visits.id}
                and search_assignment.status = 'active'
                and (
                  search_employee.first_name ilike ${pattern}
                  or search_employee.preferred_name ilike ${pattern}
                  or search_employee.last_name ilike ${pattern}
                )
            )`,
          )!,
        );
      }
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
