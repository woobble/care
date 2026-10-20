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
import { createDatabase } from '@care/database';
import { PERMISSIONS } from '@care/permissions';
import { DrizzleOutboxRepository, platformSchema } from '@care/platform';
import { startCareTestDatabase } from '@care/testing';

const UUID_V4_COMPATIBILITY_ID = '00000000-0000-4000-8000-000000000001';

describe('clients API', () => {
  test('authenticates, enforces tenant membership, and commits client, audit, and outbox changes', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const appRole = new Client({ connectionString: database.appUrl });
    const workerDatabase = createDatabase(database.workerUrl, platformSchema);
    const outbox = new DrizzleOutboxRepository(workerDatabase.db);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const keyId = uuidv7();
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const oidc = await startOidcServer(publicJwk);
    const subject = uuidv7();
    const userId = uuidv7();
    const tenantId = uuidv7();
    const membershipId = uuidv7();
    const roleId = uuidv7();
    const officeRoleId = uuidv7();
    const caregiverRoleId = uuidv7();
    const otherTenantId = uuidv7();
    const otherTenantRoleId = uuidv7();
    const organizationId = uuidv7();
    const secondOrganizationId = uuidv7();
    const facilityId = uuidv7();
    const secondFacilityId = uuidv7();
    const secondOrganizationFacilityId = uuidv7();
    const otherOrganizationId = uuidv7();
    const otherFacilityId = uuidv7();
    const crossTenantClientId = uuidv7();
    let app: NestFastifyApplication | undefined;

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = database.appUrl;
    process.env.OIDC_ISSUER = oidc.issuer;
    process.env.OIDC_CLIENT_ID = 'care-integration-test';
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.API_PUBLIC_ORIGIN = 'http://localhost:3001';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:8333';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = 'care-test-private';
    process.env.S3_ACCESS_KEY = 'care-test-access';
    process.env.S3_SECRET_KEY = 'care-test-secret';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    delete process.env.ROUTING_OSRM_URL;

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
        tenantId,
        'Integration Tenant',
        `integration-${tenantId}`,
      ]);
      await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
        otherTenantId,
        'Other Integration Tenant',
        `integration-${otherTenantId}`,
      ]);
      const defaultStatusUserId = uuidv7();
      const defaultStatusMembershipId = uuidv7();
      await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [defaultStatusUserId]);
      const defaultMembership = await owner.query<{ status: string }>(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id)
         VALUES ($1, $2, $3) RETURNING status`,
        [defaultStatusMembershipId, defaultStatusUserId, tenantId],
      );
      expect(defaultMembership.rows[0]?.status).toBe('pending');
      await owner.query('DELETE FROM identity.tenant_memberships WHERE id = $1', [
        defaultStatusMembershipId,
      ]);
      await owner.query('DELETE FROM identity.users WHERE id = $1', [defaultStatusUserId]);
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name)
         VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
        [
          organizationId,
          tenantId,
          'Integration Organization',
          secondOrganizationId,
          tenantId,
          'Second Integration Organization',
          otherOrganizationId,
          otherTenantId,
          'Other Integration Organization',
        ],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12), ($13, $14, $15, $16)`,
        [
          facilityId,
          tenantId,
          organizationId,
          'Integration Facility One',
          secondFacilityId,
          tenantId,
          organizationId,
          'Integration Facility Two',
          secondOrganizationFacilityId,
          tenantId,
          secondOrganizationId,
          'Second Organization Facility',
          otherFacilityId,
          otherTenantId,
          otherOrganizationId,
          'Other Integration Facility',
        ],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Cross', 'Tenant', 'pending', now(), now())`,
        [crossTenantClientId, otherTenantId, otherOrganizationId, otherFacilityId],
      );
      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [userId, 'admin@integration.test', 'Integration Admin'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [uuidv7(), userId, oidc.issuer, subject],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [membershipId, userId, tenantId],
      );
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        roleId,
        tenantId,
        'Integration Admin',
      ]);
      await owner.query(
        `INSERT INTO identity.role_permissions (role_id, permission)
         SELECT $1, permission FROM unnest($2::text[]) AS permission`,
        [roleId, [...PERMISSIONS]],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [membershipId, tenantId, roleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [membershipId, tenantId, tenantId],
      );
      const secondUserId = uuidv7();
      const secondMembershipId = uuidv7();
      const secondSubject = uuidv7();
      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [secondUserId, 'office@integration.test', 'Integration Office'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [uuidv7(), secondUserId, oidc.issuer, secondSubject],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [secondMembershipId, secondUserId, tenantId],
      );
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        officeRoleId,
        tenantId,
        'Office',
      ]);
      await owner.query(
        `INSERT INTO identity.role_permissions (role_id, permission)
         VALUES
           ($1, 'client.read'), ($1, 'organization.read'), ($1, 'facility.read'),
           ($1, 'team.read'), ($1, 'employee.read'), ($1, 'employee.create'),
           ($1, 'service.read'), ($1, 'service.create'), ($1, 'service.update'),
           ($1, 'service.archive'), ($1, 'service.manage_categories'),
           ($1, 'service.manage_availability'),
           ($1, 'service_agreement.read'), ($1, 'service_agreement.create'),
           ($1, 'service_agreement.update'), ($1, 'service_agreement.activate'),
           ($1, 'service_agreement.suspend'), ($1, 'service_agreement.end'),
           ($1, 'service_agreement.manage_services'),
           ($1, 'schedule.read'), ($1, 'schedule.create'), ($1, 'schedule.update'),
           ($1, 'schedule.cancel'), ($1, 'schedule.confirm'), ($1, 'schedule.assign'),
           ($1, 'schedule.generate'),
           ($1, 'employee.update'), ($1, 'employee.assign_facility'),
           ($1, 'employee.assign_team'), ($1, 'employee.link_user'),
           ($1, 'employee.manage_employment'),
           ($1, 'visit_execution.read'), ($1, 'visit_execution.correct'),
           ($1, 'care_documentation.read'), ($1, 'care_documentation.review'),
           ($1, 'care_documentation.amend'),
           ($1, 'service_evidence.read'), ($1, 'service_evidence.prepare'),
           ($1, 'operations.read'),
           ($1, 'acknowledgement.read'), ($1, 'acknowledgement.revoke')`,
        [officeRoleId],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [secondMembershipId, tenantId, officeRoleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [secondMembershipId, tenantId, tenantId],
      );

      const caregiverUserId = uuidv7();
      const caregiverSubject = uuidv7();
      const caregiverMembershipId = uuidv7();
      const unrelatedCaregiverUserId = uuidv7();
      const unrelatedCaregiverSubject = uuidv7();
      const unrelatedCaregiverMembershipId = uuidv7();
      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [caregiverUserId, 'caregiver@integration.test', 'Integration Caregiver'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [uuidv7(), caregiverUserId, oidc.issuer, caregiverSubject],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [caregiverMembershipId, caregiverUserId, tenantId],
      );
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        caregiverRoleId,
        tenantId,
        'Caregiver',
      ]);
      await owner.query(
        `INSERT INTO identity.role_permissions (role_id, permission)
         VALUES ($1, 'client.read'), ($1, 'service.read'), ($1, 'service_agreement.read'),
                ($1, 'schedule.read'), ($1, 'visit_execution.read'),
                ($1, 'visit_execution.start'), ($1, 'visit_execution.record_services'),
                ($1, 'visit_execution.complete'), ($1, 'care_documentation.read'),
                ($1, 'care_documentation.create'), ($1, 'care_documentation.update'),
                ($1, 'care_documentation.finalize'), ($1, 'service_evidence.read'),
                     ($1, 'acknowledgement.read'), ($1, 'acknowledgement.capture')`,
        [caregiverRoleId],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [caregiverMembershipId, tenantId, caregiverRoleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [caregiverMembershipId, tenantId, tenantId],
      );
      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [unrelatedCaregiverUserId, 'unrelated-caregiver@integration.test', 'Unrelated Caregiver'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [uuidv7(), unrelatedCaregiverUserId, oidc.issuer, unrelatedCaregiverSubject],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [unrelatedCaregiverMembershipId, unrelatedCaregiverUserId, tenantId],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [unrelatedCaregiverMembershipId, tenantId, caregiverRoleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [unrelatedCaregiverMembershipId, tenantId, tenantId],
      );
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        otherTenantRoleId,
        otherTenantId,
        'Other Tenant Role',
      ]);
      await owner.query(
        "INSERT INTO identity.role_permissions (role_id, permission) VALUES ($1, 'client.read')",
        [otherTenantRoleId],
      );

      expect((await appRole.query('SELECT id FROM identity.tenant_memberships')).rowCount).toBe(0);
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      expect((await appRole.query('SELECT id FROM identity.tenant_memberships')).rowCount).toBe(1);
      expect((await appRole.query('SELECT id FROM identity.roles')).rowCount).toBe(0);
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      expect((await appRole.query('SELECT role_id FROM identity.membership_roles')).rowCount).toBe(
        4,
      );
      expect(
        (await appRole.query('SELECT membership_id FROM identity.membership_scopes')).rowCount,
      ).toBe(4);
      expect((await appRole.query('SELECT role_id FROM identity.role_permissions')).rowCount).toBe(
        PERMISSIONS.length + 56,
      );
      await appRole.query('COMMIT');
      expect((await appRole.query('SELECT id FROM identity.tenant_memberships')).rowCount).toBe(0);

      app = await NestFactory.create<NestFastifyApplication>(AppModule, createApiFastifyAdapter(), {
        logger: false,
      });
      await configureApiHttp(app, 'http://localhost:3000');
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyId })
        .setIssuer(oidc.issuer)
        .setAudience('care-integration-test')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('2 minutes')
        .sign(privateKey);
      const headers = {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      };
      const issueToken = async (tokenSubject: string, claims: Record<string, unknown> = {}) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid: keyId })
          .setIssuer(oidc.issuer)
          .setAudience('care-integration-test')
          .setSubject(tokenSubject)
          .setIssuedAt()
          .setExpirationTime('10 minutes')
          .sign(privateKey);

      const unauthenticated = await fetch(`${baseUrl}/api/v1/clients`);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get('content-type')).toContain('application/problem+json');

      const unknownTenantId = UUID_V4_COMPATIBILITY_ID; // Keep a valid v4 input to cover API compatibility.
      const forbidden = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { ...headers, 'X-Tenant-Id': unknownTenantId },
      });
      expect(forbidden.status).toBe(403);

      const tokenWithoutExpiry = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyId })
        .setIssuer(oidc.issuer)
        .setAudience('care-integration-test')
        .setSubject(subject)
        .setIssuedAt()
        .sign(privateKey);
      const missingExpiry = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { ...headers, Authorization: `Bearer ${tokenWithoutExpiry}` },
      });
      expect(missingExpiry.status).toBe(401);

      const currentPermissions = await fetch(`${baseUrl}/api/v1/me/permissions`, { headers });
      expect(currentPermissions.status).toBe(200);
      expect(await currentPermissions.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ permission: 'client.create', scopeType: 'tenant' }),
          expect.objectContaining({
            permission: 'service.manage_availability',
            scopeType: 'tenant',
          }),
        ]),
      );

      const missingProviderContext = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace' }),
      });
      expect(missingProviderContext.status).toBe(400);
      const crossTenantClient = await fetch(`${baseUrl}/api/v1/clients/${crossTenantClientId}`, {
        headers,
      });
      expect(crossTenantClient.status).toBe(404);

      const createdResponse = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Ada',
          lastName: 'Lovelace',
          organizationId,
          primaryFacilityId: facilityId,
          primaryAddress: {
            addressType: 'home',
            street: 'Example Street',
            houseNumber: '1',
            postalCode: '10115',
            city: 'Berlin',
          },
        }),
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as {
        id: string;
        status: string;
        organizationId: string;
        primaryFacilityId: string;
      };
      expect(created.status).toBe('pending');
      expect(created).toMatchObject({ organizationId, primaryFacilityId: facilityId });

      const addresses = await fetch(`${baseUrl}/api/v1/clients/${created.id}/addresses`, {
        headers,
      });
      expect(addresses.status).toBe(200);
      expect(await addresses.json()).toEqual([
        expect.objectContaining({ street: 'Example Street', city: 'Berlin', isPrimary: true }),
      ]);

      const secondAddressResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/addresses`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            addressType: 'billing',
            street: 'Second Street',
            city: 'Berlin',
            isPrimary: true,
          }),
        },
      );
      expect(secondAddressResponse.status).toBe(201);
      const updatedAddresses = await fetch(`${baseUrl}/api/v1/clients/${created.id}/addresses`, {
        headers,
      });
      expect(
        ((await updatedAddresses.json()) as Array<{ street: string; isPrimary: boolean }>).filter(
          (clientAddress) => clientAddress.isPrimary,
        ),
      ).toHaveLength(1);

      const contactResponse = await fetch(`${baseUrl}/api/v1/clients/${created.id}/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Grace',
          lastName: 'Hopper',
          relationshipType: 'legal_representative',
          phone: '+49 30 123456',
          roles: ['primary_contact', 'emergency_contact', 'legal_representative'],
          representationType: 'power_of_attorney',
          representationValidFrom: '2026-01-01',
        }),
      });
      expect(contactResponse.status).toBe(201);
      expect(await contactResponse.json()).toMatchObject({
        firstName: 'Grace',
        roles: ['primary_contact', 'emergency_contact', 'legal_representative'],
      });
      const searchedContactsResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/contacts/search?q=Grace&page=1&pageSize=20`,
        { headers },
      );
      expect(searchedContactsResponse.status).toBe(200);
      expect(await searchedContactsResponse.json()).toMatchObject({
        items: [
          {
            firstName: 'Grace',
            lastName: 'Hopper',
            relationshipType: 'legal_representative',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });

      const insuranceNumber = `PRIVATE-${uuidv7()}`;
      const insuranceResponse = await fetch(`${baseUrl}/api/v1/clients/${created.id}/insurances`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          insuranceType: 'pflegeversicherung',
          insurerName: 'Demo Insurance',
          insuranceNumber,
          isPrimary: true,
        }),
      });
      expect(insuranceResponse.status).toBe(201);
      const invalidPflegegradResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/pflegegrade`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ grade: 0, validFrom: '2000-01-01', status: 'confirmed' }),
        },
      );
      expect(invalidPflegegradResponse.status).toBe(400);
      expect((await invalidPflegegradResponse.json()).code).toBe('INVALID_PFLEGEGRAD');
      const currentPflegegradResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/pflegegrade`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            grade: 3,
            validFrom: '2000-01-01',
            status: 'confirmed',
          }),
        },
      );
      expect(currentPflegegradResponse.status).toBe(201);
      const futureValidFrom = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const futurePflegegradResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/pflegegrade`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            grade: 4,
            validFrom: futureValidFrom,
            status: 'pending',
          }),
        },
      );
      expect(futurePflegegradResponse.status).toBe(201);
      const futurePflegegrad = (await futurePflegegradResponse.json()) as { id: string };
      const confirmedFuturePflegegrad = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/pflegegrade/${futurePflegegrad.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ status: 'confirmed' }) },
      );
      expect(confirmedFuturePflegegrad.status).toBe(200);

      const clientSearch = await fetch(
        `${baseUrl}/api/v1/clients?q=Ada&organizationId=${organizationId}&facilityId=${facilityId}&pflegegrad=3&page=1&pageSize=10&sortBy=lastName&sortOrder=asc`,
        { headers },
      );
      expect(await clientSearch.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: created.id, currentPflegegrad: 3 })],
      });

      const invalidProviderContext = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/provider-context`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ organizationId, primaryFacilityId: secondOrganizationFacilityId }),
        },
      );
      expect(invalidProviderContext.status).toBe(400);
      expect((await invalidProviderContext.json()).code).toBe('FACILITY_NOT_IN_ORGANIZATION');

      const secondFacilityClientResponse = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Katherine',
          lastName: 'Johnson',
          organizationId,
          primaryFacilityId: secondFacilityId,
        }),
      });
      expect(secondFacilityClientResponse.status).toBe(201);
      const secondFacilityClient = (await secondFacilityClientResponse.json()) as { id: string };
      const secondOrganizationClientResponse = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Dorothy',
          lastName: 'Vaughan',
          organizationId: secondOrganizationId,
          primaryFacilityId: secondOrganizationFacilityId,
        }),
      });
      expect(secondOrganizationClientResponse.status).toBe(201);
      const secondOrganizationClient = (await secondOrganizationClientResponse.json()) as {
        id: string;
      };

      const clientScopeOfficeHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(secondSubject)}`,
      };
      const clientSetFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: facilityId }] }),
        },
      );
      expect(clientSetFacilityScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${created.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${secondFacilityClient.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${secondOrganizationClient.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(404);

      const changedProviderContext = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/provider-context`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ organizationId, primaryFacilityId: secondFacilityId }),
        },
      );
      expect(changedProviderContext.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${created.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(404);

      const setOfficeSecondFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: secondFacilityId }] }),
        },
      );
      expect(setOfficeSecondFacilityScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${created.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${secondFacilityClient.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(200);

      const clientSetOrganizationScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            scopes: [{ scopeType: 'organization', scopeId: organizationId }],
          }),
        },
      );
      expect(clientSetOrganizationScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${secondFacilityClient.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${secondOrganizationClient.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(404);
      const organizationScopedSearch = await fetch(`${baseUrl}/api/v1/clients?pageSize=10`, {
        headers: clientScopeOfficeHeaders,
      });
      expect(await organizationScopedSearch.json()).toMatchObject({ total: 2 });

      const setOfficeTenantScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'tenant', scopeId: tenantId }] }),
        },
      );
      expect(setOfficeTenantScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${secondOrganizationClient.id}`, {
            headers: clientScopeOfficeHeaders,
          })
        ).status,
      ).toBe(200);

      const timelineResponse = await fetch(`${baseUrl}/api/v1/clients/${created.id}/timeline`, {
        headers,
      });
      expect(timelineResponse.status).toBe(200);
      const timeline = (await timelineResponse.json()) as Array<{
        actorId: string;
        action: string;
      }>;
      expect(timeline.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'client.created',
          'client.address_added',
          'client.contact_added',
          'client.insurance_added',
          'client.pflegegrad_added',
          'client.provider_context_changed',
        ]),
      );
      expect(timeline.every((entry) => entry.actorId && entry.action)).toBe(true);
      expect(timeline.every((entry) => !('summary' in entry))).toBe(true);
      expect(JSON.stringify(timeline)).not.toContain(insuranceNumber);

      const clientAudit = await owner.query<{ metadata: string }>(
        `SELECT metadata::text AS metadata FROM audit.audit_entries
         WHERE tenant_id = $1 AND resource_id = $2`,
        [tenantId, created.id],
      );
      const clientEvents = await owner.query<{ event: string }>(
        `SELECT event::text AS event FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event ->> 'aggregateId' = $2`,
        [tenantId, created.id],
      );
      expect(JSON.stringify(clientAudit.rows)).not.toContain(insuranceNumber);
      expect(JSON.stringify(clientEvents.rows)).not.toContain(insuranceNumber);

      const serviceCategoryResponse = await fetch(`${baseUrl}/api/v1/service-categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Basic care', code: `CAT-${uuidv7()}` }),
      });
      expect(serviceCategoryResponse.status).toBe(201);
      const serviceCategory = (await serviceCategoryResponse.json()) as { id: string };
      const serviceResponse = await fetch(`${baseUrl}/api/v1/services`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: `CARE-${uuidv7()}`,
          name: 'Morning care',
          description: 'Gentle morning support with comforting routine',
          categoryId: serviceCategory.id,
          unit: 'occurrence',
          defaultDurationMinutes: 30,
          validFrom: '2000-01-01',
        }),
      });
      expect(serviceResponse.status).toBe(201);
      const service = (await serviceResponse.json()) as { id: string; status: string };
      const serviceAvailabilityResponse = await fetch(
        `${baseUrl}/api/v1/services/${service.id}/availability`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            items: [
              { organizationId, facilityId },
              { organizationId, facilityId: secondFacilityId },
            ],
          }),
        },
      );
      expect(serviceAvailabilityResponse.status).toBe(200);
      const secondServiceResponse = await fetch(`${baseUrl}/api/v1/services`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: `CARE-${uuidv7()}`,
          name: 'Afternoon care',
          categoryId: serviceCategory.id,
          unit: 'occurrence',
          validFrom: '2000-01-01',
        }),
      });
      expect(secondServiceResponse.status).toBe(201);
      const secondService = (await secondServiceResponse.json()) as { id: string };
      const secondServiceAvailability = await fetch(
        `${baseUrl}/api/v1/services/${secondService.id}/availability`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ items: [{ organizationId, facilityId: secondFacilityId }] }),
        },
      );
      expect(secondServiceAvailability.status).toBe(200);
      const unavailableServiceResponse = await fetch(`${baseUrl}/api/v1/services`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: `CARE-${uuidv7()}`,
          name: 'Facility-only evening care',
          categoryId: serviceCategory.id,
          unit: 'occurrence',
          validFrom: '2000-01-01',
        }),
      });
      expect(unavailableServiceResponse.status).toBe(201);
      const unavailableService = (await unavailableServiceResponse.json()) as { id: string };
      const unavailableServiceAvailability = await fetch(
        `${baseUrl}/api/v1/services/${unavailableService.id}/availability`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ items: [{ organizationId, facilityId }] }),
        },
      );
      expect(unavailableServiceAvailability.status).toBe(200);
      const serviceSearch = await fetch(
        `${baseUrl}/api/v1/services?q=Morning&organizationId=${organizationId}&facilityId=${facilityId}`,
        { headers },
      );
      expect(await serviceSearch.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: service.id, name: 'Morning care' })],
      });
      const serviceDescriptionSearch = await fetch(
        `${baseUrl}/api/v1/services?q=comforting&organizationId=${organizationId}&facilityId=${facilityId}`,
        { headers },
      );
      expect(await serviceDescriptionSearch.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: service.id })],
      });
      const sortedServices = await fetch(
        `${baseUrl}/api/v1/services?status=all&sortBy=name&sortOrder=asc&organizationId=${organizationId}&facilityId=${facilityId}`,
        { headers },
      );
      const sortedServiceItems = (await sortedServices.json()) as {
        items: { name: string }[];
      };
      expect(sortedServiceItems.items.map((item) => item.name)).toEqual([
        'Facility-only evening care',
        'Morning care',
      ]);
      const archivedServiceCategory = await fetch(
        `${baseUrl}/api/v1/service-categories/${serviceCategory.id}/archive`,
        { method: 'POST', headers },
      );
      expect(archivedServiceCategory.status).toBe(200);
      const updateServiceInArchivedCategory = await fetch(
        `${baseUrl}/api/v1/services/${service.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ name: 'Morning care updated' }),
        },
      );
      expect(updateServiceInArchivedCategory.status).toBe(200);
      const serviceCaregiverHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(caregiverSubject)}`,
      };
      const caregiverPermissions = await fetch(`${baseUrl}/api/v1/me/permissions`, {
        headers: serviceCaregiverHeaders,
      });
      expect(caregiverPermissions.status).toBe(200);
      expect(await caregiverPermissions.json()).toEqual([
        expect.objectContaining({ permission: 'client.read' }),
        expect.objectContaining({ permission: 'service.read' }),
        expect.objectContaining({ permission: 'service_agreement.read' }),
        expect.objectContaining({ permission: 'schedule.read' }),
        expect.objectContaining({ permission: 'visit_execution.read' }),
        expect.objectContaining({ permission: 'visit_execution.start' }),
        expect.objectContaining({ permission: 'visit_execution.record_services' }),
        expect.objectContaining({ permission: 'visit_execution.complete' }),
        expect.objectContaining({ permission: 'care_documentation.read' }),
        expect.objectContaining({ permission: 'care_documentation.create' }),
        expect.objectContaining({ permission: 'care_documentation.update' }),
        expect.objectContaining({ permission: 'care_documentation.finalize' }),
        expect.objectContaining({ permission: 'service_evidence.read' }),
        expect.objectContaining({ permission: 'acknowledgement.read' }),
        expect.objectContaining({ permission: 'acknowledgement.capture' }),
      ]);
      expect(
        (await fetch(`${baseUrl}/api/v1/services`, { headers: serviceCaregiverHeaders })).status,
      ).toBe(200);
      const caregiverCannotCreateCategory = await fetch(`${baseUrl}/api/v1/service-categories`, {
        method: 'POST',
        headers: serviceCaregiverHeaders,
        body: JSON.stringify({ name: 'Not allowed' }),
      });
      expect(caregiverCannotCreateCategory.status).toBe(403);

      const crossTenantAvailability = await fetch(
        `${baseUrl}/api/v1/services/${service.id}/availability`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ items: [{ organizationId: otherOrganizationId }] }),
        },
      );
      expect(crossTenantAvailability.status).toBe(400);
      expect((await crossTenantAvailability.json()).code).toBe('INVALID_SERVICE_AVAILABILITY');

      const updated = await fetch(`${baseUrl}/api/v1/clients/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ preferredName: 'Ada' }),
      });
      expect(updated.status).toBe(200);

      const activated = await fetch(`${baseUrl}/api/v1/clients/${created.id}/activate`, {
        method: 'POST',
        headers,
      });
      expect(activated.status).toBe(200);
      expect(((await activated.json()) as { status: string }).status).toBe('active');

      const invalidAgreementValidity = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ validFrom: '2030-02-30', validUntil: '2030-03-01' }),
        },
      );
      expect(invalidAgreementValidity.status).toBe(400);
      expect((await invalidAgreementValidity.json()).code).toBe(
        'SERVICE_AGREEMENT_INVALID_VALIDITY',
      );

      const crossTenantAgreement = await fetch(
        `${baseUrl}/api/v1/clients/${crossTenantClientId}/service-agreements`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ validFrom: '2000-01-01' }),
        },
      );
      expect(crossTenantAgreement.status).toBe(404);

      const emptyAgreementResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ validFrom: '2000-01-01', reference: 'EMPTY-AGREEMENT' }),
        },
      );
      expect(emptyAgreementResponse.status).toBe(201);
      const emptyAgreement = (await emptyAgreementResponse.json()) as { id: string };
      const activateEmptyAgreement = await fetch(
        `${baseUrl}/api/v1/service-agreements/${emptyAgreement.id}/activate`,
        { method: 'POST', headers },
      );
      expect(activateEmptyAgreement.status).toBe(409);
      expect((await activateEmptyAgreement.json()).code).toBe('SERVICE_AGREEMENT_REQUIRES_SERVICE');
      expect(
        (
          await fetch(`${baseUrl}/api/v1/service-agreements/${emptyAgreement.id}/end`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(200);

      const agreementNote = `private-agreement-note-${uuidv7()}`;
      const agreementResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            validFrom: '2000-01-01',
            reference: `AGR-${uuidv7()}`,
            description: 'Operational planning details',
          }),
        },
      );
      expect(agreementResponse.status).toBe(201);
      const agreement = (await agreementResponse.json()) as {
        id: string;
        status: string;
        organizationId: string;
        facilityId: string;
      };
      expect(agreement.status).toBe('draft');
      expect(agreement).toMatchObject({ organizationId, facilityId: secondFacilityId });
      await expect(
        owner.query(
          `INSERT INTO service_agreements.agreements
             (id, tenant_id, client_id, organization_id, facility_id, status,
              valid_from, valid_until, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'draft', '2030-02-02', '2030-02-01', now(), now())`,
          [uuidv7(), tenantId, created.id, organizationId, secondFacilityId],
        ),
      ).rejects.toThrow();
      await expect(
        owner.query(
          `INSERT INTO service_agreements.agreement_services
             (id, tenant_id, agreement_id, service_definition_id, service_code, service_name,
              service_unit, status, valid_from, valid_until, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'BAD-DATE', 'Invalid period', 'occurrence', 'active',
                   '2030-02-02', '2030-02-01', now(), now())`,
          [uuidv7(), tenantId, agreement.id, service.id],
        ),
      ).rejects.toThrow();
      await expect(
        owner.query(
          `INSERT INTO service_agreements.agreement_services
             (id, tenant_id, agreement_id, service_definition_id, service_code, service_name,
              service_unit, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'BAD-REF', 'Missing service', 'occurrence', 'active',
                   now(), now())`,
          [uuidv7(), tenantId, agreement.id, uuidv7()],
        ),
      ).rejects.toThrow();
      await expect(
        owner.query(
          `INSERT INTO service_agreements.agreement_services
             (id, tenant_id, agreement_id, service_definition_id, service_code, service_name,
              service_unit, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'CROSS', 'Cross Tenant', 'occurrence', 'active', now(), now())`,
          [uuidv7(), otherTenantId, agreement.id, service.id],
        ),
      ).rejects.toThrow();
      await expect(
        owner.query(
          `INSERT INTO service_agreements.agreement_services
             (id, tenant_id, agreement_id, service_definition_id, service_code, service_name,
              service_unit, status, quantity, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'BAD', 'Invalid quantity', 'occurrence', 'active', 1.5, now(), now())`,
          [uuidv7(), tenantId, agreement.id, unavailableService.id],
        ),
      ).rejects.toThrow();
      const agreementServiceResponse = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            serviceDefinitionId: service.id,
            validFrom: '2000-01-01',
            quantity: '1',
            note: agreementNote,
            scheduleRule: { type: 'weekly', weekdays: ['monday', 'wednesday'] },
            preferredTimeStart: '08:00',
            preferredTimeEnd: '09:00',
          }),
        },
      );
      expect(agreementServiceResponse.status).toBe(201);
      const agreementService = (await agreementServiceResponse.json()) as {
        id: string;
        serviceName: string;
        scheduleRule: { type: string; weekdays?: string[] };
        quantity: string;
      };
      expect(agreementService).toMatchObject({
        serviceName: 'Morning care updated',
        quantity: '1',
        scheduleRule: { type: 'weekly', weekdays: ['monday', 'wednesday'] },
      });
      const secondAgreementServiceResponse = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            serviceDefinitionId: secondService.id,
            validFrom: '2000-01-01',
            quantity: '1',
            scheduleRule: { type: 'on_demand' },
          }),
        },
      );
      expect(secondAgreementServiceResponse.status).toBe(201);
      const secondAgreementService = (await secondAgreementServiceResponse.json()) as {
        id: string;
      };
      const unavailableServiceAssignment = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ serviceDefinitionId: unavailableService.id }),
        },
      );
      expect(unavailableServiceAssignment.status).toBe(409);
      expect((await unavailableServiceAssignment.json()).code).toBe(
        'SERVICE_NOT_AVAILABLE_FOR_PROVIDER',
      );
      const duplicateAgreementService = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ serviceDefinitionId: service.id }),
        },
      );
      expect(duplicateAgreementService.status).toBe(409);
      expect((await duplicateAgreementService.json()).code).toBe('AGREEMENT_SERVICE_DUPLICATE');

      const invalidAgreementSchedule = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services/${agreementService.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ scheduleRule: { type: 'weekly', weekdays: [] } }),
        },
      );
      expect(invalidAgreementSchedule.status).toBe(400);
      expect((await invalidAgreementSchedule.json()).code).toBe('INVALID_SCHEDULE_RULE');
      const invalidAgreementQuantity = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services/${agreementService.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ quantity: '1.5' }),
        },
      );
      expect(invalidAgreementQuantity.status).toBe(400);
      expect((await invalidAgreementQuantity.json()).code).toBe(
        'AGREEMENT_SERVICE_INVALID_QUANTITY',
      );

      const updateAgreementService = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services/${agreementService.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ preferredTimeStart: '08:30', preferredTimeEnd: '09:30' }),
        },
      );
      expect(updateAgreementService.status).toBe(200);
      const activateAgreement = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/activate`,
        { method: 'POST', headers },
      );
      expect(activateAgreement.status).toBe(200);

      const suspendBeforeScheduling = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/suspend`,
        { method: 'POST', headers },
      );
      expect(suspendBeforeScheduling.status).toBe(200);
      const suspendedGeneration = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/generate-visits`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ from: dateInBerlin(2), until: dateInBerlin(8) }),
        },
      );
      expect(suspendedGeneration.status).toBe(409);
      expect((await suspendedGeneration.json()).code).toBe('VISIT_AGREEMENT_INVALID');
      const resumeBeforeScheduling = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/resume`,
        { method: 'POST', headers },
      );
      expect(resumeBeforeScheduling.status).toBe(200);

      const createSchedulingEmployee = async (firstName: string, lastName: string) => {
        const response = await fetch(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            organizationId,
            firstName,
            lastName,
            startDate: '2000-01-01',
            employmentType: 'employee',
          }),
        });
        expect(response.status).toBe(201);
        const employee = (await response.json()) as { id: string };
        const assignment = await fetch(
          `${baseUrl}/api/v1/employees/${employee.id}/facilities/${secondFacilityId}`,
          { method: 'PUT', headers, body: JSON.stringify({ isPrimary: true }) },
        );
        expect(assignment.status).toBe(200);
        return employee;
      };
      const schedulingEmployee = await createSchedulingEmployee('Schedule', 'Assigned');
      const unavailableEmployee = await createSchedulingEmployee('Schedule', 'Unavailable');
      const employeePreferencesResponse = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/scheduling-preferences`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            preferredWeekdays: [],
            preferredTimeWindows: [{ startsAt: '08:00', endsAt: '12:00' }],
            preferredStartLatitude: 52.5,
            preferredStartLongitude: 13.4,
            travelMode: 'driving',
          }),
        },
      );
      expect(employeePreferencesResponse.status).toBe(200);
      expect(await employeePreferencesResponse.json()).toMatchObject({
        preferredTimeWindows: [{ startsAt: '08:00', endsAt: '12:00' }],
        preferredStartLatitude: 52.5,
        preferredStartLongitude: 13.4,
        travelMode: 'driving',
      });
      const savedEmployeePreferences = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/scheduling-preferences`,
        { headers },
      );
      expect(savedEmployeePreferences.status).toBe(200);
      expect(await savedEmployeePreferences.json()).toMatchObject({
        preferredStartLatitude: 52.5,
        preferredStartLongitude: 13.4,
      });
      const clientPreferencesResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/scheduling-preferences`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            preferredWeekdays: [1, 3],
            preferredTimeWindows: [{ startsAt: '09:00', endsAt: '13:00' }],
            preferredEmployeeId: schedulingEmployee.id,
            avoidedEmployeeIds: [unavailableEmployee.id],
          }),
        },
      );
      expect(clientPreferencesResponse.status).toBe(200);
      expect(await clientPreferencesResponse.json()).toMatchObject({
        preferredWeekdays: [1, 3],
        preferredEmployeeId: schedulingEmployee.id,
        avoidedEmployeeIds: [unavailableEmployee.id],
      });
      const savedClientPreferences = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/scheduling-preferences`,
        { headers },
      );
      expect(savedClientPreferences.status).toBe(200);
      expect(await savedClientPreferences.json()).toMatchObject({
        preferredWeekdays: [1, 3],
        preferredEmployeeId: schedulingEmployee.id,
        avoidedEmployeeIds: [unavailableEmployee.id],
      });
      const routingLocationResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/routing-location`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ latitude: 52.51, longitude: 13.41 }),
        },
      );
      expect(routingLocationResponse.status).toBe(200);
      expect(await routingLocationResponse.json()).toMatchObject({
        latitude: 52.51,
        longitude: 13.41,
      });
      const savedRoutingLocation = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/routing-location`,
        { headers },
      );
      expect(savedRoutingLocation.status).toBe(200);
      expect(await savedRoutingLocation.json()).toMatchObject({
        latitude: 52.51,
        longitude: 13.41,
      });
      const generationFrom = dateInBerlin(2);
      const generationUntil = addCalendarDays(generationFrom, 6);
      const generate = () =>
        fetch(`${baseUrl}/api/v1/service-agreements/${agreement.id}/generate-visits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ from: generationFrom, until: generationUntil }),
        });
      const concurrentGenerations = await Promise.all([generate(), generate()]);
      expect(concurrentGenerations.map((response) => response.status)).toEqual([200, 200]);
      const generationResults = (await Promise.all(
        concurrentGenerations.map((response) => response.json()),
      )) as Array<{
        generationId: string;
        generated: number;
        alreadyExisting: number;
        requiresManualPlacement: number;
      }>;
      const generatedCount = generationResults.reduce(
        (total, result) => total + result.generated,
        0,
      );
      expect(generatedCount).toBeGreaterThan(0);
      expect(generationResults.reduce((total, result) => total + result.alreadyExisting, 0)).toBe(
        generatedCount,
      );
      expect(generationResults.every((result) => result.requiresManualPlacement === 0)).toBe(true);

      const generationRetryResponse = await generate();
      expect(generationRetryResponse.status).toBe(200);
      expect(await generationRetryResponse.json()).toMatchObject({
        generated: 0,
        alreadyExisting: generatedCount,
        requiresManualPlacement: 0,
      });

      const visitRange = new URLSearchParams({
        from: new Date(`${generationFrom}T00:00:00.000Z`).toISOString(),
        until: new Date(`${addCalendarDays(generationUntil, 1)}T00:00:00.000Z`).toISOString(),
        origin: 'agreement_generated',
        unassigned: 'true',
        pageSize: '100',
      });
      const generatedVisitsResponse = await fetch(`${baseUrl}/api/v1/visits?${visitRange}`, {
        headers,
      });
      if (generatedVisitsResponse.status !== 200) {
        throw new Error(
          `Visit calendar returned ${generatedVisitsResponse.status}: ${JSON.stringify(await generatedVisitsResponse.json())}`,
        );
      }
      expect(generatedVisitsResponse.status).toBe(200);
      const generatedVisitPage = (await generatedVisitsResponse.json()) as {
        total: number;
        items: Array<{
          id: string;
          clientId: string;
          plannedStart: string;
          plannedEnd: string;
          timezone: string;
          origin: string;
          manuallyAdjusted: boolean;
          services: Array<{ agreementServiceId: string | null; serviceName: string }>;
          assignments: Array<{ employeeId: string }>;
        }>;
      };
      expect(generatedVisitPage.total).toBe(generatedCount);
      expect(generatedVisitPage.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            origin: 'agreement_generated',
            clientId: created.id,
            assignments: [],
            services: [expect.objectContaining({ serviceName: 'Morning care updated' })],
          }),
        ]),
      );
      const teamCalendarRange = new URLSearchParams(visitRange);
      teamCalendarRange.set('teamId', UUID_V4_COMPATIBILITY_ID); // Unknown v4 IDs remain valid request values.
      const teamCalendarResponse = await fetch(`${baseUrl}/api/v1/visits?${teamCalendarRange}`, {
        headers,
      });
      expect(teamCalendarResponse.status).toBe(200);
      expect(await teamCalendarResponse.json()).toMatchObject({ total: 0, items: [] });
      const firstGeneratedVisit = generatedVisitPage.items[0];
      if (!firstGeneratedVisit) throw new Error('Generation returned no concrete visits');
      const inaccessibleEmployeeId = uuidv7();
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, first_name, last_name)
         VALUES ($1, $2, 'Out of scope', 'Employee')`,
        [inaccessibleEmployeeId, otherTenantId],
      );
      const inaccessibleEmployeeAssignment = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: inaccessibleEmployeeId }),
        },
      );
      expect(inaccessibleEmployeeAssignment.status).toBe(404);
      expect((await inaccessibleEmployeeAssignment.json()).code).toBe('EMPLOYEE_NOT_FOUND');
      const assignmentsAfterDeniedEmployee = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        { headers },
      );
      expect(assignmentsAfterDeniedEmployee.status).toBe(200);
      expect(await assignmentsAfterDeniedEmployee.json()).toEqual([]);
      const firstVisitLocalTime = localDateTime(
        firstGeneratedVisit.plannedStart,
        firstGeneratedVisit.plannedEnd,
        firstGeneratedVisit.timezone,
      );

      const blockedTimeResponse = await fetch(
        `${baseUrl}/api/v1/employees/${unavailableEmployee.id}/unavailability`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            startsAt: firstGeneratedVisit.plannedStart,
            endsAt: firstGeneratedVisit.plannedEnd,
            note: 'temporary test block',
          }),
        },
      );
      expect(blockedTimeResponse.status).toBe(201);
      const unavailableAssignment = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: unavailableEmployee.id }),
        },
      );
      expect(unavailableAssignment.status).toBe(409);
      expect((await unavailableAssignment.json()).code).toBe('VISIT_EMPLOYEE_NOT_AVAILABLE');

      const employeeAvailabilityPath = `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/availability`;
      const emptyAvailability = await fetch(employeeAvailabilityPath, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          expectedVersion: 0,
          timezone: 'Europe/Berlin',
          maxDailyMinutes: 420,
          travelBufferMinutes: 15,
          windows: [],
        }),
      });
      expect(emptyAvailability.status).toBe(200);
      expect(await emptyAvailability.json()).toMatchObject({
        employeeId: schedulingEmployee.id,
        version: 1,
      });
      const outsideAvailability = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: schedulingEmployee.id }),
        },
      );
      expect(outsideAvailability.status).toBe(409);
      expect((await outsideAvailability.json()).code).toBe('VISIT_OUTSIDE_EMPLOYEE_AVAILABILITY');
      const weekdayValue = new Date(`${firstVisitLocalTime.date}T00:00:00.000Z`).getUTCDay();
      const availabilityWindow = await fetch(employeeAvailabilityPath, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          expectedVersion: 1,
          timezone: 'Europe/Berlin',
          maxDailyMinutes: 420,
          travelBufferMinutes: 15,
          windows: [
            {
              weekday: weekdayValue === 0 ? 7 : weekdayValue,
              startsAt: '00:00',
              endsAt: '23:59',
            },
          ],
        }),
      });
      expect(availabilityWindow.status).toBe(200);
      expect((await availabilityWindow.json()).version).toBe(2);
      const staleAvailability = await fetch(employeeAvailabilityPath, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          expectedVersion: 1,
          timezone: 'Europe/Berlin',
          maxDailyMinutes: 420,
          travelBufferMinutes: 15,
          windows: [],
        }),
      });
      expect(staleAvailability.status).toBe(409);
      expect((await staleAvailability.json()).code).toBe('SCHEDULING_VERSION_CONFLICT');

      const assignedResponse = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: schedulingEmployee.id }),
        },
      );
      expect(assignedResponse.status).toBe(201);
      const assignment = (await assignedResponse.json()) as { id: string; status: string };
      expect(assignment.status).toBe('active');

      const absenceResponse = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/unavailability`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            localStartDate: firstVisitLocalTime.date,
            localStartTime: firstVisitLocalTime.start,
            localEndDate: firstVisitLocalTime.date,
            localEndTime: firstVisitLocalTime.end,
            timezone: firstGeneratedVisit.timezone,
            reason: 'vacation',
            note: 'protected scheduling note',
          }),
        },
      );
      expect(absenceResponse.status).toBe(201);
      const absence = (await absenceResponse.json()) as { id: string; status: string };
      expect(absence.status).toBe('active');
      const absenceRange = new URLSearchParams({
        from: new Date(new Date(firstGeneratedVisit.plannedStart).getTime() - 60_000).toISOString(),
        until: new Date(new Date(firstGeneratedVisit.plannedEnd).getTime() + 60_000).toISOString(),
      });
      const absenceListResponse = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/unavailability?${absenceRange}`,
        { headers },
      );
      expect(absenceListResponse.status).toBe(200);
      const absenceList = (await absenceListResponse.json()) as {
        absences: Array<{ id: string; note?: string; reason: string }>;
        impactedVisitCount: number;
        impactedVisits: Array<{ id: string }>;
      };
      expect(absenceList.absences).toContainEqual(
        expect.objectContaining({ id: absence.id, reason: 'vacation' }),
      );
      expect(absenceList.absences[0]?.note).toBeUndefined();
      expect(absenceList.impactedVisitCount).toBe(1);
      expect(absenceList.impactedVisits[0]?.id).toBe(firstGeneratedVisit.id);
      const schedulingWorklistRange = new URLSearchParams({
        from: new Date(new Date(firstGeneratedVisit.plannedStart).getTime() - 60_000).toISOString(),
        until: new Date(new Date(firstGeneratedVisit.plannedEnd).getTime() + 60_000).toISOString(),
        page: '1',
        pageSize: '100',
      });
      const schedulingWorklistResponse = await fetch(
        `${baseUrl}/api/v1/scheduling/worklist?${schedulingWorklistRange}`,
        { headers },
      );
      expect(schedulingWorklistResponse.status).toBe(200);
      expect(await schedulingWorklistResponse.json()).toMatchObject({
        items: [
          expect.objectContaining({
            visit: expect.objectContaining({ id: firstGeneratedVisit.id }),
            conflicts: expect.arrayContaining([
              expect.objectContaining({ code: 'employee_absence', severity: 'blocking' }),
            ]),
          }),
        ],
      });
      const cancelAbsence = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/unavailability/${absence.id}`,
        { method: 'DELETE', headers },
      );
      expect(cancelAbsence.status).toBe(204);

      const duplicateAssignment = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: schedulingEmployee.id }),
        },
      );
      expect(duplicateAssignment.status).toBe(409);
      expect((await duplicateAssignment.json()).code).toBe('VISIT_ASSIGNMENT_DUPLICATE');

      const clientConflict = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: created.id,
          localDate: firstVisitLocalTime.date,
          localStartTime: firstVisitLocalTime.start,
          localEndTime: firstVisitLocalTime.end,
          services: [{ serviceDefinitionId: service.id }],
        }),
      });
      expect(clientConflict.status).toBe(409);
      expect((await clientConflict.json()).code).toBe('VISIT_CLIENT_CONFLICT');

      const collisionClientResponse = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Schedule',
          lastName: `Conflict-${uuidv7()}`,
          organizationId,
          primaryFacilityId: secondFacilityId,
        }),
      });
      expect(collisionClientResponse.status).toBe(201);
      const collisionClient = (await collisionClientResponse.json()) as { id: string };
      const activateCollisionClient = await fetch(
        `${baseUrl}/api/v1/clients/${collisionClient.id}/activate`,
        { method: 'POST', headers },
      );
      expect(activateCollisionClient.status).toBe(200);

      const soonStart = addMinutesToLocalTime(firstVisitLocalTime.end, 5);
      const soonEnd = addMinutesToLocalTime(soonStart, 30);
      const travelBufferConflict = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: collisionClient.id,
          localDate: firstVisitLocalTime.date,
          localStartTime: soonStart,
          localEndTime: soonEnd,
          employeeIds: [schedulingEmployee.id],
          services: [{ serviceDefinitionId: service.id }],
        }),
      });
      expect(travelBufferConflict.status).toBe(409);
      expect((await travelBufferConflict.json()).code).toBe('VISIT_TRAVEL_BUFFER_CONFLICT');

      const assignedDurationMinutes = Math.ceil(
        (new Date(firstGeneratedVisit.plannedEnd).getTime() -
          new Date(firstGeneratedVisit.plannedStart).getTime()) /
          60_000,
      );
      const tighterAvailability = await fetch(employeeAvailabilityPath, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          expectedVersion: 2,
          timezone: 'Europe/Berlin',
          maxDailyMinutes: assignedDurationMinutes,
          travelBufferMinutes: 15,
          windows: [
            {
              weekday: weekdayValue === 0 ? 7 : weekdayValue,
              startsAt: '00:00',
              endsAt: '23:59',
            },
          ],
        }),
      });
      expect(tighterAvailability.status).toBe(200);
      const dailyLimitStart = addMinutesToLocalTime(firstVisitLocalTime.end, 15);
      const dailyLimitEnd = addMinutesToLocalTime(dailyLimitStart, 30);
      const dailyLimitConflict = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: collisionClient.id,
          localDate: firstVisitLocalTime.date,
          localStartTime: dailyLimitStart,
          localEndTime: dailyLimitEnd,
          employeeIds: [schedulingEmployee.id],
          services: [{ serviceDefinitionId: service.id }],
        }),
      });
      expect(dailyLimitConflict.status).toBe(409);
      expect((await dailyLimitConflict.json()).code).toBe('VISIT_DAILY_PLAN_LIMIT');

      const employeeConflict = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: collisionClient.id,
          localDate: firstVisitLocalTime.date,
          localStartTime: firstVisitLocalTime.start,
          localEndTime: firstVisitLocalTime.end,
          employeeIds: [schedulingEmployee.id],
          services: [{ serviceDefinitionId: service.id }],
        }),
      });
      expect(employeeConflict.status).toBe(409);
      expect(await employeeConflict.json()).toMatchObject({
        code: 'VISIT_EMPLOYEE_CONFLICT',
        conflictingInterval: {
          plannedStart: expect.any(String),
          plannedEnd: expect.any(String),
          timezone: 'Europe/Berlin',
        },
      });

      const manualMarker = `schedule-note-${uuidv7()}`;
      const manualVisitResponse = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: created.id,
          localDate: addCalendarDays(generationUntil, 2),
          localStartTime: '11:00',
          localEndTime: '11:30',
          note: manualMarker,
          services: [{ serviceDefinitionId: service.id, plannedQuantity: '1' }],
        }),
      });
      expect(manualVisitResponse.status).toBe(201);
      const manualVisit = (await manualVisitResponse.json()) as {
        id: string;
        origin: string;
        serviceAgreementId: string | null;
        services: Array<{ serviceCode: string; serviceName: string; unit: string }>;
      };
      expect(manualVisit).toMatchObject({
        origin: 'manual',
        serviceAgreementId: null,
        services: [
          expect.objectContaining({ serviceName: 'Morning care updated', unit: 'occurrence' }),
        ],
      });

      const invalidDstVisit = await fetch(`${baseUrl}/api/v1/visits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientId: created.id,
          localDate: '2026-03-29',
          localStartTime: '02:15',
          localEndTime: '03:00',
          services: [{ serviceDefinitionId: service.id }],
        }),
      });
      expect(invalidDstVisit.status).toBe(400);
      expect((await invalidDstVisit.json()).code).toBe('VISIT_INVALID_TIME');

      const rescheduledVisit = await fetch(`${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          localDate: firstVisitLocalTime.date,
          localStartTime: '09:00',
          localEndTime: '09:30',
        }),
      });
      if (rescheduledVisit.status !== 200) {
        throw new Error(
          `Visit reschedule returned ${rescheduledVisit.status}: ${JSON.stringify(await rescheduledVisit.json())}`,
        );
      }
      expect(rescheduledVisit.status).toBe(200);
      expect(await rescheduledVisit.json()).toMatchObject({ manuallyAdjusted: true });
      const generationAfterAdjustment = await generate();
      expect(generationAfterAdjustment.status).toBe(200);
      expect(await generationAfterAdjustment.json()).toMatchObject({
        generated: 0,
        alreadyExisting: generatedCount,
      });
      const adjustedVisitResponse = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}`,
        { headers },
      );
      expect(adjustedVisitResponse.status).toBe(200);
      expect(await adjustedVisitResponse.json()).toMatchObject({ manuallyAdjusted: true });

      const endAgreementWithFutureVisits = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/end`,
        { method: 'POST', headers },
      );
      expect(endAgreementWithFutureVisits.status).toBe(409);
      expect((await endAgreementWithFutureVisits.json()).code).toBe('FUTURE_VISITS_EXIST');
      const deactivateAssignedEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/deactivate`,
        { method: 'POST', headers },
      );
      expect(deactivateAssignedEmployee.status).toBe(409);
      expect((await deactivateAssignedEmployee.json()).code).toBe('FUTURE_VISITS_EXIST');

      const unassignResponse = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments/${assignment.id}`,
        { method: 'DELETE', headers },
      );
      expect(unassignResponse.status).toBe(204);
      const assignmentHistoryResponse = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        { headers },
      );
      expect(assignmentHistoryResponse.status).toBe(200);
      expect(await assignmentHistoryResponse.json()).toMatchObject([
        expect.objectContaining({ id: assignment.id, status: 'unassigned' }),
      ]);

      const substitutionEmployee = await createSchedulingEmployee('Schedule', 'Substitute');
      const alternateSubstituteEmployee = await createSchedulingEmployee('Schedule', 'Alternate');
      const reassignedForProposal = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: schedulingEmployee.id }),
        },
      );
      expect(reassignedForProposal.status).toBe(201);
      const proposalAssignment = (await reassignedForProposal.json()) as { id: string };
      const beforeSubstitution = await fetch(`${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}`, {
        headers,
      });
      expect(beforeSubstitution.status).toBe(200);
      const beforeSubstitutionVisit = (await beforeSubstitution.json()) as {
        id: string;
        services: Array<{ id: string }>;
        assignments: Array<{ employeeId: string }>;
      };
      const candidatesResponse = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/substitute-candidates`,
        { headers },
      );
      expect(candidatesResponse.status).toBe(200);
      expect(await candidatesResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ employeeId: substitutionEmployee.id }),
          expect.objectContaining({ employeeId: alternateSubstituteEmployee.id }),
        ]),
      );
      const propose = (substituteEmployeeId: string) =>
        fetch(`${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/substitutions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            originalAssignmentId: proposalAssignment.id,
            substituteEmployeeId,
            reason: 'planned absence coverage',
          }),
        });
      const competingProposals = await Promise.all([
        propose(substitutionEmployee.id),
        propose(alternateSubstituteEmployee.id),
      ]);
      expect(competingProposals.map((response) => response.status).sort()).toEqual([201, 409]);
      const successfulProposalIndex = competingProposals.findIndex(
        (response) => response.status === 201,
      );
      const winningSubstitute =
        successfulProposalIndex === 0 ? substitutionEmployee : alternateSubstituteEmployee;
      const substitution = (await competingProposals[successfulProposalIndex]!.json()) as {
        id: string;
        status: string;
      };
      expect(substitution.status).toBe('proposed');
      const assignmentDuringProposal = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/assignments`,
        { headers },
      );
      expect(await assignmentDuringProposal.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ employeeId: schedulingEmployee.id, status: 'active' }),
        ]),
      );
      const confirmSubstitution = await fetch(
        `${baseUrl}/api/v1/substitutions/${substitution.id}/confirm`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(confirmSubstitution.status).toBe(200);
      expect(await confirmSubstitution.json()).toMatchObject({ status: 'confirmed' });
      const afterSubstitution = await fetch(`${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}`, {
        headers,
      });
      expect(afterSubstitution.status).toBe(200);
      const afterSubstitutionVisit = (await afterSubstitution.json()) as {
        id: string;
        services: Array<{ id: string }>;
        assignments: Array<{ employeeId: string }>;
      };
      expect(afterSubstitutionVisit.id).toBe(beforeSubstitutionVisit.id);
      expect(afterSubstitutionVisit.services.map((serviceLine) => serviceLine.id)).toEqual(
        beforeSubstitutionVisit.services.map((serviceLine) => serviceLine.id),
      );
      expect(afterSubstitutionVisit.assignments).toEqual(
        expect.arrayContaining([expect.objectContaining({ employeeId: winningSubstitute.id })]),
      );

      const createTour = await fetch(`${baseUrl}/api/v1/scheduling/tours`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          employeeId: winningSubstitute.id,
          localDate: firstVisitLocalTime.date,
          timezone: firstGeneratedVisit.timezone,
          visitIds: [firstGeneratedVisit.id],
        }),
      });
      expect(createTour.status).toBe(201);
      const tour = (await createTour.json()) as { id: string; version: number; status: string };
      const deniedTourWrite = await fetch(`${baseUrl}/api/v1/scheduling/tours/${tour.id}/stops`, {
        method: 'PUT',
        headers: { ...headers, Authorization: `Bearer ${await issueToken(caregiverSubject)}` },
        body: JSON.stringify({
          expectedVersion: tour.version,
          stops: [{ visitId: firstGeneratedVisit.id }],
        }),
      });
      expect(deniedTourWrite.status).toBe(403);
      const foreignTenantTour = await fetch(`${baseUrl}/api/v1/scheduling/tours/${tour.id}`, {
        headers: { ...headers, 'X-Tenant-Id': otherTenantId },
      });
      expect([403, 404]).toContain(foreignTenantTour.status);
      const duplicateTourStops = await fetch(
        `${baseUrl}/api/v1/scheduling/tours/${tour.id}/stops`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedVersion: tour.version,
            stops: [{ visitId: firstGeneratedVisit.id }, { visitId: firstGeneratedVisit.id }],
          }),
        },
      );
      expect(duplicateTourStops.status).toBe(400);
      const estimateTour = await fetch(
        `${baseUrl}/api/v1/scheduling/tours/${tour.id}/estimate-travel`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: tour.version }),
        },
      );
      expect(estimateTour.status).toBe(200);
      const estimatedTour = (await estimateTour.json()) as {
        tour: { version: number; stops: Array<{ routeStatus: string }> };
        route: { status: string };
      };
      expect(['unavailable', 'unresolved']).toContain(estimatedTour.route.status);
      // Inject an outbox failure only in this disposable database. Domain, history and audit must roll back together.
      const beforeFailedPublication = await owner.query(
        `SELECT (SELECT version FROM scheduling.tours WHERE id = $1) AS version,
                (SELECT count(*)::int FROM audit.audit_entries WHERE resource_id = $1) AS audits,
                (SELECT count(*)::int FROM scheduling.tour_publications WHERE tour_id = $1) AS publications`,
        [tour.id],
      );
      await owner.query(`CREATE FUNCTION platform.reject_test_tour_publication() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event_type = 'scheduling.tour_published' THEN RAISE EXCEPTION 'test publication failure'; END IF; RETURN NEW; END $$`);
      await owner.query(`CREATE TRIGGER reject_test_tour_publication BEFORE INSERT ON platform.outbox_messages
        FOR EACH ROW EXECUTE FUNCTION platform.reject_test_tour_publication()`);
      try {
        const failedPublication = await fetch(
          `${baseUrl}/api/v1/scheduling/tours/${tour.id}/publish`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ expectedVersion: estimatedTour.tour.version }),
          },
        );
        expect(failedPublication.status).toBe(500);
        expect(
          (
            await owner.query(
              `SELECT (SELECT version FROM scheduling.tours WHERE id = $1) AS version,
                  (SELECT count(*)::int FROM audit.audit_entries WHERE resource_id = $1) AS audits,
                  (SELECT count(*)::int FROM scheduling.tour_publications WHERE tour_id = $1) AS publications`,
              [tour.id],
            )
          ).rows,
        ).toEqual(beforeFailedPublication.rows);
        expect(
          (
            await owner.query(
              `SELECT id FROM platform.outbox_messages WHERE event_type = 'scheduling.tour_published' AND event->>'aggregateId' = $1`,
              [tour.id],
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        await owner.query('DROP TRIGGER reject_test_tour_publication ON platform.outbox_messages');
        await owner.query('DROP FUNCTION platform.reject_test_tour_publication()');
      }
      const firstPublication = await fetch(
        `${baseUrl}/api/v1/scheduling/tours/${tour.id}/publish`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: estimatedTour.tour.version }),
        },
      );
      expect(firstPublication.status).toBe(200);
      const publishedTour = (await firstPublication.json()) as {
        tour: { version: number; latestPublication: { version: number } };
      };
      expect(publishedTour.tour.latestPublication.version).toBe(1);
      const immutableFirstSnapshot = await owner.query(
        `SELECT snapshot, change_summary FROM scheduling.tour_publications WHERE tour_id = $1 AND version = 1`,
        [tour.id],
      );
      const staleTourPublication = await fetch(
        `${baseUrl}/api/v1/scheduling/tours/${tour.id}/publish`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: estimatedTour.tour.version }),
        },
      );
      expect(staleTourPublication.status).toBe(409);
      const revisePublishedTour = await fetch(
        `${baseUrl}/api/v1/scheduling/tours/${tour.id}/stops`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedVersion: publishedTour.tour.version,
            stops: [{ visitId: firstGeneratedVisit.id }],
          }),
        },
      );
      expect(revisePublishedTour.status).toBe(200);
      const revisedTour = (await revisePublishedTour.json()) as { version: number };
      const secondPublication = await fetch(
        `${baseUrl}/api/v1/scheduling/tours/${tour.id}/publish`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedVersion: revisedTour.version }),
        },
      );
      expect(secondPublication.status).toBe(200);
      expect(
        await owner.query(
          `SELECT version FROM scheduling.tour_publications WHERE tenant_id = $1 AND tour_id = $2 ORDER BY version`,
          [tenantId, tour.id],
        ),
      ).toMatchObject({ rows: [{ version: 1 }, { version: 2 }] });

      expect(
        (
          await owner.query(
            `SELECT snapshot, change_summary FROM scheduling.tour_publications WHERE tour_id = $1 AND version = 1`,
            [tour.id],
          )
        ).rows,
      ).toEqual(immutableFirstSnapshot.rows);
      const tourAuditOutbox = await owner.query(
        `SELECT audit.action, outbox.event_type FROM audit.audit_entries AS audit
         JOIN platform.outbox_messages AS outbox ON outbox.id = audit.id AND outbox.tenant_id = audit.tenant_id
         WHERE audit.tenant_id = $1 AND audit.resource_id = $2 ORDER BY audit.timestamp`,
        [tenantId, tour.id],
      );
      expect(tourAuditOutbox.rows.map((row) => row.action)).toEqual([
        'scheduling.tour_created',
        'scheduling.tour_published',
        'scheduling.tour_reordered',
        'scheduling.tour_published',
      ]);
      expect(tourAuditOutbox.rows.every((row) => row.action === row.event_type)).toBe(true);
      const confirmedVisit = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/confirm`,
        { method: 'POST', headers },
      );
      expect(confirmedVisit.status).toBe(200);
      expect(((await confirmedVisit.json()) as { status: string }).status).toBe('confirmed');
      const unconfirmedVisit = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/unconfirm`,
        { method: 'POST', headers },
      );
      expect(unconfirmedVisit.status).toBe(200);
      const cancelledVisit = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/cancel`,
        { method: 'POST', headers },
      );
      expect(cancelledVisit.status).toBe(200);
      const invalidatedTour = await fetch(`${baseUrl}/api/v1/scheduling/tours/${tour.id}`, {
        headers,
      });
      expect(invalidatedTour.status).toBe(200);
      expect(await invalidatedTour.json()).toMatchObject({
        status: 'draft',
        stops: [],
        latestPublication: { version: 2 },
      });
      expect(
        (
          await owner.query(
            `SELECT snapshot, change_summary FROM scheduling.tour_publications WHERE tour_id = $1 AND version = 1`,
            [tour.id],
          )
        ).rows,
      ).toEqual(immutableFirstSnapshot.rows);
      for (const visit of generatedVisitPage.items.slice(1)) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        const response = await fetch(`${baseUrl}/api/v1/visits/${visit.id}/cancel`, {
          method: 'POST',
          headers,
        });
        expect(response.status).toBe(200);
      }
      const cancelManualVisit = await fetch(`${baseUrl}/api/v1/visits/${manualVisit.id}/cancel`, {
        method: 'POST',
        headers,
      });
      expect(cancelManualVisit.status).toBe(200);

      const caregiverScheduleHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(caregiverSubject)}`,
      };
      const caregiverScheduleRead = await fetch(`${baseUrl}/api/v1/visits?${visitRange}`, {
        headers: caregiverScheduleHeaders,
      });
      expect(caregiverScheduleRead.status).toBe(200);
      const caregiverCannotConfirmVisit = await fetch(
        `${baseUrl}/api/v1/visits/${firstGeneratedVisit.id}/confirm`,
        { method: 'POST', headers: caregiverScheduleHeaders },
      );
      expect(caregiverCannotConfirmVisit.status).toBe(403);

      const scheduleTimelineResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/timeline`,
        { headers },
      );
      expect(scheduleTimelineResponse.status).toBe(200);
      const scheduleTimeline = (await scheduleTimelineResponse.json()) as Array<{
        action: string;
        actorId: string;
      }>;
      expect(scheduleTimeline.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'visit.generated',
          'visit.rescheduled',
          'visit.confirmed',
          'visit.unconfirmed',
          'visit.cancelled',
        ]),
      );
      expect(scheduleTimeline.every((entry) => entry.actorId && entry.action)).toBe(true);
      expect(JSON.stringify(scheduleTimeline)).not.toContain(manualMarker);

      const visitIds = generatedVisitPage.items.map((visit) => visit.id).concat(manualVisit.id);
      const visitAudit = await owner.query<{ action: string; metadata: string }>(
        `SELECT action, metadata::text AS metadata FROM audit.audit_entries
         WHERE tenant_id = $1 AND resource_type = 'visit' AND resource_id = ANY($2::uuid[])
         ORDER BY timestamp, id`,
        [tenantId, visitIds],
      );
      expect(visitAudit.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'visit.generated',
          'visit.created',
          'visit.rescheduled',
          'visit.confirmed',
          'visit.unconfirmed',
          'visit.cancelled',
          'visit.employee_assigned',
          'visit.employee_unassigned',
        ]),
      );
      const visitEvents = await owner.query<{ event: string }>(
        `SELECT event::text AS event FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])
            OR tenant_id = $1 AND event -> 'payload' ->> 'agreementId' = $3`,
        [tenantId, visitIds, agreement.id],
      );
      expect(JSON.stringify(visitAudit.rows)).not.toContain(manualMarker);
      expect(JSON.stringify(visitEvents.rows)).not.toContain(manualMarker);
      const parsedVisitEvents = visitEvents.rows.map(
        ({ event }) =>
          JSON.parse(event) as {
            type: string;
            version: number;
          },
      );
      expect(parsedVisitEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'visit.generated',
          'visit.created',
          'visit.rescheduled',
          'visit.assignment_changed',
          'visit.confirmed',
          'visit.unconfirmed',
          'visit.cancelled',
          'schedule.generation_completed',
        ]),
      );
      expect(parsedVisitEvents.every((event) => event.version === 1)).toBe(true);

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      expect(
        (
          await appRole.query('SELECT id FROM scheduling.visits WHERE id = $1', [
            firstGeneratedVisit.id,
          ])
        ).rowCount,
      ).toBe(0);
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      expect(
        (
          await appRole.query('SELECT id FROM scheduling.visits WHERE id = $1', [
            firstGeneratedVisit.id,
          ])
        ).rowCount,
      ).toBe(1);
      await appRole.query('COMMIT');

      await expect(
        owner.query(
          `INSERT INTO scheduling.visits
             (id, tenant_id, client_id, organization_id, facility_id, origin,
              service_agreement_id, status, planned_start, planned_end, timezone, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'manual', NULL, 'planned', $6, $7, 'Europe/Berlin', now(), now())`,
          [
            uuidv7(),
            tenantId,
            crossTenantClientId,
            organizationId,
            secondFacilityId,
            new Date(),
            new Date(Date.now() + 60_000),
          ],
        ),
      ).rejects.toThrow();
      await expect(
        owner.query(
          `INSERT INTO scheduling.visit_assignments
             (id, tenant_id, visit_id, employee_id, status, assigned_at, assigned_by)
           VALUES ($1, $2, $3, $4, 'active', now(), $5)`,
          [uuidv7(), tenantId, firstGeneratedVisit.id, uuidv7(), userId],
        ),
      ).rejects.toThrow();

      const caregiverAgreementHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(caregiverSubject)}`,
      };
      const caregiverAgreementList = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        { headers: caregiverAgreementHeaders },
      );
      expect(caregiverAgreementList.status).toBe(200);
      const caregiverCannotSuspendAgreement = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/suspend`,
        { method: 'POST', headers: caregiverAgreementHeaders },
      );
      expect(caregiverCannotSuspendAgreement.status).toBe(403);

      const otherFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: facilityId }] }),
        },
      );
      expect(otherFacilityScope.status).toBe(200);
      const officeCannotReadOutOfScopeAgreement = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          headers: { ...headers, Authorization: `Bearer ${await issueToken(secondSubject)}` },
        },
      );
      expect(officeCannotReadOutOfScopeAgreement.status).toBe(404);
      const matchingFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: secondFacilityId }] }),
        },
      );
      expect(matchingFacilityScope.status).toBe(200);
      const officeCanReadInScopeAgreement = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          headers: { ...headers, Authorization: `Bearer ${await issueToken(secondSubject)}` },
        },
      );
      expect(officeCanReadInScopeAgreement.status).toBe(200);
      const restoreOfficeTenantScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'tenant', scopeId: tenantId }] }),
        },
      );
      expect(restoreOfficeTenantScope.status).toBe(200);

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      expect(
        (
          await appRole.query('SELECT id FROM service_agreements.agreements WHERE id = $1', [
            agreement.id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await appRole.query(
            'SELECT id FROM service_agreements.agreement_services WHERE id = $1',
            [agreementService.id],
          )
        ).rowCount,
      ).toBe(0);
      await appRole.query('COMMIT');

      const overlappingAgreementResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ validFrom: '2000-01-01', reference: 'OVERLAP-AGREEMENT' }),
        },
      );
      expect(overlappingAgreementResponse.status).toBe(201);
      const overlappingAgreement = (await overlappingAgreementResponse.json()) as { id: string };
      const overlappingServiceResponse = await fetch(
        `${baseUrl}/api/v1/service-agreements/${overlappingAgreement.id}/services`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            serviceDefinitionId: service.id,
            scheduleRule: { type: 'on_demand' },
          }),
        },
      );
      expect(overlappingServiceResponse.status).toBe(201);
      const overlapActivation = await fetch(
        `${baseUrl}/api/v1/service-agreements/${overlappingAgreement.id}/activate`,
        { method: 'POST', headers },
      );
      expect(overlapActivation.status).toBe(409);
      expect((await overlapActivation.json()).code).toBe('SERVICE_AGREEMENT_OVERLAP');
      expect(
        (
          await fetch(`${baseUrl}/api/v1/service-agreements/${overlappingAgreement.id}/end`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(200);

      const archiveActiveService = await fetch(`${baseUrl}/api/v1/services/${service.id}/archive`, {
        method: 'POST',
        headers,
      });
      expect(archiveActiveService.status).toBe(409);
      expect((await archiveActiveService.json()).code).toBe('SERVICE_HAS_ACTIVE_AGREEMENTS');
      const archiveActiveOrganization = await fetch(
        `${baseUrl}/api/v1/organizations/${organizationId}/archive`,
        { method: 'POST', headers },
      );
      expect(archiveActiveOrganization.status).toBe(409);
      expect((await archiveActiveOrganization.json()).code).toBe(
        'ORGANIZATION_HAS_ACTIVE_SERVICE_AGREEMENTS',
      );
      const archiveActiveFacility = await fetch(
        `${baseUrl}/api/v1/facilities/${secondFacilityId}/archive`,
        { method: 'POST', headers },
      );
      expect(archiveActiveFacility.status).toBe(409);
      expect((await archiveActiveFacility.json()).code).toBe(
        'FACILITY_HAS_ACTIVE_SERVICE_AGREEMENTS',
      );
      const providerContextDuringAgreement = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/provider-context`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ organizationId, primaryFacilityId: facilityId }),
        },
      );
      expect(providerContextDuringAgreement.status).toBe(409);
      expect((await providerContextDuringAgreement.json()).code).toBe(
        'CLIENT_HAS_ACTIVE_SERVICE_AGREEMENTS',
      );
      const archiveActiveClient = await fetch(`${baseUrl}/api/v1/clients/${created.id}/archive`, {
        method: 'POST',
        headers,
      });
      expect(archiveActiveClient.status).toBe(409);
      expect((await archiveActiveClient.json()).code).toBe('CLIENT_HAS_ACTIVE_SERVICE_AGREEMENTS');

      const endedAgreementService = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services/${secondAgreementService.id}/end`,
        { method: 'POST', headers },
      );
      expect(endedAgreementService.status).toBe(200);
      expect(((await endedAgreementService.json()) as { status: string }).status).toBe('ended');
      const cannotEndLastService = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/services/${agreementService.id}/end`,
        { method: 'POST', headers },
      );
      expect(cannotEndLastService.status).toBe(409);
      expect((await cannotEndLastService.json()).code).toBe('SERVICE_AGREEMENT_REQUIRES_SERVICE');
      expect(
        (
          await fetch(`${baseUrl}/api/v1/service-agreements/${agreement.id}/suspend`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/service-agreements/${agreement.id}/resume`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(200);
      const endedAgreementResponse = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}/end`,
        { method: 'POST', headers },
      );
      expect(endedAgreementResponse.status).toBe(200);
      expect(((await endedAgreementResponse.json()) as { status: string }).status).toBe('ended');
      expect(
        (await fetch(`${baseUrl}/api/v1/service-agreements/${agreement.id}/services`, { headers }))
          .status,
      ).toBe(200);
      const updateEndedAgreement = await fetch(
        `${baseUrl}/api/v1/service-agreements/${agreement.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ reference: 'NO-REOPEN' }),
        },
      );
      expect(updateEndedAgreement.status).toBe(409);
      expect((await updateEndedAgreement.json()).code).toBe('SERVICE_AGREEMENT_ALREADY_ENDED');

      const executionClientResponse = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Execution',
          lastName: `Client-${uuidv7()}`,
          organizationId,
          primaryFacilityId: secondFacilityId,
        }),
      });
      expect(executionClientResponse.status).toBe(201);
      const executionClient = (await executionClientResponse.json()) as { id: string };
      const createExecutionRepresentative = async (firstName: string, validUntil: string) => {
        const response = await fetch(`${baseUrl}/api/v1/clients/${executionClient.id}/contacts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            firstName,
            lastName: 'Representative',
            relationshipType: 'legal_representative',
            roles: ['legal_representative'],
            representationType: 'power_of_attorney',
            representationValidFrom: '1990-01-01',
            representationValidUntil: validUntil,
          }),
        });
        expect(response.status).toBe(201);
        return (await response.json()) as { id: string };
      };
      const expiredRepresentative = await createExecutionRepresentative('Expired', '2000-01-01');
      const eligibleRepresentative = await createExecutionRepresentative('Eligible', '2099-12-31');
      expect(
        (
          await fetch(`${baseUrl}/api/v1/clients/${executionClient.id}/activate`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(200);

      const linkCaregiver = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/user`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ userId: caregiverUserId }),
        },
      );
      expect(linkCaregiver.status).toBe(200);
      const linkUnrelatedCaregiver = await fetch(
        `${baseUrl}/api/v1/employees/${unavailableEmployee.id}/user`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ userId: unrelatedCaregiverUserId }),
        },
      );
      expect(linkUnrelatedCaregiver.status).toBe(200);

      const executionDate = dateInBerlin(-1);
      const executionAvailability = await fetch(
        `${baseUrl}/api/v1/employees/${schedulingEmployee.id}/availability`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedVersion: 3,
            timezone: 'Europe/Berlin',
            maxDailyMinutes: 420,
            travelBufferMinutes: 15,
            windows: Array.from({ length: 7 }, (_, index) => ({
              weekday: index + 1,
              startsAt: '00:00',
              endsAt: '23:59',
            })),
          }),
        },
      );
      expect(executionAvailability.status).toBe(200);
      const createExecutionVisit = async (startTime: string, employeeId: string) => {
        const response = await fetch(`${baseUrl}/api/v1/visits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            clientId: executionClient.id,
            localDate: executionDate,
            localStartTime: startTime,
            localEndTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`,
            note: 'Use the side entrance.',
            employeeIds: [employeeId],
            services: [{ serviceDefinitionId: service.id, plannedQuantity: '1' }],
          }),
        });
        expect(response.status).toBe(201);
        return (await response.json()) as { id: string; services: Array<{ id: string }> };
      };
      const executionVisit = await createExecutionVisit('08:00', schedulingEmployee.id);
      const otherEmployeeVisit = await createExecutionVisit('10:00', unavailableEmployee.id);
      const cancelledExecutionVisit = await createExecutionVisit('12:00', schedulingEmployee.id);
      await owner.query(
        `INSERT INTO scheduling.client_scheduling_preferences
          (id, tenant_id, client_id, preferred_weekdays, preferred_time_windows, updated_at, updated_by)
         VALUES ($1, $2, $3, $4::smallint[], $5::jsonb, now(), $6)`,
        [
          uuidv7(),
          tenantId,
          executionClient.id,
          [1, 3],
          JSON.stringify([{ startsAt: '09:00', endsAt: '11:00' }]),
          userId,
        ],
      );
      const cancelBeforeStart = await fetch(
        `${baseUrl}/api/v1/visits/${cancelledExecutionVisit.id}/cancel`,
        { method: 'POST', headers },
      );
      expect(cancelBeforeStart.status).toBe(200);
      const caregiverHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(caregiverSubject)}`,
      };
      const unrelatedCaregiverHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(unrelatedCaregiverSubject)}`,
      };
      const officeHeaders = {
        ...headers,
        Authorization: `Bearer ${await issueToken(secondSubject)}`,
      };

      const executionRange = new URLSearchParams({
        from: new Date(`${executionDate}T00:00:00.000Z`).toISOString(),
        until: new Date(`${addCalendarDays(executionDate, 1)}T23:59:59.000Z`).toISOString(),
      });
      const caregiverVisits = await fetch(`${baseUrl}/api/v1/me/visits?${executionRange}`, {
        headers: caregiverHeaders,
      });
      expect(caregiverVisits.status).toBe(200);
      const caregiverVisitItems = (
        (await caregiverVisits.json()) as {
          items: Array<{
            id: string;
            note: string | null;
            updatedAt: string;
            assignmentAssignedAt: string;
          }>;
        }
      ).items;
      const caregiverExecutionVisit = caregiverVisitItems.find(
        (item) => item.id === executionVisit.id,
      );
      expect(caregiverExecutionVisit).toMatchObject({
        id: executionVisit.id,
        note: 'Use the side entrance.',
        updatedAt: expect.any(String),
        assignmentAssignedAt: expect.any(String),
      });

      const unassignedStart = await fetch(
        `${baseUrl}/api/v1/visits/${otherEmployeeVisit.id}/execution/start`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(unassignedStart.status).toBe(403);
      expect((await unassignedStart.json()).code).toBe('VISIT_NOT_ASSIGNED_TO_EMPLOYEE');
      const revokedAssignmentRowsResponse = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/assignments`,
        { headers },
      );
      expect(revokedAssignmentRowsResponse.status).toBe(200);
      const revokedAssignmentRows = (await revokedAssignmentRowsResponse.json()) as Array<{
        id: string;
        status: string;
      }>;
      const revokedAssignment = revokedAssignmentRows.find(
        (caregiverAssignment) => caregiverAssignment.status === 'active',
      );
      if (!revokedAssignment) throw new Error('Execution visit has no active caregiver assignment');
      const removeCaregiverAssignment = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/assignments/${revokedAssignment.id}`,
        { method: 'DELETE', headers },
      );
      expect(removeCaregiverAssignment.status).toBe(204);
      const staleAssignmentStart = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/start`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(staleAssignmentStart.status).toBe(403);
      expect((await staleAssignmentStart.json()).code).toBe('VISIT_NOT_ASSIGNED_TO_EMPLOYEE');
      const restoreCaregiverAssignment = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/assignments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ employeeId: schedulingEmployee.id }),
        },
      );
      expect(restoreCaregiverAssignment.status).toBe(201);
      const cancelledStart = await fetch(
        `${baseUrl}/api/v1/visits/${cancelledExecutionVisit.id}/execution/start`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(cancelledStart.status).toBe(409);
      expect((await cancelledStart.json()).code).toBe('VISIT_CANCELLED');
      const officeCannotStart = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/start`,
        { method: 'POST', headers: officeHeaders },
      );
      expect(officeCannotStart.status).toBe(403);
      const crossTenantExecutionRead = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution`,
        { headers: { ...caregiverHeaders, 'X-Tenant-Id': otherTenantId } },
      );
      expect(crossTenantExecutionRead.status).toBe(403);

      const executionBeforeStart = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution`,
        { headers: caregiverHeaders },
      );
      expect(executionBeforeStart.status).toBe(200);
      expect(await executionBeforeStart.json()).toMatchObject({
        visit: {
          schedulingPreferences: {
            preferredWeekdays: [1, 3],
            preferredTimeWindows: [{ startsAt: '09:00', endsAt: '11:00' }],
          },
        },
        execution: { status: 'not_started', version: 0 },
        services: [expect.objectContaining({ status: 'not_recorded', plannedQuantity: '1.000' })],
      });

      const executionSummaryUrl = new URL(`${baseUrl}/api/v1/visit-executions/summaries`);
      executionSummaryUrl.searchParams.set('visitIds', executionVisit.id);
      const caregiverExecutionSummary = await fetch(executionSummaryUrl, {
        headers: caregiverHeaders,
      });
      expect(caregiverExecutionSummary.status).toBe(200);
      expect(await caregiverExecutionSummary.json()).toEqual([
        {
          visitId: executionVisit.id,
          executionStatus: 'not_started',
          actualStart: null,
          actualEnd: null,
        },
      ]);
      const unassignedExecutionSummary = await fetch(
        `${baseUrl}/api/v1/visit-executions/summaries?visitIds=${otherEmployeeVisit.id}`,
        { headers: caregiverHeaders },
      );
      expect(unassignedExecutionSummary.status).toBe(403);
      const crossTenantExecutionSummary = await fetch(executionSummaryUrl, {
        headers: { ...caregiverHeaders, 'X-Tenant-Id': otherTenantId },
      });
      expect(crossTenantExecutionSummary.status).toBe(403);
      const invalidExecutionSummary = await fetch(
        `${baseUrl}/api/v1/visit-executions/summaries?visitIds=${executionVisit.id},${executionVisit.id}`,
        { headers: officeHeaders },
      );
      expect(invalidExecutionSummary.status).toBe(400);

      const concurrentStarts = await Promise.all([
        fetch(`${baseUrl}/api/v1/visits/${executionVisit.id}/execution/start`, {
          method: 'POST',
          headers: caregiverHeaders,
        }),
        fetch(`${baseUrl}/api/v1/visits/${executionVisit.id}/execution/start`, {
          method: 'POST',
          headers: caregiverHeaders,
        }),
      ]);
      expect(concurrentStarts.map((response) => response.status)).toEqual([200, 200]);
      const startedDetails = (await Promise.all(
        concurrentStarts.map((response) => response.json()),
      )) as Array<{ execution: { id: string; version: number } }>;
      expect(startedDetails[0]?.execution).toEqual(startedDetails[1]?.execution);
      const executionId = startedDetails[0]!.execution.id;
      expect(startedDetails[0]!.execution.version).toBe(1);
      const overdueVisitIssues = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=visit_execution`,
        { headers: officeHeaders },
      );
      expect(overdueVisitIssues.status).toBe(200);
      const overdueVisitWorklist = (await overdueVisitIssues.json()) as {
        items: Array<{
          id: string;
          issueCode: string;
          sourceDomain: string;
          sourceEntityId: string;
        }>;
      };
      const overdueVisitIssue = overdueVisitWorklist.items.find(
        (item) => item.issueCode === 'visit_execution_overdue',
      );
      expect(overdueVisitIssue).toMatchObject({
        sourceDomain: 'visit_execution',
        sourceEntityId: executionVisit.id,
      });
      const executionAssignmentsResponse = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/assignments`,
        { headers },
      );
      const executionAssignments = (await executionAssignmentsResponse.json()) as Array<{
        id: string;
        status: string;
      }>;
      const executionAssignment = executionAssignments.find((item) => item.status === 'active');
      if (!executionAssignment) throw new Error('Execution visit has no active assignment');
      const substituteExecutedVisit = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/substitutions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            originalAssignmentId: executionAssignment.id,
            substituteEmployeeId: substitutionEmployee.id,
            reason: 'must not alter an executing visit',
          }),
        },
      );
      expect(substituteExecutedVisit.status).toBe(409);
      expect((await substituteExecutedVisit.json()).code).toBe('VISIT_EXECUTION_PLANNING_LOCKED');

      // The past visit and ended agreement let facility and organization archive checks reach
      // their in-progress execution guards instead of earlier planning or agreement guards.
      const executionArchiveChecks = [
        {
          response: fetch(`${baseUrl}/api/v1/clients/${executionClient.id}/archive`, {
            method: 'POST',
            headers,
          }),
          code: 'CLIENT_EXECUTION_IN_PROGRESS',
        },
        {
          response: fetch(`${baseUrl}/api/v1/employees/${schedulingEmployee.id}/deactivate`, {
            method: 'POST',
            headers,
          }),
          code: 'EMPLOYEE_EXECUTION_IN_PROGRESS',
        },
        {
          response: fetch(`${baseUrl}/api/v1/facilities/${secondFacilityId}/archive`, {
            method: 'POST',
            headers,
          }),
          code: 'FACILITY_EXECUTION_IN_PROGRESS',
        },
        {
          response: fetch(`${baseUrl}/api/v1/organizations/${organizationId}/archive`, {
            method: 'POST',
            headers,
          }),
          code: 'ORGANIZATION_EXECUTION_IN_PROGRESS',
        },
      ];
      for (const { response: archiveResponse, code } of executionArchiveChecks) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        const response = await archiveResponse;
        expect(response.status).toBe(409);
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        expect((await response.json()).code).toBe(code);
      }

      const rescheduleExecution = await fetch(`${baseUrl}/api/v1/visits/${executionVisit.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          localDate: executionDate,
          localStartTime: '08:05',
          localEndTime: '09:05',
        }),
      });
      expect(rescheduleExecution.status).toBe(409);
      expect((await rescheduleExecution.json()).code).toBe('VISIT_EXECUTION_PLANNING_LOCKED');
      const cancelExecution = await fetch(`${baseUrl}/api/v1/visits/${executionVisit.id}/cancel`, {
        method: 'POST',
        headers,
      });
      expect(cancelExecution.status).toBe(409);
      expect((await cancelExecution.json()).code).toBe('VISIT_EXECUTION_PLANNING_LOCKED');

      const unresolvedCompletion = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/complete`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: 1 }),
        },
      );
      expect(unresolvedCompletion.status).toBe(409);
      expect((await unresolvedCompletion.json()).code).toBe('PERFORMED_SERVICE_REQUIRED');

      const visitServiceId = executionVisit.services[0]?.id;
      if (!visitServiceId) throw new Error('Execution visit has no planned service');
      const performedServiceId = uuidv7();
      const [recordPlannedService, completionRace] = await Promise.all([
        fetch(
          `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${performedServiceId}`,
          {
            method: 'PUT',
            headers: caregiverHeaders,
            body: JSON.stringify({
              expectedVersion: 1,
              visitServiceId,
              serviceDefinitionId: service.id,
              status: 'partially_performed',
              actualQuantity: '0.500',
              reasonCode: null,
            }),
          },
        ),
        fetch(`${baseUrl}/api/v1/visits/${executionVisit.id}/execution/complete`, {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: 1 }),
        }),
      ]);
      expect(recordPlannedService.status).toBe(200);
      expect(completionRace.status).toBe(409);
      expect(['PERFORMED_SERVICE_REQUIRED', 'VISIT_EXECUTION_VERSION_CONFLICT']).toContain(
        (await completionRace.json()).code,
      );
      expect(await recordPlannedService.json()).toMatchObject({
        version: 2,
        service: { id: performedServiceId, status: 'partially_performed', actualQuantity: '0.500' },
      });
      const repeatedServiceSubmission = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 1,
            visitServiceId,
            status: 'partially_performed',
            actualQuantity: '0.500',
            reasonCode: null,
          }),
        },
      );
      expect(repeatedServiceSubmission.status).toBe(200);
      expect(await repeatedServiceSubmission.json()).toMatchObject({
        version: 2,
        service: { id: performedServiceId, status: 'partially_performed', actualQuantity: '0.500' },
      });

      const invalidPrecisionUpdate = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 2,
            visitServiceId,
            status: 'performed',
            actualQuantity: '1.0000',
          }),
        },
      );
      expect(invalidPrecisionUpdate.status).toBe(400);
      expect((await invalidPrecisionUpdate.json()).code).toBe('PERFORMED_SERVICE_INVALID_QUANTITY');

      const staleServiceUpdate = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 1,
            visitServiceId,
            status: 'partially_performed',
            actualQuantity: '0.250',
          }),
        },
      );
      expect(staleServiceUpdate.status).toBe(409);
      expect((await staleServiceUpdate.json()).code).toBe('VISIT_EXECUTION_VERSION_CONFLICT');

      const unavailableUnplannedService = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${uuidv7()}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 2,
            serviceDefinitionId: unavailableService.id,
            status: 'performed',
            actualQuantity: '1.000',
          }),
        },
      );
      expect(unavailableUnplannedService.status).toBe(409);
      expect((await unavailableUnplannedService.json()).code).toBe(
        'PERFORMED_SERVICE_SERVICE_INVALID',
      );

      const unplannedPerformedServiceId = uuidv7();
      const addUnplannedService = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${unplannedPerformedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 2,
            serviceDefinitionId: service.id,
            status: 'performed',
            actualQuantity: '1.000',
          }),
        },
      );
      expect(addUnplannedService.status).toBe(200);
      expect(await addUnplannedService.json()).toMatchObject({
        version: 3,
        service: { id: unplannedPerformedServiceId, visitServiceId: null, unplanned: true },
      });

      const unassignedDocumentationRead = await fetch(
        `${baseUrl}/api/v1/visits/${otherEmployeeVisit.id}/documentation`,
        { headers: caregiverHeaders },
      );
      expect(unassignedDocumentationRead.status).toBe(403);
      expect((await unassignedDocumentationRead.json()).code).toBe(
        'CARE_DOCUMENTATION_VISIT_RELATIONSHIP_REQUIRED',
      );
      const crossTenantDocumentationRead = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/documentation`,
        { headers: { ...caregiverHeaders, 'X-Tenant-Id': otherTenantId } },
      );
      expect(crossTenantDocumentationRead.status).toBe(403);

      const createDocumentation = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/documentation`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(createDocumentation.status).toBe(200);
      const draftDocumentation = (await createDocumentation.json()) as {
        execution: { status: string };
        documentation: { id: string; status: string; version: number };
        completeness: { isComplete: boolean; missing: Array<{ code: string }> };
      };
      const documentationId = draftDocumentation.documentation.id;
      expect(documentationId[14]).toBe('7');
      expect(draftDocumentation).toMatchObject({
        execution: { status: 'in_progress' },
        documentation: { status: 'draft', version: 1 },
        completeness: { isComplete: false },
      });
      expect(draftDocumentation.completeness.missing).toEqual(
        expect.arrayContaining([
          { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId },
          { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId: unplannedPerformedServiceId },
        ]),
      );
      const idempotentDocumentationCreate = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/documentation`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(idempotentDocumentationCreate.status).toBe(200);
      expect(await idempotentDocumentationCreate.json()).toMatchObject({
        documentation: { id: documentationId, status: 'draft', version: 1 },
      });
      await expect(
        owner.query(
          `INSERT INTO care_documentation.documents
             (id, tenant_id, visit_id, execution_id, status, created_by_employee_id, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'draft', $5, 1, now(), now())`,
          [uuidv7(), tenantId, executionVisit.id, executionId, schedulingEmployee.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        owner.query(
          `INSERT INTO care_documentation.documents
             (id, tenant_id, visit_id, execution_id, status, created_by_employee_id, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'invalid', $5, 1, now(), now())`,
          [uuidv7(), tenantId, executionVisit.id, executionId, schedulingEmployee.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      const sensitiveCareText = `private-care-note-${uuidv7()}`;
      const observationResponse = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 1,
            type: 'observation',
            content: sensitiveCareText,
          }),
        },
      );
      expect(observationResponse.status).toBe(200);
      const observationDetail = (await observationResponse.json()) as {
        documentation: { version: number };
        entries: Array<{ id: string; type: string; content: string }>;
      };
      expect(observationDetail.documentation.version).toBe(2);
      expect(observationDetail.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'observation', content: sensitiveCareText }),
        ]),
      );
      const observationEntryId = observationDetail.entries.find(
        (entry) => entry.content === sensitiveCareText,
      )!.id;
      expect(observationEntryId[14]).toBe('7');
      const draftNoteOriginalText = `private-draft-note-original-${uuidv7()}`;
      const draftNoteUpdatedText = `private-draft-note-updated-${uuidv7()}`;
      const draftNoteResponse = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 2,
            type: 'care_note',
            content: draftNoteOriginalText,
          }),
        },
      );
      expect(draftNoteResponse.status).toBe(200);
      const draftNoteDetail = (await draftNoteResponse.json()) as {
        documentation: { version: number };
        entries: Array<{ id: string; content: string }>;
      };
      expect(draftNoteDetail.documentation.version).toBe(3);
      const draftNoteId = draftNoteDetail.entries.find(
        (entry) => entry.content === draftNoteOriginalText,
      )!.id;
      const updateDraftNote = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries/${draftNoteId}`,
        {
          method: 'PATCH',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: 3, content: draftNoteUpdatedText }),
        },
      );
      expect(updateDraftNote.status).toBe(200);
      const updatedDraftNoteDetail = (await updateDraftNote.json()) as {
        documentation: { version: number };
        entries: Array<{ id: string; content: string }>;
      };
      expect(updatedDraftNoteDetail.documentation.version).toBe(4);
      expect(updatedDraftNoteDetail.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: draftNoteId, content: draftNoteUpdatedText }),
        ]),
      );
      const removeDraftNote = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries/${draftNoteId}`,
        {
          method: 'DELETE',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: 4 }),
        },
      );
      expect(removeDraftNote.status).toBe(200);
      const removedDraftNoteDetail = (await removeDraftNote.json()) as {
        documentation: { version: number };
        entries: Array<{ id: string; content: string }>;
      };
      expect(removedDraftNoteDetail.documentation.version).toBe(5);
      expect(removedDraftNoteDetail.entries).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: draftNoteId })]),
      );

      const staleDocumentationEdit = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 1,
            type: 'care_note',
            content: 'Stale documentation write',
          }),
        },
      );
      expect(staleDocumentationEdit.status).toBe(409);
      expect((await staleDocumentationEdit.json()).code).toBe(
        'CARE_DOCUMENTATION_VERSION_CONFLICT',
      );

      const concurrentDocumentationEdits = await Promise.all([
        fetch(`${baseUrl}/api/v1/care-documentation/${documentationId}/entries`, {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 5,
            type: 'care_note',
            content: 'First concurrent note',
          }),
        }),
        fetch(`${baseUrl}/api/v1/care-documentation/${documentationId}/entries`, {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 5,
            type: 'deviation',
            content: 'Second concurrent note',
          }),
        }),
      ]);
      expect(concurrentDocumentationEdits.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const concurrentConflict = concurrentDocumentationEdits.find(
        (response) => response.status === 409,
      )!;
      expect((await concurrentConflict.json()).code).toBe('CARE_DOCUMENTATION_VERSION_CONFLICT');
      const concurrentSuccess = concurrentDocumentationEdits.find(
        (response) => response.status === 200,
      )!;
      const concurrentDetail = (await concurrentSuccess.json()) as {
        documentation: { version: number };
      };
      let documentationVersion = concurrentDetail.documentation.version;

      const sensitiveInvalidIncidentText = `private-invalid-incident-${uuidv7()}`;
      const invalidIncident = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            type: 'incident',
            content: sensitiveInvalidIncidentText,
            occurredAt: new Date().toISOString(),
          }),
        },
      );
      expect(invalidIncident.status).toBe(400);
      const invalidIncidentProblem = await invalidIncident.json();
      expect(invalidIncidentProblem.code).toBe('DOCUMENTATION_ENTRY_INVALID');
      expect(JSON.stringify(invalidIncidentProblem)).not.toContain(sensitiveInvalidIncidentText);
      const sensitiveIncidentText = `private-incident-${uuidv7()}`;
      const incidentResponse = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            type: 'incident',
            content: sensitiveIncidentText,
            occurredAt: new Date().toISOString(),
            severity: 'low',
          }),
        },
      );
      expect(incidentResponse.status).toBe(200);
      const incidentDetail = (await incidentResponse.json()) as {
        documentation: { version: number };
        entries: Array<{ id: string; type: string; severity: string | null }>;
      };
      documentationVersion = incidentDetail.documentation.version;
      const incidentId = incidentDetail.entries.find((entry) => entry.type === 'incident')!.id;
      expect(incidentId[14]).toBe('7');
      expect(incidentDetail.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'incident', severity: 'low' })]),
      );

      const missingPerformedServiceEvidence = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/evidence/${uuidv7()}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: documentationVersion, status: 'documented' }),
        },
      );
      expect(missingPerformedServiceEvidence.status).toBe(404);
      expect((await missingPerformedServiceEvidence.json()).code).toBe(
        'SERVICE_EVIDENCE_NOT_FOUND',
      );
      const finalizeWhileExecutionInProgress = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/finalize`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: documentationVersion }),
        },
      );
      expect(finalizeWhileExecutionInProgress.status).toBe(409);
      expect((await finalizeWhileExecutionInProgress.json()).code).toBe(
        'VISIT_EXECUTION_NOT_COMPLETED',
      );

      const documentationRange = new URLSearchParams({
        from: executionRange.get('from')!,
        until: executionRange.get('until')!,
        facilityId: secondFacilityId,
        employeeId: schedulingEmployee.id,
        incomplete: 'true',
      });
      const officeDocumentationWorklist = await fetch(
        `${baseUrl}/api/v1/care-documentation?${documentationRange}`,
        { headers: officeHeaders },
      );
      expect(officeDocumentationWorklist.status).toBe(200);
      const officeDocumentationWorklistBody = await officeDocumentationWorklist.json();
      expect(officeDocumentationWorklistBody).toMatchObject({
        items: [
          expect.objectContaining({
            visitId: executionVisit.id,
            documentationId,
            documentationStatus: 'draft',
            missing: expect.arrayContaining([
              { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId },
              {
                code: 'SERVICE_EVIDENCE_REQUIRED',
                performedServiceId: unplannedPerformedServiceId,
              },
            ]),
          }),
        ],
      });
      expect(JSON.stringify(officeDocumentationWorklistBody)).not.toContain(sensitiveCareText);
      expect(JSON.stringify(officeDocumentationWorklistBody)).not.toContain(sensitiveIncidentText);
      expect(JSON.stringify(officeDocumentationWorklistBody)).not.toContain(
        sensitiveInvalidIncidentText,
      );
      expect(JSON.stringify(officeDocumentationWorklistBody)).not.toContain(draftNoteOriginalText);
      expect(JSON.stringify(officeDocumentationWorklistBody)).not.toContain(draftNoteUpdatedText);
      const clientFilteredDocumentationRange = new URLSearchParams(documentationRange);
      clientFilteredDocumentationRange.set('clientQuery', 'Execution Client-');
      const clientFilteredDocumentationWorklist = await fetch(
        `${baseUrl}/api/v1/care-documentation?${clientFilteredDocumentationRange}`,
        { headers: officeHeaders },
      );
      expect(clientFilteredDocumentationWorklist.status).toBe(200);
      expect(await clientFilteredDocumentationWorklist.json()).toMatchObject({
        items: [expect.objectContaining({ clientId: executionClient.id })],
        total: 1,
      });
      const unmatchedClientDocumentationRange = new URLSearchParams(documentationRange);
      unmatchedClientDocumentationRange.set('clientQuery', 'Unknown client');
      const unmatchedClientDocumentationWorklist = await fetch(
        `${baseUrl}/api/v1/care-documentation?${unmatchedClientDocumentationRange}`,
        { headers: officeHeaders },
      );
      expect(unmatchedClientDocumentationWorklist.status).toBe(200);
      expect(await unmatchedClientDocumentationWorklist.json()).toMatchObject({
        items: [],
        total: 0,
      });
      const restrictOfficeDocumentationScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: facilityId }] }),
        },
      );
      expect(restrictOfficeDocumentationScope.status).toBe(200);
      const outOfScopeDocumentationWorklist = await fetch(
        `${baseUrl}/api/v1/care-documentation?${documentationRange}`,
        { headers: officeHeaders },
      );
      expect(outOfScopeDocumentationWorklist.status).toBe(200);
      expect(await outOfScopeDocumentationWorklist.json()).toMatchObject({ items: [], total: 0 });
      const restoreOfficeDocumentationScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'tenant', scopeId: tenantId }] }),
        },
      );
      expect(restoreOfficeDocumentationScope.status).toBe(200);
      const caregiverDocumentationWorklist = await fetch(
        `${baseUrl}/api/v1/me/documentation?${new URLSearchParams({
          from: executionRange.get('from')!,
          until: executionRange.get('until')!,
        })}`,
        { headers: caregiverHeaders },
      );
      expect(caregiverDocumentationWorklist.status).toBe(200);
      expect(await caregiverDocumentationWorklist.json()).toMatchObject({
        items: [expect.objectContaining({ visitId: executionVisit.id, documentationId })],
      });

      const amendDraftDocumentation = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/amendments`,
        {
          method: 'POST',
          headers: officeHeaders,
          body: JSON.stringify({
            reason: 'Draft correction',
            correction: 'Must not be accepted yet',
          }),
        },
      );
      expect(amendDraftDocumentation.status).toBe(409);
      expect((await amendDraftDocumentation.json()).code).toBe('CARE_DOCUMENTATION_NOT_FINALIZED');

      const completeExecution = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/complete`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: 3 }),
        },
      );
      expect(completeExecution.status).toBe(200);
      const completedDetail = (await completeExecution.json()) as {
        execution: {
          id: string;
          status: string;
          version: number;
          actualStart: string;
          actualEnd: string;
        };
        services: Array<{
          visitServiceId: string | null;
          plannedQuantity: string | null;
          actualQuantity: string | null;
          status: string;
          unplanned: boolean;
        }>;
      };
      expect(completedDetail.execution).toMatchObject({
        id: executionId,
        status: 'completed',
        version: 4,
      });
      const repeatedCompletion = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/complete`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: 3 }),
        },
      );
      expect(repeatedCompletion.status).toBe(200);
      expect(await repeatedCompletion.json()).toMatchObject({
        execution: {
          id: executionId,
          status: 'completed',
          version: 4,
          actualEnd: completedDetail.execution.actualEnd,
        },
      });
      expect(completedDetail.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            visitServiceId,
            plannedQuantity: '1.000',
            actualQuantity: '0.500',
            status: 'partially_performed',
            unplanned: false,
          }),
          expect.objectContaining({
            visitServiceId: null,
            plannedQuantity: null,
            actualQuantity: '1.000',
            status: 'performed',
            unplanned: true,
          }),
        ]),
      );
      const completedVisitWorklistResponse = await fetch(
        `${baseUrl}/api/v1/operations/work-items?sourceDomain=visit_execution`,
        { headers: officeHeaders },
      );
      expect(completedVisitWorklistResponse.status).toBe(200);
      const completedVisitWorklist = (await completedVisitWorklistResponse.json()) as {
        items: Array<{ issueCode: string; sourceEntityId: string }>;
      };
      expect(
        completedVisitWorklist.items.some(
          (item) =>
            item.issueCode === 'visit_execution_overdue' &&
            item.sourceEntityId === executionVisit.id,
        ),
      ).toBe(false);
      const resolvedVisitIssue = await owner.query<{ resolved_at: Date | null }>(
        `SELECT resolved_at FROM operations.exception_occurrences WHERE tenant_id = $1 AND issue_key = $2`,
        [tenantId, overdueVisitIssue!.id],
      );
      expect(resolvedVisitIssue.rows[0]?.resolved_at).toBeTruthy();

      const finalizeIncompleteDocumentation = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/finalize`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: documentationVersion }),
        },
      );
      expect(finalizeIncompleteDocumentation.status).toBe(409);
      expect((await finalizeIncompleteDocumentation.json()).code).toBe(
        'CARE_DOCUMENTATION_INCOMPLETE',
      );

      const sensitiveEvidenceText = `private-evidence-${uuidv7()}`;
      const plannedEvidenceResponse = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/evidence/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            status: 'documented',
            note: sensitiveEvidenceText,
          }),
        },
      );
      expect(plannedEvidenceResponse.status).toBe(200);
      const plannedEvidenceDetail = (await plannedEvidenceResponse.json()) as {
        documentation: { version: number };
        services: Array<{
          performedServiceId: string;
          evidence: { id: string; note: string | null } | null;
        }>;
      };
      documentationVersion = plannedEvidenceDetail.documentation.version;
      const plannedEvidenceId = plannedEvidenceDetail.services.find(
        (evidenceService) => evidenceService.performedServiceId === performedServiceId,
      )!.evidence!.id;
      expect(plannedEvidenceId[14]).toBe('7');
      expect(plannedEvidenceDetail.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            performedServiceId,
            evidence: expect.objectContaining({ note: sensitiveEvidenceText }),
          }),
        ]),
      );
      await expect(
        owner.query(
          `INSERT INTO care_documentation.service_evidence
             (id, tenant_id, documentation_id, execution_id, performed_service_id, status, documented_by_employee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'documented', $6, now(), now())`,
          [
            uuidv7(),
            tenantId,
            documentationId,
            executionId,
            performedServiceId,
            schedulingEmployee.id,
          ],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        owner.query(
          `INSERT INTO care_documentation.service_evidence
             (id, tenant_id, documentation_id, execution_id, performed_service_id, status, documented_by_employee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'invalid', $6, now(), now())`,
          [
            uuidv7(),
            tenantId,
            documentationId,
            executionId,
            unplannedPerformedServiceId,
            schedulingEmployee.id,
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const invalidNotRequiredEvidence = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/evidence/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            status: 'not_required',
            note: 'This partially performed service still needs evidence',
          }),
        },
      );
      expect(invalidNotRequiredEvidence.status).toBe(400);
      expect((await invalidNotRequiredEvidence.json()).code).toBe('SERVICE_EVIDENCE_INVALID');
      const sensitiveUpdatedEvidenceText = `private-evidence-updated-${uuidv7()}`;
      const updatePlannedEvidence = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/evidence/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            status: 'documented',
            note: sensitiveUpdatedEvidenceText,
          }),
        },
      );
      expect(updatePlannedEvidence.status).toBe(200);
      const updatedPlannedEvidenceDetail = (await updatePlannedEvidence.json()) as {
        documentation: { version: number };
        services: Array<{
          performedServiceId: string;
          evidence: { id: string; note: string | null } | null;
        }>;
      };
      documentationVersion = updatedPlannedEvidenceDetail.documentation.version;
      expect(updatedPlannedEvidenceDetail.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            performedServiceId,
            evidence: expect.objectContaining({
              id: plannedEvidenceId,
              note: sensitiveUpdatedEvidenceText,
            }),
          }),
        ]),
      );
      const staleEvidenceUpdate = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/evidence/${performedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: documentationVersion - 1, status: 'documented' }),
        },
      );
      expect(staleEvidenceUpdate.status).toBe(409);
      expect((await staleEvidenceUpdate.json()).code).toBe('CARE_DOCUMENTATION_VERSION_CONFLICT');

      const unplannedEvidenceResponse = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/evidence/${unplannedPerformedServiceId}`,
        {
          method: 'PUT',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            status: 'documented',
            note: 'Unplanned service documented',
          }),
        },
      );
      expect(unplannedEvidenceResponse.status).toBe(200);
      const completeDocumentationDetail = (await unplannedEvidenceResponse.json()) as {
        documentation: { version: number; status: string };
        completeness: { isComplete: boolean; missing: unknown[] };
        services: Array<{
          performedServiceId: string;
          evidence: { id: string; note: string | null } | null;
        }>;
      };
      documentationVersion = completeDocumentationDetail.documentation.version;
      const unplannedEvidenceId = completeDocumentationDetail.services.find(
        (evidenceService) => evidenceService.performedServiceId === unplannedPerformedServiceId,
      )!.evidence!.id;
      expect(unplannedEvidenceId[14]).toBe('7');
      expect(completeDocumentationDetail).toMatchObject({
        completeness: { isComplete: true, missing: [] },
        documentation: { status: 'draft' },
      });
      expect(completeDocumentationDetail.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            performedServiceId: unplannedPerformedServiceId,
            evidence: expect.objectContaining({ note: 'Unplanned service documented' }),
          }),
        ]),
      );

      const finalizationRaceText = `private-finalization-race-${uuidv7()}`;
      const [racingFinalization, racingEdit] = await Promise.all([
        fetch(`${baseUrl}/api/v1/care-documentation/${documentationId}/finalize`, {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ expectedVersion: documentationVersion }),
        }),
        fetch(`${baseUrl}/api/v1/care-documentation/${documentationId}/entries`, {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            type: 'care_note',
            content: finalizationRaceText,
          }),
        }),
      ]);
      expect([racingFinalization.status, racingEdit.status].sort()).toEqual([200, 409]);
      let finalizedResponse = racingFinalization;
      if (racingFinalization.status === 409) {
        expect((await racingFinalization.json()).code).toBe('CARE_DOCUMENTATION_VERSION_CONFLICT');
        expect(racingEdit.status).toBe(200);
        const updatedDocumentation = (await racingEdit.json()) as {
          documentation: { version: number };
        };
        documentationVersion = updatedDocumentation.documentation.version;
        finalizedResponse = await fetch(
          `${baseUrl}/api/v1/care-documentation/${documentationId}/finalize`,
          {
            method: 'POST',
            headers: caregiverHeaders,
            body: JSON.stringify({ expectedVersion: documentationVersion }),
          },
        );
      } else {
        expect((await racingEdit.json()).code).toBe('CARE_DOCUMENTATION_ALREADY_FINALIZED');
      }
      expect(finalizedResponse.status).toBe(200);
      const finalizedDocumentation = (await finalizedResponse.json()) as {
        documentation: { id: string; status: string; version: number };
        completeness: { isComplete: boolean };
        entries: Array<{ id: string; content: string }>;
      };
      documentationVersion = finalizedDocumentation.documentation.version;
      expect(finalizedDocumentation).toMatchObject({
        documentation: { id: documentationId, status: 'finalized' },
        completeness: { isComplete: true },
      });

      const caregiverEditFinalizedDocumentation = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/entries/${observationEntryId}`,
        {
          method: 'PATCH',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: documentationVersion,
            content: 'Overwrite attempt',
          }),
        },
      );
      expect(caregiverEditFinalizedDocumentation.status).toBe(409);
      expect((await caregiverEditFinalizedDocumentation.json()).code).toBe(
        'CARE_DOCUMENTATION_ALREADY_FINALIZED',
      );
      const caregiverCannotAmendDocumentation = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/amendments`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ reason: 'Caregiver amendment', correction: 'Not authorized' }),
        },
      );
      expect(caregiverCannotAmendDocumentation.status).toBe(403);

      const officeDocumentationReview = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/documentation`,
        { headers: officeHeaders },
      );
      expect(officeDocumentationReview.status).toBe(200);
      expect(await officeDocumentationReview.json()).toMatchObject({
        documentation: { id: documentationId, status: 'finalized' },
        entries: expect.arrayContaining([
          expect.objectContaining({ content: sensitiveCareText }),
          expect.objectContaining({ content: sensitiveIncidentText }),
        ]),
      });

      const initialPackageResponse = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/evidence-package`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(initialPackageResponse.status).toBe(200);
      const initialPackage = (await initialPackageResponse.json()) as {
        id: string;
        version: number;
        snapshotHash: string;
        snapshot: { clientName: string; items: Array<{ performedServiceId: string }> };
        isCurrent: boolean;
        status: string;
        acknowledgements: Array<{ id: string; status: string }>;
      };
      expect(initialPackage).toMatchObject({ version: 1, isCurrent: true, status: 'ready' });
      expect(initialPackage.snapshot.items.length).toBeGreaterThan(0);
      const serializedEvidenceSnapshot = JSON.stringify(initialPackage.snapshot);
      expect(serializedEvidenceSnapshot).not.toContain('moderate');
      const repeatedPackageResponse = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/evidence-package`,
        { method: 'POST', headers: officeHeaders },
      );
      expect(repeatedPackageResponse.status).toBe(200);
      expect(await repeatedPackageResponse.json()).toMatchObject({
        id: initialPackage.id,
        version: initialPackage.version,
        snapshotHash: initialPackage.snapshotHash,
        isCurrent: true,
        status: 'ready',
      });

      const officeWorklistQuery = new URLSearchParams({
        from: executionRange.get('from')!,
        until: executionRange.get('until')!,
        visitId: executionVisit.id,
      });
      const initialWorklistResponse = await fetch(
        `${baseUrl}/api/v1/service-evidence?${officeWorklistQuery}`,
        { headers: officeHeaders },
      );
      expect(initialWorklistResponse.status).toBe(200);
      expect(await initialWorklistResponse.json()).toMatchObject({
        items: [
          expect.objectContaining({
            visitId: executionVisit.id,
            evidencePackageId: initialPackage.id,
            status: 'awaiting_acknowledgement',
          }),
        ],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      const secondWorklistPageQuery = new URLSearchParams({
        from: executionRange.get('from')!,
        until: executionRange.get('until')!,
        visitId: executionVisit.id,
        status: 'awaiting_acknowledgement',
        sort: 'status',
        sortOrder: 'asc',
        page: '2',
        pageSize: '1',
      });
      const secondWorklistPageResponse = await fetch(
        `${baseUrl}/api/v1/service-evidence?${secondWorklistPageQuery}`,
        { headers: officeHeaders },
      );
      expect(secondWorklistPageResponse.status).toBe(200);
      expect(await secondWorklistPageResponse.json()).toMatchObject({
        items: [],
        page: 2,
        pageSize: 1,
        total: 1,
      });

      const officeCannotCapture = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${initialPackage.id}/acknowledgement`,
        {
          method: 'POST',
          headers: officeHeaders,
          body: JSON.stringify({
            idempotencyKey: uuidv7(),
            signatory: { type: 'client' },
            method: 'typed_confirmation',
            confirmationName: initialPackage.snapshot.clientName,
          }),
        },
      );
      expect(officeCannotCapture.status).toBe(403);

      const unrelatedCaregiverPrepare = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/evidence-package`,
        { method: 'POST', headers: unrelatedCaregiverHeaders },
      );
      expect(unrelatedCaregiverPrepare.status).toBe(403);
      expect((await unrelatedCaregiverPrepare.json()).code).toBe(
        'SERVICE_EVIDENCE_VISIT_RELATIONSHIP_REQUIRED',
      );
      const crossTenantPackageRead = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${initialPackage.id}`,
        { headers: { ...caregiverHeaders, 'X-Tenant-Id': otherTenantId } },
      );
      expect(crossTenantPackageRead.status).toBe(403);

      const expiredRepresentativeCapture = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${initialPackage.id}/acknowledgement`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            idempotencyKey: uuidv7(),
            signatory: { type: 'representative', contactId: expiredRepresentative.id },
            method: 'typed_confirmation',
            confirmationName: 'Expired Representative',
          }),
        },
      );
      expect(expiredRepresentativeCapture.status).toBe(403);
      expect((await expiredRepresentativeCapture.json()).code).toBe(
        'ACKNOWLEDGEMENT_SIGNATORY_INVALID',
      );

      const clientAcknowledgementInput = {
        idempotencyKey: uuidv7(),
        signatory: { type: 'client' },
        method: 'typed_confirmation',
        confirmationName: initialPackage.snapshot.clientName,
      } as const;
      const concurrentClientAcknowledgements = await Promise.all(
        [0, 1].map(() =>
          fetch(`${baseUrl}/api/v1/evidence-packages/${initialPackage.id}/acknowledgement`, {
            method: 'POST',
            headers: caregiverHeaders,
            body: JSON.stringify(clientAcknowledgementInput),
          }),
        ),
      );
      expect(concurrentClientAcknowledgements.map((response) => response.status)).toEqual([
        200, 200,
      ]);
      const clientAcknowledgements = await Promise.all(
        concurrentClientAcknowledgements.map((response) => response.json()),
      );
      expect(clientAcknowledgements[0]).toMatchObject({
        status: 'acknowledged',
        signatoryType: 'client',
        method: 'typed_confirmation',
        evidencePackageHash: initialPackage.snapshotHash,
      });
      expect(clientAcknowledgements[1].id).toBe(clientAcknowledgements[0].id);

      const conflictingRetry = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${initialPackage.id}/acknowledgement`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            ...clientAcknowledgementInput,
            confirmationName: 'A different name',
          }),
        },
      );
      expect(conflictingRetry.status).toBe(400);
      expect((await conflictingRetry.json()).code).toBe('ACKNOWLEDGEMENT_IDEMPOTENCY_CONFLICT');
      const caregiverCannotRevoke = await fetch(
        `${baseUrl}/api/v1/acknowledgements/${clientAcknowledgements[0].id}/revoke`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({ reason: 'Not allowed' }),
        },
      );
      expect(caregiverCannotRevoke.status).toBe(403);

      const sensitiveAmendmentReason = `private-amendment-reason-${uuidv7()}`;
      const sensitiveAmendmentCorrection = `private-amendment-correction-${uuidv7()}`;
      const officeAmendment = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}/amendments`,
        {
          method: 'POST',
          headers: officeHeaders,
          body: JSON.stringify({
            reason: sensitiveAmendmentReason,
            correction: sensitiveAmendmentCorrection,
          }),
        },
      );
      expect(officeAmendment.status).toBe(200);
      const amendedDocumentation = (await officeAmendment.json()) as {
        documentation: { id: string; status: string; version: number };
        amendments: Array<{ id: string; reason: string; correction: string }>;
        history: Array<{ id: string; action: string; metadata: Record<string, unknown> }>;
      };
      expect(amendedDocumentation.amendments[0]?.id[14]).toBe('7');
      expect(amendedDocumentation.history.every((entry) => entry.id[14] === '7')).toBe(true);
      expect(amendedDocumentation).toMatchObject({
        documentation: { id: documentationId, status: 'finalized', version: documentationVersion },
        amendments: expect.arrayContaining([
          expect.objectContaining({
            reason: sensitiveAmendmentReason,
            correction: sensitiveAmendmentCorrection,
          }),
        ]),
      });
      const serializedDocumentationHistory = JSON.stringify(amendedDocumentation.history);
      expect(serializedDocumentationHistory).not.toContain(sensitiveCareText);
      expect(serializedDocumentationHistory).not.toContain(sensitiveIncidentText);
      expect(serializedDocumentationHistory).not.toContain(sensitiveEvidenceText);
      expect(serializedDocumentationHistory).not.toContain(sensitiveAmendmentReason);
      expect(serializedDocumentationHistory).not.toContain(sensitiveAmendmentCorrection);
      expect(serializedDocumentationHistory).not.toContain(finalizationRaceText);

      const concurrentAmendmentTexts = [
        {
          reason: `private-amendment-a-${uuidv7()}`,
          correction: `private-correction-a-${uuidv7()}`,
        },
        {
          reason: `private-amendment-b-${uuidv7()}`,
          correction: `private-correction-b-${uuidv7()}`,
        },
      ];
      const concurrentAmendmentResponses = await Promise.all(
        concurrentAmendmentTexts.map(({ reason, correction }) =>
          fetch(`${baseUrl}/api/v1/care-documentation/${documentationId}/amendments`, {
            method: 'POST',
            headers: officeHeaders,
            body: JSON.stringify({ reason, correction }),
          }),
        ),
      );
      expect(concurrentAmendmentResponses.map((response) => response.status)).toEqual([200, 200]);
      const concurrentAmendmentDetails = await Promise.all(
        concurrentAmendmentResponses.map((response) => response.json()),
      );
      for (const amendment of concurrentAmendmentTexts) {
        expect(JSON.stringify(concurrentAmendmentDetails)).toContain(amendment.reason);
        expect(JSON.stringify(concurrentAmendmentDetails)).toContain(amendment.correction);
      }
      const persistedAmendmentsResponse = await fetch(
        `${baseUrl}/api/v1/care-documentation/${documentationId}`,
        { headers: officeHeaders },
      );
      expect(persistedAmendmentsResponse.status).toBe(200);
      const persistedAmendments = (await persistedAmendmentsResponse.json()) as {
        amendments: Array<{ id: string; reason: string; correction: string; createdAt: string }>;
        history: Array<{ action: string }>;
      };
      expect(persistedAmendments.amendments).toHaveLength(3);
      for (const amendment of concurrentAmendmentTexts) {
        expect(JSON.stringify(persistedAmendments.amendments)).toContain(amendment.reason);
        expect(JSON.stringify(persistedAmendments.amendments)).toContain(amendment.correction);
      }
      const sensitiveNarrativeMarkers = [
        sensitiveCareText,
        sensitiveInvalidIncidentText,
        sensitiveIncidentText,
        draftNoteOriginalText,
        draftNoteUpdatedText,
        sensitiveEvidenceText,
        sensitiveUpdatedEvidenceText,
        finalizationRaceText,
        sensitiveAmendmentReason,
        sensitiveAmendmentCorrection,
        ...concurrentAmendmentTexts.flatMap(({ reason, correction }) => [reason, correction]),
      ];
      const persistedDocumentationHistory = JSON.stringify(persistedAmendments.history);
      for (const marker of sensitiveNarrativeMarkers) {
        expect(serializedDocumentationHistory).not.toContain(marker);
        expect(persistedDocumentationHistory).not.toContain(marker);
      }
      expect(persistedAmendments.amendments.map((amendment) => amendment.id)).toEqual(
        [...persistedAmendments.amendments]
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .map((amendment) => amendment.id),
      );
      expect(
        persistedAmendments.history.filter(
          (entry) => entry.action === 'care_documentation.amended',
        ),
      ).toHaveLength(3);

      const outdatedPackageResponse = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${initialPackage.id}`,
        { headers: officeHeaders },
      );
      expect(outdatedPackageResponse.status).toBe(200);
      expect(await outdatedPackageResponse.json()).toMatchObject({
        id: initialPackage.id,
        isCurrent: false,
        status: 'outdated',
        acknowledgements: [
          expect.objectContaining({
            id: clientAcknowledgements[0].id,
            status: 'acknowledged',
            evidencePackageHash: initialPackage.snapshotHash,
          }),
        ],
      });
      const staleAcknowledgement = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${initialPackage.id}/acknowledgement`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            ...clientAcknowledgementInput,
            idempotencyKey: uuidv7(),
          }),
        },
      );
      expect(staleAcknowledgement.status).toBe(409);
      expect((await staleAcknowledgement.json()).code).toBe('EVIDENCE_PACKAGE_STALE');

      const secondPackageResponse = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/evidence-package`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(secondPackageResponse.status).toBe(200);
      const secondPackage = (await secondPackageResponse.json()) as {
        id: string;
        version: number;
        snapshot: { clientName: string };
        isCurrent: boolean;
      };
      expect(secondPackage).toMatchObject({ version: 2, isCurrent: true });

      const raceAcknowledgementInput = {
        idempotencyKey: uuidv7(),
        signatory: { type: 'client' },
        method: 'typed_confirmation',
        confirmationName: secondPackage.snapshot.clientName,
      };
      const amendmentRaceReason = `amendment-race-${uuidv7()}`;
      const [racingAcknowledgement, racingAmendment] = await Promise.all([
        fetch(`${baseUrl}/api/v1/evidence-packages/${secondPackage.id}/acknowledgement`, {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify(raceAcknowledgementInput),
        }),
        fetch(`${baseUrl}/api/v1/care-documentation/${documentationId}/amendments`, {
          method: 'POST',
          headers: officeHeaders,
          body: JSON.stringify({
            reason: amendmentRaceReason,
            correction: `amendment-race-correction-${uuidv7()}`,
          }),
        }),
      ]);
      expect(racingAmendment.status).toBe(200);
      expect([200, 409]).toContain(racingAcknowledgement.status);
      if (racingAcknowledgement.status === 409) {
        expect((await racingAcknowledgement.json()).code).toBe('EVIDENCE_PACKAGE_STALE');
      }
      const racePackageRead = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${secondPackage.id}`,
        { headers: officeHeaders },
      );
      expect(racePackageRead.status).toBe(200);
      expect(await racePackageRead.json()).toMatchObject({
        isCurrent: false,
        status: 'outdated',
      });

      const replacementPackageResponse = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/evidence-package`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(replacementPackageResponse.status).toBe(200);
      const replacementPackage = (await replacementPackageResponse.json()) as {
        id: string;
        version: number;
        snapshot: { clientName: string };
        isCurrent: boolean;
      };
      expect(replacementPackage).toMatchObject({ version: 3, isCurrent: true });

      const representativeAcknowledgementResponse = await fetch(
        `${baseUrl}/api/v1/evidence-packages/${replacementPackage.id}/acknowledgement`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            idempotencyKey: uuidv7(),
            signatory: { type: 'representative', contactId: eligibleRepresentative.id },
            method: 'typed_confirmation',
            confirmationName: 'Eligible Representative',
          }),
        },
      );
      expect(representativeAcknowledgementResponse.status).toBe(200);
      const representativeAcknowledgement = await representativeAcknowledgementResponse.json();
      expect(representativeAcknowledgement).toMatchObject({
        status: 'acknowledged',
        signatoryType: 'representative',
        signatoryName: 'Eligible Representative',
        capacity: 'authorized_representative',
        signatoryContactId: eligibleRepresentative.id,
      });
      const representativeAcknowledgementId = representativeAcknowledgement.id as string;
      const officeRevocation = await fetch(
        `${baseUrl}/api/v1/acknowledgements/${representativeAcknowledgementId}/revoke`,
        {
          method: 'POST',
          headers: officeHeaders,
          body: JSON.stringify({ reason: 'API integration revocation' }),
        },
      );
      expect(officeRevocation.status).toBe(200);
      expect(await officeRevocation.json()).toMatchObject({
        id: representativeAcknowledgementId,
        status: 'revoked',
        revocationReason: 'API integration revocation',
      });

      const competingAcknowledgement = fetch(
        `${baseUrl}/api/v1/evidence-packages/${replacementPackage.id}/acknowledgement`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            idempotencyKey: uuidv7(),
            signatory: { type: 'client' },
            method: 'typed_confirmation',
            confirmationName: replacementPackage.snapshot.clientName,
          }),
        },
      );
      const competingDecline = fetch(
        `${baseUrl}/api/v1/evidence-packages/${replacementPackage.id}/decline`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            idempotencyKey: uuidv7(),
            signatory: { type: 'client' },
            reasonCode: 'disagrees_with_record',
            note: 'Concurrent acknowledgement and decline',
          }),
        },
      );
      const acknowledgementDeclineRace = await Promise.all([
        competingAcknowledgement,
        competingDecline,
      ]);
      const raceStatuses = acknowledgementDeclineRace.map((response) => response.status);
      expect(raceStatuses.filter((status) => status === 200)).toHaveLength(1);
      expect(raceStatuses.filter((status) => status === 409)).toHaveLength(1);
      const losingOutcome = acknowledgementDeclineRace[raceStatuses.indexOf(409)]!;
      expect((await losingOutcome.json()).code).toBe('ACKNOWLEDGEMENT_ALREADY_EXISTS');

      const completedDocumentationWorklist = await fetch(
        `${baseUrl}/api/v1/care-documentation?${new URLSearchParams({
          from: executionRange.get('from')!,
          until: executionRange.get('until')!,
          facilityId: secondFacilityId,
          employeeId: schedulingEmployee.id,
          status: 'finalized',
          incomplete: 'false',
        })}`,
        { headers: officeHeaders },
      );
      expect(completedDocumentationWorklist.status).toBe(200);
      expect(await completedDocumentationWorklist.json()).toMatchObject({
        items: [
          expect.objectContaining({ visitId: executionVisit.id, documentationId, missing: [] }),
        ],
      });

      const caregiverCannotCorrect = await fetch(
        `${baseUrl}/api/v1/visit-executions/${executionId}/correct-times`,
        {
          method: 'POST',
          headers: caregiverHeaders,
          body: JSON.stringify({
            expectedVersion: 4,
            actualStart: new Date(
              Date.parse(completedDetail.execution.actualStart) - 60_000,
            ).toISOString(),
            reason: 'Correcting an entry mistake',
          }),
        },
      );
      expect(caregiverCannotCorrect.status).toBe(403);
      const correctedStart = new Date(
        Date.parse(completedDetail.execution.actualStart) - 60_000,
      ).toISOString();
      const correctExecutionTime = await fetch(
        `${baseUrl}/api/v1/visit-executions/${executionId}/correct-times`,
        {
          method: 'POST',
          headers: officeHeaders,
          body: JSON.stringify({
            expectedVersion: 4,
            actualStart: correctedStart,
            reason: 'Correcting an entry mistake',
          }),
        },
      );
      expect(correctExecutionTime.status).toBe(200);
      expect(await correctExecutionTime.json()).toMatchObject({ version: 5 });

      const officeExecutionRead = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution`,
        { headers: officeHeaders },
      );
      expect(officeExecutionRead.status).toBe(200);
      expect(await officeExecutionRead.json()).toMatchObject({
        execution: { id: executionId, status: 'completed', actualStart: correctedStart },
      });
      const officeExecutionSummary = await fetch(executionSummaryUrl, { headers: officeHeaders });
      expect(officeExecutionSummary.status).toBe(200);
      expect(await officeExecutionSummary.json()).toEqual([
        {
          visitId: executionVisit.id,
          executionStatus: 'completed',
          actualStart: correctedStart,
          actualEnd: completedDetail.execution.actualEnd,
        },
      ]);
      const officeCannotRecordService = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution/services/${performedServiceId}`,
        {
          method: 'PUT',
          headers: officeHeaders,
          body: JSON.stringify({
            expectedVersion: 5,
            visitServiceId,
            status: 'performed',
            actualQuantity: '1.000',
          }),
        },
      );
      expect(officeCannotRecordService.status).toBe(403);

      const visitHistoryResponse = await fetch(`${baseUrl}/api/v1/visits/${executionVisit.id}`, {
        headers: officeHeaders,
      });
      expect(visitHistoryResponse.status).toBe(200);
      const visitHistory = (await visitHistoryResponse.json()) as {
        history: Array<{ action: string; actorId: string }>;
      };
      expect(visitHistory.history.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'visit_execution.started',
          'performed_service.recorded',
          'performed_service.added_unplanned',
          'visit_execution.completed',
          'visit_execution.times_corrected',
        ]),
      );
      expect(visitHistory.history.every((entry) => Boolean(entry.actorId))).toBe(true);

      const executionTimelineResponse = await fetch(
        `${baseUrl}/api/v1/clients/${executionClient.id}/timeline`,
        { headers: officeHeaders },
      );
      expect(executionTimelineResponse.status).toBe(200);
      const executionTimeline = (await executionTimelineResponse.json()) as Array<{
        action: string;
        actorId: string;
      }>;
      expect(executionTimeline.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'visit_execution.started',
          'visit_execution.completed',
          'incident.recorded',
          'care_documentation.finalized',
          'care_documentation.amended',
        ]),
      );
      expect(executionTimeline.every((entry) => entry.actorId && entry.action)).toBe(true);
      expect(
        executionTimeline.some((entry) =>
          [
            'care_documentation.created',
            'care_documentation.entry_added',
            'care_documentation.entry_updated',
            'care_documentation.entry_removed',
            'service_evidence.recorded',
            'service_evidence.updated',
          ].includes(entry.action),
        ),
      ).toBe(false);
      const serializedExecutionTimeline = JSON.stringify(executionTimeline);
      expect(serializedExecutionTimeline).not.toContain(sensitiveCareText);
      expect(serializedExecutionTimeline).not.toContain(sensitiveIncidentText);
      expect(serializedExecutionTimeline).not.toContain(sensitiveEvidenceText);
      expect(serializedExecutionTimeline).not.toContain(sensitiveAmendmentReason);
      expect(serializedExecutionTimeline).not.toContain(sensitiveAmendmentCorrection);
      expect(serializedExecutionTimeline).not.toContain(finalizationRaceText);
      for (const amendment of concurrentAmendmentTexts) {
        expect(serializedExecutionTimeline).not.toContain(amendment.reason);
        expect(serializedExecutionTimeline).not.toContain(amendment.correction);
      }
      for (const marker of sensitiveNarrativeMarkers) {
        expect(serializedExecutionTimeline).not.toContain(marker);
      }

      const documentationAudit = await owner.query<{ action: string; metadata: string }>(
        `SELECT action, metadata::text AS metadata FROM audit.audit_entries
         WHERE tenant_id = $1 AND metadata->>'documentationId' = $2
         ORDER BY timestamp, id`,
        [tenantId, documentationId],
      );
      expect(documentationAudit.rows.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'care_documentation.created',
          'care_documentation.entry_added',
          'care_documentation.entry_updated',
          'care_documentation.entry_removed',
          'incident.recorded',
          'service_evidence.recorded',
          'service_evidence.updated',
          'care_documentation.finalized',
          'care_documentation.amended',
        ]),
      );
      const serializedDocumentationAudit = JSON.stringify(documentationAudit.rows);
      expect(serializedDocumentationAudit).not.toContain(sensitiveCareText);
      expect(serializedDocumentationAudit).not.toContain(sensitiveIncidentText);
      expect(serializedDocumentationAudit).not.toContain(sensitiveEvidenceText);
      expect(serializedDocumentationAudit).not.toContain(sensitiveAmendmentReason);
      expect(serializedDocumentationAudit).not.toContain(sensitiveAmendmentCorrection);
      expect(serializedDocumentationAudit).not.toContain(finalizationRaceText);
      for (const amendment of concurrentAmendmentTexts) {
        expect(serializedDocumentationAudit).not.toContain(amendment.reason);
        expect(serializedDocumentationAudit).not.toContain(amendment.correction);
      }
      for (const marker of sensitiveNarrativeMarkers) {
        expect(serializedDocumentationAudit).not.toContain(marker);
      }
      const documentationEvents = await owner.query<{ event: string }>(
        `SELECT event::text AS event FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event->>'aggregateId' = $2`,
        [tenantId, documentationId],
      );
      const parsedDocumentationEvents = documentationEvents.rows.map(
        ({ event }) => JSON.parse(event) as { id: string; type: string; version: number },
      );
      expect(parsedDocumentationEvents.every((event) => event.id[14] === '7')).toBe(true);
      expect(parsedDocumentationEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'care_documentation.created',
          'care_documentation.entry_added',
          'care_documentation.entry_updated',
          'care_documentation.entry_removed',
          'incident.recorded',
          'service_evidence.recorded',
          'service_evidence.updated',
          'care_documentation.finalized',
          'care_documentation.amended',
        ]),
      );
      expect(parsedDocumentationEvents.every((event) => event.version === 1)).toBe(true);
      const serializedDocumentationEvents = JSON.stringify(parsedDocumentationEvents);
      expect(serializedDocumentationEvents).not.toContain(sensitiveCareText);
      expect(serializedDocumentationEvents).not.toContain(sensitiveIncidentText);
      expect(serializedDocumentationEvents).not.toContain(sensitiveEvidenceText);
      expect(serializedDocumentationEvents).not.toContain(sensitiveAmendmentReason);
      expect(serializedDocumentationEvents).not.toContain(sensitiveAmendmentCorrection);
      expect(serializedDocumentationEvents).not.toContain(finalizationRaceText);
      for (const amendment of concurrentAmendmentTexts) {
        expect(serializedDocumentationEvents).not.toContain(amendment.reason);
        expect(serializedDocumentationEvents).not.toContain(amendment.correction);
      }
      for (const marker of sensitiveNarrativeMarkers) {
        expect(serializedDocumentationEvents).not.toContain(marker);
      }

      await expect(
        owner.query('UPDATE care_documentation.documents SET updated_at = now() WHERE id = $1', [
          documentationId,
        ]),
      ).rejects.toThrow();
      await expect(
        owner.query('DELETE FROM care_documentation.history WHERE documentation_id = $1', [
          documentationId,
        ]),
      ).rejects.toThrow();
      const executionAudit = await owner.query<{ action: string; metadata: string }>(
        `SELECT action, metadata::text AS metadata FROM audit.audit_entries
         WHERE tenant_id = $1 AND (resource_id = $2 OR metadata->>'executionId' = $3)
         ORDER BY timestamp, id`,
        [tenantId, executionClient.id, executionId],
      );
      expect(executionAudit.rows.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'visit_execution.started',
          'performed_service.recorded',
          'performed_service.added_unplanned',
          'visit_execution.completed',
          'visit_execution.times_corrected',
        ]),
      );
      const executionEvents = await owner.query<{ event: string }>(
        `SELECT event::text AS event FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event->>'aggregateId' = $2`,
        [tenantId, executionId],
      );
      const parsedExecutionEvents = executionEvents.rows.map(
        ({ event }) => JSON.parse(event) as { type: string; version: number },
      );
      expect(parsedExecutionEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'visit_execution.started',
          'performed_service.recorded',
          'performed_service.unplanned_added',
          'visit_execution.completed',
          'visit_execution.corrected',
        ]),
      );
      expect(parsedExecutionEvents.every((event) => event.version === 1)).toBe(true);

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      const documentationRlsTables = [
        ['documents', 'id'],
        ['entries', 'documentation_id'],
        ['service_evidence', 'documentation_id'],
        ['amendments', 'documentation_id'],
        ['history', 'documentation_id'],
      ] as const;
      expect(
        (
          await appRole.query('SELECT id FROM visit_execution.executions WHERE id = $1', [
            executionId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await appRole.query(
            'SELECT id FROM visit_execution.performed_services WHERE execution_id = $1',
            [executionId],
          )
        ).rowCount,
      ).toBe(0);
      await appRole.query('SAVEPOINT before_documentation_cross_tenant_write');
      await expect(
        appRole.query(
          `INSERT INTO care_documentation.history
             (id, tenant_id, documentation_id, actor_user_id, action, metadata, occurred_at)
           VALUES ($1, $2, $3, $4, 'care_documentation.test', '{}'::jsonb, now())`,
          [uuidv7(), tenantId, documentationId, userId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await appRole.query('ROLLBACK TO SAVEPOINT before_documentation_cross_tenant_write');
      for (const [table, referenceColumn] of documentationRlsTables) {
        // oxlint-disable no-await-in-loop -- Keep the table assertions ordered within the transaction.
        expect(
          (
            await appRole.query(
              `SELECT id FROM care_documentation.${table}
               WHERE ${referenceColumn} = $1`,
              [documentationId],
            )
          ).rowCount,
        ).toBe(0);
        // oxlint-enable no-await-in-loop
      }
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      expect(
        (
          await appRole.query('SELECT id FROM visit_execution.executions WHERE id = $1', [
            executionId,
          ])
        ).rowCount,
      ).toBe(1);
      for (const [table, referenceColumn] of documentationRlsTables) {
        // oxlint-disable no-await-in-loop -- Keep the table assertions ordered within the transaction.
        expect(
          (
            await appRole.query(
              `SELECT id FROM care_documentation.${table}
               WHERE ${referenceColumn} = $1`,
              [documentationId],
            )
          ).rowCount,
        ).toBeGreaterThan(0);
        // oxlint-enable no-await-in-loop
      }
      await appRole.query('COMMIT');

      const archivedAfterEnd = await fetch(`${baseUrl}/api/v1/services/${service.id}/archive`, {
        method: 'POST',
        headers,
      });
      expect(archivedAfterEnd.status).toBe(200);
      const executionAfterServiceArchive = await fetch(
        `${baseUrl}/api/v1/visits/${executionVisit.id}/execution`,
        { headers: caregiverHeaders },
      );
      expect(executionAfterServiceArchive.status).toBe(200);
      const historicalExecution = (await executionAfterServiceArchive.json()) as {
        services: Array<{ serviceDefinitionId: string; serviceCode: string; serviceName: string }>;
      };
      expect(historicalExecution.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            serviceDefinitionId: service.id,
            serviceCode: expect.any(String),
            serviceName: 'Morning care updated',
          }),
        ]),
      );
      const crossTenantExecutionInsert = owner.query(
        `INSERT INTO visit_execution.executions
           (id, tenant_id, visit_id, status, actual_start, started_by_employee_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'in_progress', now(), $4, now(), now())`,
        [uuidv7(), otherTenantId, executionVisit.id, schedulingEmployee.id],
      );
      await expect(crossTenantExecutionInsert).rejects.toThrow();
      const futureAgreementResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/service-agreements`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ validFrom: '2000-01-01' }),
        },
      );
      expect(futureAgreementResponse.status).toBe(201);
      const futureAgreement = (await futureAgreementResponse.json()) as { id: string };
      const archivedServiceAssignment = await fetch(
        `${baseUrl}/api/v1/service-agreements/${futureAgreement.id}/services`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ serviceDefinitionId: service.id }),
        },
      );
      expect(archivedServiceAssignment.status).toBe(409);
      expect((await archivedServiceAssignment.json()).code).toBe('SERVICE_ARCHIVED');
      expect(
        (
          await fetch(`${baseUrl}/api/v1/service-agreements/${futureAgreement.id}/end`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(200);

      const agreementTimelineResponse = await fetch(
        `${baseUrl}/api/v1/clients/${created.id}/timeline`,
        { headers },
      );
      expect(agreementTimelineResponse.status).toBe(200);
      const agreementTimeline = (await agreementTimelineResponse.json()) as Array<{
        action: string;
        actorId: string;
        occurredAt: string;
      }>;
      const agreementEntries = agreementTimeline.filter((entry) =>
        entry.action.startsWith('service_agreement.'),
      );
      const agreementActions = agreementEntries.map((entry) => entry.action);
      const expectedAgreementActions = [
        'service_agreement.created',
        'service_agreement.service_added',
        'service_agreement.service_updated',
        'service_agreement.service_ended',
        'service_agreement.activated',
        'service_agreement.suspended',
        'service_agreement.resumed',
        'service_agreement.ended',
      ];
      expect(agreementActions).toEqual(expect.arrayContaining(expectedAgreementActions));
      expect(agreementActions.indexOf('service_agreement.created')).toBeLessThan(
        agreementActions.indexOf('service_agreement.service_added'),
      );
      expect(agreementActions.indexOf('service_agreement.service_updated')).toBeLessThan(
        agreementActions.indexOf('service_agreement.activated'),
      );
      const timelineTimestamps = agreementTimeline.map((entry) => Date.parse(entry.occurredAt));
      expect(timelineTimestamps).toEqual(
        [...timelineTimestamps].sort((left, right) => left - right),
      );
      expect(agreementEntries.every((entry) => entry.actorId && entry.action)).toBe(true);
      expect(JSON.stringify(agreementTimeline)).not.toContain(agreementNote);

      const agreementAudit = await owner.query<{ action: string; metadata: string }>(
        `SELECT action, metadata::text AS metadata FROM audit.audit_entries
         WHERE tenant_id = $1 AND resource_type = 'service_agreement' AND resource_id = $2
         ORDER BY timestamp, id`,
        [tenantId, agreement.id],
      );
      const agreementEvents = await owner.query<{ event: string }>(
        `SELECT event::text AS event FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event ->> 'aggregateId' = $2`,
        [tenantId, agreement.id],
      );
      expect(agreementAudit.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'service_agreement.created',
          'service_agreement.service_added',
          'service_agreement.service_updated',
          'service_agreement.service_ended',
          'service_agreement.activated',
          'service_agreement.suspended',
          'service_agreement.resumed',
          'service_agreement.ended',
        ]),
      );
      const agreementAuditActions = agreementAudit.rows.map((row) => row.action);
      expect(agreementAuditActions.indexOf('service_agreement.service_ended')).toBeLessThan(
        agreementAuditActions.indexOf('service_agreement.ended'),
      );
      expect(JSON.stringify(agreementAudit.rows)).not.toContain(agreementNote);
      expect(JSON.stringify(agreementEvents.rows)).not.toContain(agreementNote);
      const parsedAgreementEvents = agreementEvents.rows.map(
        ({ event }) => JSON.parse(event) as { type: string; version: number },
      );
      expect(parsedAgreementEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'service_agreement.created',
          'service_agreement.service_added',
          'service_agreement.service_changed',
          'service_agreement.service_ended',
          'service_agreement.activated',
          'service_agreement.suspended',
          'service_agreement.resumed',
          'service_agreement.ended',
        ]),
      );
      expect(parsedAgreementEvents.every((event) => event.version === 1)).toBe(true);

      const archived = await fetch(`${baseUrl}/api/v1/clients/${created.id}/archive`, {
        method: 'POST',
        headers,
      });
      expect(archived.status).toBe(200);
      expect(((await archived.json()) as { status: string }).status).toBe('archived');

      const invalidTransition = await fetch(`${baseUrl}/api/v1/clients/${created.id}/activate`, {
        method: 'POST',
        headers,
      });
      expect(invalidTransition.status).toBe(409);

      const audit = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = $2',
        [tenantId, created.id],
      );
      const events = await owner.query<{ count: string }>(
        "SELECT count(*) FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = $2",
        [tenantId, created.id],
      );
      expect(Number(audit.rows[0]?.count)).toBeGreaterThanOrEqual(10);
      expect(Number(events.rows[0]?.count)).toBeGreaterThanOrEqual(10);

      const pendingIds = await outbox.pendingIds();
      expect(pendingIds.length).toBeGreaterThanOrEqual(4);
      const firstAttempt = await outbox.claim(pendingIds[0]!, 'integration-worker', {
        maxAttempts: 2,
      });
      expect(firstAttempt?.attemptCount).toBe(1);
      await outbox.markFailed(firstAttempt!, new Error('temporary failure'), 2);
      const retryState = await owner.query<{
        status: string;
        attempt_count: number;
        last_error: string;
      }>('SELECT status, attempt_count, last_error FROM platform.outbox_messages WHERE id = $1', [
        firstAttempt!.id,
      ]);
      expect(retryState.rows[0]).toMatchObject({
        status: 'pending',
        attempt_count: 1,
        last_error: 'Error',
      });

      const retry = await outbox.claim(firstAttempt!.id, 'integration-worker-retry', {
        now: new Date(Date.now() + 120_000),
        maxAttempts: 2,
      });
      expect(retry?.attemptCount).toBe(2);
      if (!retry) throw new Error('Outbox retry was not claimable');
      await outbox.markDelivered(retry);
      expect(
        await outbox.claim(retry.id, 'integration-worker-late', {
          now: new Date(Date.now() + 120_000),
          maxAttempts: 2,
        }),
      ).toBeNull();

      const listMembers = await fetch(`${baseUrl}/api/v1/admin/members`, { headers });
      expect(listMembers.status).toBe(200);
      const listedMembers = (await listMembers.json()) as {
        items: Array<{ id: string; email: string | null; status: string }>;
      };
      expect(listedMembers.items.some((member) => member.email === 'admin@integration.test')).toBe(
        true,
      );

      const listRoles = await fetch(`${baseUrl}/api/v1/admin/roles`, { headers });
      expect(listRoles.status).toBe(200);
      const listedRoles = (await listRoles.json()) as Array<{
        name: string;
        permissions: string[];
      }>;
      expect(listedRoles.map((role) => role.name)).toEqual(
        expect.arrayContaining(['Integration Admin', 'Office', 'Caregiver']),
      );

      const organizations = await fetch(`${baseUrl}/api/v1/organizations`, { headers });
      expect(organizations.status).toBe(200);
      expect(await organizations.json()).toEqual([
        expect.objectContaining({ id: organizationId, tenantId }),
        expect.objectContaining({ id: secondOrganizationId, tenantId }),
      ]);
      const crossTenantOrganization = await fetch(
        `${baseUrl}/api/v1/organizations/${otherOrganizationId}`,
        { headers },
      );
      expect(crossTenantOrganization.status).toBe(404);
      const crossTenantFacility = await fetch(`${baseUrl}/api/v1/facilities/${otherFacilityId}`, {
        headers,
      });
      expect(crossTenantFacility.status).toBe(404);

      const workforceOrganizationResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Workforce Integration Organization', code: 'WFO' }),
      });
      expect(workforceOrganizationResponse.status).toBe(201);
      const workforceOrganization = (await workforceOrganizationResponse.json()) as {
        id: string;
        status: string;
      };
      expect(workforceOrganization.status).toBe('active');
      const organizationIdLookup = await fetch(
        `${baseUrl}/api/v1/organizations/search?ids=${workforceOrganization.id},${otherOrganizationId}&page=1&pageSize=1`,
        { headers },
      );
      expect(organizationIdLookup.status).toBe(200);
      expect(await organizationIdLookup.json()).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 1,
        items: [expect.objectContaining({ id: workforceOrganization.id })],
      });
      const updateWorkforceOrganization = await fetch(
        `${baseUrl}/api/v1/organizations/${workforceOrganization.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ legalName: 'Workforce Integration GmbH' }),
        },
      );
      expect(updateWorkforceOrganization.status).toBe(200);

      const createWorkforceFacility = async (name: string) => {
        const response = await fetch(`${baseUrl}/api/v1/facilities`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ organizationId: workforceOrganization.id, name }),
        });
        expect(response.status).toBe(201);
        return (await response.json()) as { id: string; status: string };
      };
      const workforceFacilityA = await createWorkforceFacility('Workforce Facility A');
      const workforceFacilityB = await createWorkforceFacility('Workforce Facility B');
      const updateWorkforceFacility = await fetch(
        `${baseUrl}/api/v1/facilities/${workforceFacilityA.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ phone: '+49 30 99' }) },
      );
      expect(updateWorkforceFacility.status).toBe(200);
      const invalidFacilityUpdate = await fetch(`${baseUrl}/api/v1/teams`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId: workforceOrganization.id,
          facilityId: otherFacilityId,
          name: 'Cross Tenant Team',
        }),
      });
      expect(invalidFacilityUpdate.status).toBe(404);

      const workforceTeamResponse = await fetch(`${baseUrl}/api/v1/teams`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId: workforceOrganization.id,
          facilityId: workforceFacilityA.id,
          name: 'Workforce Team',
        }),
      });
      expect(workforceTeamResponse.status).toBe(201);
      const workforceTeam = (await workforceTeamResponse.json()) as { id: string; status: string };
      expect(workforceTeam.status).toBe('active');
      const teamIdLookup = await fetch(
        `${baseUrl}/api/v1/teams/search?ids=${workforceTeam.id}&page=1&pageSize=1`,
        { headers },
      );
      expect(teamIdLookup.status).toBe(200);
      expect(await teamIdLookup.json()).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 1,
        items: [expect.objectContaining({ id: workforceTeam.id })],
      });
      const updateWorkforceTeam = await fetch(`${baseUrl}/api/v1/teams/${workforceTeam.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Workforce Team Updated' }),
      });
      expect(updateWorkforceTeam.status).toBe(200);

      const qualificationResponse = await fetch(`${baseUrl}/api/v1/qualifications`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Integration Qualification', code: 'INT-Q' }),
      });
      expect(qualificationResponse.status).toBe(201);
      const qualification = (await qualificationResponse.json()) as { id: string; status: string };
      const skillResponse = await fetch(`${baseUrl}/api/v1/skills`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Integration Skill', code: 'INT-S' }),
      });
      expect(skillResponse.status).toBe(201);
      const skill = (await skillResponse.json()) as { id: string; status: string };

      const workforceEmployeeResponse = await fetch(`${baseUrl}/api/v1/employees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId: workforceOrganization.id,
          firstName: 'Ava',
          lastName: 'ScopeOne',
          preferredName: 'Ava',
          personnelNumber: 'WF-100',
          employmentType: 'employee',
          startDate: '2026-01-01',
          weeklyHours: 32,
        }),
      });
      expect(workforceEmployeeResponse.status).toBe(201);
      const workforceEmployee = (await workforceEmployeeResponse.json()) as {
        id: string;
        status: string;
      };
      const otherWorkforceEmployeeResponse = await fetch(`${baseUrl}/api/v1/employees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organizationId: workforceOrganization.id,
          firstName: 'Bea',
          lastName: 'ScopeTwo',
          personnelNumber: 'WF-101',
        }),
      });
      expect(otherWorkforceEmployeeResponse.status).toBe(201);
      const otherWorkforceEmployee = (await otherWorkforceEmployeeResponse.json()) as {
        id: string;
      };

      const updatedEmployeeResponse = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ phone: '+49 30 123' }) },
      );
      expect(updatedEmployeeResponse.status).toBe(200);
      const assignFacilityA = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/facilities/${workforceFacilityA.id}`,
        { method: 'PUT', headers, body: JSON.stringify({ isPrimary: true }) },
      );
      expect(assignFacilityA.status).toBe(200);
      const assignFacilityB = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/facilities/${workforceFacilityB.id}`,
        { method: 'PUT', headers, body: JSON.stringify({}) },
      );
      expect(assignFacilityB.status).toBe(200);
      const assignOtherEmployeeFacility = await fetch(
        `${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}/facilities/${workforceFacilityB.id}`,
        { method: 'PUT', headers, body: JSON.stringify({}) },
      );
      expect(assignOtherEmployeeFacility.status).toBe(200);
      const crossTenantEmployeeFacility = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/facilities/${otherFacilityId}`,
        { method: 'PUT', headers, body: JSON.stringify({}) },
      );
      expect((await crossTenantEmployeeFacility.json()).code).toBe('INVALID_FACILITY_ASSIGNMENT');

      const assignTeam = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/teams/${workforceTeam.id}`,
        { method: 'PUT', headers, body: JSON.stringify({ role: 'Team lead' }) },
      );
      expect(assignTeam.status).toBe(200);
      const addQualification = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/qualifications/${qualification.id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ validFrom: '2026-01-01', issuer: 'Test' }),
        },
      );
      expect(addQualification.status).toBe(200);
      const addSkill = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/skills/${skill.id}`,
        { method: 'PUT', headers },
      );
      expect(addSkill.status).toBe(200);
      const addTransientQualification = await fetch(
        `${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}/qualifications/${qualification.id}`,
        { method: 'PUT', headers, body: JSON.stringify({}) },
      );
      expect(addTransientQualification.status).toBe(200);
      const removeQualification = await fetch(
        `${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}/qualifications/${qualification.id}`,
        { method: 'DELETE', headers },
      );
      expect(removeQualification.status).toBe(200);
      const addTransientSkill = await fetch(
        `${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}/skills/${skill.id}`,
        { method: 'PUT', headers },
      );
      expect(addTransientSkill.status).toBe(200);
      const removeSkill = await fetch(
        `${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}/skills/${skill.id}`,
        { method: 'DELETE', headers },
      );
      expect(removeSkill.status).toBe(200);
      const updateQualification = await fetch(
        `${baseUrl}/api/v1/qualifications/${qualification.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ description: 'Updated qualification' }),
        },
      );
      expect(updateQualification.status).toBe(200);
      const updateSkill = await fetch(`${baseUrl}/api/v1/skills/${skill.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ description: 'Updated skill' }),
      });
      expect(updateSkill.status).toBe(200);
      const linkUser = await fetch(`${baseUrl}/api/v1/employees/${workforceEmployee.id}/user`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ userId: secondUserId }),
      });
      expect(linkUser.status).toBe(200);
      const linkedEmployee = (await linkUser.json()) as {
        linkedUser: { id: string; membershipStatus: string } | null;
      };
      expect(linkedEmployee.linkedUser).toMatchObject({
        id: secondUserId,
        membershipStatus: 'active',
      });
      const duplicateUserLink = await fetch(
        `${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}/user`,
        { method: 'PUT', headers, body: JSON.stringify({ userId: secondUserId }) },
      );
      expect((await duplicateUserLink.json()).code).toBe('USER_ALREADY_LINKED');
      const conflictingEmployeeLink = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/user`,
        { method: 'PUT', headers, body: JSON.stringify({ userId }) },
      );
      expect((await conflictingEmployeeLink.json()).code).toBe('EMPLOYEE_ALREADY_LINKED');

      const searchEmployees = await fetch(
        `${baseUrl}/api/v1/employees?q=Ava&organizationId=${workforceOrganization.id}&facilityId=${workforceFacilityA.id}&teamId=${workforceTeam.id}&page=1&pageSize=1&sortBy=lastName&sortOrder=asc`,
        { headers },
      );
      expect(searchEmployees.status).toBe(200);
      expect(await searchEmployees.json()).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 1,
        items: [expect.objectContaining({ id: workforceEmployee.id, firstName: 'Ava' })],
      });

      const workforceOfficeToken = await issueToken(secondSubject);
      const workforceOfficeHeaders = {
        ...headers,
        Authorization: `Bearer ${workforceOfficeToken}`,
      };
      const setOfficeFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            scopes: [{ scopeType: 'facility', scopeId: workforceFacilityA.id }],
          }),
        },
      );
      expect(setOfficeFacilityScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/employees/${workforceEmployee.id}`, {
            headers: workforceOfficeHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}`, {
            headers: workforceOfficeHeaders,
          })
        ).status,
      ).toBe(403);
      const setOfficeTeamScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'team', scopeId: workforceTeam.id }] }),
        },
      );
      expect(setOfficeTeamScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/employees/${workforceEmployee.id}`, {
            headers: workforceOfficeHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}`, {
            headers: workforceOfficeHeaders,
          })
        ).status,
      ).toBe(403);
      const setOfficeOrganizationScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            scopes: [{ scopeType: 'organization', scopeId: workforceOrganization.id }],
          }),
        },
      );
      expect(setOfficeOrganizationScope.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/employees/${otherWorkforceEmployee.id}`, {
            headers: workforceOfficeHeaders,
          })
        ).status,
      ).toBe(200);
      const officeCannotCreateOrganization = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: workforceOfficeHeaders,
        body: JSON.stringify({ name: 'Office cannot create organization' }),
      });
      expect(officeCannotCreateOrganization.status).toBe(403);
      const officeCannotArchiveEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/archive`,
        { method: 'POST', headers: workforceOfficeHeaders },
      );
      expect(officeCannotArchiveEmployee.status).toBe(403);
      const caregiverCannotReadEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}`,
        { headers: { ...headers, Authorization: `Bearer ${await issueToken(caregiverSubject)}` } },
      );
      expect(caregiverCannotReadEmployee.status).toBe(403);
      const unassignTeam = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/teams/${workforceTeam.id}`,
        { method: 'DELETE', headers },
      );
      expect(unassignTeam.status).toBe(200);

      const removeUserLink = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/user`,
        {
          method: 'DELETE',
          headers,
        },
      );
      expect(removeUserLink.status).toBe(200);
      const unassignPrimaryFacility = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/facilities/${workforceFacilityA.id}`,
        { method: 'DELETE', headers },
      );
      expect(unassignPrimaryFacility.status).toBe(200);
      const promotedFacility = (await unassignPrimaryFacility.json()) as {
        facilityAssignments: Array<{ facilityId: string; isPrimary: boolean; status: string }>;
      };
      expect(
        promotedFacility.facilityAssignments.filter(
          (facilityAssignment) => facilityAssignment.status === 'active',
        ),
      ).toEqual([
        expect.objectContaining({
          facilityId: workforceFacilityB.id,
          isPrimary: true,
          status: 'active',
        }),
      ]);
      expect(promotedFacility.facilityAssignments).toContainEqual(
        expect.objectContaining({ facilityId: workforceFacilityA.id, status: 'inactive' }),
      );
      const deactivateEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/deactivate`,
        { method: 'POST', headers },
      );
      expect((await deactivateEmployee.json()).status).toBe('inactive');
      const activateEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/activate`,
        { method: 'POST', headers },
      );
      expect((await activateEmployee.json()).status).toBe('active');
      const archiveEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await archiveEmployee.json()).status).toBe('archived');
      const archivedEmployeeCannotReactivate = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}/activate`,
        { method: 'POST', headers },
      );
      expect(archivedEmployeeCannotReactivate.status).toBe(409);

      const facilityArchiveBlocked = await fetch(
        `${baseUrl}/api/v1/facilities/${workforceFacilityA.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await facilityArchiveBlocked.json()).code).toBe('FACILITY_HAS_ACTIVE_TEAMS');
      const organizationArchiveBlocked = await fetch(
        `${baseUrl}/api/v1/organizations/${workforceOrganization.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await organizationArchiveBlocked.json()).code).toBe(
        'ORGANIZATION_HAS_ACTIVE_CHILDREN',
      );

      const archiveQualification = await fetch(
        `${baseUrl}/api/v1/qualifications/${qualification.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await archiveQualification.json()).status).toBe('archived');
      const archiveSkill = await fetch(`${baseUrl}/api/v1/skills/${skill.id}/archive`, {
        method: 'POST',
        headers,
      });
      expect((await archiveSkill.json()).status).toBe('archived');
      const archivedDefinitionsEmployee = await fetch(
        `${baseUrl}/api/v1/employees/${workforceEmployee.id}`,
        { headers },
      );
      expect(archivedDefinitionsEmployee.status).toBe(200);
      expect(await archivedDefinitionsEmployee.json()).toMatchObject({
        qualifications: [expect.objectContaining({ status: 'archived' })],
        skills: [expect.objectContaining({ status: 'archived' })],
      });

      const archiveWorkforceTeam = await fetch(
        `${baseUrl}/api/v1/teams/${workforceTeam.id}/archive`,
        {
          method: 'POST',
          headers,
        },
      );
      expect((await archiveWorkforceTeam.json()).status).toBe('archived');
      const archiveWorkforceFacilityA = await fetch(
        `${baseUrl}/api/v1/facilities/${workforceFacilityA.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await archiveWorkforceFacilityA.json()).status).toBe('archived');
      const archiveWorkforceFacilityB = await fetch(
        `${baseUrl}/api/v1/facilities/${workforceFacilityB.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await archiveWorkforceFacilityB.json()).status).toBe('archived');
      const archiveWorkforceOrganization = await fetch(
        `${baseUrl}/api/v1/organizations/${workforceOrganization.id}/archive`,
        { method: 'POST', headers },
      );
      expect((await archiveWorkforceOrganization.json()).status).toBe('archived');
      const activateWorkforceOrganization = await fetch(
        `${baseUrl}/api/v1/organizations/${workforceOrganization.id}/activate`,
        { method: 'POST', headers },
      );
      expect((await activateWorkforceOrganization.json()).status).toBe('active');
      const activateWorkforceFacility = await fetch(
        `${baseUrl}/api/v1/facilities/${workforceFacilityA.id}/activate`,
        { method: 'POST', headers },
      );
      expect((await activateWorkforceFacility.json()).status).toBe('active');
      const activateWorkforceTeam = await fetch(
        `${baseUrl}/api/v1/teams/${workforceTeam.id}/activate`,
        {
          method: 'POST',
          headers,
        },
      );
      expect((await activateWorkforceTeam.json()).status).toBe('active');

      const auditActions = await owner.query<{ action: string }>(
        `SELECT action FROM audit.audit_entries
         WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])`,
        [
          tenantId,
          [
            workforceOrganization.id,
            workforceFacilityA.id,
            workforceTeam.id,
            workforceEmployee.id,
            otherWorkforceEmployee.id,
          ],
        ],
      );
      expect(auditActions.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'organization.created',
          'organization.updated',
          'facility.created',
          'facility.updated',
          'team.created',
          'team.updated',
          'employee.created',
          'employee.updated',
          'employee.facility_assigned',
          'employee.team_assigned',
          'employee.team_unassigned',
          'employee.user_linked',
          'employee.user_unlinked',
          'employee.qualification_added',
          'employee.skill_added',
          'employee.qualification_removed',
          'employee.skill_removed',
        ]),
      );
      const workforceEvents = await owner.query<{ count: string }>(
        `SELECT count(*) FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])`,
        [
          tenantId,
          [
            workforceOrganization.id,
            workforceFacilityA.id,
            workforceTeam.id,
            workforceEmployee.id,
            otherWorkforceEmployee.id,
          ],
        ],
      );
      expect(Number(workforceEvents.rows[0]?.count)).toBeGreaterThanOrEqual(10);

      const officeToken = await issueToken(secondSubject);
      const officeAdminHeaders = { ...headers, Authorization: `Bearer ${officeToken}` };
      const officeCannotListMembers = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers: officeAdminHeaders,
      });
      expect(officeCannotListMembers.status).toBe(403);
      const officeCannotReadAudit = await fetch(`${baseUrl}/api/v1/audit`, {
        headers: officeAdminHeaders,
      });
      expect(officeCannotReadAudit.status).toBe(403);
      const officeCannotAssignAdministrator = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/roles`,
        {
          method: 'PUT',
          headers: officeAdminHeaders,
          body: JSON.stringify({ roleIds: [roleId] }),
        },
      );
      expect(officeCannotAssignAdministrator.status).toBe(403);
      const caregiverToken = await issueToken(caregiverSubject);
      const caregiverAdminHeaders = { ...headers, Authorization: `Bearer ${caregiverToken}` };
      const caregiverCannotListMembers = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers: caregiverAdminHeaders,
      });
      expect(caregiverCannotListMembers.status).toBe(403);
      const caregiverCannotListInvitations = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        headers: caregiverAdminHeaders,
      });
      expect(caregiverCannotListInvitations.status).toBe(403);
      const caregiverCannotReadAudit = await fetch(`${baseUrl}/api/v1/audit`, {
        headers: caregiverAdminHeaders,
      });
      expect(caregiverCannotReadAudit.status).toBe(403);
      const caregiverCannotDeactivateMember = await fetch(
        `${baseUrl}/api/v1/admin/members/${caregiverMembershipId}/deactivate`,
        { method: 'POST', headers: caregiverAdminHeaders },
      );
      expect(caregiverCannotDeactivateMember.status).toBe(403);
      const caregiverCannotModifyMemberScopes = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/scopes`,
        {
          method: 'PUT',
          headers: caregiverAdminHeaders,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: secondFacilityId }] }),
        },
      );
      expect(caregiverCannotModifyMemberScopes.status).toBe(403);
      const tenantBAdminRequest = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers: { ...headers, 'X-Tenant-Id': otherTenantId },
      });
      expect(tenantBAdminRequest.status).toBe(403);
      const tenantBInvitationRequest = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers: { ...headers, 'X-Tenant-Id': otherTenantId },
        body: JSON.stringify({ email: `cross-tenant-${uuidv7()}@integration.test` }),
      });
      expect(tenantBInvitationRequest.status).toBe(403);

      const newUserEmail = `invited-${uuidv7()}@integration.test`;
      const invalidInvitation = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'not-an-email' }),
      });
      expect(invalidInvitation.status).toBe(400);
      expect((await invalidInvitation.json()).code).toBe('INVALID_REQUEST');
      const invitationResponse = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: newUserEmail }),
      });
      const invitationResult = (await invitationResponse.json()) as {
        invitation: { id: string; email: string; status: string };
      };
      if (invitationResponse.status !== 201) {
        throw new Error(
          `Invitation request returned ${invitationResponse.status}: ${JSON.stringify(invitationResult)}`,
        );
      }
      const invitation = invitationResult;
      expect(invitation).toMatchObject({
        invitation: { email: newUserEmail, status: 'pending' },
      });
      const invitationPageResponse = await fetch(
        `${baseUrl}/api/v1/admin/invitations?page=1&pageSize=1`,
        { headers },
      );
      expect(invitationPageResponse.status).toBe(200);
      const invitationPage = (await invitationPageResponse.json()) as {
        items: Array<{ id: string }>;
        page: number;
        pageSize: number;
        total: number;
      };
      expect(invitationPage).toMatchObject({ page: 1, pageSize: 1 });
      expect(invitationPage.total).toBeGreaterThanOrEqual(1);
      expect(invitationPage.items).toContainEqual(
        expect.objectContaining({ id: invitation.invitation.id }),
      );
      const pendingInvitations = await fetch(
        `${baseUrl}/api/v1/admin/invitations?status=pending&page=1&pageSize=20`,
        { headers },
      );
      expect(pendingInvitations.status).toBe(200);
      expect(
        ((await pendingInvitations.json()) as { items: Array<{ id: string }> }).items,
      ).toContainEqual(expect.objectContaining({ id: invitation.invitation.id }));
      const duplicateInvitation = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: newUserEmail }),
      });
      expect(duplicateInvitation.status).toBe(409);
      expect((await duplicateInvitation.json()).code).toBe('INVITATION_ALREADY_EXISTS');
      const alreadyMemberInvitation = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'admin@integration.test' }),
      });
      expect(alreadyMemberInvitation.status).toBe(409);
      expect((await alreadyMemberInvitation.json()).code).toBe('USER_ALREADY_MEMBER');

      const unverifiedSubject = uuidv7();
      const unverifiedToken = await issueToken(unverifiedSubject, {
        email: newUserEmail,
        email_verified: false,
        name: 'Unverified Integration User',
      });
      const unverifiedTenantList = await fetch(`${baseUrl}/api/v1/me/tenants`, {
        headers: { Authorization: `Bearer ${unverifiedToken}` },
      });
      expect(unverifiedTenantList.status).toBe(200);
      expect(await unverifiedTenantList.json()).toEqual([]);
      const unverifiedMembership = await owner.query(
        `SELECT membership.id
         FROM identity.tenant_memberships AS membership
         JOIN identity.external_identities AS external
           ON external.user_id = membership.user_id
         WHERE external.issuer = $1 AND external.subject = $2 AND membership.tenant_id = $3`,
        [oidc.issuer, unverifiedSubject, tenantId],
      );
      expect(unverifiedMembership.rowCount).toBe(0);
      const unverifiedInvitationState = await owner.query<{ status: string }>(
        'SELECT status FROM identity.tenant_invitations WHERE id = $1',
        [invitation.invitation.id],
      );
      expect(unverifiedInvitationState.rows[0]?.status).toBe('pending');

      const invitedSubject = uuidv7();
      const invitedToken = await issueToken(invitedSubject, {
        email: newUserEmail,
        email_verified: true,
        name: 'Invited Integration User',
      });
      const signedInWithoutTenant = await fetch(`${baseUrl}/api/v1/me/tenants`, {
        headers: { Authorization: `Bearer ${invitedToken}` },
      });
      expect(signedInWithoutTenant.status).toBe(200);
      expect(await signedInWithoutTenant.json()).toEqual([]);
      const invitedUser = await owner.query<{ id: string }>(
        'SELECT id FROM identity.users WHERE email = $1',
        [newUserEmail],
      );
      const invitedMembership = await owner.query<{ id: string; status: string }>(
        'SELECT id, status FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
        [invitedUser.rows[0]?.id, tenantId],
      );
      const invitedMembershipId = invitedMembership.rows[0]?.id;
      expect(invitedMembership.rows[0]).toMatchObject({ status: 'pending' });
      const invitationState = await owner.query<{ status: string; accepted_at: Date | null }>(
        'SELECT status, accepted_at FROM identity.tenant_invitations WHERE id = $1',
        [invitation.invitation.id],
      );
      expect(invitationState.rows[0]?.status).toBe('accepted');
      expect(invitationState.rows[0]?.accepted_at).toBeInstanceOf(Date);
      if (!invitedMembershipId) throw new Error('Verified invitation did not create membership');

      const previouslyKnownSubject = uuidv7();
      const previouslyKnownEmail = `known-${uuidv7()}@integration.test`;
      const previouslyKnownToken = await issueToken(previouslyKnownSubject, {
        email: previouslyKnownEmail,
        email_verified: true,
        name: 'Previously Known User',
      });
      const initialTenantList = await fetch(`${baseUrl}/api/v1/me/tenants`, {
        headers: { Authorization: `Bearer ${previouslyKnownToken}` },
      });
      expect(initialTenantList.status).toBe(200);
      expect(await initialTenantList.json()).toEqual([]);

      const previouslyKnownInvitationResponse = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: previouslyKnownEmail }),
      });
      expect(previouslyKnownInvitationResponse.status).toBe(201);
      const previouslyKnownInvitation = (await previouslyKnownInvitationResponse.json()) as {
        invitation: { id: string; status: string };
      };
      expect(previouslyKnownInvitation).toMatchObject({
        invitation: { status: 'pending' },
      });
      const membershipBeforeAuthentication = await owner.query(
        `SELECT id FROM identity.tenant_memberships
         WHERE user_id = (SELECT id FROM identity.users WHERE email = $1) AND tenant_id = $2`,
        [previouslyKnownEmail, tenantId],
      );
      expect(membershipBeforeAuthentication.rowCount).toBe(0);

      const authenticatedTenantList = await fetch(`${baseUrl}/api/v1/me/tenants`, {
        headers: { Authorization: `Bearer ${previouslyKnownToken}` },
      });
      expect(authenticatedTenantList.status).toBe(200);
      expect(await authenticatedTenantList.json()).toEqual([]);
      const authenticatedMembership = await owner.query<{
        status: string;
        role_count: number;
      }>(
        `SELECT membership.status, count(membership_role.role_id)::int AS role_count
         FROM identity.tenant_memberships AS membership
         LEFT JOIN identity.membership_roles AS membership_role
           ON membership_role.membership_id = membership.id
         WHERE membership.user_id = (SELECT id FROM identity.users WHERE email = $1)
           AND membership.tenant_id = $2
         GROUP BY membership.status`,
        [previouslyKnownEmail, tenantId],
      );
      expect(authenticatedMembership.rows[0]).toEqual({ status: 'pending', role_count: 0 });
      const previouslyKnownInvitationState = await owner.query<{
        status: string;
        accepted_at: Date | null;
      }>('SELECT status, accepted_at FROM identity.tenant_invitations WHERE id = $1', [
        previouslyKnownInvitation.invitation.id,
      ]);
      expect(previouslyKnownInvitationState.rows[0]?.status).toBe('accepted');
      expect(previouslyKnownInvitationState.rows[0]?.accepted_at).toBeInstanceOf(Date);

      const crossTenantRole = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/roles`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ roleIds: [otherTenantRoleId] }),
        },
      );
      expect(crossTenantRole.status).toBe(404);
      expect((await crossTenantRole.json()).code).toBe('ROLE_NOT_FOUND');

      const assignOffice = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/roles`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ roleIds: [officeRoleId] }),
        },
      );
      expect(assignOffice.status).toBe(200);
      expect(
        ((await assignOffice.json()) as { roles: Array<{ name: string }> }).roles.map(
          (role) => role.name,
        ),
      ).toEqual(['Office']);

      const removeOffice = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/roles`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ roleIds: [] }),
        },
      );
      expect(removeOffice.status).toBe(200);
      expect(((await removeOffice.json()) as { roles: unknown[] }).roles).toEqual([]);
      const restoreOffice = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/roles`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ roleIds: [officeRoleId] }),
        },
      );
      expect(restoreOffice.status).toBe(200);

      const crossTenantScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: otherFacilityId }] }),
        },
      );
      expect(crossTenantScope.status).toBe(400);
      expect((await crossTenantScope.json()).code).toBe('CROSS_TENANT_REFERENCE');

      const assignFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: facilityId }] }),
        },
      );
      expect(assignFacilityScope.status).toBe(200);
      const filteredMembers = await fetch(
        `${baseUrl}/api/v1/admin/members?q=${encodeURIComponent('Invited Integration User')}&roleId=${officeRoleId}&scopeType=facility&facilityId=${facilityId}`,
        { headers },
      );
      expect(filteredMembers.status).toBe(200);
      const filteredMemberItems = (await filteredMembers.json()) as {
        items: Array<{ id: string; displayName: string | null }>;
        total: number;
      };
      expect(filteredMemberItems.items).toEqual([
        expect.objectContaining({
          id: invitedMembershipId,
          displayName: 'Invited Integration User',
        }),
      ]);
      expect(filteredMemberItems.total).toBe(1);
      const crossTenantScopeFilter = await fetch(
        `${baseUrl}/api/v1/admin/members?q=${encodeURIComponent('Invited Integration User')}&facilityId=${otherFacilityId}`,
        { headers },
      );
      expect(crossTenantScopeFilter.status).toBe(200);
      expect(((await crossTenantScopeFilter.json()) as { items: unknown[] }).items).toEqual([]);
      const activateMember = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/activate`,
        { method: 'POST', headers },
      );
      expect(activateMember.status).toBe(200);
      expect(((await activateMember.json()) as { status: string }).status).toBe('active');

      const invitedHeaders = {
        Authorization: `Bearer ${invitedToken}`,
        'X-Tenant-Id': tenantId,
      };
      const facilityList = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(facilityList.status).toBe(200);
      expect(await facilityList.json()).toEqual([
        expect.objectContaining({ id: facilityId, name: 'Integration Facility One' }),
      ]);
      const deniedFacility = await fetch(`${baseUrl}/api/v1/facilities/${secondFacilityId}`, {
        headers: invitedHeaders,
      });
      expect(deniedFacility.status).toBe(403);

      const mixedTenantScopes = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            scopes: [
              { scopeType: 'tenant', scopeId: tenantId },
              { scopeType: 'facility', scopeId: facilityId },
            ],
          }),
        },
      );
      expect(mixedTenantScopes.status).toBe(400);
      expect((await mixedTenantScopes.json()).code).toBe('INVALID_SCOPE');

      const assignTenantScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'tenant', scopeId: tenantId }] }),
        },
      );
      expect(assignTenantScope.status).toBe(200);
      const tenantScopedFacilities = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(tenantScopedFacilities.status).toBe(200);
      expect(await tenantScopedFacilities.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: facilityId }),
          expect.objectContaining({ id: secondFacilityId }),
        ]),
      );

      const removeFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [] }),
        },
      );
      expect(removeFacilityScope.status).toBe(200);
      expect(((await removeFacilityScope.json()) as { scopes: unknown[] }).scopes).toEqual([]);
      const noScopeAccess = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(noScopeAccess.status).toBe(403);

      const restoreFacilityScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ scopes: [{ scopeType: 'facility', scopeId: facilityId }] }),
        },
      );
      expect(restoreFacilityScope.status).toBe(200);
      const restoredFacilityList = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(restoredFacilityList.status).toBe(200);
      expect(await restoredFacilityList.json()).toEqual([
        expect.objectContaining({ id: facilityId }),
      ]);

      const assignOrganizationScope = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/scopes`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            scopes: [{ scopeType: 'organization', scopeId: organizationId }],
          }),
        },
      );
      expect(assignOrganizationScope.status).toBe(200);
      const organizationList = await fetch(`${baseUrl}/api/v1/organizations`, {
        headers: invitedHeaders,
      });
      expect(organizationList.status).toBe(200);
      expect(await organizationList.json()).toEqual([
        expect.objectContaining({ id: organizationId, tenantId }),
      ]);
      const organizationFacilities = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(organizationFacilities.status).toBe(200);
      expect(await organizationFacilities.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: facilityId }),
          expect.objectContaining({ id: secondFacilityId }),
        ]),
      );

      const deactivateMember = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/deactivate`,
        { method: 'POST', headers },
      );
      expect(deactivateMember.status).toBe(200);
      const inactiveAccess = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(inactiveAccess.status).toBe(403);
      const reactivateMember = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/activate`,
        { method: 'POST', headers },
      );
      expect(reactivateMember.status).toBe(200);
      const revokeMember = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/revoke`,
        { method: 'POST', headers },
      );
      expect(revokeMember.status).toBe(200);
      expect(((await revokeMember.json()) as { status: string }).status).toBe('revoked');
      const cannotReactivateRevoked = await fetch(
        `${baseUrl}/api/v1/admin/members/${invitedMembershipId}/activate`,
        { method: 'POST', headers },
      );
      expect(cannotReactivateRevoked.status).toBe(409);
      expect((await cannotReactivateRevoked.json()).code).toBe('MEMBERSHIP_REVOKED');
      const revokedAccess = await fetch(`${baseUrl}/api/v1/facilities`, {
        headers: invitedHeaders,
      });
      expect(revokedAccess.status).toBe(403);
      const cannotReinviteRevokedMember = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: newUserEmail }),
      });
      expect(cannotReinviteRevokedMember.status).toBe(409);
      expect((await cannotReinviteRevokedMember.json()).code).toBe('MEMBERSHIP_REVOKED');

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit?page=1&pageSize=100`, { headers });
      expect(auditResponse.status).toBe(200);
      const auditResult = (await auditResponse.json()) as {
        items: Array<{ action: string; resourceId: string }>;
      };
      expect(auditResult.items.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'tenant.member.invited',
          'tenant.member.role_changed',
          'tenant.member.scope_changed',
          'tenant.member.activated',
          'tenant.member.deactivated',
          'tenant.member.revoked',
        ]),
      );
      const accessEvents = await owner.query<{ count: string }>(
        `SELECT count(*) FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event ->> 'aggregateId' IN ($2, $3)`,
        [tenantId, invitation.invitation.id, invitedMembershipId],
      );
      expect(Number(accessEvents.rows[0]?.count)).toBeGreaterThanOrEqual(8);

      let crossTenantRoleConstraint = false;
      try {
        await owner.query(
          'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
          [invitedMembershipId, tenantId, otherTenantRoleId],
        );
      } catch (error) {
        crossTenantRoleConstraint = (error as { code?: string }).code === '23503';
      }
      expect(crossTenantRoleConstraint).toBe(true);
      let crossTenantScopeConstraint = false;
      try {
        await owner.query(
          `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
           VALUES ($1, $2, 'facility', $3)`,
          [invitedMembershipId, tenantId, otherFacilityId],
        );
      } catch (error) {
        crossTenantScopeConstraint = (error as { code?: string }).code === '23503';
      }
      expect(crossTenantScopeConstraint).toBe(true);
      const employeeUserConstraint = await owner.query<{ count: string }>(
        "SELECT count(*) FROM pg_constraint WHERE conname = 'employees_user_fk' AND contype = 'f'",
      );
      expect(employeeUserConstraint.rows[0]?.count).toBe('1');
      let employeeCrossTenantConstraint = false;
      try {
        await owner.query(
          `INSERT INTO employees.employees (id, tenant_id, user_id, first_name, last_name)
           VALUES ($1, $2, $3, 'Cross', 'Tenant')`,
          [uuidv7(), otherTenantId, userId],
        );
      } catch (error) {
        employeeCrossTenantConstraint = (error as { code?: string }).code === '23503';
      }
      expect(employeeCrossTenantConstraint).toBe(true);
      let facilityOrganizationConstraint = false;
      try {
        await owner.query(
          `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
           VALUES ($1, $2, $3, 'Cross Tenant Facility')`,
          [uuidv7(), tenantId, otherOrganizationId],
        );
      } catch (error) {
        facilityOrganizationConstraint = (error as { code?: string }).code === '23503';
      }
      expect(facilityOrganizationConstraint).toBe(true);

      const deactivateAdministrator = await fetch(
        `${baseUrl}/api/v1/admin/members/${membershipId}/deactivate`,
        { method: 'POST', headers },
      );
      expect(deactivateAdministrator.status).toBe(200);
      const inactiveAdministratorCannotManage = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers,
      });
      expect(inactiveAdministratorCannotManage.status).toBe(403);
    } finally {
      await app?.close();
      await closeServer(oidc.server);
      await workerDatabase.close();
      await appRole.end();
      await owner.end();
      await database.container.stop();
    }
  }, 240_000);
});

function dateInBerlin(daysFromToday = 0): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return addCalendarDays(`${part('year')}-${part('month')}-${part('day')}`, daysFromToday);
}

function addCalendarDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function addMinutesToLocalTime(value: string, minutes: number): string {
  const [hours = '0', remainingMinutes = '0'] = value.split(':');
  const total = (Number(hours) * 60 + Number(remainingMinutes) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function localDateTime(
  startValue: string,
  endValue: string,
  timezone: string,
): { date: string; start: string; end: string } {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = format.formatToParts(new Date(startValue));
  const endParts = format.formatToParts(new Date(endValue));
  const value = (values: Intl.DateTimeFormatPart[], name: string) =>
    values.find((item) => item.type === name)?.value ?? '';
  return {
    date: `${value(parts, 'year')}-${value(parts, 'month')}-${value(parts, 'day')}`,
    start: `${value(parts, 'hour')}:${value(parts, 'minute')}`,
    end: `${value(endParts, 'hour')}:${value(endParts, 'minute')}`,
  };
}

async function startOidcServer(jwk: JsonWebKey): Promise<{ server: Server; issuer: string }> {
  let issuer: string;
  let origin: string;
  const server: Server = createServer((request, response) => {
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
