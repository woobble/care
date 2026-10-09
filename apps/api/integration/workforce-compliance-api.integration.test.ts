import type { AddressInfo } from 'node:net';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { NextFunction, Response } from 'express';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { describe, expect, test } from 'bun:test';
import { v7 as uuidv7 } from 'uuid';
import type { AuthorizationPrincipal } from '@care/permissions';
import {
  WorkforceComplianceAccessDeniedError,
  WorkforceComplianceSettingsVersionConflictError,
  type WorkforceComplianceApplicationService,
} from '@care/workforce-compliance';
import type { ApiRequest } from '../src/http/request';
import { ProblemDetailsFilter } from '../src/presentation/http/problem-details.filter';
import { WorkforceComplianceController } from '../src/presentation/http/workforce-compliance.controller';
import { WORKFORCE_COMPLIANCE_APPLICATION } from '../src/tokens';

describe('workforce compliance API', () => {
  test('allows settings reads, marks read-only settings, and maps update authorization and version conflicts', async () => {
    const tenantId = uuidv7();
    const userId = uuidv7();
    const state = {
      principal: principalWith(tenantId, userId, ['workforce_compliance.read']),
      settings: {
        criticalDays: 30,
        warningDays: 90,
        reportingTimezone: 'Europe/Berlin',
        version: 3,
      },
    };
    let updateCalls = 0;
    const application = {
      getSettings: async (principal: AuthorizationPrincipal) => {
        requireTenantRead(principal);
        return state.settings;
      },
      updateSettings: async (
        principal: AuthorizationPrincipal,
        input: { expectedVersion: number; criticalDays?: number },
      ) => {
        updateCalls += 1;
        if (!hasTenantGrant(principal, 'workforce_compliance.manage_settings')) {
          throw new WorkforceComplianceAccessDeniedError();
        }
        if (input.expectedVersion !== state.settings.version) {
          throw new WorkforceComplianceSettingsVersionConflictError(
            input.expectedVersion,
            state.settings.version,
          );
        }
        state.settings = {
          ...state.settings,
          ...(input.criticalDays === undefined ? {} : { criticalDays: input.criticalDays }),
          version: state.settings.version + 1,
        };
        return state.settings;
      },
    } as unknown as WorkforceComplianceApplicationService;
    // This test injects a principal at the HTTP boundary; auth guards are covered by API integration.
    Reflect.defineMetadata(GUARDS_METADATA, [], WorkforceComplianceController);
    const module = createTestModule(application);
    const app = await NestFactory.create(module, { logger: false, abortOnError: false });
    app.use((request: ApiRequest, _response: Response, next: NextFunction) => {
      request.principal = state.principal;
      request.context = { requestId: uuidv7(), correlationId: uuidv7() };
      next();
    });

    try {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1/workforce-compliance/settings`;
      const headers = {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
      };

      const settingsResponse = await fetch(baseUrl, { headers });
      expect(settingsResponse.status).toBe(200);
      expect(await settingsResponse.json()).toMatchObject({
        criticalDays: 30,
        warningDays: 90,
        reportingTimezone: 'Europe/Berlin',
        version: 3,
        canManage: false,
      });

      const invalidQuery = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/workforce-compliance/summary?horizonDays=0`,
        { headers },
      );
      expect(invalidQuery.status).toBe(400);
      expect(await invalidQuery.json()).toMatchObject({
        status: 400,
        code: 'INVALID_WORKFORCE_COMPLIANCE_QUERY',
      });

      const invalidSettings = await fetch(baseUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ expectedVersion: -1 }),
      });
      expect(invalidSettings.status).toBe(400);
      expect(await invalidSettings.json()).toMatchObject({
        status: 400,
        code: 'INVALID_WORKFORCE_COMPLIANCE_SETTINGS',
      });

      const deniedUpdate = await fetch(baseUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ expectedVersion: 3, criticalDays: 20 }),
      });
      expect(deniedUpdate.status).toBe(403);
      expect(await deniedUpdate.json()).toMatchObject({
        status: 403,
        code: 'WORKFORCE_COMPLIANCE_ACCESS_DENIED',
      });

      state.principal = principalWith(tenantId, userId, [
        'workforce_compliance.read',
        'workforce_compliance.manage_settings',
      ]);
      const manageableSettingsResponse = await fetch(baseUrl, { headers });
      expect(manageableSettingsResponse.status).toBe(200);
      expect(await manageableSettingsResponse.json()).toMatchObject({ canManage: true });

      const staleUpdate = await fetch(baseUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ expectedVersion: 2, criticalDays: 20 }),
      });
      expect(staleUpdate.status).toBe(409);
      expect(await staleUpdate.json()).toMatchObject({
        status: 409,
        code: 'WORKFORCE_COMPLIANCE_SETTINGS_VERSION_CONFLICT',
      });

      const successfulUpdate = await fetch(baseUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ expectedVersion: 3, criticalDays: 20 }),
      });
      expect(successfulUpdate.status).toBe(200);
      expect(await successfulUpdate.json()).toMatchObject({
        criticalDays: 20,
        warningDays: 90,
        version: 4,
      });
      expect(updateCalls).toBe(3);
    } finally {
      await app.close();
    }
  });
});

function createTestModule(application: WorkforceComplianceApplicationService): DynamicModule {
  @Module({})
  class WorkforceComplianceApiTestModule {}

  return {
    module: WorkforceComplianceApiTestModule,
    controllers: [WorkforceComplianceController],
    providers: [
      { provide: WORKFORCE_COMPLIANCE_APPLICATION, useValue: application },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  };
}

function principalWith(
  tenantId: string,
  userId: string,
  permissions: readonly ('workforce_compliance.read' | 'workforce_compliance.manage_settings')[],
): AuthorizationPrincipal {
  return {
    tenantId,
    userId,
    grants: permissions.map((permission) => ({
      permission,
      scopeType: 'tenant',
      scopeId: tenantId,
    })),
  };
}

function hasTenantGrant(
  principal: AuthorizationPrincipal,
  permission: 'workforce_compliance.read' | 'workforce_compliance.manage_settings',
): boolean {
  return principal.grants.some(
    (grant) =>
      grant.permission === permission &&
      grant.scopeType === 'tenant' &&
      grant.scopeId === principal.tenantId,
  );
}

function requireTenantRead(principal: AuthorizationPrincipal): void {
  if (!hasTenantGrant(principal, 'workforce_compliance.read')) {
    throw new WorkforceComplianceAccessDeniedError();
  }
}
