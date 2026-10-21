import { describe, expect, mock, test } from 'bun:test';

import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import type { ApiRequest } from '@app/api/http/request';
import { SchedulingModule } from '@app/api/modules/scheduling.module';
import { AuthorizationDeniedError } from '@care/permissions';
import {
  InvalidTourError,
  TourVersionConflictError,
  type SchedulingApplicationService,
} from '@care/scheduling';

import { SchedulingToursController } from './scheduling-tours.controller';

const id = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000002';
const body = { employeeId, localDate: '2026-10-21', timezone: 'Europe/Berlin', visitIds: [id] };
const query = { employeeId, from: '2026-10-21', until: '2026-10-22' };
function fixture() {
  const response = { id, version: 1, stops: [], latestPublication: { version: 2 } };
  const service = {
    listTours: mock(async (..._args: unknown[]) => [response]),
    createTour: mock(async (..._args: unknown[]) => response),
    getTour: mock(async (..._args: unknown[]) => response),
    updateTourStops: mock(async (..._args: unknown[]) => response),
    suggestTourOrder: mock(async (..._args: unknown[]) => ({
      status: 'unavailable',
      visitIds: [id],
      conflicts: [],
    })),
    estimateTourRoute: mock(async (..._args: unknown[]) => ({
      tour: response,
      route: { status: 'unavailable', legs: [] },
      conflicts: [],
    })),
    publishTour: mock(async (..._args: unknown[]) => ({ tour: response, version: 2, changes: [] })),
  };
  const principal = { userId: id, tenantId: employeeId, grants: [] };
  const request = {
    principal,
    context: { requestId: 'request', correlationId: 'correlation' },
    headers: { 'user-agent': 'tour-test' },
    ip: '127.0.0.1',
  } as unknown as ApiRequest;
  return {
    controller: new SchedulingToursController(service as unknown as SchedulingApplicationService),
    service,
    request,
    response,
    principal,
  };
}

describe('Office tour HTTP boundary', () => {
  test('registers exactly once with unchanged guards, prefix, methods, paths and explicit status metadata', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SchedulingModule).filter(
        (controller: unknown) => controller === SchedulingToursController,
      ),
    ).toHaveLength(1);
    expect(Reflect.getMetadata(PATH_METADATA, SchedulingToursController)).toBe(
      'api/v1/scheduling/tours',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, SchedulingToursController)).toEqual([
      OidcGuard,
      TenantContextGuard,
    ]);
    const routes = [
      ['list', RequestMethod.GET, '/', undefined],
      ['create', RequestMethod.POST, '/', 201],
      ['get', RequestMethod.GET, ':id', undefined],
      ['updateStops', RequestMethod.PUT, ':id/stops', undefined],
      ['suggestOrder', RequestMethod.POST, ':id/suggest-order', 200],
      ['estimateTravel', RequestMethod.POST, ':id/estimate-travel', 200],
      ['publish', RequestMethod.POST, ':id/publish', 200],
    ] as const;
    for (const [name, method, path, status] of routes) {
      const handler = SchedulingToursController.prototype[name];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(status);
    }
  });

  test('passes all seven operations through the public facade with context, metadata and unchanged responses', async () => {
    const f = fixture();
    expect(Object.is((await f.controller.list(f.request, query))[0], f.response)).toBe(true);
    expect(f.service.listTours.mock.calls[0]).toEqual([
      f.principal,
      employeeId,
      query.from,
      query.until,
    ]);
    expect(Object.is(await f.controller.create(f.request, body), f.response)).toBe(true);
    expect(f.service.createTour.mock.calls[0]).toEqual([
      f.principal,
      body,
      { ...f.request.context, tenantId: employeeId },
      { ip: '127.0.0.1', userAgent: 'tour-test' },
    ]);
    expect(Object.is(await f.controller.get(f.request, id), f.response)).toBe(true);
    expect(
      Object.is(
        await f.controller.updateStops(f.request, id, {
          expectedVersion: 1,
          stops: [{ visitId: id }],
        }),
        f.response,
      ),
    ).toBe(true);
    expect(await f.controller.suggestOrder(f.request, id)).toMatchObject({
      status: 'unavailable',
      conflicts: [],
    });
    expect(
      await f.controller.estimateTravel(f.request, id, { expectedVersion: '1' }),
    ).toMatchObject({ route: { status: 'unavailable' } });
    expect(f.service.estimateTourRoute.mock.calls[0]).toEqual([f.principal, id, 1]);
    expect(await f.controller.publish(f.request, id, { expectedVersion: '1' })).toMatchObject({
      version: 2,
      tour: { latestPublication: { version: 2 } },
    });
    expect(f.service.publishTour.mock.calls[0]).toEqual([
      f.principal,
      id,
      1,
      { ...f.request.context, tenantId: employeeId },
      { ip: '127.0.0.1', userAgent: 'tour-test' },
    ]);
  });

  test('rejects missing/invalid query fields, UUIDs and unknown properties before application calls', async () => {
    const f = fixture();
    for (const value of [
      {},
      { ...query, employeeId: 'invalid' },
      { ...query, from: '21-10-2026' },
      { ...query, extra: 'field' },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- Verify independent invalid request cases.
      await expect(f.controller.list(f.request, value)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(f.controller.get(f.request, 'invalid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(f.controller.create(f.request, { ...body, extra: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.service.listTours).not.toHaveBeenCalled();
    expect(f.service.createTour).not.toHaveBeenCalled();
    expect(f.service.getTour).not.toHaveBeenCalled();
  });

  test('retains coerced route/publication versions and strict stop versions', async () => {
    const f = fixture();
    await f.controller.estimateTravel(f.request, id, { expectedVersion: '2' });
    await f.controller.publish(f.request, id, { expectedVersion: true });
    expect(f.service.estimateTourRoute.mock.calls[0]).toEqual([f.principal, id, 2]);
    expect((f.service.publishTour.mock.calls[0] as unknown as unknown[])?.[2]).toBe(1);
    await expect(
      f.controller.updateStops(f.request, id, { expectedVersion: '2', stops: [{ visitId: id }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    for (const value of [
      {},
      { expectedVersion: null },
      { expectedVersion: undefined },
      { expectedVersion: '0' },
      { expectedVersion: 1, extra: true },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- Preserve each rejected coercion/strictness boundary.
      await expect(f.controller.publish(f.request, id, value)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(f.service.updateTourStops).not.toHaveBeenCalled();
  });

  test('preserves absent, undefined and null dispatcher notes and rejects invalid stop payloads', async () => {
    const f = fixture();
    await f.controller.updateStops(f.request, id, { expectedVersion: 1, stops: [{ visitId: id }] });
    await f.controller.updateStops(f.request, id, {
      expectedVersion: 1,
      stops: [{ visitId: id, dispatcherNote: undefined }],
    });
    await f.controller.updateStops(f.request, id, {
      expectedVersion: 1,
      stops: [{ visitId: id, dispatcherNote: null }],
    });
    const calls = f.service.updateTourStops.mock.calls as unknown as Array<
      [unknown, string, { stops: Array<{ dispatcherNote?: string | null }> }]
    >;
    expect(calls[0]![2].stops[0]).not.toHaveProperty('dispatcherNote');
    expect(calls[1]![2].stops[0]).toHaveProperty('dispatcherNote', undefined);
    expect(calls[2]![2].stops[0]).toHaveProperty('dispatcherNote', null);
    await expect(
      f.controller.updateStops(f.request, id, { expectedVersion: 1, stops: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      f.controller.updateStops(f.request, id, {
        expectedVersion: 1,
        stops: [{ visitId: id, unknown: true }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      f.controller.updateStops(f.request, id, {
        expectedVersion: 1,
        stops: Array.from({ length: 101 }, () => ({ visitId: id })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('keeps missing-principal and malformed-body precedence and propagates application authorization/version/date errors', async () => {
    const f = fixture();
    const anonymous = { ...f.request, principal: undefined } as unknown as ApiRequest;
    await expect(f.controller.create(anonymous, body)).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.controller.get(anonymous, id)).rejects.toBeInstanceOf(BadRequestException);
    f.service.createTour.mockRejectedValue(new AuthorizationDeniedError('schedule.update'));
    await expect(f.controller.create(f.request, { ...body, visitIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.service.createTour).not.toHaveBeenCalled();
    await expect(f.controller.create(f.request, body)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    f.service.publishTour.mockRejectedValue(new TourVersionConflictError());
    await expect(
      f.controller.publish(f.request, id, { expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(TourVersionConflictError);
    f.service.listTours.mockRejectedValue(new InvalidTourError());
    await expect(
      f.controller.list(f.request, { ...query, until: '2026-10-20' }),
    ).rejects.toBeInstanceOf(InvalidTourError);
  });
});
