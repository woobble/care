import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { v7 as uuidv7 } from 'uuid';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { startCareTestDatabase } from '@care/testing';
import { AppModule } from '../src/app.module';
import { RequestContextMiddleware } from '../src/http/request-context.middleware';
import type { ApiRequest } from '../src/http/request';
import type { NextFunction, Request, Response } from 'express';

describe('operations PostgreSQL/API integration', () => {
  test('projects a current scheduling exception, records task history, and enforces tenant and source scope', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const organizationId = uuidv7();
    const otherOrganizationId = uuidv7();
    const facilityId = uuidv7();
    const otherFacilityId = uuidv7();
    const clientId = uuidv7();
    const otherClientId = uuidv7();
    const employeeId = uuidv7();
    const otherEmployeeId = uuidv7();
    const visitId = uuidv7();
    const userId = uuidv7();
    const subject = uuidv7();
    const taskFromOtherTenantId = uuidv7();
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const keyId = uuidv7();
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const oidc = await startOidcServer(publicJwk);
    let api: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
    const now = new Date();

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES ($1, 'Operations tenant', $2), ($3, 'Other operations tenant', $4)`,
        [tenantId, `operations-${tenantId}`, otherTenantId, `operations-${otherTenantId}`],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name)
         VALUES ($1, $2, 'Operations provider'), ($3, $4, 'Other provider')`,
        [organizationId, tenantId, otherOrganizationId, otherTenantId],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $2, $3, 'Operations facility'), ($4, $5, $6, 'Other facility')`,
        [facilityId, tenantId, organizationId, otherFacilityId, otherTenantId, otherOrganizationId],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Ada', 'Operations', 'active', $5, $5),
                ($6, $2, $3, $4, 'Grace', 'Other', 'active', $5, $5)`,
        [clientId, tenantId, organizationId, facilityId, now, otherClientId],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, organization_id, first_name, last_name, status, created_at)
         VALUES ($1, $2, $3, 'Office', 'Assignee', 'active', $7),
                ($4, $5, $6, 'Other', 'Assignee', 'active', $7)`,
        [
          employeeId,
          tenantId,
          organizationId,
          otherEmployeeId,
          otherTenantId,
          otherOrganizationId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO employees.employee_facility_assignments
           (id, tenant_id, organization_id, employee_id, facility_id, is_primary, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, 'active', $6, $6)`,
        [uuidv7(), tenantId, organizationId, employeeId, facilityId, now],
      );
      await owner.query(
        `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status, planned_start, planned_end, timezone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed', $6, $7, 'Europe/Berlin', $8, $8)`,
        [
          visitId,
          tenantId,
          clientId,
          organizationId,
          facilityId,
          new Date(now.getTime() + 3 * 60 * 60 * 1000),
          new Date(now.getTime() + 4 * 60 * 60 * 1000),
          now,
        ],
      );
      await owner.query(
        `INSERT INTO scheduling.client_scheduling_preferences
           (id, tenant_id, client_id, preferred_weekdays, preferred_time_windows, preferred_employee_id, updated_at, updated_by)
         VALUES ($1, $2, $3, '{}', '[]'::jsonb, $4, $5, $6)`,
        [uuidv7(), tenantId, clientId, employeeId, now, userId],
      );
      await owner.query(
        `INSERT INTO operations.tasks (id, tenant_id, organization_id, title, status, priority, created_by_user_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'Other tenant task', 'open', 'normal', $4, 1, $5, $5)`,
        [taskFromOtherTenantId, otherTenantId, otherOrganizationId, uuidv7(), now],
      );

      await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [userId]);
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [uuidv7(), userId, oidc.issuer, subject],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [uuidv7(), userId, tenantId],
      );
      const roleId = uuidv7();
      const membershipId = await owner.query<{ id: string }>(
        'SELECT id FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
        [userId, tenantId],
      );
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        roleId,
        tenantId,
        'Operations integration',
      ]);
      const permissions = [
        'operations.read',
        'operations.tasks.create',
        'operations.tasks.manage',
        'operations.tasks.assign',
        'operations.exceptions.manage',
        'schedule.read',
        'client.read',
        'employee.read',
        'organization.read',
      ];
      for (const permission of permissions) {
        await owner.query(
          'INSERT INTO identity.role_permissions (role_id, permission) VALUES ($1, $2)',
          [roleId, permission],
        );
      }
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [membershipId.rows[0]!.id, tenantId, roleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [membershipId.rows[0]!.id, tenantId],
      );
      await owner.query(
        'UPDATE employees.employees SET user_id = $1, updated_at = $2 WHERE id = $3',
        [userId, now, employeeId],
      );

      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = testDatabase.appUrl;
      process.env.OIDC_ISSUER = oidc.issuer;
      process.env.OIDC_CLIENT_ID = 'care-operations-integration';
      process.env.WEB_ORIGIN = 'http://localhost:3000';
      process.env.S3_ENDPOINT = 'http://127.0.0.1:8333';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'care-test-private';
      process.env.S3_ACCESS_KEY = 'care-test-access';
      process.env.S3_SECRET_KEY = 'care-test-secret';
      process.env.S3_FORCE_PATH_STYLE = 'true';

      api = await NestFactory.create(AppModule, { logger: false });
      const contextMiddleware = new RequestContextMiddleware();
      api.use((request: Request, response: Response, next: NextFunction) =>
        contextMiddleware.use(request as ApiRequest, response, next),
      );
      await api.listen(0, '127.0.0.1');
      const address = api.getHttpServer().address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyId })
        .setIssuer(oidc.issuer)
        .setAudience('care-operations-integration')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('2 minutes')
        .sign(privateKey);
      const headers = {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      };

      const firstWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, { headers });
      expect(firstWorklist.status).toBe(200);
      const firstItems = (await firstWorklist.json()) as {
        items: Array<{
          id: string;
          issueCode: string;
          status: string;
          firstDetectedAt: string;
        }>;
      };
      const missingAssignment = firstItems.items.find(
        (item) => item.issueCode === 'missing_assignment',
      );
      const snoozableIssue = firstItems.items.find(
        (item) => item.issueCode === 'client_preference',
      );
      expect(missingAssignment).toBeDefined();
      expect(snoozableIssue).toBeDefined();
      expect(typeof missingAssignment!.firstDetectedAt).toBe('string');

      const repeatedWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, { headers });
      const repeatedItems = (await repeatedWorklist.json()) as {
        items: Array<{ id: string; issueCode: string }>;
      };
      expect(repeatedItems.items.find((item) => item.issueCode === 'missing_assignment')?.id).toBe(
        missingAssignment!.id,
      );

      const dashboard = await fetch(`${baseUrl}/api/v1/operations/dashboard`, { headers });
      expect(dashboard.status).toBe(200);
      expect(await dashboard.json()).toMatchObject({
        categoryCounts: { scheduling: expect.any(Number) },
      });

      const acknowledged = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${snoozableIssue!.id}/acknowledge`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        },
      );
      if (acknowledged.status !== 200)
        throw new Error(`Exception acknowledgement failed: ${await acknowledged.text()}`);
      const acknowledgedWorklist = await fetch(
        `${baseUrl}/api/v1/operations/work-items?status=acknowledged`,
        { headers },
      );
      const acknowledgedItems = (await acknowledgedWorklist.json()) as {
        items: Array<{ id: string; status: string }>;
      };
      expect(acknowledgedItems.items).toContainEqual(
        expect.objectContaining({ id: snoozableIssue!.id, status: 'acknowledged' }),
      );

      const snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const snoozed = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${snoozableIssue!.id}/snooze`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ snoozedUntil, reason: 'Waiting for the office to confirm.' }),
        },
      );
      expect(snoozed.status).toBe(200);
      const snoozedWorklist = await fetch(
        `${baseUrl}/api/v1/operations/work-items?status=snoozed`,
        { headers },
      );
      const snoozedItems = (await snoozedWorklist.json()) as {
        items: Array<{ id: string; status: string }>;
      };
      expect(snoozedItems.items).toContainEqual(
        expect.objectContaining({ id: snoozableIssue!.id, status: 'snoozed' }),
      );

      await owner.query(
        `INSERT INTO scheduling.visit_assignments
           (id, tenant_id, visit_id, employee_id, status, assigned_at, assigned_by)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [uuidv7(), tenantId, visitId, employeeId, now, userId],
      );
      await owner.query(
        `UPDATE scheduling.client_scheduling_preferences
         SET preferred_employee_id = NULL, updated_at = $2
         WHERE tenant_id = $1 AND client_id = $3`,
        [tenantId, now, clientId],
      );
      const resolvedWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, { headers });
      const resolvedItems = (await resolvedWorklist.json()) as { items: Array<{ id: string }> };
      expect(resolvedItems.items.some((item) => item.id === missingAssignment!.id)).toBe(false);
      expect(resolvedItems.items.some((item) => item.id === snoozableIssue!.id)).toBe(false);

      await owner.query('DELETE FROM scheduling.visit_assignments WHERE visit_id = $1', [visitId]);
      await owner.query(
        `UPDATE scheduling.client_scheduling_preferences
         SET preferred_employee_id = $2, updated_at = $3
         WHERE tenant_id = $1 AND client_id = $4`,
        [tenantId, employeeId, now, clientId],
      );
      const recurringWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, {
        headers,
      });
      const recurringItems = (await recurringWorklist.json()) as {
        items: Array<{ id: string; issueCode: string; status: string }>;
      };
      const recurringIssue = recurringItems.items.find(
        (item) => item.issueCode === 'client_preference',
      );
      expect(recurringIssue).toMatchObject({ id: snoozableIssue!.id, status: 'open' });

      const exceptionHistory = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${snoozableIssue!.id}/history`,
        { headers },
      );
      expect(exceptionHistory.status).toBe(200);
      const exceptionHistoryBody = (await exceptionHistory.json()) as {
        totalOccurrences: number;
        totalInteractions: number;
        occurrences: Array<{ id: string; resolvedAt: string | null }>;
        interactions: Array<{
          occurrenceId: string | null;
          action: string;
          reason: string | null;
        }>;
      };
      expect(exceptionHistoryBody.totalOccurrences).toBe(2);
      expect(exceptionHistoryBody.occurrences).toHaveLength(2);
      const activeOccurrence = exceptionHistoryBody.occurrences.find(
        (row) => row.resolvedAt === null,
      );
      const previousOccurrence = exceptionHistoryBody.occurrences.find(
        (row) => row.resolvedAt !== null,
      );
      expect(activeOccurrence).toBeDefined();
      expect(previousOccurrence).toBeDefined();
      expect(activeOccurrence!.id).not.toBe(previousOccurrence!.id);
      expect(exceptionHistoryBody.totalInteractions).toBe(2);
      expect(exceptionHistoryBody.interactions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            occurrenceId: previousOccurrence!.id,
            action: 'acknowledged',
          }),
          expect.objectContaining({
            occurrenceId: previousOccurrence!.id,
            action: 'snoozed',
            reason: 'Waiting for the office to confirm.',
          }),
        ]),
      );

      const outsideSchedulingWindow = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
      await owner.query(
        `UPDATE scheduling.visits
         SET planned_start = $2, planned_end = $3, updated_at = $4
         WHERE tenant_id = $1 AND id = $5`,
        [
          tenantId,
          outsideSchedulingWindow,
          new Date(outsideSchedulingWindow.getTime() + 60 * 60 * 1000),
          now,
          visitId,
        ],
      );
      const outOfWindowWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, {
        headers,
      });
      const outOfWindowItems = (await outOfWindowWorklist.json()) as {
        items: Array<{ id: string }>;
      };
      expect(outOfWindowItems.items.some((item) => item.id === snoozableIssue!.id)).toBe(false);
      const outOfWindowHistory = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${snoozableIssue!.id}/history`,
        { headers },
      );
      const outOfWindowHistoryBody = (await outOfWindowHistory.json()) as {
        occurrences: Array<{ resolvedAt: string | null }>;
      };
      expect(
        outOfWindowHistoryBody.occurrences.filter((row) => row.resolvedAt === null),
      ).toHaveLength(1);

      await owner.query(
        `INSERT INTO scheduling.visit_assignments
           (id, tenant_id, visit_id, employee_id, status, assigned_at, assigned_by)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [uuidv7(), tenantId, visitId, employeeId, now, userId],
      );
      await owner.query(
        `UPDATE scheduling.client_scheduling_preferences
         SET preferred_employee_id = NULL, updated_at = $2
         WHERE tenant_id = $1 AND client_id = $3`,
        [tenantId, now, clientId],
      );
      await fetch(`${baseUrl}/api/v1/operations/work-items`, { headers });
      const reconciledHistory = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${snoozableIssue!.id}/history`,
        { headers },
      );
      const reconciledHistoryBody = (await reconciledHistory.json()) as {
        occurrences: Array<{ resolvedAt: string | null }>;
      };
      expect(
        reconciledHistoryBody.occurrences.filter((row) => row.resolvedAt === null),
      ).toHaveLength(0);

      const createTask = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          title: 'Call the client about next week',
          assignedEmployeeId: employeeId,
          dueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(createTask.status).toBe(201);
      const createdTask = (await createTask.json()) as {
        id: string;
        status: string;
        version: number;
        assignedEmployeeId: string;
      };
      expect(createdTask).toMatchObject({
        status: 'open',
        version: 1,
        assignedEmployeeId: employeeId,
      });

      const upcomingTasks = await fetch(`${baseUrl}/api/v1/operations/tasks?due=upcoming`, {
        headers,
      });
      expect(upcomingTasks.status).toBe(200);
      expect(
        ((await upcomingTasks.json()) as { items: Array<{ id: string }> }).items.some(
          (task) => task.id === createdTask.id,
        ),
      ).toBe(true);
      const taskDashboard = await fetch(`${baseUrl}/api/v1/operations/dashboard`, { headers });
      expect(taskDashboard.status).toBe(200);
      expect(await taskDashboard.json()).toMatchObject({ tasks: { assignedToMe: 1 } });

      const activityResponse = await fetch(
        `${baseUrl}/api/v1/operations/tasks/${createdTask.id}/activity`,
        { headers },
      );
      const createdActivity = (await activityResponse.json()) as Array<{ kind: string }>;
      expect(createdActivity.map((row) => row.kind)).toEqual(['created', 'assigned']);

      const taskDetail = await fetch(`${baseUrl}/api/v1/operations/tasks/${createdTask.id}`, {
        headers,
      });
      const taskDetailBody = (await taskDetail.json()) as Record<string, unknown>;
      expect(taskDetailBody).not.toHaveProperty('sourceClientId');
      expect(taskDetailBody).not.toHaveProperty('sourceVisitId');
      expect(taskDetailBody).not.toHaveProperty('tenantId');

      const comment = await fetch(`${baseUrl}/api/v1/operations/tasks/${createdTask.id}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ comment: 'Confirm the preferred time before Friday.' }),
      });
      expect(comment.status).toBe(201);

      const wrongAssignee = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          title: 'Invalid scoped assignment',
          assignedEmployeeId: otherEmployeeId,
        }),
      });
      expect(wrongAssignee.status).toBe(400);

      const completeTask = await fetch(
        `${baseUrl}/api/v1/operations/tasks/${createdTask.id}/complete`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: createdTask.version }),
        },
      );
      expect(completeTask.status).toBe(200);
      const completed = (await completeTask.json()) as {
        status: string;
        version: number;
        completedAt: string | null;
        completedByUserId: string | null;
      };
      expect(completed).toMatchObject({
        status: 'completed',
        version: 2,
        completedByUserId: userId,
      });
      expect(typeof completed.completedAt).toBe('string');

      const reopen = await fetch(`${baseUrl}/api/v1/operations/tasks/${createdTask.id}/reopen`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expectedVersion: completed.version }),
      });
      expect(reopen.status).toBe(200);
      expect(await reopen.json()).toMatchObject({ status: 'open', version: 3 });

      const completeActivity = await fetch(
        `${baseUrl}/api/v1/operations/tasks/${createdTask.id}/activity`,
        { headers },
      );
      const completeActivityRows = (await completeActivity.json()) as Array<{
        kind: string;
        comment: string | null;
      }>;
      expect(
        completeActivityRows.some(
          (row) =>
            row.kind === 'comment' && row.comment === 'Confirm the preferred time before Friday.',
        ),
      ).toBe(true);

      const clientTaskResponse = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          clientId,
          title: 'Client scoped follow-up',
          priority: 'urgent',
          assignedEmployeeId: employeeId,
        }),
      });
      expect(clientTaskResponse.status).toBe(201);
      const clientTask = (await clientTaskResponse.json()) as { id: string };
      const mismatchedTaskSource = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          clientId: otherClientId,
          title: 'Mismatched client reference',
          source: { type: 'client', id: clientId },
        }),
      });
      expect(mismatchedTaskSource.status).toBe(400);

      const clientScopedDashboard = await fetch(`${baseUrl}/api/v1/operations/dashboard`, {
        headers,
      });
      expect(await clientScopedDashboard.json()).toMatchObject({
        tasks: { assignedToMe: 2, urgent: 1 },
      });

      await owner.query(
        "DELETE FROM identity.role_permissions WHERE role_id = $1 AND permission = 'client.read'",
        [roleId],
      );
      const unauthorizedSource = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          title: 'Unauthorized source reference',
          source: { type: 'client', id: clientId },
        }),
      });
      expect(unauthorizedSource.status).toBe(403);

      const unauthorizedClientTask = await fetch(
        `${baseUrl}/api/v1/operations/tasks/${clientTask.id}`,
        { headers },
      );
      expect(unauthorizedClientTask.status).toBe(403);
      const unauthorizedExceptionHistory = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${snoozableIssue!.id}/history`,
        { headers },
      );
      expect(unauthorizedExceptionHistory.status).toBe(404);
      const scopedTaskList = await fetch(`${baseUrl}/api/v1/operations/tasks?pageSize=100`, {
        headers,
      });
      const scopedTasks = (await scopedTaskList.json()) as {
        items: Array<{ id: string; title: string }>;
        total: number;
      };
      expect(scopedTasks.total).toBe(1);
      expect(
        scopedTasks.items.some(
          (task) => task.id === clientTask.id || task.title === 'Client scoped follow-up',
        ),
      ).toBe(false);
      const crossTenant = await fetch(`${baseUrl}/api/v1/operations/tasks/${createdTask.id}`, {
        headers: { ...headers, 'X-Tenant-Id': otherTenantId },
      });
      expect(crossTenant.status).not.toBe(200);
      expect(await crossTenant.text()).not.toContain('Call the client about next week');

      const auditActions = await owner.query<{ action: string; metadata: Record<string, unknown> }>(
        'SELECT action, metadata FROM audit.audit_entries WHERE tenant_id = $1',
        [tenantId],
      );
      expect(auditActions.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'operations.exception_acknowledged',
          'operations.exception_snoozed',
          'operations.task_created',
          'operations.task_assigned',
          'operations.task_completed',
          'operations.task_reopened',
          'operations.task_comment_added',
        ]),
      );
      expect(JSON.stringify(auditActions.rows)).not.toContain('Call the client about next week');
      const outboxEvents = await owner.query<{ event_type: string }>(
        'SELECT event_type FROM platform.outbox_messages WHERE tenant_id = $1',
        [tenantId],
      );
      expect(outboxEvents.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining([
          'operations.exception_acknowledged',
          'operations.exception_snoozed',
          'operations.task_created',
          'operations.task_assigned',
          'operations.task_completed',
          'operations.task_reopened',
        ]),
      );

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const tenantTasks = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.tasks ORDER BY id',
      );
      expect(tenantTasks.rows.map((row) => row.id)).not.toContain(taskFromOtherTenantId);
      const tenantOccurrences = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.exception_occurrences ORDER BY id',
      );
      expect(tenantOccurrences.rows.map((row) => row.id)).toContain(previousOccurrence!.id);
      const tenantInteractions = await appRole.query<{ occurrence_id: string | null }>(
        'SELECT occurrence_id FROM operations.exception_interactions ORDER BY id',
      );
      expect(tenantInteractions.rows.map((row) => row.occurrence_id)).toContain(
        previousOccurrence!.id,
      );
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      const otherTenantTasks = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.tasks ORDER BY id',
      );
      expect(otherTenantTasks.rows.map((row) => row.id)).toEqual([taskFromOtherTenantId]);
      const otherTenantOccurrences = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.exception_occurrences ORDER BY id',
      );
      expect(otherTenantOccurrences.rows).toEqual([]);
      const otherTenantInteractions = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.exception_interactions ORDER BY id',
      );
      expect(otherTenantInteractions.rows).toEqual([]);
      await appRole.query('COMMIT');
    } finally {
      await api?.close().catch(() => undefined);
      await closeServer(oidc.server).catch(() => undefined);
      await appRole.end().catch(() => undefined);
      await owner.end().catch(() => undefined);
      await testDatabase.container.stop();
    }
  }, 300_000);
});

async function startOidcServer(jwk: JsonWebKey): Promise<{ server: Server; issuer: string }> {
  let issuer: string;
  let origin: string;
  const server = createServer((request, response) => {
    if (request.url === '/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${origin}/jwks`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      );
    } else if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  issuer = `${origin}/`;
  return { server, issuer };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
