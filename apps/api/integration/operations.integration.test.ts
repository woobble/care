import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '@app/api/app.module';
import { configureApiHttp, createApiFastifyAdapter } from '@app/api/http/fastify';
import {
  ORGANIZATION_APPLICATION,
  OPERATIONS_APPLICATION,
  CLIENT_APPLICATION,
  AUDIT_WRITER,
  BENEFITS_APPLICATION,
  OPERATIONS_RECURRENCE_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '@app/api/tokens';

import type { AuditWriter } from '@care/audit';
import { BenefitEntitlementExpiryQueries, type BenefitsApplicationService } from '@care/benefits';
import { PayerArrangementExpiryQueries } from '@care/billing';
import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import { QualificationExpiryQueries } from '@care/employees';
import { readOperationsDeadlineCases } from '@care/onboarding';
import {
  type OperationsApplicationService,
  OperationsDeadlineTaskScheduler,
  type OperationsRecurrenceApplicationService,
} from '@care/operations';
import type { OrganizationApplicationService } from '@care/organizations';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { AgreementExpiryQueries } from '@care/service-agreements';
import { startCareTestDatabase } from '@care/testing';

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
    const qualificationId = uuidv7();
    const employeeQualificationId = uuidv7();
    const extraQualificationIds = Array.from({ length: 101 }, () => uuidv7());
    const extraEmployeeQualificationIds = Array.from({ length: 101 }, () => uuidv7());
    const extraAdmissionIds = Array.from({ length: 501 }, () => uuidv7());
    const extraExecutionVisitIds = Array.from({ length: 101 }, () => uuidv7());
    const extraExecutionIds = Array.from({ length: 101 }, () => uuidv7());
    const missingEvidenceVisitId = uuidv7();
    const missingEvidenceExecutionId = uuidv7();
    const missingEvidenceServiceId = uuidv7();
    const missingEvidenceDocumentId = uuidv7();
    const serviceCategoryId = uuidv7();
    const serviceDefinitionId = uuidv7();
    const visitId = uuidv7();
    const agreementId = uuidv7();
    const admissionCaseId = uuidv7();
    const overdueFollowUpCaseId = uuidv7();
    const benefitFundingSourceId = uuidv7();
    const benefitEntitlementId = uuidv7();
    const payerArrangementId = uuidv7();
    const invoiceId = uuidv7();
    const overdueInvoiceId = uuidv7();
    const rejectedClaimPayerId = uuidv7();
    const rejectedClaimArrangementId = uuidv7();
    const rejectedClaimId = uuidv7();
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
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const inEightDays = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const inNineDays = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const inTenDays = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const overdueFollowUpAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const missingEvidencePlannedStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const missingEvidencePlannedEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const missingEvidenceActualEnd = new Date(
      missingEvidencePlannedStart.getTime() + 60 * 60 * 1000,
    );

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
        `INSERT INTO services.service_categories
           (id, tenant_id, name, status, created_at, updated_at)
         VALUES ($1, $2, 'Operations test category', 'active', $3, $3)`,
        [serviceCategoryId, tenantId, now],
      );
      await owner.query(
        `INSERT INTO services.service_definitions
           (id, tenant_id, code, name, category_id, unit, status, valid_from, created_at, updated_at)
         VALUES ($1, $2, 'OPS-MISSING-EVIDENCE', 'Operations missing evidence service', $3,
                 'occurrence', 'active', $4, $5, $5)`,
        [serviceDefinitionId, tenantId, serviceCategoryId, today, now],
      );
      await owner.query(
        `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status,
            planned_start, planned_end, timezone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed', $6, $7, 'Europe/Berlin', $8, $8)`,
        [
          missingEvidenceVisitId,
          tenantId,
          clientId,
          organizationId,
          facilityId,
          missingEvidencePlannedStart,
          missingEvidencePlannedEnd,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO visit_execution.executions
           (id, tenant_id, visit_id, status, actual_start, started_by_employee_id,
            version, created_at, updated_at)
         VALUES ($1, $2, $3, 'in_progress', $4, $5, 1, $6, $6)`,
        [
          missingEvidenceExecutionId,
          tenantId,
          missingEvidenceVisitId,
          missingEvidencePlannedStart,
          employeeId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO visit_execution.performed_services
           (id, tenant_id, execution_id, visit_id, service_definition_id, service_code_snapshot,
            service_name_snapshot, unit_snapshot, actual_quantity, status, performed_by_employee_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'OPS-MISSING-EVIDENCE',
                 'Operations missing evidence service', 'occurrence', 1, 'performed', $6, $7, $7)`,
        [
          missingEvidenceServiceId,
          tenantId,
          missingEvidenceExecutionId,
          missingEvidenceVisitId,
          serviceDefinitionId,
          employeeId,
          now,
        ],
      );
      await owner.query(
        `UPDATE visit_execution.executions
         SET status = 'completed', actual_end = $3, completed_by_employee_id = $4, updated_at = $5
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, missingEvidenceExecutionId, missingEvidenceActualEnd, employeeId, now],
      );
      await owner.query(
        `INSERT INTO care_documentation.documents
           (id, tenant_id, visit_id, execution_id, status, created_by_employee_id,
            finalized_by_employee_id, finalized_at, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'finalized', $5, $5, $6, 1, $6, $6)`,
        [
          missingEvidenceDocumentId,
          tenantId,
          missingEvidenceVisitId,
          missingEvidenceExecutionId,
          employeeId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO employees.qualification_definitions
           (id, tenant_id, name, status, created_at, updated_at)
         VALUES ($1, $2, 'Operations qualification', 'active', $3, $3)`,
        [qualificationId, tenantId, now],
      );
      await owner.query(
        `INSERT INTO employees.qualification_definitions
           (id, tenant_id, name, status, created_at, updated_at)
         SELECT definition_id, $1, 'Operations qualification ' || ordinality, 'active', $2, $2
         FROM unnest($3::uuid[]) WITH ORDINALITY AS qualifications(definition_id, ordinality)`,
        [tenantId, now, extraQualificationIds],
      );
      await owner.query(
        `INSERT INTO employees.employee_qualifications
           (id, tenant_id, employee_id, qualification_id, valid_from, valid_until, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7)`,
        [employeeQualificationId, tenantId, employeeId, qualificationId, today, inEightDays, now],
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
        `INSERT INTO employees.employee_qualifications
           (id, tenant_id, employee_id, qualification_id, valid_from, valid_until, status, created_at, updated_at)
         SELECT employee_qualification_id, $1, $2, qualification_id, $3, $4, 'active', $5, $5
         FROM unnest($6::uuid[], $7::uuid[]) AS qualifications(employee_qualification_id, qualification_id)`,
        [
          tenantId,
          employeeId,
          today,
          inEightDays,
          now,
          extraEmployeeQualificationIds,
          extraQualificationIds,
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
        `INSERT INTO billing.payers
           (id, tenant_id, organization_id, payer_type, name, status, valid_from, version,
            created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'other', 'Operations projection payer', 'active', $4, 1, $5, $5, $6, $6)`,
        [rejectedClaimPayerId, tenantId, organizationId, today, userId, now],
      );
      await owner.query(
        `INSERT INTO billing.payer_arrangements
           (id, tenant_id, organization_id, client_id, payer_id, payer_type, arrangement_type,
            recipient_type, mandate_status, valid_from, version, created_by, updated_by,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'other', 'reimbursement_to_client', 'client',
                 'not_applicable', $6, 1, $7, $7, $8, $8)`,
        [
          rejectedClaimArrangementId,
          tenantId,
          organizationId,
          clientId,
          rejectedClaimPayerId,
          today,
          userId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO billing.claims
           (id, tenant_id, organization_id, facility_id, client_id, invoice_id, payer_id,
            payer_arrangement_id, arrangement_type, funding_source_type, status, currency,
            amount_cents, invoice_version, invoice_snapshot, payer_snapshot, arrangement_snapshot,
            profile_snapshot, snapshot_hash, package_version, package_hash, version, created_by,
            updated_by, created_at, updated_at, prepared_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reimbursement_to_client', 'other',
                 'rejected', 'EUR', 1000, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 repeat('a', 64), 1, repeat('b', 64), 2, $9, $9, $10, $10, $10)`,
        [
          rejectedClaimId,
          tenantId,
          organizationId,
          facilityId,
          clientId,
          invoiceId,
          rejectedClaimPayerId,
          rejectedClaimArrangementId,
          userId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO billing.invoices
           (id, tenant_id, organization_id, facility_id, client_id, recipient_type,
            recipient_snapshot, issuer_snapshot, invoice_number, issue_date, due_date, currency,
            subtotal_cents, tax_total_cents, grand_total_cents, status, version, created_by,
            issued_by, issued_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'client', '{}'::jsonb, '{}'::jsonb, $6, $7, $7,
                 'EUR', 800, 0, 800, 'issued', 1, $8, $8, $9, $9, $9)`,
        [
          overdueInvoiceId,
          tenantId,
          organizationId,
          facilityId,
          clientId,
          `OPS-OVERDUE-${overdueInvoiceId.slice(0, 8)}`,
          twoDaysAgo,
          userId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO onboarding.cases
           (id, tenant_id, organization_id, facility_id, first_name, last_name, contact_method,
            preferred_start_date, inquiry_source, stage, next_follow_up_at, last_activity_at,
            created_by_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'New', $9, 'phone', $5, 'operations integration',
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
          admissionCaseId,
        ],
      );
      await owner.query(
        `INSERT INTO onboarding.cases
           (id, tenant_id, organization_id, facility_id, first_name, last_name, contact_method,
            inquiry_source, stage, next_follow_up_at, last_activity_at, created_by_user_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Overdue', 'Follow-up', 'phone', 'operations integration',
                 'inquiry', $5, $6, $7, $6, $6)`,
        [
          overdueFollowUpCaseId,
          tenantId,
          organizationId,
          facilityId,
          overdueFollowUpAt,
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
        'schedule.assign',
        'schedule.update',
        'visit_execution.read',
        'client.read',
        'employee.read',
        'organization.read',
        'service_agreement.read',
        'benefits.review',
        'billing.read',
        'billing.payments.read',
        'claims.read',
        'care_documentation.review',
        'onboarding.read',
        'operations.recurring_tasks.manage',
      ];
      for (const permission of permissions) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
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
      process.env.API_PUBLIC_ORIGIN = 'http://localhost:3001';
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
      const deadlineSchedulerInternals = deadlineScheduler as unknown as {
        evaluateDeadlineOccurrences: (
          tenantId: string,
          now: Date,
        ) => Promise<{ failedDomains: string[]; remindersTriggered: number }>;
      };
      const evaluateDeadlineOccurrences =
        deadlineSchedulerInternals.evaluateDeadlineOccurrences.bind(deadlineScheduler);
      let interruptAfterDeadlineTasksCommit = true;
      deadlineSchedulerInternals.evaluateDeadlineOccurrences = async (scheduledTenantId, runAt) => {
        if (interruptAfterDeadlineTasksCommit) {
          interruptAfterDeadlineTasksCommit = false;
          throw new Error('Injected interruption after deadline task commit');
        }
        return evaluateDeadlineOccurrences(scheduledTenantId, runAt);
      };
      await expect(
        deadlineScheduler.run(tenantId, 'operations-integration-deadlines-first-attempt', now),
      ).rejects.toThrow('Injected interruption after deadline task commit');
      const recoveredDeadlineRun = await deadlineScheduler.run(
        tenantId,
        'operations-integration-deadlines-restart',
        new Date(now.getTime() + 60_000),
      );
      deadlineSchedulerInternals.evaluateDeadlineOccurrences = evaluateDeadlineOccurrences;
      expect(recoveredDeadlineRun).toMatchObject({ status: 'succeeded', tasksCreated: 0 });
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
        new Date(now.getTime() + 120_000),
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

      const searchableIssueResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?search=client%20preference`,
        { headers },
      );
      expect(searchableIssueResponse.status).toBe(200);
      const searchableIssues = (await searchableIssueResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(searchableIssues.items.some((item) => item.id === snoozableIssue!.id)).toBe(true);
      const clientSearchResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?search=Ada%20Operations`,
        { headers },
      );
      const clientSearchItems = (await clientSearchResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(clientSearchItems.items.some((item) => item.id === snoozableIssue!.id)).toBe(true);
      const sourceFilteredResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=scheduling`,
        { headers },
      );
      const sourceFilteredItems = (await sourceFilteredResponse.json()) as {
        items: Array<{ sourceDomain: string }>;
      };
      expect(sourceFilteredItems.items.length).toBeGreaterThan(0);
      expect(sourceFilteredItems.items.every((item) => item.sourceDomain === 'scheduling')).toBe(
        true,
      );
      const categoryFilteredResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?category=scheduling`,
        { headers },
      );
      expect(categoryFilteredResponse.status).toBe(200);
      const categoryFilteredItems = (await categoryFilteredResponse.json()) as {
        items: Array<{ category: string }>;
      };
      expect(categoryFilteredItems.items.length).toBeGreaterThan(0);
      expect(categoryFilteredItems.items.every((item) => item.category === 'scheduling')).toBe(
        true,
      );
      const undatedCategoryFilterResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?category=documentation&due=today`,
        { headers },
      );
      expect(undatedCategoryFilterResponse.status).toBe(200);
      const undatedCategoryFilter = (await undatedCategoryFilterResponse.json()) as {
        items: unknown[];
        truncated: boolean;
      };
      expect(undatedCategoryFilter).toMatchObject({ items: [], truncated: false });
      const employeeDeadlineFilterResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=employee_qualifications&employeeId=${employeeId}&fromDate=${inEightDays}&untilDate=${inEightDays}&search=${employeeQualificationId}`,
        { headers },
      );
      expect(employeeDeadlineFilterResponse.status).toBe(200);
      const employeeDeadlineFilter = (await employeeDeadlineFilterResponse.json()) as {
        items: Array<{ employeeId: string | null; sourceEntityId: string; dueAt: string | null }>;
        total: number;
        truncated: boolean;
      };
      expect(employeeDeadlineFilter.items).toContainEqual(
        expect.objectContaining({
          employeeId,
          sourceEntityId: employeeQualificationId,
          dueAt: expect.any(String),
        }),
      );
      expect(employeeDeadlineFilter).toMatchObject({ total: 1, truncated: false });
      expect(employeeDeadlineFilter.items).toHaveLength(1);
      const paginatedQualificationResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=employee_qualifications&page=1&pageSize=10`,
        { headers },
      );
      expect(paginatedQualificationResponse.status).toBe(200);
      const paginatedQualifications = (await paginatedQualificationResponse.json()) as {
        items: unknown[];
        total: number;
        truncated: boolean;
      };
      expect(paginatedQualifications).toMatchObject({ total: 102, truncated: false });
      expect(paginatedQualifications.items).toHaveLength(10);
      const lastQualificationPageResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=employee_qualifications&page=11&pageSize=10`,
        { headers },
      );
      const lastQualificationPage = (await lastQualificationPageResponse.json()) as {
        items: unknown[];
        total: number;
      };
      expect(lastQualificationPage).toMatchObject({ total: 102 });
      expect(lastQualificationPage.items).toHaveLength(2);
      const employeeFilteredResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?employeeId=${employeeId}`,
        { headers },
      );
      expect(employeeFilteredResponse.status).toBe(200);
      const employeeFilteredItems = (await employeeFilteredResponse.json()) as {
        items: Array<{ employeeId: string | null; sourceDomain: string }>;
      };
      expect(employeeFilteredItems.items.length).toBeGreaterThan(0);
      expect(employeeFilteredItems.items.every((item) => item.employeeId === employeeId)).toBe(
        true,
      );
      const receivableDateFilterResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=billing&fromDate=${inEightDays}&untilDate=${inEightDays}`,
        { headers },
      );
      expect(receivableDateFilterResponse.status).toBe(200);
      const receivableDateFilter = (await receivableDateFilterResponse.json()) as {
        items: Array<{ issueCode: string; sourceEntityId: string; dueAt: string | null }>;
      };
      expect(receivableDateFilter.items).toContainEqual(
        expect.objectContaining({
          issueCode: 'receivable_due',
          sourceEntityId: invoiceId,
          dueAt: expect.any(String),
        }),
      );
      expect(receivableDateFilter.items).toHaveLength(1);
      const overdueReceivableResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=billing&due=overdue`,
        { headers },
      );
      expect(overdueReceivableResponse.status).toBe(200);
      const overdueReceivables = (await overdueReceivableResponse.json()) as {
        items: Array<{ issueCode: string; sourceEntityId: string; dueAt: string | null }>;
      };
      expect(overdueReceivables.items).toContainEqual(
        expect.objectContaining({
          issueCode: 'receivable_due',
          sourceEntityId: overdueInvoiceId,
          dueAt: expect.any(String),
        }),
      );
      const overdueFollowUpResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=onboarding&due=overdue`,
        { headers },
      );
      expect(overdueFollowUpResponse.status).toBe(200);
      const overdueFollowUps = (await overdueFollowUpResponse.json()) as {
        items: Array<{ issueCode: string; sourceEntityId: string; dueAt: string | null }>;
      };
      expect(overdueFollowUps.items).toContainEqual(
        expect.objectContaining({
          issueCode: 'admission_follow_up_overdue',
          sourceEntityId: overdueFollowUpCaseId,
          dueAt: expect.any(String),
        }),
      );
      const rejectedClaimResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=claims&clientId=${clientId}`,
        { headers },
      );
      expect(rejectedClaimResponse.status).toBe(200);
      const rejectedClaimItems = (await rejectedClaimResponse.json()) as {
        items: Array<{ issueCode: string; sourceEntityId: string; severity: string }>;
      };
      expect(rejectedClaimItems.items).toContainEqual(
        expect.objectContaining({
          issueCode: 'claim_rejected',
          sourceEntityId: rejectedClaimId,
          severity: 'critical',
        }),
      );
      const missingEvidenceResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=care_documentation&clientId=${clientId}`,
        { headers },
      );
      expect(missingEvidenceResponse.status).toBe(200);
      const missingEvidenceItems = (await missingEvidenceResponse.json()) as {
        items: Array<{ issueCode: string; sourceEntityId: string }>;
      };
      expect(missingEvidenceItems.items).toContainEqual(
        expect.objectContaining({
          issueCode: 'documentation_service_evidence_required',
          sourceEntityId: missingEvidenceVisitId,
        }),
      );

      const repeatedWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, { headers });
      const repeatedItems = (await repeatedWorklist.json()) as {
        items: Array<{ id: string; issueCode: string }>;
      };
      expect(repeatedItems.items.find((item) => item.issueCode === 'missing_assignment')?.id).toBe(
        missingAssignment!.id,
      );

      const dashboard = await fetch(`${baseUrl}/api/v1/operations/dashboard`, { headers });
      expect(dashboard.status).toBe(200);
      const dashboardBody = (await dashboard.json()) as {
        categoryCounts: { scheduling: number };
        deadlineCounts: { overdue: number; today: number; upcoming: number };
      };
      expect(typeof dashboardBody.categoryCounts.scheduling).toBe('number');
      expect(Object.values(dashboardBody.deadlineCounts).every(Number.isInteger)).toBe(true);
      expect(dashboardBody.deadlineCounts.overdue > 0).toBe(true);

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

      // Exercise the actual Nest-composed owner contracts, independently of Operations' gates.
      const expiryQuery = {
        fromDate: today,
        untilDate: inNineDays,
        effectiveOn: today,
        offset: 0,
        pageSize: 100 as const,
      };
      const principalFor = (
        permission: Permission,
        scopeType: 'tenant' | 'organization' | 'facility' = 'tenant',
        scopeId = tenantId,
      ): AuthorizationPrincipal => ({
        tenantId,
        userId,
        grants: [{ permission, scopeType, scopeId }],
      });
      const expirySources = [
        {
          source: api!.get(AgreementExpiryQueries),
          permission: 'service_agreement.read' as const,
          id: agreementId,
        },
        {
          source: api!.get(QualificationExpiryQueries),
          permission: 'employee.read' as const,
          id: employeeQualificationId,
        },
        {
          source: api!.get(BenefitEntitlementExpiryQueries),
          permission: 'benefits.review' as const,
          id: benefitEntitlementId,
        },
        {
          source: api!.get(PayerArrangementExpiryQueries),
          permission: 'billing.read' as const,
          id: payerArrangementId,
        },
      ];
      for (const { source, permission, id } of expirySources) {
        // oxlint-disable no-await-in-loop -- Security checks deliberately exercise each composed source in order.
        await expect(
          source.operationsExpiryPage({ tenantId, userId, grants: [] }, expiryQuery),
        ).rejects.toThrow();
        const visible = await source.operationsExpiryPage(
          principalFor(permission, 'facility', facilityId),
          expiryQuery,
        );
        expect(visible.items.map((row) => row.id)).toContain(id);
        const outside = await source.operationsExpiryPage(
          principalFor(permission, 'organization', otherOrganizationId),
          expiryQuery,
        );
        expect(outside.items).toEqual([]);
        expect(
          (
            await source.operationsExpiryPage(principalFor(permission), {
              ...expiryQuery,
              facilityId: otherFacilityId,
            })
          ).items,
        ).toEqual([]);
        expect(
          (
            await source.operationsExpiryPage(
              {
                ...principalFor(permission),
                tenantId: otherTenantId,
                grants: [{ permission, scopeType: 'tenant', scopeId: otherTenantId }],
              },
              expiryQuery,
            )
          ).items,
        ).toEqual([]);
        await expect(
          source.operationsExpiryPage(principalFor(permission), {
            ...expiryQuery,
            pageSize: 101 as 100,
          }),
        ).rejects.toThrow();
        // oxlint-enable no-await-in-loop
      }
      const operationsForScopes = api!.get<OperationsApplicationService>(OPERATIONS_APPLICATION);
      for (const [sourceDomain, permission] of [
        ['service_agreements', 'service_agreement.read'],
        ['employee_qualifications', 'employee.read'],
        ['benefits', 'benefits.review'],
        ['billing', 'billing.read'],
      ] as const) {
        // oxlint-disable no-await-in-loop -- Verify each source gate and the independent Operations scope.
        expect(
          await operationsForScopes.listWorkItems(principalFor('operations.read'), {
            sourceDomain,
            deadlinesOnly: true,
          }),
        ).toMatchObject({ items: [], total: 0, truncated: false });
        const intersectedPrincipal = principalFor(permission, 'facility', facilityId);
        intersectedPrincipal.grants = [
          ...intersectedPrincipal.grants,
          {
            permission: 'operations.read',
            scopeType: 'organization',
            scopeId: otherOrganizationId,
          },
        ];
        expect(
          await operationsForScopes.listWorkItems(intersectedPrincipal, {
            sourceDomain,
            deadlinesOnly: true,
          }),
        ).toMatchObject({ items: [], total: 0, truncated: false });
        // oxlint-enable no-await-in-loop
      }
      const organizations = api!.get<OrganizationApplicationService>(ORGANIZATION_APPLICATION);
      expect(
        await organizations.operationsTimezones(
          principalFor('operations.read', 'facility', facilityId),
          [organizationId],
        ),
      ).toEqual(new Map([[organizationId, 'Europe/Berlin']]));
      expect(
        await organizations.operationsTimezones(
          principalFor('operations.read', 'facility', otherFacilityId),
          [organizationId],
        ),
      ).toEqual(new Map());
      expect(
        await organizations.operationsTimezones(principalFor('operations.read'), [
          otherOrganizationId,
        ]),
      ).toEqual(new Map());
      expect(
        await organizations.operationsTimezones({ tenantId, userId, grants: [] }, [organizationId]),
      ).toEqual(new Map());

      // A whole raw page may be invisible. Its empty authorized projection must not stop scanning.
      const hiddenOrganizationId = uuidv7();
      const hiddenClientId = uuidv7();
      const hiddenFacilityId = uuidv7();
      const hiddenFundingId = uuidv7();
      const hiddenEntitlementIds = Array.from({ length: 100 }, () => uuidv7());
      await owner.query(
        'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
        [hiddenOrganizationId, tenantId, 'Hidden expiry provider'],
      );
      await owner.query(
        'INSERT INTO organizations.facilities (id, tenant_id, organization_id, name) VALUES ($1, $2, $3, $4)',
        [hiddenFacilityId, tenantId, hiddenOrganizationId, 'Hidden facility'],
      );
      await owner.query(
        `INSERT INTO clients.clients (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'Hidden', 'Client', 'active', $5, $5)`,
        [hiddenClientId, tenantId, hiddenOrganizationId, hiddenFacilityId, now],
      );
      await owner.query(
        `INSERT INTO benefits.funding_sources (id, tenant_id, client_id, source_type, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, 'other', 'active', $4, $5, $5)`,
        [hiddenFundingId, tenantId, hiddenClientId, userId, now],
      );
      await owner.query(
        `INSERT INTO benefits.client_entitlements (id, tenant_id, client_id, benefit_type, funding_source_id, valid_from, valid_until, status, calculation_mode, source, version, created_by, created_at, updated_at)
        SELECT id, $1, $2, 'other', $3, $4::date - ordinality::int, $4::date - ordinality::int, 'confirmed', 'external_input', 'provider_reported', 1, $5, $6, $6 FROM unnest($7::uuid[]) WITH ORDINALITY AS entries(id, ordinality)`,
        [tenantId, hiddenClientId, hiddenFundingId, today, userId, now, hiddenEntitlementIds],
      );
      // Count actual SELECT constructions in these simple source/client reads; no per-item lookups.
      let selectCount = 0;
      const realUnitOfWork = api!.get<UnitOfWork>(UNIT_OF_WORK);
      const countedUnitOfWork: UnitOfWork = {
        transaction(options, operation) {
          return realUnitOfWork.transaction(options, (transaction) =>
            operation(
              new Proxy(transaction, {
                get(target, property) {
                  if (property === 'select')
                    return (...args: Parameters<typeof transaction.select>) => {
                      selectCount += 1;
                      return target.select(...args);
                    };
                  return Reflect.get(target, property);
                },
              }),
            ),
          );
        },
      };
      const measuredExpiry = new BenefitEntitlementExpiryQueries(
        countedUnitOfWork,
        api!.get<ClientApplicationService>(CLIENT_APPLICATION),
      );
      const measurementQuery = {
        ...expiryQuery,
        fromDate: new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10),
      };
      const measuredStartedAt = performance.now();
      expect(
        (
          await measuredExpiry.operationsExpiryPage(
            principalFor('benefits.review'),
            measurementQuery,
          )
        ).items,
      ).toHaveLength(100);
      expect(selectCount).toBe(2);
      const firstPageMs = performance.now() - measuredStartedAt;
      selectCount = 0;
      const tailStartedAt = performance.now();
      expect(
        (
          await measuredExpiry.operationsExpiryPage(principalFor('benefits.review'), {
            ...measurementQuery,
            offset: 100,
          })
        ).items,
      ).toHaveLength(1);
      expect(selectCount).toBe(2);
      console.info('Goal 02 expiry page measurement', {
        firstPageMs: Math.round(firstPageMs * 100) / 100,
        tailPageMs: Math.round((performance.now() - tailStartedAt) * 100) / 100,
        selectsPerPage: selectCount,
      });
      const benefitExpiry = api!.get(BenefitEntitlementExpiryQueries);
      const scopedBenefitPrincipal = principalFor(
        'benefits.review',
        'organization',
        organizationId,
      );
      const hiddenExpiryQuery = {
        ...expiryQuery,
        fromDate: new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10),
      };
      expect(
        await benefitExpiry.operationsExpiryPage(scopedBenefitPrincipal, hiddenExpiryQuery),
      ).toEqual({ items: [], complete: false });
      expect(
        await benefitExpiry.operationsExpiryPage(scopedBenefitPrincipal, {
          ...hiddenExpiryQuery,
          offset: 100,
        }),
      ).toMatchObject({
        items: [expect.objectContaining({ id: benefitEntitlementId })],
        complete: true,
      });
      const operations = api!.get<OperationsApplicationService>(OPERATIONS_APPLICATION);
      const scopedOperationsPrincipal = {
        ...scopedBenefitPrincipal,
        grants: [
          ...scopedBenefitPrincipal.grants,
          {
            permission: 'operations.read' as const,
            scopeType: 'organization' as const,
            scopeId: organizationId,
          },
        ],
      };
      const scanned = await operations.listWorkItems(scopedOperationsPrincipal, {
        sourceDomain: 'benefits',
        deadlinesOnly: true,
      });
      expect(scanned).toMatchObject({
        total: 1,
        truncated: false,
        items: [expect.objectContaining({ sourceEntityId: benefitEntitlementId })],
      });
      await owner.query(
        'DELETE FROM benefits.client_entitlements WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, hiddenEntitlementIds],
      );

      // A later page failure preserves previously observed, still-current occurrences.
      const qualifications = api!.get(QualificationExpiryQueries);
      const readQualificationPage = qualifications.operationsExpiryPage.bind(qualifications);
      try {
        qualifications.operationsExpiryPage = async (principal, query) => {
          if (query.offset >= 100) throw new Error('Injected expiry page failure');
          return readQualificationPage(principal, query);
        };
        const failedRead = await fetch(
          `${baseUrl}/api/v1/operations/work-items?sourceDomain=employee_qualifications`,
          { headers },
        );
        expect(await failedRead.json()).toMatchObject({ truncated: true });
        const stillOpen = await owner.query(
          `SELECT count(*)::int AS count FROM operations.exception_occurrences WHERE tenant_id = $1 AND source_domain = 'employee_qualifications' AND resolved_at IS NULL`,
          [tenantId],
        );
        expect(stillOpen.rows[0].count).toBe(102);
      } finally {
        qualifications.operationsExpiryPage = readQualificationPage;
      }

      // Local end-of-day is preserved for provider timezones independently of the default timezone.
      await owner.query(
        "UPDATE organizations.organizations SET timezone = 'America/New_York' WHERE id = $1",
        [organizationId],
      );
      const zoned = await fetch(`${baseUrl}/api/v1/operations/deadlines?category=agreements`, {
        headers,
      });
      const zonedBody = (await zoned.json()) as {
        items: Array<{ sourceEntityId: string; dueAt: string }>;
      };
      const zonedDue = new Date(
        zonedBody.items.find((item) => item.sourceEntityId === agreementId)!.dueAt,
      );
      const localParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(zonedDue);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        localParts.find((value) => value.type === type)!.value;
      expect(`${part('year')}-${part('month')}-${part('day')}`).toBe(inEightDays);
      expect(`${part('hour')}:${part('minute')}:${part('second')}`).toBe('23:59:59');
      await owner.query(
        "UPDATE organizations.organizations SET timezone = 'Europe/Berlin' WHERE id = $1",
        [organizationId],
      );

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
          clientName: string | null;
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
      expect(onboardingFollowUpDeadline?.clientName).toBeNull();

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

      const restartSafeRecurrenceResponse = await fetch(
        `${baseUrl}/api/v1/operations/recurring-tasks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            organizationId,
            facilityId,
            clientId,
            title: 'Annual restart-safe review',
            priority: 'normal',
            assignedEmployeeId: employeeId,
            rule: { frequency: 'yearly', interval: 1 },
            timezone: 'Europe/Berlin',
            startDate: recurrenceStartDate,
            timeOfDay: '09:00',
            generationPolicy: 'generate_missed',
          }),
        },
      );
      expect(restartSafeRecurrenceResponse.status).toBe(201);
      const restartSafeRecurrence = (await restartSafeRecurrenceResponse.json()) as { id: string };
      const recurrenceSchedulerInternals = recurrenceScheduler as unknown as {
        finishRun: (
          tenantId: string,
          workerId: string,
          now: Date,
          status: 'succeeded' | 'failed',
          tasksCreated: number,
          lastFailureCode: string | null,
        ) => Promise<void>;
      };
      const finishRun = recurrenceSchedulerInternals.finishRun.bind(recurrenceScheduler);
      let interruptAfterRecurrenceCommit = true;
      recurrenceSchedulerInternals.finishRun = async (...args) => {
        if (interruptAfterRecurrenceCommit) {
          interruptAfterRecurrenceCommit = false;
          throw new Error('Injected interruption after recurrence occurrence commit');
        }
        return finishRun(...args);
      };
      await expect(
        recurrenceScheduler.runRecurringTaskScheduler(
          tenantId,
          'operations-integration-recurrence-first-attempt',
          new Date(now.getTime() + 1_000),
        ),
      ).rejects.toThrow('Injected interruption after recurrence occurrence commit');
      recurrenceSchedulerInternals.finishRun = finishRun;
      const recoveredRecurrenceRun = await recurrenceScheduler.runRecurringTaskScheduler(
        tenantId,
        'operations-integration-recurrence-restart',
        new Date(now.getTime() + 2_000),
      );
      expect(recoveredRecurrenceRun).toMatchObject({ status: 'succeeded', tasksCreated: 0 });
      const recoveredRecurrenceOccurrences = await owner.query<{ task_id: string }>(
        `SELECT task_id FROM operations.recurring_task_occurrences
         WHERE tenant_id = $1 AND recurrence_definition_id = $2`,
        [tenantId, restartSafeRecurrence.id],
      );
      expect(recoveredRecurrenceOccurrences.rows).toHaveLength(1);

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

      const visitAssignmentResponse = await fetch(
        `${baseUrl}/api/v1/visits/${visitId}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId }),
        },
      );
      expect(visitAssignmentResponse.status).toBe(201);
      const visitAssignment = (await visitAssignmentResponse.json()) as { id: string };
      const clearedClientPreference = await fetch(
        `${baseUrl}/api/v1/clients/${clientId}/scheduling-preferences`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            preferredWeekdays: [],
            preferredTimeWindows: [],
            preferredEmployeeId: null,
            avoidedEmployeeIds: [],
          }),
        },
      );
      expect(clearedClientPreference.status).toBe(200);
      const resolvedWorklist = await fetch(`${baseUrl}/api/v1/operations/work-items`, { headers });
      const resolvedItems = (await resolvedWorklist.json()) as { items: Array<{ id: string }> };
      expect(resolvedItems.items.some((item) => item.id === missingAssignment!.id)).toBe(false);
      expect(resolvedItems.items.some((item) => item.id === snoozableIssue!.id)).toBe(false);
      const resolvedAssignmentHistory = await fetch(
        `${baseUrl}/api/v1/operations/work-items/${missingAssignment!.id}/history`,
        { headers },
      );
      const resolvedAssignmentOccurrence = (await resolvedAssignmentHistory.json()) as {
        occurrences: Array<{ resolvedAt: string | null }>;
      };
      expect(resolvedAssignmentOccurrence.occurrences).toHaveLength(1);
      expect(resolvedAssignmentOccurrence.occurrences[0]?.resolvedAt).toBeString();

      const unassignedVisitResponse = await fetch(
        `${baseUrl}/api/v1/visits/${visitId}/assignments/${visitAssignment.id}`,
        { method: 'DELETE', headers },
      );
      expect(unassignedVisitResponse.status).toBe(204);
      const restoredClientPreference = await fetch(
        `${baseUrl}/api/v1/clients/${clientId}/scheduling-preferences`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            preferredWeekdays: [],
            preferredTimeWindows: [],
            preferredEmployeeId: employeeId,
            avoidedEmployeeIds: [],
          }),
        },
      );
      expect(restoredClientPreference.status).toBe(200);
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

      const taskDueAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const createTask = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          title: 'Call the client about next week',
          assignedEmployeeId: employeeId,
          dueAt: taskDueAt.toISOString(),
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

      // Task management remains reachable through the public facade, with separate display/source permissions.
      const taskReader: AuthorizationPrincipal = {
        userId,
        tenantId,
        grants: [
          { permission: 'operations.read', scopeType: 'tenant', scopeId: tenantId },
          { permission: 'client.read', scopeType: 'tenant', scopeId: tenantId },
        ],
      };
      const redactedTaskList = await operations.listTasks(taskReader, { assignedToMe: true });
      expect(redactedTaskList.items.find((task) => task.id === createdTask.id)).toMatchObject({
        assignedEmployeeName: null,
      });
      expect(await operations.getTask(taskReader, followUpTask.id)).toMatchObject({ source: null });
      const providerScopedReader: AuthorizationPrincipal = {
        ...taskReader,
        grants: [
          { permission: 'operations.read', scopeType: 'organization', scopeId: organizationId },
        ],
      };
      expect(await operations.getTask(providerScopedReader, createdTask.id)).toMatchObject({
        id: createdTask.id,
      });
      await expect(
        operations.getTask(
          {
            ...providerScopedReader,
            grants: [
              {
                permission: 'operations.read',
                scopeType: 'organization',
                scopeId: otherOrganizationId,
              },
            ],
          },
          createdTask.id,
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' });
      await expect(
        operations.getTask({ ...taskReader, tenantId: otherTenantId }, createdTask.id),
      ).rejects.toMatchObject({ code: 'OPERATIONS_TASK_NOT_FOUND' });
      await expect(
        operations.createTask(
          taskReader,
          { organizationId, title: 'Denied create' },
          { requestId: 'task-denied', correlationId: 'task-denied' },
          {},
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' });
      const missingTaskSource = await fetch(baseUrl + '/api/v1/operations/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Missing source', source: { type: 'visit', id: uuidv7() } }),
      });
      expect(missingTaskSource.status).toBe(404);
      const wrongTaskProvider = await fetch(baseUrl + '/api/v1/operations/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ organizationId: otherOrganizationId, title: 'Foreign provider' }),
      });
      expect(wrongTaskProvider.status).toBe(400);
      const invalidTaskInput = await fetch(baseUrl + '/api/v1/operations/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ organizationId, title: '   ' }),
      });
      expect(invalidTaskInput.status).toBe(400);
      const noOpBefore = await owner.query(
        'SELECT version, updated_at FROM operations.tasks WHERE id = $1',
        [createdTask.id],
      );
      const noOpAuditBefore = await owner.query(
        'SELECT count(*) FROM audit.audit_entries WHERE resource_id = $1',
        [createdTask.id],
      );
      const noOpPatch = await fetch(baseUrl + '/api/v1/operations/tasks/' + createdTask.id, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ expectedVersion: 1, title: 'Call the client about next week' }),
      });
      expect(noOpPatch.status).toBe(200);
      expect(await noOpPatch.json()).toMatchObject({ version: 1 });
      expect(
        (
          await owner.query('SELECT version, updated_at FROM operations.tasks WHERE id = $1', [
            createdTask.id,
          ])
        ).rows,
      ).toEqual(noOpBefore.rows);
      expect(
        (
          await owner.query('SELECT count(*) FROM audit.audit_entries WHERE resource_id = $1', [
            createdTask.id,
          ])
        ).rows,
      ).toEqual(noOpAuditBefore.rows);
      const combinedQueue = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?page=1&pageSize=1`,
        { headers },
      );
      expect(combinedQueue.status).toBe(200);
      const combinedQueueBody = (await combinedQueue.json()) as {
        page: number;
        pageSize: number;
        total: number;
        items: Array<{
          kind: 'task' | 'exception';
          task?: { id: string };
          exception?: { id: string };
        }>;
      };
      expect(combinedQueueBody).toMatchObject({ page: 1, pageSize: 1 });
      const queueExceptions = await fetch(
        `${baseUrl}/api/v1/operations/work-items?page=1&pageSize=100`,
        { headers },
      );
      const queueTasks = await fetch(`${baseUrl}/api/v1/operations/tasks?page=1&pageSize=1`, {
        headers,
      });
      const queueExceptionTotal = ((await queueExceptions.json()) as { total: number }).total;
      const queueTaskTotal = ((await queueTasks.json()) as { total: number }).total;
      expect(combinedQueueBody.total).toBe(queueExceptionTotal + queueTaskTotal);
      expect(combinedQueueBody.items).toHaveLength(1);
      const exceptionsOnlyQueue = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?itemType=exceptions&pageSize=10`,
        { headers },
      );
      const exceptionsOnlyQueueBody = (await exceptionsOnlyQueue.json()) as {
        total: number;
        items: Array<{ kind: 'task' | 'exception' }>;
      };
      expect(exceptionsOnlyQueue.status).toBe(200);
      expect(exceptionsOnlyQueueBody.total).toBe(queueExceptionTotal);
      expect(exceptionsOnlyQueueBody.items.every((item) => item.kind === 'exception')).toBe(true);
      const scopedExceptionQueue = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?itemType=exceptions&organizationId=${organizationId}&facilityId=${facilityId}&clientId=${clientId}&pageSize=100`,
        { headers },
      );
      expect(scopedExceptionQueue.status).toBe(200);
      const scopedExceptionQueueBody = (await scopedExceptionQueue.json()) as {
        total: number;
        items: Array<{
          kind: 'task' | 'exception';
          exception?: {
            organizationId: string | null;
            facilityId: string | null;
            clientId: string | null;
          };
        }>;
      };
      expect(scopedExceptionQueueBody.items.length).toBe(scopedExceptionQueueBody.total);
      expect(
        scopedExceptionQueueBody.items.every(
          (item) =>
            item.kind === 'exception' &&
            item.exception?.organizationId === organizationId &&
            item.exception.facilityId === facilityId &&
            item.exception.clientId === clientId,
        ),
      ).toBe(true);
      const combinedQueueSecondPage = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?page=2&pageSize=1`,
        { headers },
      );
      expect(combinedQueueSecondPage.status).toBe(200);
      const secondPageBody = (await combinedQueueSecondPage.json()) as {
        items: Array<{
          kind: 'task' | 'exception';
          task?: { id: string };
          exception?: { id: string };
        }>;
      };
      expect(secondPageBody.items).toHaveLength(1);
      expect(secondPageBody.items[0]?.task?.id ?? secondPageBody.items[0]?.exception?.id).not.toBe(
        combinedQueueBody.items[0]?.task?.id ?? combinedQueueBody.items[0]?.exception?.id,
      );
      const sortedCombinedQueue = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?sort=priority&pageSize=100`,
        { headers },
      );
      expect(sortedCombinedQueue.status).toBe(200);
      const sortedCombinedQueueBody = (await sortedCombinedQueue.json()) as {
        items: Array<{
          kind: 'task' | 'exception';
          task?: {
            id: string;
            priority: 'urgent' | 'high' | 'normal' | 'low';
            dueAt: string | null;
          };
          exception?: {
            id: string;
            severity: 'critical' | 'warning' | 'info';
            dueAt: string | null;
          };
        }>;
      };
      const queueItemKey = (item: { task?: { id: string }; exception?: { id: string } }) =>
        item.task?.id ?? item.exception?.id ?? '';
      expect(queueItemKey(combinedQueueBody.items[0] ?? {})).toBe(
        queueItemKey(sortedCombinedQueueBody.items[0] ?? {}),
      );
      expect(queueItemKey(secondPageBody.items[0] ?? {})).toBe(
        queueItemKey(sortedCombinedQueueBody.items[1] ?? {}),
      );
      const queuePriority = (item: (typeof sortedCombinedQueueBody.items)[number]) => {
        if (item.kind === 'task') {
          const priority = item.task?.priority;
          return priority === 'urgent'
            ? 4
            : priority === 'high'
              ? 3
              : priority === 'normal'
                ? 2
                : 1;
        }
        const severity = item.exception?.severity;
        return severity === 'critical' ? 3 : severity === 'warning' ? 2 : 1;
      };
      const queueDue = (item: (typeof sortedCombinedQueueBody.items)[number]) =>
        item.kind === 'task' ? (item.task?.dueAt ?? null) : (item.exception?.dueAt ?? null);
      const queueId = (item: (typeof sortedCombinedQueueBody.items)[number]) =>
        item.kind === 'task' ? (item.task?.id ?? '') : (item.exception?.id ?? '');
      const expectedQueueOrder = [...sortedCombinedQueueBody.items].sort((left, right) => {
        const byPriority = queuePriority(right) - queuePriority(left);
        if (byPriority) return byPriority;
        const byDue =
          (queueDue(left) ? Date.parse(queueDue(left)!) : Number.POSITIVE_INFINITY) -
          (queueDue(right) ? Date.parse(queueDue(right)!) : Number.POSITIVE_INFINITY);
        if (byDue) return byDue;
        if (left.kind !== right.kind) return left.kind === 'task' ? -1 : 1;
        return queueId(right).localeCompare(queueId(left));
      });
      expect(sortedCombinedQueueBody.items).toEqual(expectedQueueOrder);
      const taskSearchQueue = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?itemType=tasks&search=${encodeURIComponent('Call the client about next week')}`,
        { headers },
      );
      expect(taskSearchQueue.status).toBe(200);
      const taskSearchQueueBody = (await taskSearchQueue.json()) as {
        total: number;
        items: Array<{ kind: 'task' | 'exception'; task?: { id: string } }>;
      };
      expect(taskSearchQueueBody.total).toBe(1);
      expect(taskSearchQueueBody.items).toEqual([
        { kind: 'task', task: expect.objectContaining({ id: createdTask.id }) },
      ]);
      const taskDueDate = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Berlin',
      }).format(taskDueAt);
      const dueRangeQueue = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?itemType=tasks&fromDate=${taskDueDate}&untilDate=${taskDueDate}&search=${encodeURIComponent('Call the client about next week')}`,
        { headers },
      );
      expect(dueRangeQueue.status).toBe(200);
      const dueRangeQueueBody = (await dueRangeQueue.json()) as {
        total: number;
        items: Array<{ kind: 'task' | 'exception'; task?: { id: string } }>;
      };
      expect(dueRangeQueueBody.total).toBe(1);
      expect(dueRangeQueueBody.items).toEqual([
        { kind: 'task', task: expect.objectContaining({ id: createdTask.id }) },
      ]);
      const outsideDueRange = await fetch(
        `${baseUrl}/api/v1/operations/tasks?fromDate=2000-01-01&untilDate=2000-01-02&search=${encodeURIComponent('Call the client about next week')}`,
        { headers },
      );
      expect(outsideDueRange.status).toBe(200);
      expect(await outsideDueRange.json()).toMatchObject({ items: [], total: 0 });
      const reversedDueRange = await fetch(
        `${baseUrl}/api/v1/operations/work-queue?fromDate=2026-10-20&untilDate=2026-10-19`,
        { headers },
      );
      expect(reversedDueRange.status).toBe(400);

      const upcomingTasks = await fetch(`${baseUrl}/api/v1/operations/tasks?due=upcoming`, {
        headers,
      });
      expect(upcomingTasks.status).toBe(200);
      const upcomingTaskItems = (
        (await upcomingTasks.json()) as {
          items: Array<{
            id: string;
            clientName?: string | null;
            assignedEmployeeName?: string | null;
          }>;
        }
      ).items;
      expect(upcomingTaskItems.find((task) => task.id === createdTask.id)).toMatchObject({
        id: createdTask.id,
        assignedEmployeeName: 'Office Assignee',
      });
      const taskDashboard = await fetch(`${baseUrl}/api/v1/operations/dashboard`, { headers });
      expect(taskDashboard.status).toBe(200);
      expect(await taskDashboard.json()).toMatchObject({ tasks: { assignedToMe: 4 } });

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

      const concurrentTaskCompletions = await Promise.all([
        fetch(`${baseUrl}/api/v1/operations/tasks/${createdTask.id}/complete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: createdTask.version }),
        }),
        fetch(`${baseUrl}/api/v1/operations/tasks/${createdTask.id}/complete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: createdTask.version }),
        }),
      ]);
      expect(concurrentTaskCompletions.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const completedTaskResponse = concurrentTaskCompletions.find(
        (response) => response.status === 200,
      );
      if (!completedTaskResponse) throw new Error('Expected one concurrent task update to succeed');
      const completed = (await completedTaskResponse.json()) as {
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

      // Exercise all remaining lifecycle edges and rollback on the same task, preserving fixture totals.
      const taskPath = baseUrl + '/api/v1/operations/tasks/' + createdTask.id;
      const mutateTask = (suffix: string, body: Record<string, unknown>, method = 'POST') =>
        fetch(taskPath + suffix, { method, headers, body: JSON.stringify(body) });
      const badVersion = await mutateTask('/start', { expectedVersion: 0 });
      expect(badVersion.status).toBe(400);
      const invalidReopen = await mutateTask('/reopen', { expectedVersion: 3 });
      expect(invalidReopen.status).toBe(409);
      const startTask = await mutateTask('/start', { expectedVersion: 3 });
      expect(startTask.status).toBe(200);
      expect(await startTask.json()).toMatchObject({
        status: 'in_progress',
        version: 4,
        completedAt: null,
        completedByUserId: null,
      });
      const invalidStart = await mutateTask('/start', { expectedVersion: 4 });
      expect(invalidStart.status).toBe(409);
      const clearAssignment = await mutateTask(
        '',
        { expectedVersion: 4, assignedEmployeeId: null },
        'PATCH',
      );
      expect(clearAssignment.status).toBe(200);
      expect(await clearAssignment.json()).toMatchObject({ version: 5, assignedEmployeeId: null });
      const restoreAssignment = await mutateTask(
        '',
        { expectedVersion: 5, assignedEmployeeId: employeeId },
        'PATCH',
      );
      expect(restoreAssignment.status).toBe(200);
      expect(await restoreAssignment.json()).toMatchObject({
        version: 6,
        assignedEmployeeId: employeeId,
      });
      const invalidReassignment = await mutateTask(
        '',
        { expectedVersion: 6, assignedEmployeeId: otherEmployeeId },
        'PATCH',
      );
      expect(invalidReassignment.status).toBe(400);
      const stalePatch = await mutateTask('', { expectedVersion: 5, priority: 'urgent' }, 'PATCH');
      expect(stalePatch.status).toBe(409);
      const beforeRollback = await owner.query(
        `SELECT (SELECT row_to_json(task) FROM operations.tasks AS task WHERE id = $1) AS task,
                (SELECT count(*)::int FROM operations.task_activity WHERE task_id = $1) AS activities,
                (SELECT count(*)::int FROM audit.audit_entries WHERE resource_id = $1) AS audits,
                (SELECT count(*)::int FROM platform.outbox_messages WHERE event->>'aggregateId' = $1::text) AS events`,
        [createdTask.id],
      );
      // Disposable PostgreSQL-only failure after task/history/audit writes, before outbox commit.
      await owner.query(`CREATE FUNCTION platform.reject_test_task_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event_type = 'operations.task_updated' THEN RAISE EXCEPTION 'test task outbox failure'; END IF; RETURN NEW; END $$`);
      await owner.query(
        `CREATE TRIGGER reject_test_task_update BEFORE INSERT ON platform.outbox_messages FOR EACH ROW EXECUTE FUNCTION platform.reject_test_task_update()`,
      );
      try {
        const failedPatch = await mutateTask(
          '',
          { expectedVersion: 6, priority: 'urgent' },
          'PATCH',
        );
        expect(failedPatch.status).toBe(500);
        expect(
          (
            await owner.query(
              `SELECT (SELECT row_to_json(task) FROM operations.tasks AS task WHERE id = $1) AS task,
                  (SELECT count(*)::int FROM operations.task_activity WHERE task_id = $1) AS activities,
                  (SELECT count(*)::int FROM audit.audit_entries WHERE resource_id = $1) AS audits,
                  (SELECT count(*)::int FROM platform.outbox_messages WHERE event->>'aggregateId' = $1::text) AS events`,
              [createdTask.id],
            )
          ).rows,
        ).toEqual(beforeRollback.rows);
      } finally {
        await owner.query('DROP TRIGGER reject_test_task_update ON platform.outbox_messages');
        await owner.query('DROP FUNCTION platform.reject_test_task_update()');
      }
      const beforeComment = await owner.query(
        'SELECT version, updated_at FROM operations.tasks WHERE id = $1',
        [createdTask.id],
      );
      const taskOutboxBeforeComment = await owner.query(
        `SELECT count(*) FROM platform.outbox_messages WHERE event->>'aggregateId' = $1`,
        [createdTask.id],
      );
      const finalComment = await mutateTask('/comments', { comment: '  Protected task comment  ' });
      expect(finalComment.status).toBe(201);
      expect(
        (
          await owner.query('SELECT version, updated_at FROM operations.tasks WHERE id = $1', [
            createdTask.id,
          ])
        ).rows,
      ).toEqual(beforeComment.rows);
      expect(
        (
          await owner.query(
            `SELECT count(*) FROM platform.outbox_messages WHERE event->>'aggregateId' = $1`,
            [createdTask.id],
          )
        ).rows,
      ).toEqual(taskOutboxBeforeComment.rows);
      expect(
        (
          await owner.query(
            `SELECT comment FROM operations.task_activity WHERE task_id = $1 AND comment = 'Protected task comment'`,
            [createdTask.id],
          )
        ).rowCount,
      ).toBe(1);
      const taskAuditPairs = await owner.query(
        `SELECT audit.id, outbox.id AS event_id FROM audit.audit_entries AS audit
         LEFT JOIN platform.outbox_messages AS outbox ON audit.id = outbox.id AND audit.tenant_id = outbox.tenant_id
         WHERE audit.resource_id = $1 AND audit.action <> 'operations.task_comment_added'`,
        [createdTask.id],
      );
      expect(taskAuditPairs.rows.every((row) => row.id === row.event_id)).toBe(true);
      expect(
        JSON.stringify(
          (
            await owner.query('SELECT metadata FROM audit.audit_entries WHERE resource_id = $1', [
              createdTask.id,
            ])
          ).rows,
        ),
      ).not.toContain('Protected task comment');
      // Scheduler-created tasks retain occurrence identity when read and no-op edited through the facade.
      const generatedTaskDetails = await operations.getTask(
        taskReader,
        generatedOccurrences[0]!.taskId,
      );
      expect(generatedTaskDetails.id).toBe(generatedOccurrences[0]!.taskId);
      const occurrenceBeforeEdit = await owner.query(
        'SELECT * FROM operations.recurring_task_occurrences WHERE task_id = $1',
        [generatedTaskDetails.id],
      );
      const generatedNoOp = await fetch(
        baseUrl + '/api/v1/operations/tasks/' + generatedTaskDetails.id,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            expectedVersion: generatedTaskDetails.version,
            title: generatedTaskDetails.title,
          }),
        },
      );
      expect(generatedNoOp.status).toBe(200);
      expect(
        (
          await owner.query(
            'SELECT * FROM operations.recurring_task_occurrences WHERE task_id = $1',
            [generatedTaskDetails.id],
          )
        ).rows,
      ).toEqual(occurrenceBeforeEdit.rows);
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
      const clientNamedTasksResponse = await fetch(
        `${baseUrl}/api/v1/operations/tasks?pageSize=100`,
        { headers },
      );
      const clientNamedTasks = (await clientNamedTasksResponse.json()) as {
        items: Array<{
          id: string;
          clientName?: string | null;
          assignedEmployeeName?: string | null;
        }>;
      };
      expect(clientNamedTasks.items.find((task) => task.id === clientTask.id)).toMatchObject({
        clientName: 'Ada Operations',
        assignedEmployeeName: 'Office Assignee',
      });
      const clientNameSearchResponse = await fetch(
        `${baseUrl}/api/v1/operations/tasks?search=Ada%20Operations`,
        { headers },
      );
      expect(clientNameSearchResponse.status).toBe(200);
      const clientNameSearch = (await clientNameSearchResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(clientNameSearch.items.some((task) => task.id === clientTask.id)).toBe(true);
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
        tasks: { assignedToMe: 5, urgent: 1 },
      });

      const cancelledTask = await mutateTask('/cancel', { expectedVersion: 6 });
      expect(cancelledTask.status).toBe(200);
      expect(await cancelledTask.json()).toMatchObject({
        status: 'cancelled',
        version: 7,
        completedAt: null,
        completedByUserId: null,
      });
      const terminalPatch = await mutateTask(
        '',
        { expectedVersion: 7, priority: 'urgent' },
        'PATCH',
      );
      expect(terminalPatch.status).toBe(409);
      const terminalComplete = await mutateTask('/complete', { expectedVersion: 7 });
      expect(terminalComplete.status).toBe(409);

      const executionPlannedStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const executionPlannedEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      await owner.query(
        `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status,
            planned_start, planned_end, timezone, created_at, updated_at)
         SELECT visit_id, $1, $2, $3, $4, 'manual', 'confirmed', $5, $6, 'Europe/Berlin', $7, $7
         FROM unnest($8::uuid[]) AS visits(visit_id)`,
        [
          tenantId,
          clientId,
          organizationId,
          facilityId,
          executionPlannedStart,
          executionPlannedEnd,
          now,
          extraExecutionVisitIds,
        ],
      );
      await owner.query(
        `INSERT INTO visit_execution.executions
           (id, tenant_id, visit_id, status, actual_start, started_by_employee_id, created_at, updated_at)
         SELECT execution_id, $1, visit_id, 'in_progress', $4, $5, $6, $6
         FROM unnest($2::uuid[], $3::uuid[]) AS executions(execution_id, visit_id)`,
        [
          tenantId,
          extraExecutionIds,
          extraExecutionVisitIds,
          executionPlannedStart,
          employeeId,
          now,
        ],
      );
      const paginatedExecutionResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=visit_execution&page=1&pageSize=10`,
        { headers },
      );
      expect(paginatedExecutionResponse.status).toBe(200);
      const paginatedExecutions = (await paginatedExecutionResponse.json()) as {
        items: unknown[];
        total: number;
        truncated: boolean;
      };
      expect(paginatedExecutions).toMatchObject({ total: 101, truncated: false });
      expect(paginatedExecutions.items).toHaveLength(10);

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
      expect(tenantRecurringOccurrences.rows.map((row) => row.task_id)).toEqual(
        expect.arrayContaining([
          generatedOccurrences[0]!.taskId,
          recoveredRecurrenceOccurrences.rows[0]!.task_id,
        ]),
      );
      expect(tenantRecurringOccurrences.rows).toHaveLength(2);
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
      await owner.query(
        `INSERT INTO onboarding.cases
           (id, tenant_id, organization_id, facility_id, first_name, last_name, contact_method,
            inquiry_source, stage, next_follow_up_at, last_activity_at, created_by_user_id,
            created_at, updated_at)
         SELECT case_id, $1, $2, $3, 'Bulk', 'Admission', 'phone', 'operations pagination',
                'inquiry', $4, $5, $6, $5, $5
         FROM unnest($7::uuid[]) AS cases(case_id)`,
        [tenantId, organizationId, facilityId, inEightDays, now, userId, extraAdmissionIds],
      );
      const paginatedOnboardingResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=onboarding&page=1&pageSize=10`,
        { headers },
      );
      expect(paginatedOnboardingResponse.status).toBe(200);
      const paginatedOnboarding = (await paginatedOnboardingResponse.json()) as {
        items: unknown[];
        total: number;
        truncated: boolean;
      };
      expect(paginatedOnboarding.total).toBeGreaterThan(500);
      expect(paginatedOnboarding.truncated).toBe(false);
      expect(paginatedOnboarding.items).toHaveLength(10);
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
