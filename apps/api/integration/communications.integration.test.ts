import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '@app/api/app.module';
import { configureApiHttp, createApiFastifyAdapter } from '@app/api/http/fastify';
import { startCareTestDatabase } from '@care/testing';

describe('communications and onboarding PostgreSQL/API integration', () => {
  test('links intake communications, registers prospects, admits clients, and schedules first visits', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const organizationId = uuidv7();
    const otherTenantOrganizationId = uuidv7();
    const facilityId = uuidv7();
    const otherTenantFacilityId = uuidv7();
    const clientId = uuidv7();
    const otherClientId = uuidv7();
    const otherTenantClientId = uuidv7();
    const userId = uuidv7();
    const representativeId = uuidv7();
    const otherClientContactId = uuidv7();
    const visitId = uuidv7();
    const otherVisitId = uuidv7();
    const subject = uuidv7();
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const publicJwk = await exportJWK(publicKey);
    const keyId = uuidv7();
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const oidc = await startOidcServer(publicJwk);
    let api: NestFastifyApplication | undefined;
    const now = new Date();

    try {
      await owner.connect();
      await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
        tenantId,
        'Communications tenant',
        `communications-${tenantId}`,
      ]);
      await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
        otherTenantId,
        'Other communications tenant',
        `communications-${otherTenantId}`,
      ]);
      await owner.query(
        'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
        [organizationId, tenantId, 'Communications provider'],
      );
      await owner.query(
        'INSERT INTO organizations.facilities (id, tenant_id, organization_id, name) VALUES ($1, $2, $3, $4)',
        [facilityId, tenantId, organizationId, 'Communications facility'],
      );
      await owner.query(
        'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
        [otherTenantOrganizationId, otherTenantId, 'Other communications provider'],
      );
      await owner.query(
        'INSERT INTO organizations.facilities (id, tenant_id, organization_id, name) VALUES ($1, $2, $3, $4)',
        [
          otherTenantFacilityId,
          otherTenantId,
          otherTenantOrganizationId,
          'Other communications facility',
        ],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Ada', 'Client', 'active', $5, $5),
                ($6, $2, $3, $4, 'Grace', 'Other', 'active', $5, $5)`,
        [clientId, tenantId, organizationId, facilityId, now, otherClientId],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Lin', 'OtherTenant', 'active', $5, $5)`,
        [otherTenantClientId, otherTenantId, otherTenantOrganizationId, otherTenantFacilityId, now],
      );
      const today = now.toISOString().slice(0, 10);
      const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await owner.query(
        `INSERT INTO clients.client_contacts
           (id, tenant_id, client_id, first_name, last_name, relationship_type, representation_type,
            representation_valid_from, representation_valid_until, created_at, updated_at)
         VALUES ($1, $2, $3, 'Bea', 'Representative', 'legal_representative', 'legal_guardianship', $4, $5, $6, $6)`,
        [representativeId, tenantId, clientId, today, validUntil, now],
      );
      await owner.query(
        `INSERT INTO clients.client_contacts
           (id, tenant_id, client_id, first_name, last_name, relationship_type, created_at, updated_at)
         VALUES ($1, $2, $3, 'Other', 'Client Contact', 'relative', $4, $4)`,
        [otherClientContactId, tenantId, otherClientId, now],
      );
      await owner.query(
        `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
         VALUES ($1, $2, $3, 'legal_representative')`,
        [tenantId, clientId, representativeId],
      );
      await owner.query(
        `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status,
            planned_start, planned_end, timezone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed', $6, $7, 'Europe/Berlin', $8, $8),
                ($9, $2, $10, $4, $5, 'manual', 'confirmed', $6, $7, 'Europe/Berlin', $8, $8)`,
        [
          visitId,
          tenantId,
          clientId,
          organizationId,
          facilityId,
          now,
          new Date(now.getTime() + 60 * 60 * 1000),
          now,
          otherVisitId,
          otherClientId,
        ],
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
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        roleId,
        tenantId,
        'Communications integration',
      ]);
      const permissions = [
        'client.read',
        'client.update',
        'client.create',
        'communications.read',
        'communications.create',
        'communications.update',
        'communications.amend',
        'communications.preferences.manage',
        'schedule.read',
        'schedule.create',
        'service.read',
        'operations.read',
        'operations.tasks.create',
        'onboarding.read',
        'onboarding.create',
        'onboarding.manage',
        'onboarding.admit',
        'onboarding.templates.manage',
        'service_agreement.read',
      ];
      for (const permission of permissions) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        await owner.query(
          'INSERT INTO identity.role_permissions (role_id, permission) VALUES ($1, $2)',
          [roleId, permission],
        );
      }
      const membership = await owner.query<{ id: string }>(
        'SELECT id FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
        [userId, tenantId],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [membership.rows[0]!.id, tenantId, roleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [membership.rows[0]!.id, tenantId],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [uuidv7(), userId, otherTenantId],
      );
      const otherTenantMembership = await owner.query<{ id: string }>(
        'SELECT id FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
        [userId, otherTenantId],
      );
      const otherTenantRoleId = uuidv7();
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        otherTenantRoleId,
        otherTenantId,
        'Other tenant communications integration',
      ]);
      for (const permission of ['client.read', 'communications.read', 'communications.create']) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        await owner.query(
          'INSERT INTO identity.role_permissions (role_id, permission) VALUES ($1, $2)',
          [otherTenantRoleId, permission],
        );
      }
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [otherTenantMembership.rows[0]!.id, otherTenantId, otherTenantRoleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [otherTenantMembership.rows[0]!.id, otherTenantId],
      );

      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = database.appUrl;
      process.env.OIDC_ISSUER = oidc.issuer;
      process.env.OIDC_CLIENT_ID = 'care-communications-integration';
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
        .setAudience('care-communications-integration')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('2 minutes')
        .sign(privateKey);
      const headers = {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      };
      const otherTenantHeaders = { ...headers, 'X-Tenant-Id': otherTenantId };

      const admissionResponse = await fetch(`${baseUrl}/api/v1/onboarding/cases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          facilityId,
          firstName: 'Nora',
          lastName: 'Prospect',
          contactMethod: 'phone',
          inquirySource: 'website',
          fundingPlan: 'private_pay',
        }),
      });
      expect(admissionResponse.status).toBe(201);
      const admission = (await admissionResponse.json()) as { id: string; version: number };

      const prospectCommunicationResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${admission.id}/communications/records`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            direction: 'inbound',
            channel: 'phone',
            category: 'general_inquiry',
            subject: 'Ask about weekday support',
            summary: 'Requested a morning callback.',
            outcome: 'action_required',
            occurredAt: now.toISOString(),
          }),
        },
      );
      expect(prospectCommunicationResponse.status).toBe(201);
      const prospectCommunication = (await prospectCommunicationResponse.json()) as {
        id: string;
        subject: string;
      };
      expect(prospectCommunication.subject).toBe('Ask about weekday support');

      const admissionDetailResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${admission.id}`,
        { headers },
      );
      expect(admissionDetailResponse.status).toBe(200);
      const admissionDetail = (await admissionDetailResponse.json()) as {
        version: number;
        communications: Array<{
          link: { interactionId: string };
          interaction: { id: string; summary: string | null };
          prospect: boolean;
        }>;
      };
      expect(admissionDetail.version).toBe(admission.version + 1);
      expect(admissionDetail.communications).toEqual([
        {
          link: { interactionId: prospectCommunication.id },
          interaction: expect.objectContaining({
            id: prospectCommunication.id,
            summary: 'Requested a morning callback.',
          }),
          prospect: true,
        },
      ]);
      const crossTenantAdmission = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${admission.id}`,
        { headers: otherTenantHeaders },
      );
      expect(crossTenantAdmission.status).toBe(404);

      const secondAdmissionResponse = await fetch(`${baseUrl}/api/v1/onboarding/cases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          facilityId,
          firstName: 'Omar',
          lastName: 'Prospect',
          contactMethod: 'email',
          inquirySource: 'referral',
        }),
      });
      expect(secondAdmissionResponse.status).toBe(201);
      const secondAdmission = (await secondAdmissionResponse.json()) as {
        id: string;
        version: number;
      };
      const fullNameSearchResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases?search=Nora%20Prospect`,
        { headers },
      );
      expect(fullNameSearchResponse.status).toBe(200);
      const fullNameSearch = (await fullNameSearchResponse.json()) as {
        total: number;
        items: Array<{ id: string }>;
      };
      expect(fullNameSearch).toMatchObject({ total: 1, items: [{ id: admission.id }] });
      const admissionSummaryResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${admission.id}/summary`,
        { headers },
      );
      expect(admissionSummaryResponse.status).toBe(200);
      expect(await admissionSummaryResponse.json()).toMatchObject({
        id: admission.id,
        firstName: 'Nora',
        lastName: 'Prospect',
        organizationName: null,
        facilityName: null,
      });
      const sortedAdmissionsResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases?sortBy=name&sortDirection=asc&page=1&pageSize=1`,
        { headers },
      );
      expect(sortedAdmissionsResponse.status).toBe(200);
      const sortedAdmissions = (await sortedAdmissionsResponse.json()) as {
        total: number;
        page: number;
        pageSize: number;
        items: Array<{ id: string; firstName: string }>;
      };
      expect(sortedAdmissions).toMatchObject({ total: 2, page: 1, pageSize: 1 });
      expect(sortedAdmissions.items[0]).toMatchObject({ id: admission.id, firstName: 'Nora' });
      const secondSortedPageResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases?sortBy=name&sortDirection=asc&page=2&pageSize=1`,
        { headers },
      );
      const secondSortedPage = (await secondSortedPageResponse.json()) as {
        items: Array<{ id: string; firstName: string }>;
      };
      expect(secondSortedPage.items[0]).toMatchObject({
        id: secondAdmission.id,
        firstName: 'Omar',
      });
      const crossTenantSummaryResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${admission.id}/summary`,
        { headers: otherTenantHeaders },
      );
      expect(crossTenantSummaryResponse.status).toBe(404);
      const otherFundingResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${secondAdmission.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ expectedVersion: secondAdmission.version, fundingPlan: 'other' }),
        },
      );
      expect(otherFundingResponse.status).toBe(200);
      const incompleteFundingReadinessResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${secondAdmission.id}/readiness`,
        { headers },
      );
      const incompleteFundingReadiness = (await incompleteFundingReadinessResponse.json()) as {
        findings: Array<{ code: string; severity: string; detailCode?: string }>;
      };
      expect(
        incompleteFundingReadiness.findings.find(
          (finding) => finding.code === 'funding_arrangement',
        ),
      ).toMatchObject({ severity: 'blocker', detailCode: 'FUNDING_PLAN_DETAILS_MISSING' });
      const documentedFundingResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${secondAdmission.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            expectedVersion: secondAdmission.version + 1,
            fundingPlanDetails: 'Private payment from the client',
          }),
        },
      );
      expect(documentedFundingResponse.status).toBe(200);
      const documentedFundingReadinessResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${secondAdmission.id}/readiness`,
        { headers },
      );
      const documentedFundingReadiness = (await documentedFundingReadinessResponse.json()) as {
        findings: Array<{ code: string; severity: string }>;
      };
      expect(
        documentedFundingReadiness.findings.find(
          (finding) => finding.code === 'funding_arrangement',
        )?.severity,
      ).toBe('complete');
      const blockedWorklistResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases?readiness=blocked&page=1&pageSize=25`,
        { headers },
      );
      expect(blockedWorklistResponse.status).toBe(200);
      const blockedWorklist = (await blockedWorklistResponse.json()) as {
        total: number;
        items: Array<{ id: string }>;
      };
      expect(blockedWorklist.total).toBe(2);
      expect(blockedWorklist.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([admission.id, secondAdmission.id]),
      );
      const templatesResponse = await fetch(`${baseUrl}/api/v1/onboarding/templates`, { headers });
      expect(templatesResponse.status).toBe(200);
      const templates = (await templatesResponse.json()) as Array<{
        id: string;
        currentVersion: number;
        items: Array<{
          code: string;
          category: string;
          label: string;
          source: 'automatic' | 'manual' | 'document';
          mandatory: boolean;
          requirementType: 'policy' | 'external';
        }>;
      }>;
      expect(templates).toHaveLength(1);
      expect(templates[0]?.items).toHaveLength(7);
      const templateItems = templates[0]!.items.map(
        ({ code, category, label, source, mandatory, requirementType }) => ({
          code,
          category,
          label,
          source,
          mandatory,
          requirementType,
        }),
      );
      expect(templateItems.some((item) => item.category === 'required_documents')).toBe(true);
      templateItems.push({
        code: 'prospect_follow_up',
        category: 'follow_up',
        label: 'Confirm follow-up completed',
        source: 'manual',
        mandatory: false,
        requirementType: 'policy',
      });
      const templateUpdateResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/templates/${templates[0]!.id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ expectedVersion: 1, name: 'Default', items: templateItems }),
        },
      );
      expect(templateUpdateResponse.status).toBe(200);
      const updatedTemplate = (await templateUpdateResponse.json()) as {
        currentVersion: number;
        items: Array<{ code: string }>;
      };
      expect(updatedTemplate.currentVersion).toBe(2);
      expect(updatedTemplate.items).toHaveLength(8);
      const pinnedChecklistResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${admission.id}`,
        { headers },
      );
      const pinnedChecklist = (await pinnedChecklistResponse.json()) as {
        checklist: Array<{ code: string }>;
      };
      expect(pinnedChecklist.checklist).toHaveLength(7);

      const primaryContactId = uuidv7();
      const serviceCategoryId = uuidv7();
      const serviceId = uuidv7();
      const agreementId = uuidv7();
      const nowForAdmission = new Date();
      const todayForAdmission = nowForAdmission.toISOString().slice(0, 10);
      const activationCaseResponse = await fetch(`${baseUrl}/api/v1/onboarding/cases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          facilityId,
          firstName: 'Iris',
          lastName: 'Pending',
          contactMethod: 'phone',
          inquirySource: 'referral',
          fundingPlan: 'private_pay',
        }),
      });
      expect(activationCaseResponse.status).toBe(201);
      const createdActivationCase = (await activationCaseResponse.json()) as {
        id: string;
        version: number;
      };
      const registerClientResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${createdActivationCase.id}/register-client`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: createdActivationCase.version }),
        },
      );
      expect(registerClientResponse.status).toBe(200);
      const activationCase = (await registerClientResponse.json()) as {
        id: string;
        clientId: string;
        version: number;
      };
      expect(activationCase.version).toBe(createdActivationCase.version + 1);
      const earlyFirstVisitLinkResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}/first-visit`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ visitId: uuidv7(), expectedVersion: activationCase.version }),
        },
      );
      expect(earlyFirstVisitLinkResponse.status).toBe(409);
      expect((await earlyFirstVisitLinkResponse.json()).code).toBe(
        'ONBOARDING_FIRST_VISIT_STAGE_INVALID',
      );
      const registeredClient = await owner.query<{ status: string }>(
        'SELECT status FROM clients.clients WHERE tenant_id = $1 AND id = $2',
        [tenantId, activationCase.clientId],
      );
      expect(registeredClient.rows[0]?.status).toBe('pending');
      const registeredClientId = activationCase.clientId;
      await owner.query(
        `INSERT INTO clients.client_contacts
           (id, tenant_id, client_id, first_name, last_name, relationship_type, created_at, updated_at)
         VALUES ($1, $2, $3, 'Iris', 'Contact', 'relative', $4, $4)`,
        [primaryContactId, tenantId, registeredClientId, nowForAdmission],
      );
      await owner.query(
        `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
         VALUES ($1, $2, $3, 'primary_contact')`,
        [tenantId, registeredClientId, primaryContactId],
      );
      await owner.query(
        `INSERT INTO services.service_categories (id, tenant_id, name, status, created_at, updated_at)
         VALUES ($1, $2, 'Integration services', 'active', $3, $3)`,
        [serviceCategoryId, tenantId, nowForAdmission],
      );
      await owner.query(
        `INSERT INTO services.service_definitions
           (id, tenant_id, code, name, category_id, unit, benefit_category, status, valid_from, created_at, updated_at)
         VALUES ($1, $2, 'HOME-01', 'Home support', $3, 'hour', 'recognized_support', 'active', $4, $5, $5)`,
        [serviceId, tenantId, serviceCategoryId, todayForAdmission, nowForAdmission],
      );
      await owner.query(
        `INSERT INTO services.service_availability
           (id, tenant_id, service_id, organization_id, facility_id, active, valid_from, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $7)`,
        [
          uuidv7(),
          tenantId,
          serviceId,
          organizationId,
          facilityId,
          todayForAdmission,
          nowForAdmission,
        ],
      );
      await owner.query(
        `INSERT INTO services.service_prices
           (id, tenant_id, service_id, organization_id, facility_id, price_cents, pricing_unit,
            valid_from, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, 3200, 'hour', $6, $7, $8)`,
        [
          uuidv7(),
          tenantId,
          serviceId,
          organizationId,
          facilityId,
          todayForAdmission,
          userId,
          nowForAdmission,
        ],
      );
      await owner.query(
        `INSERT INTO service_agreements.agreements
           (id, tenant_id, client_id, organization_id, facility_id, status, valid_from, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $7)`,
        [
          agreementId,
          tenantId,
          registeredClientId,
          organizationId,
          facilityId,
          todayForAdmission,
          nowForAdmission,
        ],
      );
      await owner.query(
        `INSERT INTO service_agreements.agreement_services
           (id, tenant_id, agreement_id, service_definition_id, service_code, service_name, service_unit,
            status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'HOME-01', 'Home support', 'hour', 'active', $5, $5)`,
        [uuidv7(), tenantId, agreementId, serviceId, nowForAdmission],
      );
      const mismatchedServicesCaseResponse = await fetch(`${baseUrl}/api/v1/onboarding/cases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          facilityId,
          clientId: registeredClientId,
          firstName: 'Iris',
          lastName: 'Pending',
          contactMethod: 'phone',
          inquirySource: 'referral',
          fundingPlan: 'private_pay',
        }),
      });
      expect(mismatchedServicesCaseResponse.status).toBe(201);
      const mismatchedServicesCase = (await mismatchedServicesCaseResponse.json()) as {
        id: string;
        version: number;
      };
      const mismatchedAssessmentResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${mismatchedServicesCase.id}/assessment`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedVersion: mismatchedServicesCase.version,
            data: {
              requestedServices: ['Companion support'],
              householdSupport: 'Weekly companionship',
              everydayAssistance: '',
              accompaniment: '',
              preferredDays: ['monday'],
              preferredTimeStart: null,
              preferredTimeEnd: null,
              visitsPerWeek: 1,
              preferredStartDate: null,
              accessibility: '',
              preferences: '',
              organizationalNotes: '',
            },
          }),
        },
      );
      expect(mismatchedAssessmentResponse.status).toBe(200);
      const mismatchedAgreementReadinessResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${mismatchedServicesCase.id}/readiness`,
        { headers },
      );
      const mismatchedAgreementReadiness = (await mismatchedAgreementReadinessResponse.json()) as {
        findings: Array<{ code: string; severity: string; detailCode?: string }>;
      };
      expect(
        mismatchedAgreementReadiness.findings.find(
          (finding) => finding.code === 'service_agreement',
        ),
      ).toMatchObject({ severity: 'blocker', detailCode: 'AGREEMENT_SERVICES_MISSING' });
      const assessmentResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}/assessment`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedVersion: activationCase.version,
            data: {
              requestedServices: ['home support'],
              householdSupport: 'Weekly home support',
              everydayAssistance: '',
              accompaniment: '',
              preferredDays: ['monday'],
              preferredTimeStart: null,
              preferredTimeEnd: null,
              visitsPerWeek: 1,
              preferredStartDate: null,
              accessibility: '',
              preferences: '',
              organizationalNotes: '',
            },
          }),
        },
      );
      expect(assessmentResponse.status).toBe(200);
      let activationCaseVersion = activationCase.version + 1;
      for (const toStage of ['assessment', 'preparation', 'ready_for_admission'] as const) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        const transitionResponse = await fetch(
          `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}/transitions`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ expectedVersion: activationCaseVersion, toStage }),
          },
        );
        expect(transitionResponse.status).toBe(200);
        activationCaseVersion += 1;
      }
      const admissionDecisionResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}/admit`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: activationCaseVersion }),
        },
      );
      expect(admissionDecisionResponse.status).toBe(200);
      const admittedActivationCase = (await admissionDecisionResponse.json()) as {
        version: number;
        decisionSnapshot: { checklistTemplateId: string; checklistTemplateVersion: number };
      };
      expect(admittedActivationCase.decisionSnapshot).toMatchObject({
        checklistTemplateId: templates[0]!.id,
        checklistTemplateVersion: updatedTemplate.currentVersion,
      });
      const activatedClient = await owner.query<{ status: string }>(
        'SELECT status FROM clients.clients WHERE tenant_id = $1 AND id = $2',
        [tenantId, registeredClientId],
      );
      const admittedCase = await owner.query<{ stage: string }>(
        'SELECT stage FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
        [tenantId, activationCase.id],
      );
      expect(activatedClient.rows[0]?.status).toBe('active');
      expect(admittedCase.rows[0]?.stage).toBe('admitted');

      const firstVisitDate = new Date(nowForAdmission.getTime() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const firstVisitResponse = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: registeredClientId,
          localDate: firstVisitDate,
          localStartTime: '10:00',
          localEndTime: '11:00',
          services: [{ serviceDefinitionId: serviceId, plannedQuantity: '1' }],
        }),
      });
      const firstVisitBody = (await firstVisitResponse.json()) as
        | { id: string }
        | { code?: string; detail?: string };
      if (firstVisitResponse.status !== 201)
        throw new Error(`First visit creation failed: ${JSON.stringify(firstVisitBody)}`);
      const firstVisit = firstVisitBody as { id: string };
      const firstVisitLinkResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}/first-visit`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            visitId: firstVisit.id,
            expectedVersion: admittedActivationCase.version,
          }),
        },
      );
      expect(firstVisitLinkResponse.status).toBe(200);
      const linkedCaseResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}`,
        { headers },
      );
      const linkedCase = (await linkedCaseResponse.json()) as {
        firstVisitId: string | null;
        version: number;
        servicePricing: Array<{
          status: string;
          priceCents: number | null;
          pricingUnit: string | null;
        }>;
      };
      expect(linkedCaseResponse.status).toBe(200);
      expect(linkedCase).toMatchObject({
        firstVisitId: firstVisit.id,
        version: admittedActivationCase.version + 1,
      });
      expect(linkedCase.servicePricing).toContainEqual(
        expect.objectContaining({
          requestedService: 'home support',
          serviceId,
          status: 'available',
          priceCents: 3200,
          pricingUnit: 'hour',
        }),
      );

      const followUpTaskResponse = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          facilityId,
          clientId: registeredClientId,
          title: 'Confirm first visit details',
          priority: 'normal',
        }),
      });
      expect(followUpTaskResponse.status).toBe(201);
      const followUpTask = (await followUpTaskResponse.json()) as { id: string };
      const followUpLinkResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}/tasks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ taskId: followUpTask.id }),
        },
      );
      expect(followUpLinkResponse.status).toBe(200);
      const linkedAfterTaskResponse = await fetch(
        `${baseUrl}/api/v1/onboarding/cases/${activationCase.id}`,
        { headers },
      );
      const linkedAfterTask = (await linkedAfterTaskResponse.json()) as {
        tasks: Array<{ task: { id: string } }>;
      };
      expect(linkedAfterTask.tasks.map(({ task }) => task.id)).toContain(followUpTask.id);

      const recorded = await fetch(
        `${baseUrl}/api/v1/communications/clients/${clientId}/interactions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            direction: 'inbound',
            channel: 'phone',
            category: 'appointment_coordination',
            subject: 'Confirm afternoon visit',
            summary: 'Representative confirmed availability.',
            outcome: 'action_required',
            occurredAt: now.toISOString(),
            contactId: representativeId,
            source: { type: 'visit', id: visitId },
          }),
        },
      );
      expect(recorded.status).toBe(201);
      const interaction = (await recorded.json()) as {
        id: string;
        contactAuthorization: string;
        version: number;
      };
      expect(interaction).toMatchObject({
        contactAuthorization: 'legal_representative',
        version: 1,
      });

      const otherClientContact = await fetch(
        `${baseUrl}/api/v1/communications/clients/${clientId}/interactions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            direction: 'inbound',
            channel: 'phone',
            category: 'general_inquiry',
            subject: 'Contact belongs to another client',
            outcome: 'request_received',
            occurredAt: now.toISOString(),
            contactId: otherClientContactId,
          }),
        },
      );
      expect(otherClientContact.status).toBe(404);

      const otherTenantInteraction = await fetch(
        `${baseUrl}/api/v1/communications/clients/${otherTenantClientId}/interactions`,
        {
          method: 'POST',
          headers: otherTenantHeaders,
          body: JSON.stringify({
            direction: 'inbound',
            channel: 'phone',
            category: 'general_inquiry',
            subject: 'Authorized other tenant record',
            outcome: 'resolved',
            occurredAt: now.toISOString(),
          }),
        },
      );
      expect(otherTenantInteraction.status).toBe(201);
      const otherTenantRecord = (await otherTenantInteraction.json()) as { id: string };
      const otherTenantHistory = await fetch(`${baseUrl}/api/v1/communications`, {
        headers: otherTenantHeaders,
      });
      expect(otherTenantHistory.status).toBe(200);
      expect(await otherTenantHistory.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: otherTenantRecord.id })],
      });
      const crossTenantSummary = await fetch(
        `${baseUrl}/api/v1/communications/clients/${clientId}/summary`,
        { headers: otherTenantHeaders },
      );
      expect(crossTenantSummary.status).toBe(404);

      const clientHistory = await fetch(
        `${baseUrl}/api/v1/communications/clients/${clientId}/interactions?page=1&pageSize=25`,
        { headers },
      );
      expect(clientHistory.status).toBe(200);
      expect(await clientHistory.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: interaction.id })],
      });

      const otherClientHistory = await fetch(
        `${baseUrl}/api/v1/communications/clients/${otherClientId}/interactions`,
        { headers },
      );
      expect(otherClientHistory.status).toBe(200);
      expect(await otherClientHistory.json()).toMatchObject({ total: 0, items: [] });

      const wrongClientSource = await fetch(
        `${baseUrl}/api/v1/communications/clients/${clientId}/interactions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            direction: 'inbound',
            channel: 'phone',
            category: 'general_inquiry',
            subject: 'Wrong client link',
            outcome: 'request_received',
            occurredAt: now.toISOString(),
            source: { type: 'visit', id: otherVisitId },
          }),
        },
      );
      expect(wrongClientSource.status).toBe(404);

      const wrongClientTask = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          clientId: otherClientId,
          title: 'Mismatched communication task',
          source: { type: 'communication', id: interaction.id },
        }),
      });
      expect(wrongClientTask.status).toBe(400);

      const preferences = await fetch(
        `${baseUrl}/api/v1/communications/clients/${clientId}/preferences`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            expectedVersion: 0,
            preferredChannel: 'phone',
            preferredLanguage: 'de',
            preferredContactId: representativeId,
            correspondencePreference: 'postal',
            contactRestrictions: 'No calls after 18:00.',
          }),
        },
      );
      expect(preferences.status).toBe(200);
      expect(await preferences.json()).toMatchObject({
        consentStatus: 'unknown',
        version: 1,
        correspondencePreference: 'postal',
      });

      const needsTask = await fetch(`${baseUrl}/api/v1/communications?followUpStatus=needs_task`, {
        headers,
      });
      expect(needsTask.status).toBe(200);
      expect(await needsTask.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: interaction.id, followUpStatus: 'needs_task' })],
      });

      const followUp = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          clientId,
          title: 'Send visit confirmation',
          priority: 'normal',
          source: { type: 'communication', id: interaction.id },
        }),
      });
      const followUpBody = await followUp.text();
      if (followUp.status !== 201)
        throw new Error(`Follow-up task request failed: ${followUpBody}`);
      const task = JSON.parse(followUpBody) as { source: { type: string; id: string } };
      expect(task.source).toEqual({ type: 'communication', id: interaction.id });

      const openFollowUp = await fetch(`${baseUrl}/api/v1/communications?followUpStatus=open`, {
        headers,
      });
      expect(openFollowUp.status).toBe(200);
      expect(await openFollowUp.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: interaction.id, followUpStatus: 'open' })],
      });

      const overdueTask = await fetch(`${baseUrl}/api/v1/operations/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId,
          clientId,
          title: 'Call back about the visit',
          priority: 'high',
          dueAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          source: { type: 'communication', id: interaction.id },
        }),
      });
      expect(overdueTask.status).toBe(201);

      const overdueFollowUp = await fetch(
        `${baseUrl}/api/v1/communications?followUpStatus=overdue`,
        { headers },
      );
      expect(overdueFollowUp.status).toBe(200);
      expect(await overdueFollowUp.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: interaction.id, followUpStatus: 'overdue' })],
      });

      const stillOpenFollowUp = await fetch(
        `${baseUrl}/api/v1/communications?followUpStatus=open`,
        { headers },
      );
      expect(stillOpenFollowUp.status).toBe(200);
      expect(await stillOpenFollowUp.json()).toMatchObject({ total: 0, items: [] });

      const noLongerNeedsTask = await fetch(
        `${baseUrl}/api/v1/communications?followUpStatus=needs_task`,
        { headers },
      );
      expect(noLongerNeedsTask.status).toBe(200);
      expect(await noLongerNeedsTask.json()).toMatchObject({ total: 0, items: [] });

      const amended = await fetch(
        `${baseUrl}/api/v1/communications/interactions/${interaction.id}/amendments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            expectedVersion: 1,
            reason: 'Correct the confirmation detail.',
            summary: 'Representative confirmed the morning visit instead.',
          }),
        },
      );
      expect(amended.status).toBe(200);
      expect(await amended.json()).toMatchObject({
        version: 2,
        summary: 'Representative confirmed the morning visit instead.',
      });

      const detail = await fetch(
        `${baseUrl}/api/v1/communications/interactions/${interaction.id}`,
        { headers },
      );
      expect(detail.status).toBe(200);
      const history = (await detail.json()) as {
        amendments: Array<{
          version: number;
          reason: string;
          summary: string;
          recordedByUserId: string;
        }>;
      };
      expect(history.amendments).toHaveLength(1);
      expect(history.amendments[0]).toMatchObject({
        version: 1,
        reason: 'Correct the confirmation detail.',
        summary: 'Representative confirmed availability.',
        recordedByUserId: userId,
      });

      const summary = await fetch(`${baseUrl}/api/v1/communications/clients/${clientId}/summary`, {
        headers,
      });
      expect(summary.status).toBe(200);
      const summaryBody = (await summary.json()) as {
        openFollowUps: Array<{ id: string; title: string; status: string; dueAt: string | null }>;
      };
      const openFollowUps = summaryBody.openFollowUps;
      const summaryKeys = Object.keys(summaryBody).sort();
      expect(summaryBody).toMatchObject({
        mostRecentInteraction: {
          subject: 'Confirm afternoon visit',
          occurredAt: now.toISOString(),
        },
        preferredChannel: 'phone',
        preferredContactName: 'Bea Representative',
        primaryAuthorizedContact: {
          name: 'Bea Representative',
          authorization: 'legal_representative',
        },
        openFollowUps: expect.arrayContaining([
          expect.objectContaining({ title: 'Send visit confirmation' }),
        ]),
      });
      expect(openFollowUps).toHaveLength(2);
      expect(summaryKeys).toEqual([
        'mostRecentInteraction',
        'openFollowUps',
        'preferredChannel',
        'preferredContactName',
        'primaryAuthorizedContact',
      ]);
    } finally {
      await api?.close().catch(() => undefined);
      await closeServer(oidc.server).catch(() => undefined);
      await owner.end().catch(() => undefined);
      await database.container.stop();
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
    } else response.writeHead(404).end();
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
