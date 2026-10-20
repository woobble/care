import { v7 as uuidv7 } from 'uuid';

import type { ClientApplicationService } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';

import { createDomainEvent } from '@care/events';

import { isSupportedTimeZone } from '@care/organizations';
import { assertCan, type AuthorizationPrincipal } from '@care/permissions';

import type {
  RouteEstimate,
  RouteOrderSuggestion,
  RouteProvider,
} from '@module/scheduling/domain/route-provider';
import {
  compareTourStops,
  InvalidTourError,
  sameTourDate,
  TourVersionConflictError,
  tourFeasibilityConflicts,
  type SchedulingConflict,
} from '@module/scheduling/domain/tour';
import type { VisitData } from '@module/scheduling/domain/visit';

import type { SchedulingRepository } from '@module/scheduling/infrastructure/scheduling.repository';

import { isPublishedStop } from './publication-snapshot';

import type { CreateTourInput, UpdateTourStopsInput, TourSummary } from './tour.contracts';
import {
  VisitOutsideProviderContextError,
  ActiveVisitSubstitutionError,
  TourNotFoundError,
  SchedulingConflictsError,
} from './planning.errors';
import { validLocalDate, dayDistance } from './planning-time';
import type { SchedulingPlanningGuards } from './planning-guards';
import type { SchedulingEventWriter } from './scheduling-events';

// Each awaited statement uses the same transaction connection; preserve lock and validation ordering.
// oxlint-disable no-await-in-loop

type AuditContext = { ip?: string; userAgent?: string };

/** Internal Office tour orchestration. Public callers use SchedulingApplicationService. */
export class SchedulingToursApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: Pick<ClientApplicationService, 'getForServiceAgreement'>,
    private readonly repository: Pick<
      SchedulingRepository,
      | 'activeEmployeeIds'
      | 'activeProposedSubstitution'
      | 'employeePreferences'
      | 'getTour'
      | 'insertTour'
      | 'insertTourPublication'
      | 'insertTourStops'
      | 'latestTourPublication'
      | 'listTours'
      | 'replaceTourStops'
      | 'tourStops'
      | 'updateTourStopEstimates'
      | 'updateTourVersion'
    >,
    private readonly planning: Pick<
      SchedulingPlanningGuards,
      | 'employeeSchedulingResource'
      | 'requireVisitForMutation'
      | 'ensurePlanningMutable'
      | 'ensureEmployeeAvailable'
      | 'lockResources'
    >,
    private readonly events: Pick<SchedulingEventWriter, 'record'>,
    private readonly routeProvider: RouteProvider,
  ) {}

  async createTour(
    principal: AuthorizationPrincipal,
    input: CreateTourInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<TourSummary> {
    validateTourRequest(input.localDate, input.timezone, input.visitIds);
    const tourId = uuidv7();
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.planning.employeeSchedulingResource(
        transaction,
        principal,
        input.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.planning.lockResources(transaction, principal.tenantId, [
        `employee:${employee.id}`,
        ...input.visitIds.map((visitId) => `visit:${visitId}`),
      ]);
      const visitsForTour = [] as VisitData[];
      for (const visitId of input.visitIds) {
        const visit = await this.planning.requireVisitForMutation(
          transaction,
          principal,
          visitId,
          'schedule.update',
          true,
        );
        if (visit.status === 'cancelled' || !sameTourDate(visit, input.localDate, input.timezone)) {
          throw new InvalidTourError();
        }
        const employeeIds = await this.repository.activeEmployeeIds(
          transaction,
          principal.tenantId,
          visit.id,
        );
        if (!employeeIds.includes(employee.id)) throw new InvalidTourError();
        if (visitsForTour[0] && visitsForTour[0].organizationId !== visit.organizationId) {
          throw new InvalidTourError();
        }
        await this.planning.ensurePlanningMutable(transaction, visit);
        await this.planning.ensureEmployeeAvailable(
          transaction,
          principal.tenantId,
          employee.id,
          visit,
          visit.id,
        );
        visitsForTour.push(visit);
      }
      const now = new Date();
      const tour = {
        id: tourId,
        tenantId: principal.tenantId,
        employeeId: employee.id,
        organizationId: visitsForTour[0]!.organizationId,
        facilityId: null,
        localDate: input.localDate,
        timezone: input.timezone,
        status: 'draft' as const,
        version: 1,
        createdAt: now,
        createdBy: principal.userId,
        updatedAt: now,
        updatedBy: principal.userId,
      };
      await this.repository.insertTour(transaction, tour);
      await this.repository.insertTourStops(
        transaction,
        visitsForTour.sort(compareTourStops).map((visit, index) => ({
          id: uuidv7(),
          tenantId: principal.tenantId,
          tourId,
          visitId: visit.id,
          sequence: index + 1,
          estimatedTravelMinutes: null,
          estimatedDistanceMeters: null,
          routeStatus: 'unknown',
          dispatcherNote: null,
        })),
      );
      await this.recordTourChange(
        transaction,
        principal,
        context,
        auditContext,
        tour,
        'scheduling.tour_created',
        {
          employeeId: employee.id,
          localDate: tour.localDate,
          visitIds: visitsForTour.map((visit) => visit.id),
        },
        now,
      );
    });
    return this.getTour(principal, tourId);
  }

  async listTours(
    principal: AuthorizationPrincipal,
    employeeId: string,
    from: string,
    until: string,
  ) {
    if (
      !validLocalDate(from) ||
      !validLocalDate(until) ||
      until <= from ||
      dayDistance(from, until) > 31
    ) {
      throw new InvalidTourError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { resource } = await this.planning.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.read', resource });
      const rows = await this.repository.listTours(
        transaction,
        principal.tenantId,
        employeeId,
        from,
        until,
      );
      const summaries: Array<
        (typeof rows)[number] & {
          stopCount: number;
          latestPublishedVersion: number | null;
        }
      > = [];
      for (const tour of rows) {
        const publication = await this.repository.latestTourPublication(
          transaction,
          principal.tenantId,
          tour.id,
        );
        const stops = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        summaries.push({
          ...tour,
          stopCount: stops.length,
          latestPublishedVersion: publication?.version ?? null,
        });
      }
      return summaries;
    });
  }

  async getTour(principal: AuthorizationPrincipal, tourId: string): Promise<TourSummary> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const tour = await this.repository.getTour(transaction, principal.tenantId, tourId);
      if (!tour) throw new TourNotFoundError();
      const { resource } = await this.planning.employeeSchedulingResource(
        transaction,
        principal,
        tour.employeeId,
      );
      assertCan(principal, { action: 'schedule.read', resource });
      const stops = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
      for (const row of stops) {
        const client = await this.clients.getForServiceAgreement(
          transaction,
          principal,
          row.visit.clientId,
        );
        assertCan(principal, {
          action: 'schedule.read',
          resource: {
            tenantId: principal.tenantId,
            clientId: row.visit.clientId,
            organizationId: row.visit.organizationId,
            facilityId: row.visit.facilityId,
          },
        });
        if (
          client.organizationId !== row.visit.organizationId ||
          client.primaryFacilityId !== row.visit.facilityId
        ) {
          throw new VisitOutsideProviderContextError();
        }
      }
      const latestPublication = await this.repository.latestTourPublication(
        transaction,
        principal.tenantId,
        tour.id,
      );
      return {
        id: tour.id,
        employeeId: tour.employeeId,
        organizationId: tour.organizationId,
        localDate: tour.localDate,
        timezone: tour.timezone,
        status: tour.status,
        version: tour.version,
        stops: stops.map(({ stop, visit }) => ({
          id: stop.id,
          visitId: stop.visitId,
          sequence: stop.sequence,
          plannedStart: visit.plannedStart,
          plannedEnd: visit.plannedEnd,
          timezone: visit.timezone,
          estimatedTravelMinutes: stop.estimatedTravelMinutes,
          estimatedDistanceMeters: stop.estimatedDistanceMeters,
          routeStatus: stop.routeStatus,
          dispatcherNote: stop.dispatcherNote,
        })),
        latestPublication,
      };
    });
  }

  async updateTourStops(
    principal: AuthorizationPrincipal,
    tourId: string,
    input: UpdateTourStopsInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<TourSummary> {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.stops.length < 1 ||
      input.stops.length > 100 ||
      new Set(input.stops.map((stop) => stop.visitId)).size !== input.stops.length ||
      input.stops.some((stop) => (stop.dispatcherNote?.length ?? 0) > 500)
    ) {
      throw new InvalidTourError();
    }
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const tour = await this.repository.getTour(transaction, principal.tenantId, tourId, true);
      if (!tour) throw new TourNotFoundError();
      if (tour.version !== input.expectedVersion) throw new TourVersionConflictError();
      const { resource } = await this.planning.employeeSchedulingResource(
        transaction,
        principal,
        tour.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.planning.lockResources(transaction, principal.tenantId, [
        `employee:${tour.employeeId}`,
        ...input.stops.map((stop) => `visit:${stop.visitId}`),
      ]);
      const visitsForTour: VisitData[] = [];
      for (const item of input.stops) {
        const visit = await this.planning.requireVisitForMutation(
          transaction,
          principal,
          item.visitId,
          'schedule.update',
          true,
        );
        if (
          visit.status === 'cancelled' ||
          visit.organizationId !== tour.organizationId ||
          !sameTourDate(visit, tour.localDate, tour.timezone)
        ) {
          throw new InvalidTourError();
        }
        const employeeIds = await this.repository.activeEmployeeIds(
          transaction,
          principal.tenantId,
          visit.id,
        );
        if (!employeeIds.includes(tour.employeeId)) throw new InvalidTourError();
        await this.planning.ensurePlanningMutable(transaction, visit);
        visitsForTour.push(visit);
      }
      const now = new Date();
      await this.repository.replaceTourStops(
        transaction,
        principal.tenantId,
        tour.id,
        input.stops.map((stop, index) => ({
          visitId: stop.visitId,
          sequence: index + 1,
          dispatcherNote: stop.dispatcherNote?.trim() || null,
        })),
      );
      if (
        !(await this.repository.updateTourVersion(
          transaction,
          principal.tenantId,
          tour.id,
          input.expectedVersion,
          now,
          principal.userId,
          'draft',
        ))
      ) {
        throw new TourVersionConflictError();
      }
      await this.recordTourChange(
        transaction,
        principal,
        context,
        auditContext,
        tour,
        'scheduling.tour_reordered',
        {
          employeeId: tour.employeeId,
          localDate: tour.localDate,
          visitIds: input.stops.map((stop) => stop.visitId),
        },
        now,
      );
    });
    return this.getTour(principal, tourId);
  }

  async estimateTourRoute(
    principal: AuthorizationPrincipal,
    tourId: string,
    expectedVersion: number,
  ): Promise<{ tour: TourSummary; route: RouteEstimate; conflicts: SchedulingConflict[] }> {
    const routeStops = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId);
        if (!tour) throw new TourNotFoundError();
        if (tour.version !== expectedVersion) throw new TourVersionConflictError();
        const { resource } = await this.planning.employeeSchedulingResource(
          transaction,
          principal,
          tour.employeeId,
        );
        assertCan(principal, { action: 'schedule.update', resource });
        const rows = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        const preferences = await this.repository.employeePreferences(
          transaction,
          principal.tenantId,
          tour.employeeId,
        );
        return {
          stops: rows.map(({ stop, latitude, longitude }) => ({
            stopId: stop.id,
            visitId: stop.visitId,
            location:
              latitude === null || longitude === null
                ? null
                : { latitude: Number(latitude), longitude: Number(longitude) },
          })),
          startLocation:
            preferences?.preferredStartLatitude === null ||
            preferences?.preferredStartLongitude === null ||
            !preferences
              ? null
              : {
                  latitude: Number(preferences.preferredStartLatitude),
                  longitude: Number(preferences.preferredStartLongitude),
                },
        };
      },
    );
    const route = await this.routeProvider.estimate(
      routeStops.stops.map(({ visitId, location }) => ({ visitId, location })),
      routeStops.startLocation,
    );
    const result = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId, true);
        if (!tour) throw new TourNotFoundError();
        if (tour.version !== expectedVersion) throw new TourVersionConflictError();
        await this.repository.updateTourStopEstimates(
          transaction,
          principal.tenantId,
          tour.id,
          route.legs.map((leg) => ({
            toVisitId: leg.toVisitId,
            travelMinutes: Math.ceil(leg.durationSeconds / 60),
            distanceMeters: leg.distanceMeters,
            routeStatus: route.status,
          })),
          route.status,
        );
        const now = new Date();
        if (
          !(await this.repository.updateTourVersion(
            transaction,
            principal.tenantId,
            tour.id,
            expectedVersion,
            now,
            principal.userId,
            'draft',
          ))
        ) {
          throw new TourVersionConflictError();
        }
        const storedStops = await this.repository.tourStops(
          transaction,
          principal.tenantId,
          tour.id,
        );
        const conflicts = tourFeasibilityConflicts(
          storedStops.map((row) => row.visit as VisitData),
          storedStops.slice(1).map((row, index) => ({
            fromVisitId: storedStops[index]!.stop.visitId,
            toVisitId: row.stop.visitId,
            travelMinutes:
              row.stop.routeStatus === 'available' ? row.stop.estimatedTravelMinutes : null,
          })),
        );
        return { tour, conflicts };
      },
    );
    return {
      tour: await this.getTour(principal, tourId),
      route,
      conflicts: result.conflicts,
    };
  }

  async suggestTourOrder(
    principal: AuthorizationPrincipal,
    tourId: string,
  ): Promise<RouteOrderSuggestion & { conflicts: SchedulingConflict[] }> {
    const routeStops = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId);
        if (!tour) throw new TourNotFoundError();
        const { resource } = await this.planning.employeeSchedulingResource(
          transaction,
          principal,
          tour.employeeId,
        );
        assertCan(principal, { action: 'schedule.read', resource });
        const rows = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        const preferences = await this.repository.employeePreferences(
          transaction,
          principal.tenantId,
          tour.employeeId,
        );
        return {
          stops: rows.map(({ stop, visit, latitude, longitude }) => ({
            visitId: stop.visitId,
            visit,
            location:
              latitude === null || longitude === null
                ? null
                : { latitude: Number(latitude), longitude: Number(longitude) },
          })),
          startLocation:
            preferences?.preferredStartLatitude === null ||
            preferences?.preferredStartLongitude === null ||
            !preferences
              ? null
              : {
                  latitude: Number(preferences.preferredStartLatitude),
                  longitude: Number(preferences.preferredStartLongitude),
                },
        };
      },
    );
    const suggestion = await this.routeProvider.suggestOrder(
      routeStops.stops.map(({ visitId, location }) => ({ visitId, location })),
      routeStops.startLocation,
    );
    const reOrdered = suggestion.visitIds
      .map((visitId) => routeStops.stops.find((stop) => stop.visitId === visitId)!)
      .filter(Boolean);
    const estimate = await this.routeProvider.estimate(
      reOrdered.map(({ visitId, location }) => ({ visitId, location })),
      routeStops.startLocation,
    );
    const conflicts = tourFeasibilityConflicts(
      reOrdered.map(({ visit }) => visit),
      estimate.legs.map((leg) => ({
        fromVisitId: leg.fromVisitId,
        toVisitId: leg.toVisitId,
        travelMinutes: Math.ceil(leg.durationSeconds / 60),
      })),
    );
    if (estimate.status !== 'available' && reOrdered.length > 1) {
      conflicts.push({
        code: 'travel_feasibility_unknown',
        severity: 'warning',
        visitId: reOrdered[1]!.visitId,
        relatedVisitId: reOrdered[0]!.visitId,
      });
    }
    return { ...suggestion, conflicts };
  }

  async publishTour(
    principal: AuthorizationPrincipal,
    tourId: string,
    expectedVersion: number,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const published = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId, true);
        if (!tour) throw new TourNotFoundError();
        if (tour.version !== expectedVersion) throw new TourVersionConflictError();
        const { resource } = await this.planning.employeeSchedulingResource(
          transaction,
          principal,
          tour.employeeId,
        );
        assertCan(principal, { action: 'schedule.update', resource });
        const stopRows = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        if (stopRows.length === 0) throw new InvalidTourError();
        for (const row of stopRows) {
          const visit = await this.planning.requireVisitForMutation(
            transaction,
            principal,
            row.visit.id,
            'schedule.update',
            true,
          );
          if (visit.status === 'cancelled' || !sameTourDate(visit, tour.localDate, tour.timezone)) {
            throw new InvalidTourError();
          }
          const assignments = await this.repository.activeEmployeeIds(
            transaction,
            principal.tenantId,
            visit.id,
          );
          if (!assignments.includes(tour.employeeId)) throw new InvalidTourError();
          await this.planning.ensurePlanningMutable(transaction, visit);
          await this.planning.ensureEmployeeAvailable(
            transaction,
            principal.tenantId,
            tour.employeeId,
            visit,
            visit.id,
          );
          if (
            await this.repository.activeProposedSubstitution(
              transaction,
              principal.tenantId,
              visit.id,
            )
          ) {
            throw new ActiveVisitSubstitutionError();
          }
        }
        const routeConflicts = tourFeasibilityConflicts(
          stopRows.map(({ visit }) => visit as VisitData),
          stopRows.slice(1).map((row, index) => ({
            fromVisitId: stopRows[index]!.stop.visitId,
            toVisitId: row.stop.visitId,
            travelMinutes:
              row.stop.routeStatus === 'available' ? row.stop.estimatedTravelMinutes : null,
          })),
        );
        const blocking = routeConflicts.filter((conflict) => conflict.severity === 'blocking');
        if (blocking.length) throw new SchedulingConflictsError(blocking);
        const now = new Date();
        const prior = await this.repository.latestTourPublication(
          transaction,
          principal.tenantId,
          tour.id,
        );
        const snapshot = stopRows.map(({ stop, visit }) => ({
          visitId: stop.visitId,
          sequence: stop.sequence,
          plannedStart: visit.plannedStart.toISOString(),
          plannedEnd: visit.plannedEnd.toISOString(),
          timezone: visit.timezone,
          employeeId: tour.employeeId,
          estimatedTravelMinutes: stop.estimatedTravelMinutes,
          estimatedDistanceMeters: stop.estimatedDistanceMeters,
          routeStatus: stop.routeStatus,
        }));
        const changes = publicationChanges(prior?.snapshot, snapshot);
        const publicationVersion = (prior?.version ?? 0) + 1;
        await this.repository.insertTourPublication(transaction, {
          id: uuidv7(),
          tenantId: principal.tenantId,
          tourId: tour.id,
          version: publicationVersion,
          employeeId: tour.employeeId,
          snapshot,
          changeSummary: changes,
          publishedAt: now,
          publishedBy: principal.userId,
        });
        if (
          !(await this.repository.updateTourVersion(
            transaction,
            principal.tenantId,
            tour.id,
            expectedVersion,
            now,
            principal.userId,
            'published',
          ))
        ) {
          throw new TourVersionConflictError();
        }
        const event = createDomainEvent({
          type: 'scheduling.tour_published',
          tenantId: principal.tenantId,
          aggregateType: 'tour',
          aggregateId: tour.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          occurredAt: now.toISOString(),
          payload: {
            tourId: tour.id,
            employeeId: tour.employeeId,
            localDate: tour.localDate,
            version: publicationVersion,
            visitIds: snapshot.map((stop) => stop.visitId),
          },
        });
        await this.events.record(transaction, principal, context, auditContext, {
          event,
          action: 'scheduling.tour_published',
          resourceType: 'tour',
          resourceId: tour.id,
          metadata: {
            employeeId: tour.employeeId,
            localDate: tour.localDate,
            version: publicationVersion,
            changes,
          },
        });
        return {
          tourId: tour.id,
          employeeId: tour.employeeId,
          localDate: tour.localDate,
          version: publicationVersion,
          changes,
        };
      },
    );
    return { ...published, tour: await this.getTour(principal, tourId) };
  }

  private async recordTourChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    tour: { id: string; employeeId: string; localDate: string; version: number },
    operation: 'scheduling.tour_created' | 'scheduling.tour_reordered',
    metadata: { employeeId: string; localDate: string; visitIds: string[] },
    now: Date,
  ): Promise<void> {
    const event = createDomainEvent({
      type: operation,
      tenantId: principal.tenantId,
      aggregateType: 'tour',
      aggregateId: tour.id,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      occurredAt: now.toISOString(),
      payload: { tourId: tour.id, ...metadata, version: tour.version },
    });
    await this.events.record(transaction, principal, context, auditContext, {
      event,
      action: operation,
      resourceType: 'tour',
      resourceId: tour.id,
      metadata,
    });
  }
}

function validateTourRequest(localDate: string, timezone: string, visitIds: string[]): void {
  if (
    !validLocalDate(localDate) ||
    !isSupportedTimeZone(timezone) ||
    visitIds.length < 1 ||
    visitIds.length > 100 ||
    new Set(visitIds).size !== visitIds.length
  ) {
    throw new InvalidTourError();
  }
}

function publicationChanges(
  previous: unknown,
  current: Array<{ visitId: string; sequence: number; plannedStart: string; plannedEnd: string }>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(previous)) return [{ type: 'initial' }];
  const oldStops = previous.filter(isPublishedStop);
  const oldIds = oldStops.map((stop) => stop.visitId);
  const newIds = current.map((stop) => stop.visitId);
  const changes: Array<Record<string, unknown>> = [];
  for (const visitId of newIds.filter((id) => !oldIds.includes(id)))
    changes.push({ type: 'visit_added', visitId });
  for (const visitId of oldIds.filter((id) => !newIds.includes(id)))
    changes.push({ type: 'visit_removed', visitId });
  if (oldIds.length === newIds.length && oldIds.some((id, index) => id !== newIds[index])) {
    changes.push({ type: 'tour_reordered' });
  }
  const oldById = new Map(oldStops.map((stop) => [stop.visitId, stop]));
  for (const stop of current) {
    const old = oldById.get(stop.visitId);
    if (old && (old.plannedStart !== stop.plannedStart || old.plannedEnd !== stop.plannedEnd)) {
      changes.push({ type: 'visit_rescheduled', visitId: stop.visitId });
    }
  }
  return changes;
}
