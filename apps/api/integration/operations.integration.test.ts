import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { v7 as uuidv7 } from 'uuid';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { AuditWriter } from '@care/audit';
import type { BenefitsApplicationService } from '@care/benefits';
import type { UnitOfWork } from '@care/database';
import {
  OperationsDeadlineTaskScheduler,
  type OperationsRecurrenceApplicationService,
} from '@care/operations';
import { readOperationsDeadlineCases } from '@care/onboarding';
import type { OutboxWriter } from '@care/platform';
import { startCareTestDatabase } from '@care/testing';
import { AppModule } from '@app/api/app.module';
import { configureApiHttp, createApiFastifyAdapter } from '@app/api/http/fastify';
import {
  AUDIT_WRITER,
  BENEFITS_APPLICATION,
  OPERATIONS_RECURRENCE_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '@app/api/tokens';

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
    const otherTenantClientId = uuidv7();
    const employeeId = uuidv7();
    const otherEmployeeId = uuidv7();
    const visitId = uuidv7();
    const agreementId = uuidv7();
    const admissionCaseId = uuidv7();
    const benefitFundingSourceId = uuidv7();
    const benefitEntitlementId = uuidv7();
    const payerArrangementId = uuidv7();
    const invoiceId = uuidv7();
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
    let api: NestFastifyApplication | undefined;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const inEightDays = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const inNineDays = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const inTenDays = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

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
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Second', 'Tenant', 'active', $5, $5)`,
        [otherTenantClientId, otherTenantId, otherOrganizationId, otherFacilityId, now],
      );
      const agreementValidUntil = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await owner.query(
        `INSERT INTO service_agreements.agreements
           (id, tenant_id, client_id, organization_id, facility_id, status, valid_from, valid_until, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8)`,
        [
          agreementId,
          tenantId,
          clientId,
          organizationId,
          facilityId,
          now.toISOString().slice(0, 10),
          agreementValidUntil,
          now,
        ],
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
        `INSERT INTO benefits.funding_sources
           (id, tenant_id, client_id, source_type, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'other', 'active', $4, $5, $5)`,
        [benefitFundingSourceId, tenantId, clientId, userId, now],
      );
      await owner.query(
        `INSERT INTO benefits.client_entitlements
           (id, tenant_id, client_id, benefit_type, funding_source_id, valid_from, valid_until,
            status, calculation_mode, source, verified_at, version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'other', $4, $5, $6, 'confirmed', 'external_input',
                 'provider_reported', $7, 1, $8, $7, $7)`,
        [
          benefitEntitlementId,
          tenantId,
          clientId,
          benefitFundingSourceId,
          today,
          inEightDays,
          now,
          userId,
        ],
      );
      await owner.query(
        `INSERT INTO billing.payer_arrangements
           (id, tenant_id, organization_id, client_id, payer_type, arrangement_type, recipient_type,
            mandate_status, valid_from, valid_until, version, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'other', 'other', 'client', 'authorized', $5, $6, 1, $7, $7, $8, $8)`,
        [payerArrangementId, tenantId, organizationId, clientId, today, inNineDays, userId, now],
      );
      await owner.query(
        `INSERT INTO billing.invoices
           (id, tenant_id, organization_id, facility_id, client_id, recipient_type,
            recipient_snapshot, issuer_snapshot, invoice_number, issue_date, due_date, currency,
            subtotal_cents, tax_total_cents, grand_total_cents, status, version, created_by,
            issued_by, issued_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'client', '{}'::jsonb, '{}'::jsonb, $6, $7, $8,
                 'EUR', 1000, 0, 1000, 'issued', 1, $9, $9, $10, $10, $10)`,
        [
          invoiceId,
          tenantId,
          organizationId,
          facilityId,
          clientId,
          `OPS-${invoiceId.slice(0, 8)}`,
          today,
          inEightDays,
          userId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO onboarding.cases
           (id, tenant_id, organization_id, facility_id, first_name, last_name, contact_method,
            preferred_start_date, inquiry_source, stage, next_follow_up_at, last_activity_at,
            created_by_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'New', 'Admission', 'phone', $5, 'operations integration',
                 'inquiry', $6, $7, $8, $7, $7)`,
        [
          admissionCaseId,
          tenantId,
          organizationId,
          facilityId,
          inEightDays,
          inTenDays,
          now,
          userId,
        ],
      );
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
        'operations.reminder_settings.manage',
        'schedule.read',
        'client.read',
        'employee.read',
        'organization.read',
        'service_agreement.read',
        'benefits.review',
        'billing.read',
        'billing.payments.read',
        'onboarding.read',
        'operations.recurring_tasks.manage',
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

      api = await NestFactory.create<NestFastifyApplication>(AppModule, createApiFastifyAdapter(), {
        logger: false,
      });
      await configureApiHttp(api, 'http://localhost:3000');
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

      const onboardingPolicyResponse = await fetch(
        `${baseUrl}/api/v1/operations/reminder-settings`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            organizationId,
            category: 'onboarding',
            offsetsDays: [14, 3, 0],
            enabled: true,
            createFollowUpTask: false,
            expectedVersion: 0,
          }),
        },
      );
      expect(onboardingPolicyResponse.status).toBe(200);
      expect(await onboardingPolicyResponse.json()).toMatchObject({
        category: 'onboarding',
        offsetsDays: [14, 3, 0],
      });

      const agreementPolicyResponse = await fetch(
        `${baseUrl}/api/v1/operations/reminder-settings`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            organizationId,
            category: 'agreements',
            offsetsDays: [30, 7, 0],
            enabled: true,
            createFollowUpTask: true,
            assignedEmployeeId: employeeId,
            expectedVersion: 0,
          }),
        },
      );
      expect(agreementPolicyResponse.status).toBe(200);
      const deadlineScheduler = new OperationsDeadlineTaskScheduler(
        api!.get<UnitOfWork>(UNIT_OF_WORK),
        api!.get<AuditWriter>(AUDIT_WRITER),
        api!.get<OutboxWriter>(OUTBOX_WRITER),
        {
          benefits: api!.get<BenefitsApplicationService>(BENEFITS_APPLICATION),
          onboardingCases: readOperationsDeadlineCases,
        },
      );
      const firstDeadlineRun = await deadlineScheduler.run(
        tenantId,
        'operations-integration-deadlines',
        now,
      );
      expect(firstDeadlineRun).toMatchObject({ status: 'succeeded', tasksCreated: 1 });
      const scheduledAgreementOccurrences = await owner.query<{
        first_detected_at: Date;
        last_observed_at: Date;
      }>(
        `SELECT first_detected_at, last_observed_at
         FROM operations.exception_occurrences
         WHERE tenant_id = $1 AND issue_code = 'agreement_expiry'
           AND source_entity_id = $2 AND resolved_at IS NULL`,
        [tenantId, agreementId],
      );
      expect(scheduledAgreementOccurrences.rows).toHaveLength(1);
      const scheduledDomainDeadlines = await owner.query<{
        source_entity_id: string;
        issue_code: string;
      }>(
        `SELECT source_entity_id, issue_code
         FROM operations.exception_occurrences
         WHERE tenant_id = $1 AND resolved_at IS NULL`,
        [tenantId],
      );
      const scheduledDeadlineKeys = new Set(
        scheduledDomainDeadlines.rows.map((row) => `${row.source_entity_id}:${row.issue_code}`),
      );
      expect(scheduledDeadlineKeys).toContain(`${benefitEntitlementId}:benefit_entitlement_expiry`);
      expect(scheduledDeadlineKeys).toContain(`${payerArrangementId}:payer_authorization_expiry`);
      expect(scheduledDeadlineKeys).toContain(`${invoiceId}:receivable_due`);
      expect(scheduledDeadlineKeys).toContain(`${admissionCaseId}:admission_follow_up_due`);
      expect(scheduledDeadlineKeys).toContain(`${admissionCaseId}:admission_start_date`);
      const repeatedDeadlineRun = await deadlineScheduler.run(
        tenantId,
        'operations-integration-deadlines-retry',
        new Date(now.getTime() + 60_000),
      );
      expect(repeatedDeadlineRun).toMatchObject({ status: 'succeeded', tasksCreated: 0 });
      const repeatedAgreementOccurrences = await owner.query<{
        first_detected_at: Date;
        last_observed_at: Date;
      }>(
        `SELECT first_detected_at, last_observed_at
         FROM operations.exception_occurrences
         WHERE tenant_id = $1 AND issue_code = 'agreement_expiry'
           AND source_entity_id = $2 AND resolved_at IS NULL`,
        [tenantId, agreementId],
      );
      expect(repeatedAgreementOccurrences.rows).toHaveLength(1);
      expect(repeatedAgreementOccurrences.rows[0]!.first_detected_at).toEqual(
        scheduledAgreementOccurrences.rows[0]!.first_detected_at,
      );
      const generatedAgreementTasks = await owner.query<{
        id: string;
        assigned_employee_id: string | null;
        status: string;
      }>(
        `SELECT id, assigned_employee_id, status
         FROM operations.tasks
         WHERE tenant_id = $1 AND source_agreement_id = $2 AND source_deadline_key IS NOT NULL`,
        [tenantId, agreementId],
      );
      expect(generatedAgreementTasks.rows).toHaveLength(1);
      expect(generatedAgreementTasks.rows[0]).toMatchObject({
        assigned_employee_id: employeeId,
        status: 'open',
      });

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
        deadlineCounts: {
          overdue: expect.any(Number),
          today: expect.any(Number),
          upcoming: expect.any(Number),
        },
      });

      const deadlinesResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=agreements`,
        { headers },
      );
      expect(deadlinesResponse.status).toBe(200);
      const deadlines = (await deadlinesResponse.json()) as {
        items: Array<{
          id: string;
          issueCode: string;
          sourceEntityId: string;
          dueAt: string | null;
        }>;
      };
      const agreementDeadline = deadlines.items.find(
        (item) => item.sourceEntityId === agreementId && item.issueCode === 'agreement_expiry',
      );
      expect(agreementDeadline?.dueAt).toBeDefined();
      const assignedDeadlineResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=agreements&assignedEmployeeId=${employeeId}`,
        { headers },
      );
      expect(assignedDeadlineResponse.status).toBe(200);
      const assignedDeadlines = (await assignedDeadlineResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(assignedDeadlines.items.map((item) => item.id)).toContain(agreementDeadline!.id);
      const otherAssignedDeadlineResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=agreements&assignedEmployeeId=${otherEmployeeId}`,
        { headers },
      );
      const otherAssignedDeadlines = (await otherAssignedDeadlineResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(otherAssignedDeadlines.items.map((item) => item.id)).not.toContain(
        agreementDeadline!.id,
      );

      const benefitsDeadlinesResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=benefits`,
        { headers },
      );
      const benefitsDeadlines = (await benefitsDeadlinesResponse.json()) as {
        items: Array<{
          id: string;
          issueCode: string;
          sourceEntityId: string;
          dueAt: string | null;
        }>;
      };
      const entitlementDeadline = benefitsDeadlines.items.find(
        (item) =>
          item.sourceEntityId === benefitEntitlementId &&
          item.issueCode === 'benefit_entitlement_expiry',
      );
      expect(entitlementDeadline?.dueAt).toBeDefined();

      const billingDeadlinesResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=billing`,
        { headers },
      );
      const billingDeadlines = (await billingDeadlinesResponse.json()) as {
        items: Array<{
          id: string;
          issueCode: string;
          sourceEntityId: string;
          dueAt: string | null;
        }>;
      };
      const payerArrangementDeadline = billingDeadlines.items.find(
        (item) =>
          item.sourceEntityId === payerArrangementId &&
          item.issueCode === 'payer_authorization_expiry',
      );
      expect(payerArrangementDeadline?.dueAt).toBeDefined();

      const onboardingDeadlinesResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=onboarding`,
        { headers },
      );
      const onboardingDeadlines = (await onboardingDeadlinesResponse.json()) as {
        items: Array<{
          id: string;
          issueCode: string;
          sourceEntityId: string;
          dueAt: string | null;
        }>;
      };
      const onboardingFollowUpDeadline = onboardingDeadlines.items.find(
        (item) =>
          item.sourceEntityId === admissionCaseId && item.issueCode === 'admission_follow_up_due',
      );
      const onboardingStartDateDeadline = onboardingDeadlines.items.find(
        (item) =>
          item.sourceEntityId === admissionCaseId && item.issueCode === 'admission_start_date',
      );
      expect(onboardingFollowUpDeadline?.dueAt).toBeDefined();
      expect(onboardingStartDateDeadline?.dueAt).toBeDefined();

      const followUpResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines/${agreementDeadline!.id}/tasks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'Review agreement expiry', priority: 'high' }),
        },
      );
      expect(followUpResponse.status).toBe(201);
      const followUpTask = (await followUpResponse.json()) as {
        id: string;
        source: { type: string; id: string };
      };
      expect(followUpTask.source).toEqual({ type: 'service_agreement', id: agreementId });
      const repeatedFollowUpResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines/${agreementDeadline!.id}/tasks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'Review agreement expiry', priority: 'high' }),
        },
      );
      expect(repeatedFollowUpResponse.status).toBe(201);
      expect((await repeatedFollowUpResponse.json()).id).toBe(followUpTask.id);

      await owner.query(
        `UPDATE service_agreements.agreements SET valid_until = $3, updated_at = $4
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, agreementId, inTenDays.toISOString().slice(0, 10), now],
      );
      const updatedAgreementDeadlinesResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=agreements`,
        { headers },
      );
      const updatedAgreementDeadlines = (await updatedAgreementDeadlinesResponse.json()) as {
        items: Array<{ id: string; sourceEntityId: string; dueAt: string | null }>;
      };
      const updatedAgreementDeadline = updatedAgreementDeadlines.items.find(
        (item) => item.sourceEntityId === agreementId,
      );
      expect(updatedAgreementDeadline?.id).toBe(agreementDeadline!.id);
      expect(updatedAgreementDeadline?.dueAt).not.toBe(agreementDeadline!.dueAt);
      const changedAgreementHistoryResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${agreementDeadline!.id}/history?page=1&pageSize=1`,
        { headers },
      );
      const changedAgreementHistory = (await changedAgreementHistoryResponse.json()) as {
        page: number;
        pageSize: number;
        totalOccurrences: number;
        occurrences: Array<{ sourceAt: string | null; resolvedAt: string | null }>;
      };
      expect(changedAgreementHistory).toMatchObject({
        page: 1,
        pageSize: 1,
        totalOccurrences: 2,
      });
      expect(changedAgreementHistory.occurrences).toHaveLength(1);
      const secondAgreementHistoryResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${agreementDeadline!.id}/history?page=2&pageSize=1`,
        { headers },
      );
      const secondAgreementHistory = (await secondAgreementHistoryResponse.json()) as {
        page: number;
        pageSize: number;
        totalOccurrences: number;
        occurrences: Array<{ sourceAt: string | null; resolvedAt: string | null }>;
      };
      expect(secondAgreementHistory).toMatchObject({
        page: 2,
        pageSize: 1,
        totalOccurrences: 2,
      });
      expect(secondAgreementHistory.occurrences).toHaveLength(1);
      expect(
        [changedAgreementHistory, secondAgreementHistory].flatMap((history) =>
          history.occurrences.filter((item) => item.resolvedAt === null),
        ),
      ).toHaveLength(1);

      const recurrenceStartDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const recurrenceResponse = await fetch(`${baseUrl}/api/v1/operations/recurring-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          facilityId,
          clientId,
          title: 'Annual administrative review',
          priority: 'normal',
          assignedEmployeeId: employeeId,
          rule: { frequency: 'yearly', interval: 1 },
          timezone: 'Europe/Berlin',
          startDate: recurrenceStartDate,
          timeOfDay: '09:00',
          generationPolicy: 'generate_missed',
        }),
      });
      expect(recurrenceResponse.status).toBe(201);
      const recurrence = (await recurrenceResponse.json()) as { id: string };
      const recurrenceScheduler = api!.get<OperationsRecurrenceApplicationService>(
        OPERATIONS_RECURRENCE_APPLICATION,
      );
      const concurrentRuns = await Promise.all([
        recurrenceScheduler.runRecurringTaskScheduler(tenantId, 'operations-integration', now),
        recurrenceScheduler.runRecurringTaskScheduler(tenantId, 'operations-integration-2', now),
      ]);
      expect(concurrentRuns.map((run) => run.status).sort()).toEqual(['busy', 'succeeded']);
      expect(concurrentRuns.reduce((total, run) => total + run.tasksCreated, 0)).toBe(1);
      const generatedOccurrencesResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${recurrence.id}/occurrences`,
        { headers },
      );
      expect(generatedOccurrencesResponse.status).toBe(200);
      const generatedOccurrences = (await generatedOccurrencesResponse.json()) as Array<{
        taskId: string;
        occurrenceDate: string;
      }>;
      expect(generatedOccurrences).toHaveLength(1);
      const generatedTask = await owner.query<{ id: string; status: string }>(
        'SELECT id, status FROM operations.tasks WHERE tenant_id = $1 AND id = $2',
        [tenantId, generatedOccurrences[0]!.taskId],
      );
      expect(generatedTask.rows).toEqual([{ id: generatedOccurrences[0]!.taskId, status: 'open' }]);

      const recurrenceDetailsResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${recurrence.id}`,
        { headers },
      );
      const recurrenceDetails = (await recurrenceDetailsResponse.json()) as {
        version: number;
      };
      const pausedRecurrenceResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${recurrence.id}/pause`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: recurrenceDetails.version }),
        },
      );
      expect(pausedRecurrenceResponse.status).toBe(200);
      const pausedRecurrence = (await pausedRecurrenceResponse.json()) as {
        status: string;
        version: number;
      };
      expect(pausedRecurrence.status).toBe('paused');
      expect(generatedTask.rows[0]?.status).toBe('open');
      const resumedRecurrenceResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${recurrence.id}/resume`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: pausedRecurrence.version }),
        },
      );
      expect(resumedRecurrenceResponse.status).toBe(200);
      const resumedRecurrence = (await resumedRecurrenceResponse.json()) as {
        status: string;
        version: number;
      };
      expect(resumedRecurrence.status).toBe('active');
      const endedRecurrenceResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${recurrence.id}/end`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: resumedRecurrence.version }),
        },
      );
      expect(endedRecurrenceResponse.status).toBe(200);
      expect(await endedRecurrenceResponse.json()).toMatchObject({ status: 'ended' });

      const skipMissedRecurrenceResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            organizationId,
            facilityId,
            title: 'Skip missed annual review',
            rule: { frequency: 'yearly', interval: 1 },
            timezone: 'Europe/Berlin',
            startDate: recurrenceStartDate,
            timeOfDay: '09:00',
            generationPolicy: 'skip_missed',
          }),
        },
      );
      expect(skipMissedRecurrenceResponse.status).toBe(201);
      const skipMissedRecurrence = (await skipMissedRecurrenceResponse.json()) as { id: string };
      const skipMissedRun = await recurrenceScheduler.runRecurringTaskScheduler(
        tenantId,
        'operations-integration-skip-missed',
        now,
      );
      expect(skipMissedRun).toMatchObject({ status: 'succeeded', tasksCreated: 0 });
      const skippedOccurrencesResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${skipMissedRecurrence.id}/occurrences`,
        { headers },
      );
      expect(await skippedOccurrencesResponse.json()).toEqual([]);
      const skippedDefinitionResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks/${skipMissedRecurrence.id}`,
        { headers },
      );
      expect(await skippedDefinitionResponse.json()).toMatchObject({ status: 'active' });

      await owner.query(
        `UPDATE service_agreements.agreements SET status = 'ended', updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, agreementId, now],
      );
      await owner.query(
        `UPDATE benefits.client_entitlements SET status = 'ended', updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, benefitEntitlementId, now],
      );
      await owner.query(
        `UPDATE billing.payer_arrangements SET mandate_status = 'revoked', updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, payerArrangementId, now],
      );
      await owner.query(
        `UPDATE onboarding.cases SET preferred_start_date = NULL, next_follow_up_at = NULL, updated_at = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, admissionCaseId, now],
      );
      const resolvedDeadlinesResponse = await fetch(
        `${baseUrl}/api/v1/operations/deadlines?category=agreements`,
        { headers },
      );
      const resolvedDeadlines = (await resolvedDeadlinesResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(resolvedDeadlines.items.some((item) => item.id === agreementDeadline!.id)).toBe(false);
      const resolvedSourceDeadlines = await Promise.all(
        ['benefits', 'billing', 'onboarding'].map(async (category) => {
          const response = await fetch(
            `${baseUrl}/api/v1/operations/deadlines?category=${category}`,
            { headers },
          );
          return (await response.json()) as { items: Array<{ id: string }> };
        }),
      );
      const resolvedDeadlineIds = new Set(
        resolvedSourceDeadlines.flatMap((result) => result.items.map((item) => item.id)),
      );
      expect(resolvedDeadlineIds.has(entitlementDeadline!.id)).toBe(false);
      expect(resolvedDeadlineIds.has(payerArrangementDeadline!.id)).toBe(false);
      expect(resolvedDeadlineIds.has(onboardingFollowUpDeadline!.id)).toBe(false);
      expect(resolvedDeadlineIds.has(onboardingStartDateDeadline!.id)).toBe(false);
      const deadlineHistoryResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${agreementDeadline!.id}/history`,
        { headers },
      );
      expect(deadlineHistoryResponse.status).toBe(200);
      expect(await deadlineHistoryResponse.json()).toMatchObject({
        issueId: agreementDeadline!.id,
        occurrences: [
          expect.objectContaining({ resolvedAt: expect.any(String) }),
          expect.objectContaining({ resolvedAt: expect.any(String) }),
        ],
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
      expect(await taskDashboard.json()).toMatchObject({ tasks: { assignedToMe: 3 } });

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
        tasks: { assignedToMe: 4, urgent: 1 },
      });

      await owner.query(
        "DELETE FROM identity.role_permissions WHERE role_id = $1 AND permission = 'client.read'",
        [roleId],
      );
      const scopedRecurrencesResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks?page=1&pageSize=1`,
        { headers },
      );
      expect(scopedRecurrencesResponse.status).toBe(200);
      expect(await scopedRecurrencesResponse.json()).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 1,
        items: [expect.objectContaining({ id: skipMissedRecurrence.id })],
      });
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
      const tenantRecurrences = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.recurring_task_definitions ORDER BY id',
      );
      expect(tenantRecurrences.rows.map((row) => row.id)).toEqual(
        expect.arrayContaining([recurrence.id, skipMissedRecurrence.id]),
      );
      const tenantRecurringOccurrences = await appRole.query<{ task_id: string }>(
        'SELECT task_id FROM operations.recurring_task_occurrences ORDER BY task_id',
      );
      expect(tenantRecurringOccurrences.rows.map((row) => row.task_id)).toEqual([
        generatedOccurrences[0]!.taskId,
      ]);
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
      const otherTenantRecurrences = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.recurring_task_definitions ORDER BY id',
      );
      expect(otherTenantRecurrences.rows).toEqual([]);
      const otherTenantRecurringOccurrences = await appRole.query<{ task_id: string }>(
        'SELECT task_id FROM operations.recurring_task_occurrences ORDER BY task_id',
      );
      expect(otherTenantRecurringOccurrences.rows).toEqual([]);
      const otherTenantInteractions = await appRole.query<{ id: string }>(
        'SELECT id FROM operations.exception_interactions ORDER BY id',
      );
      expect(otherTenantInteractions.rows).toEqual([]);
      await appRole.query('COMMIT');
      const pagedAgreementIds = Array.from({ length: 501 }, () => uuidv7());
      await owner.query(
        `INSERT INTO service_agreements.agreements
           (id, tenant_id, client_id, organization_id, facility_id, status, valid_from, valid_until, created_at, updated_at)
         SELECT agreement_id, $2, $3, $4, $5, 'active', $6, $7, $8, $8
         FROM unnest($1::uuid[]) AS generated(agreement_id)`,
        [
          pagedAgreementIds,
          otherTenantId,
          otherTenantClientId,
          otherOrganizationId,
          otherFacilityId,
          today,
          inEightDays,
          now,
        ],
      );
      const firstPagedDeadlineRun = await deadlineScheduler.run(
        otherTenantId,
        'operations-integration-deadline-pages',
        now,
      );
      expect(firstPagedDeadlineRun).toMatchObject({
        status: 'succeeded',
        tasksCreated: 0,
        remindersTriggered: 500,
      });
      const agreementCursorAfterFirstPage = await owner.query<{ cursor: string | null }>(
        `SELECT projection_cursors->>'service_agreements:agreement_expiry' AS cursor
         FROM operations.scheduler_runs
         WHERE tenant_id = $1 AND job_name = 'deadline_evaluation'`,
        [otherTenantId],
      );
      expect(agreementCursorAfterFirstPage.rows[0]?.cursor).toBeTruthy();
      const secondPagedDeadlineRun = await deadlineScheduler.run(
        otherTenantId,
        'operations-integration-deadline-pages-retry',
        new Date(now.getTime() + 60_000),
      );
      expect(secondPagedDeadlineRun).toMatchObject({
        status: 'succeeded',
        tasksCreated: 0,
        remindersTriggered: 1,
      });
      const agreementCursorAfterSecondPage = await owner.query<{ cursor: string | null }>(
        `SELECT projection_cursors->>'service_agreements:agreement_expiry' AS cursor
         FROM operations.scheduler_runs
         WHERE tenant_id = $1 AND job_name = 'deadline_evaluation'`,
        [otherTenantId],
      );
      expect(agreementCursorAfterSecondPage.rows[0]?.cursor).toBeNull();
      const pagedAgreementOccurrences = await owner.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM operations.exception_occurrences
         WHERE tenant_id = $1 AND issue_code = 'agreement_expiry' AND resolved_at IS NULL`,
        [otherTenantId],
      );
      expect(pagedAgreementOccurrences.rows[0]?.count).toBe('501');
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
