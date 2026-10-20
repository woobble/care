import { describe, expect, mock, test } from 'bun:test';

import type { ClientApplicationService } from '@care/clients';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { EmployeeApplicationService } from '@care/employees';
import { AuthorizationDeniedError, type AuthorizationPrincipal } from '@care/permissions';
import type { DomainEvent } from '@care/events';
import type { VisitData } from '@module/scheduling/domain/visit';
import { InvalidTourError, TourVersionConflictError } from '@module/scheduling/domain/tour';
import {
  UnavailableRouteProvider,
  type RouteProvider,
} from '@module/scheduling/domain/route-provider';
import type { SchedulingRepository } from '@module/scheduling/infrastructure/scheduling.repository';

import { SchedulingPlanningGuards } from './planning-guards';
import { SchedulingEventWriter } from './scheduling-events';
import { SchedulingToursApplicationService } from './tours.application';
import {
  SchedulingConflictsError,
  TourNotFoundError,
  VisitOutsideProviderContextError,
} from './planning.errors';

const principal: AuthorizationPrincipal = {
  userId: 'dispatcher',
  tenantId: 'tenant',
  grants: ['schedule.read', 'schedule.update'].map((permission) => ({
    permission: permission as 'schedule.read' | 'schedule.update',
    scopeType: 'tenant',
    scopeId: 'tenant',
  })),
};
const context = { requestId: 'request', correlationId: 'correlation' };

function fixture(provider: RouteProvider = new UnavailableRouteProvider()) {
  const now = new Date('2026-10-10T00:00:00Z');
  const visits: VisitData[] = [0, 1].map((index) => ({
    id: `visit-${index}`,
    tenantId: 'tenant',
    clientId: `client-${index}`,
    organizationId: 'organization',
    facilityId: 'facility',
    origin: 'manual',
    serviceAgreementId: null,
    status: 'planned',
    plannedStart: new Date(`2026-10-10T0${8 + index}:00:00Z`),
    plannedEnd: new Date(`2026-10-10T0${8 + index}:30:00Z`),
    timezone: 'Europe/Berlin',
    timeWindowStart: null,
    timeWindowEnd: null,
    note: 'private visit note',
    manuallyAdjusted: false,
    createdAt: now,
    updatedAt: now,
  }));
  const tour = {
    id: 'tour',
    tenantId: 'tenant',
    employeeId: 'employee',
    organizationId: 'organization',
    facilityId: null,
    localDate: '2026-10-10',
    timezone: 'Europe/Berlin',
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    createdBy: 'dispatcher',
    updatedBy: 'dispatcher',
  };
  let rows = visits.map((visit, index) => ({
    visit,
    latitude: '51.5',
    longitude: '7.5',
    stop: {
      id: `stop-${index}`,
      tenantId: 'tenant',
      tourId: 'tour',
      visitId: visit.id,
      sequence: index + 1,
      estimatedTravelMinutes: null as number | null,
      estimatedDistanceMeters: null as number | null,
      routeStatus: 'unknown',
      dispatcherNote: null as string | null,
    },
  }));
  const publications: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const events: DomainEvent[] = [];
  let active = false;
  const transaction = { execute: mock(async () => {}) } as unknown as DatabaseTransaction;
  const unitOfWork: UnitOfWork = {
    async transaction(options, operation) {
      expect(active).toBe(false);
      expect(options.tenantId).toBeDefined();
      active = true;
      try {
        return await operation(transaction);
      } finally {
        active = false;
      }
    },
  };
  const repository = {
    getTour: mock(async (_tx: DatabaseTransaction, tenantId: string, _id: string, _lock = false) =>
      tenantId === tour.tenantId ? tour : null,
    ),
    get: mock(
      async (_tx: DatabaseTransaction, tenantId: string, id: string) =>
        visits.find((visit) => visit.tenantId === tenantId && visit.id === id) ?? null,
    ),
    listTours: mock(async () => [tour]),
    tourStops: mock(async () => rows),
    latestTourPublication: mock(async () => publications.at(-1) ?? null),
    employeePreferences: mock(async () => null),
    activeEmployeeIds: mock(async () => ['employee']),
    activeProposedSubstitution: mock(async () => null),
    findEmployeeConflict: mock(async () => null),
    isEmployeeUnavailable: mock(async () => false),
    availabilityForEmployee: mock(async () => null),
    insertTour: mock(async (tx: DatabaseTransaction, value: typeof tour) => {
      expect(tx).toBe(transaction);
      Object.assign(tour, value);
    }),
    insertTourStops: mock(
      async (_tx: DatabaseTransaction, stops: Array<(typeof rows)[number]['stop']>) => {
        rows = stops.map((stop) => ({
          ...rows.find((row) => row.visit.id === stop.visitId)!,
          stop,
        }));
      },
    ),
    replaceTourStops: mock(
      async (
        _tx: DatabaseTransaction,
        _tenant: string,
        _id: string,
        stops: Array<{ visitId: string; sequence: number; dispatcherNote: string | null }>,
      ) => {
        rows = stops.map((stop) => {
          const row = rows.find((item) => item.visit.id === stop.visitId)!;
          return { ...row, stop: { ...row.stop, ...stop } };
        });
      },
    ),
    updateTourVersion: mock(async () => {
      tour.version += 1;
      return true;
    }),
    updateTourStopEstimates: mock(
      async (
        _tx: DatabaseTransaction,
        _tenant: string,
        _id: string,
        legs: Array<{
          toVisitId: string;
          travelMinutes: number;
          distanceMeters: number;
          routeStatus: string;
        }>,
        status: string,
      ) => {
        for (const row of rows) {
          const leg = legs.find((item) => item.toVisitId === row.visit.id);
          Object.assign(row.stop, {
            routeStatus: status,
            estimatedTravelMinutes: leg?.travelMinutes ?? null,
            estimatedDistanceMeters: leg?.distanceMeters ?? null,
          });
        }
      },
    ),
    insertTourPublication: mock(
      async (tx: DatabaseTransaction, publication: Record<string, unknown>) => {
        expect(tx).toBe(transaction);
        publications.push(structuredClone(publication));
      },
    ),
  };
  const clients = {
    getForServiceAgreement: mock(async () => ({
      organizationId: 'organization',
      primaryFacilityId: 'facility',
    })),
  } as unknown as Pick<ClientApplicationService, 'getForServiceAgreement'>;
  const employees = {
    getForSchedulingManagement: mock(async () => ({
      employee: { id: 'employee', organizationId: 'organization' },
      facilityIds: ['facility'],
      teamIds: ['team'],
    })),
  } as unknown as Pick<EmployeeApplicationService, 'getForSchedulingManagement'>;
  const executionGuard = { hasExecutionForVisit: mock(async () => false) };
  const planning = new SchedulingPlanningGuards(
    repository as unknown as SchedulingRepository,
    clients,
    employees,
    executionGuard,
  );
  const writer = new SchedulingEventWriter(
    {
      append: mock(async (tx, audit) => {
        expect(tx).toBe(transaction);
        audits.push(audit);
      }),
    },
    {
      enqueue: mock(async (tx, event) => {
        expect(tx).toBe(transaction);
        events.push(event);
      }),
    },
  );
  const service = new SchedulingToursApplicationService(
    unitOfWork,
    clients,
    repository as unknown as SchedulingRepository,
    planning,
    writer,
    provider,
  );
  return {
    service,
    repository,
    planning,
    tour,
    visits,
    publications,
    audits,
    events,
    clients,
    executionGuard,
    active: () => active,
  };
}

describe('Office tour orchestration', () => {
  test('creates assigned visits in chronological order with matching audit and outbox metadata', async () => {
    const f = fixture();
    const tour = await f.service.createTour(
      principal,
      {
        employeeId: 'employee',
        localDate: '2026-10-10',
        timezone: 'Europe/Berlin',
        visitIds: ['visit-1', 'visit-0'],
      },
      context,
      {},
    );
    expect(tour.stops.map((stop) => stop.visitId)).toEqual(['visit-0', 'visit-1']);
    expect(f.audits[0]).toMatchObject({
      id: f.events[0]!.id,
      resourceId: tour.id,
      action: 'scheduling.tour_created',
    });
    expect(JSON.stringify(f.events)).not.toContain('private visit note');
    expect(f.repository.insertTour).toHaveBeenCalledTimes(1);
  });

  test.each(['organization', 'facility', 'team'] as const)(
    'checks %s employee scope and separates read from update grants',
    async (scopeType) => {
      const f = fixture();
      const scoped: AuthorizationPrincipal = {
        ...principal,
        grants: [{ permission: 'schedule.read', scopeType, scopeId: scopeType }],
      };
      expect(
        await f.service.listTours(scoped, 'employee', '2026-10-10', '2026-10-11'),
      ).toHaveLength(1);
      if (scopeType === 'team') {
        // Existing stop authorization has no team resource; retain that additional restriction.
        await expect(f.service.getTour(scoped, 'tour')).rejects.toBeInstanceOf(
          AuthorizationDeniedError,
        );
      } else expect(await f.service.getTour(scoped, 'tour')).toMatchObject({ id: 'tour' });
      await expect(
        f.service.updateTourStops(
          scoped,
          'tour',
          { expectedVersion: 1, stops: [{ visitId: 'visit-0' }] },
          context,
          {},
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      await expect(
        f.service.listTours(
          { ...scoped, grants: [{ permission: 'schedule.read', scopeType, scopeId: 'foreign' }] },
          'employee',
          '2026-10-10',
          '2026-10-11',
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    },
  );

  test('rejects tenant isolation breaches and changed client provider context', async () => {
    const f = fixture();
    await expect(
      f.service.getTour({ ...principal, tenantId: 'other' }, 'tour'),
    ).rejects.toBeInstanceOf(TourNotFoundError);
    f.visits[0]!.facilityId = 'other-facility';
    await expect(f.service.getTour(principal, 'tour')).rejects.toBeInstanceOf(
      VisitOutsideProviderContextError,
    );
  });

  test.each(['cancelled', 'wrong-date', 'unassigned', 'duplicate'] as const)(
    'rejects incompatible creation: %s',
    async (kind) => {
      const f = fixture();
      if (kind === 'cancelled') f.visits[0]!.status = 'cancelled';
      if (kind === 'wrong-date') f.visits[0]!.plannedStart = new Date('2026-10-11T08:00:00Z');
      if (kind === 'unassigned') f.repository.activeEmployeeIds.mockResolvedValue([]);
      await expect(
        f.service.createTour(
          principal,
          {
            employeeId: 'employee',
            localDate: '2026-10-10',
            timezone: 'Europe/Berlin',
            visitIds: kind === 'duplicate' ? ['visit-0', 'visit-0'] : ['visit-0'],
          },
          context,
          {},
        ),
      ).rejects.toBeInstanceOf(InvalidTourError);
      expect(f.events).toHaveLength(0);
      expect(f.repository.insertTour).not.toHaveBeenCalled();
    },
  );

  test('reorders stops with their trimmed notes and rejects stale commands before writing', async () => {
    const f = fixture();
    const result = await f.service.updateTourStops(
      principal,
      'tour',
      {
        expectedVersion: 1,
        stops: [
          { visitId: 'visit-1', dispatcherNote: ' second ' },
          { visitId: 'visit-0', dispatcherNote: 'first' },
        ],
      },
      context,
      {},
    );
    expect(
      result.stops.map(({ visitId, dispatcherNote }) => ({ visitId, dispatcherNote })),
    ).toEqual([
      { visitId: 'visit-1', dispatcherNote: 'second' },
      { visitId: 'visit-0', dispatcherNote: 'first' },
    ]);
    await expect(f.service.publishTour(principal, 'tour', 1, context, {})).rejects.toBeInstanceOf(
      TourVersionConflictError,
    );
    await expect(
      f.service.updateTourStops(
        principal,
        'tour',
        { expectedVersion: 1, stops: [{ visitId: 'visit-0' }] },
        context,
        {},
      ),
    ).rejects.toBeInstanceOf(TourVersionConflictError);
    expect(f.repository.replaceTourStops).toHaveBeenCalledTimes(1);
    expect(f.publications).toHaveLength(0);
  });

  test('keeps routing outside transactions, sends only coordinates and rounds minutes upwards', async () => {
    const provider: RouteProvider = {
      estimate: mock(async (stops) => {
        expect(f.active()).toBe(false);
        expect(stops).toEqual([
          { visitId: 'visit-0', location: { latitude: 51.5, longitude: 7.5 } },
          { visitId: 'visit-1', location: { latitude: 51.5, longitude: 7.5 } },
        ]);
        return {
          status: 'available' as const,
          legs: [
            {
              fromVisitId: 'visit-0',
              toVisitId: 'visit-1',
              durationSeconds: 61,
              distanceMeters: 400,
            },
          ],
        };
      }),
      suggestOrder: mock(async () => ({ status: 'available' as const, visitIds: [] })),
    };
    const f = fixture(provider);
    const result = await f.service.estimateTourRoute(principal, 'tour', 1);
    expect(result.tour.stops[1]).toMatchObject({
      estimatedTravelMinutes: 2,
      estimatedDistanceMeters: 400,
    });
    expect(f.repository.getTour.mock.calls[1]!.at(-1)).toBe(true);
  });

  test('rejects a route result made stale during provider I/O without saving estimates', async () => {
    const provider: RouteProvider = {
      estimate: async () => {
        expect(f.active()).toBe(false);
        f.tour.version++;
        return { status: 'unavailable', legs: [] };
      },
      suggestOrder: async () => ({ status: 'unavailable', visitIds: [] }),
    };
    const f = fixture(provider);
    await expect(f.service.estimateTourRoute(principal, 'tour', 1)).rejects.toBeInstanceOf(
      TourVersionConflictError,
    );
    expect(f.repository.updateTourStopEstimates).not.toHaveBeenCalled();
    expect(f.repository.updateTourVersion).not.toHaveBeenCalled();
  });

  test('reports unavailable estimates and suggestions without changing appointments or publishing', async () => {
    const f = fixture();
    const dates = f.visits.map((visit) => visit.plannedStart.toISOString());
    const estimate = await f.service.estimateTourRoute(principal, 'tour', 1);
    expect(estimate.route.status).toBe('unavailable');
    expect(estimate.conflicts).toEqual([
      expect.objectContaining({ code: 'travel_feasibility_unknown' }),
    ]);
    const suggestion = await f.service.suggestTourOrder(principal, 'tour');
    expect(suggestion.status).toBe('unavailable');
    expect(suggestion.conflicts).toContainEqual(
      expect.objectContaining({ code: 'travel_feasibility_unknown' }),
    );
    expect(f.visits.map((visit) => visit.plannedStart.toISOString())).toEqual(dates);
    expect(f.repository.updateTourVersion).toHaveBeenCalledTimes(1);
    expect(f.publications).toHaveLength(0);
  });

  test('blocks infeasible publications and appends independent snapshots and change summaries', async () => {
    const f = fixture();
    const rows = await f.repository.tourStops();
    rows[1]!.stop.routeStatus = 'available';
    rows[1]!.stop.estimatedTravelMinutes = 31;
    await expect(f.service.publishTour(principal, 'tour', 1, context, {})).rejects.toBeInstanceOf(
      SchedulingConflictsError,
    );
    expect(f.publications).toHaveLength(0);
    expect(f.events).toHaveLength(0);
    rows[1]!.stop.estimatedTravelMinutes = 10;
    await f.service.publishTour(principal, 'tour', 1, context, {});
    const initial = structuredClone(f.publications[0]);
    f.visits[1]!.plannedStart = new Date('2026-10-10T09:15:00Z');
    await f.service.publishTour(principal, 'tour', 2, context, {});
    expect(f.publications.map((publication) => publication.version)).toEqual([1, 2]);
    expect(f.publications[0]).toEqual(initial);
    expect(f.publications[1]!.changeSummary).toEqual([
      { type: 'visit_rescheduled', visitId: 'visit-1' },
    ]);
    expect(f.events.map((event) => event.type)).toEqual([
      'scheduling.tour_published',
      'scheduling.tour_published',
    ]);
    expect(f.audits.map((audit) => audit.id)).toEqual(f.events.map((event) => event.id));
  });
});

test.each([
  ['2026-03-29', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 23],
  ['2026-10-25', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 25],
] as const)(
  'tour availability uses the %s local day across DST (%s–%s, %i hours)',
  async (localDate, start, end, hours) => {
    const f = fixture();
    Object.assign(f.tour, { localDate });
    Object.assign(f.visits[0]!, {
      plannedStart: new Date(new Date(start).getTime() + 60_000),
      plannedEnd: new Date(new Date(end).getTime() - 60_000),
    });
    const assignedVisitsForEmployee = mock(
      async (
        _tx: DatabaseTransaction,
        _tenant: string,
        _employee: string,
        from: Date,
        until: Date,
      ) => {
        expect(from.toISOString()).toBe(new Date(start).toISOString());
        expect(until.toISOString()).toBe(new Date(end).toISOString());
        expect((until.getTime() - from.getTime()) / 3_600_000).toBe(hours);
        return [];
      },
    );
    const repository = {
      ...f.repository,
      availabilityForEmployee: async () => ({
        value: {
          timezone: 'Europe/Berlin',
          windows: [{ weekday: 7, startsAt: '00:00', endsAt: '00:00' }],
          exceptions: [],
          maxDailyMinutes: null,
          travelBufferMinutes: 0,
        },
      }),
      assignedVisitsForEmployee,
    } as unknown as SchedulingRepository;
    const guards = new SchedulingPlanningGuards(
      repository,
      f.clients,
      {} as EmployeeApplicationService,
    );
    await guards.ensureEmployeeAvailable(
      {} as DatabaseTransaction,
      'tenant',
      'employee',
      f.visits[0]!,
      'visit-0',
    );
    expect(assignedVisitsForEmployee).toHaveBeenCalledTimes(1);
    // Tour matching follows the visit start in the tour's zone, including UTC-adjacent dates.
    const tour = await f.service.createTour(
      principal,
      { employeeId: 'employee', localDate, timezone: 'Europe/Berlin', visitIds: ['visit-0'] },
      context,
      {},
    );
    expect(tour.localDate).toBe(localDate);
  },
);

test('optimized ordering stays a preview and reports travel conflicts for the proposed order', async () => {
  const f = fixture({
    suggestOrder: async () => {
      expect(f.active()).toBe(false);
      return { status: 'available', visitIds: ['visit-1', 'visit-0'] };
    },
    estimate: async (stops) => {
      expect(f.active()).toBe(false);
      expect(stops.map((stop) => stop.visitId)).toEqual(['visit-1', 'visit-0']);
      return {
        status: 'available',
        legs: [
          {
            fromVisitId: 'visit-1',
            toVisitId: 'visit-0',
            durationSeconds: 600,
            distanceMeters: 1000,
          },
        ],
      };
    },
  });
  const suggestion = await f.service.suggestTourOrder(principal, 'tour');
  expect(suggestion.visitIds).toEqual(['visit-1', 'visit-0']);
  expect(suggestion.conflicts).toContainEqual(
    expect.objectContaining({ code: 'insufficient_travel_time', severity: 'blocking' }),
  );
  expect(f.repository.replaceTourStops).not.toHaveBeenCalled();
  expect(f.repository.updateTourVersion).not.toHaveBeenCalled();
  expect(f.publications).toHaveLength(0);
});

test('publication rechecks execution and absence guards without emitting history', async () => {
  const f = fixture();
  f.executionGuard.hasExecutionForVisit.mockResolvedValue(true);
  await expect(f.service.publishTour(principal, 'tour', 1, context, {})).rejects.toMatchObject({
    code: 'VISIT_EXECUTION_PLANNING_LOCKED',
  });
  f.executionGuard.hasExecutionForVisit.mockResolvedValue(false);
  f.repository.isEmployeeUnavailable.mockResolvedValue(true);
  await expect(f.service.publishTour(principal, 'tour', 1, context, {})).rejects.toMatchObject({
    code: 'VISIT_EMPLOYEE_NOT_AVAILABLE',
  });
  expect(f.publications).toHaveLength(0);
  expect(f.audits).toHaveLength(0);
  expect(f.events).toHaveLength(0);
});
