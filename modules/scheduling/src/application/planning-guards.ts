import { sql } from 'drizzle-orm';

import type { ClientApplicationService } from '@care/clients';

import type { DatabaseTransaction } from '@care/database';
import type { EmployeeApplicationService } from '@care/employees';

import {
  assertCan,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';

import { localDateTimeToInstant } from '@module/scheduling/domain';
import {
  availabilityForVisit,
  InvalidEmployeeAvailabilityError,
} from '@module/scheduling/domain/availability';

import type { VisitData } from '@module/scheduling/domain/visit';
import type { SchedulingExecutionGuard } from '@module/scheduling/infrastructure/scheduling-guards';
import type { SchedulingRepository } from '@module/scheduling/infrastructure/scheduling.repository';

import {
  VisitExecutionPlanningLockedError,
  VisitNotFoundError,
  VisitOutsideProviderContextError,
  VisitEmployeeConflictError,
  VisitEmployeeUnavailableError,
  VisitOutsideEmployeeAvailabilityError,
  VisitTravelBufferConflictError,
  VisitDailyPlanLimitError,
} from './planning.errors';
import { dateInTimeZone, addCalendarDate, calendarDates } from './planning-time';
// Transaction statements and resource locks must remain sequential.
// oxlint-disable no-await-in-loop

export class SchedulingPlanningGuards {
  constructor(
    private readonly repository: SchedulingRepository,
    private readonly clients: Pick<ClientApplicationService, 'getForServiceAgreement'>,
    private readonly employees: Pick<EmployeeApplicationService, 'getForSchedulingManagement'>,
    private readonly executionGuard?: SchedulingExecutionGuard,
  ) {}

  async ensurePlanningMutable(transaction: DatabaseTransaction, visit: VisitData): Promise<void> {
    if (await this.executionGuard?.hasExecutionForVisit(transaction, visit.tenantId, visit.id)) {
      throw new VisitExecutionPlanningLockedError();
    }
  }

  async requireVisitForMutation(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    visitId: string,
    permission: Permission,
    lock: boolean,
  ): Promise<VisitData> {
    const visit = await this.repository.get(transaction, principal.tenantId, visitId, lock);
    if (!visit) throw new VisitNotFoundError();
    const client = await this.clients.getForServiceAgreement(
      transaction,
      principal,
      visit.clientId,
      lock,
    );
    assertCan(principal, {
      action: permission,
      resource: {
        tenantId: visit.tenantId,
        clientId: visit.clientId,
        organizationId: visit.organizationId,
        facilityId: visit.facilityId,
      },
    });
    if (
      client.organizationId !== visit.organizationId ||
      client.primaryFacilityId !== visit.facilityId
    ) {
      throw new VisitOutsideProviderContextError();
    }
    return visit;
  }

  async ensureEmployeeAvailable(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    visit: VisitData,
    excludeVisitId?: string,
  ): Promise<void> {
    const conflict = await this.repository.findEmployeeConflict(transaction, {
      tenantId,
      employeeId,
      plannedStart: visit.plannedStart,
      plannedEnd: visit.plannedEnd,
      ...(excludeVisitId === undefined ? {} : { excludeVisitId }),
    });
    if (conflict) {
      throw new VisitEmployeeConflictError(
        conflict.visit.plannedStart,
        conflict.visit.plannedEnd,
        conflict.visit.timezone,
      );
    }
    if (
      await this.repository.isEmployeeUnavailable(
        transaction,
        tenantId,
        employeeId,
        visit.plannedStart,
        visit.plannedEnd,
      )
    ) {
      throw new VisitEmployeeUnavailableError();
    }
    const availability = await this.repository.availabilityForEmployee(
      transaction,
      tenantId,
      employeeId,
    );
    if (
      availability &&
      availabilityForVisit(visit.plannedStart, visit.plannedEnd, availability.value) === 'outside'
    ) {
      throw new VisitOutsideEmployeeAvailabilityError();
    }
    if (availability) {
      const dates = calendarDates(
        dateInTimeZone(visit.plannedStart, availability.value.timezone),
        dateInTimeZone(visit.plannedEnd, availability.value.timezone),
      );
      const dayRanges = dates.map((date) => {
        const nextDate = addCalendarDate(date, 1);
        const startsAt = localDateTimeToInstant(
          date,
          '00:00',
          availability.value.timezone,
          'earlier',
        );
        const endsAt = localDateTimeToInstant(
          nextDate,
          '00:00',
          availability.value.timezone,
          'later',
        );
        if (!startsAt || !endsAt || endsAt <= startsAt)
          throw new InvalidEmployeeAvailabilityError();
        return { startsAt, endsAt };
      });
      const bufferMs = availability.value.travelBufferMinutes * 60_000;
      const assigned = await this.repository.assignedVisitsForEmployee(
        transaction,
        tenantId,
        employeeId,
        new Date(dayRanges[0]!.startsAt.getTime() - bufferMs),
        new Date(dayRanges.at(-1)!.endsAt.getTime() + bufferMs),
        excludeVisitId,
      );
      const stops = [...assigned, visit].sort(
        (left, right) =>
          left.plannedStart.getTime() - right.plannedStart.getTime() ||
          left.id.localeCompare(right.id),
      );
      const visitIndex = stops.findIndex((stop) => stop.id === visit.id);
      const previous = visitIndex > 0 ? stops[visitIndex - 1] : undefined;
      const next = visitIndex >= 0 ? stops[visitIndex + 1] : undefined;
      if (
        bufferMs > 0 &&
        ((previous && visit.plannedStart.getTime() - previous.plannedEnd.getTime() < bufferMs) ||
          (next && next.plannedStart.getTime() - visit.plannedEnd.getTime() < bufferMs))
      ) {
        throw new VisitTravelBufferConflictError();
      }
      if (availability.value.maxDailyMinutes !== null) {
        for (let index = 0; index < dayRanges.length; index += 1) {
          const day = dayRanges[index]!;
          const dayStops = stops.filter(
            (stop) => stop.plannedStart < day.endsAt && stop.plannedEnd > day.startsAt,
          );
          const visitMinutes = dayStops.reduce(
            (total, stop) =>
              total +
              Math.max(
                0,
                Math.min(stop.plannedEnd.getTime(), day.endsAt.getTime()) -
                  Math.max(stop.plannedStart.getTime(), day.startsAt.getTime()),
              ) /
                60_000,
            0,
          );
          const bufferedMinutes =
            visitMinutes +
            Math.max(0, dayStops.length - 1) * availability.value.travelBufferMinutes;
          if (bufferedMinutes > availability.value.maxDailyMinutes) {
            throw new VisitDailyPlanLimitError(availability.value.maxDailyMinutes);
          }
        }
      }
    }
  }

  async employeeSchedulingResource(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    employeeId: string,
  ) {
    const { employee, facilityIds, teamIds } = await this.employees.getForSchedulingManagement(
      transaction,
      principal.tenantId,
      employeeId,
      true,
    );
    const resource: ResourceContext = {
      tenantId: principal.tenantId,
      ...(employee.organizationId ? { organizationId: employee.organizationId } : {}),
      facilityIds,
      teamIds,
    };
    return { employee, resource };
  }

  async lockResources(
    transaction: DatabaseTransaction,
    tenantId: string,
    resourceKeys: string[],
  ): Promise<void> {
    const keys = [...new Set(resourceKeys)].sort();
    for (const resource of keys) {
      const key = `${tenantId}:${resource}`;
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
  }
}
