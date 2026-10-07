import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Client } from 'pg';
import { startCareTestDatabase } from '@care/testing';
import { createDatabase } from '@care/database';
import { DrizzleOutboxRepository, platformSchema } from '@care/platform';
import { PERMISSIONS } from '@care/permissions';
import { AppModule } from '../src/app.module';
import { RequestContextMiddleware } from '../src/http/request-context.middleware';
import type { ApiRequest } from '../src/http/request';

describe('clients API', () => {
  test('authenticates, enforces tenant membership, and commits client, audit, and outbox changes', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const appRole = new Client({ connectionString: database.appUrl });
    const workerDatabase = createDatabase(database.workerUrl, platformSchema);
    const outbox = new DrizzleOutboxRepository(workerDatabase.db);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const keyId = randomUUID();
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const oidc = await startOidcServer(publicJwk);
    const subject = randomUUID();
    const userId = randomUUID();
    const tenantId = randomUUID();
    const membershipId = randomUUID();
    const roleId = randomUUID();
    const officeRoleId = randomUUID();
    const caregiverRoleId = randomUUID();
    const otherTenantId = randomUUID();
    const otherTenantRoleId = randomUUID();
    const organizationId = randomUUID();
    const secondOrganizationId = randomUUID();
    const facilityId = randomUUID();
    const secondFacilityId = randomUUID();
    const secondOrganizationFacilityId = randomUUID();
    const otherOrganizationId = randomUUID();
    const otherFacilityId = randomUUID();
    const crossTenantClientId = randomUUID();
    let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = database.appUrl;
    process.env.OIDC_ISSUER = oidc.issuer;
    process.env.OIDC_CLIENT_ID = 'care-integration-test';
    process.env.WEB_ORIGIN = 'http://localhost:3000';

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
      const defaultStatusUserId = randomUUID();
      const defaultStatusMembershipId = randomUUID();
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
        [randomUUID(), userId, oidc.issuer, subject],
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
      const secondUserId = randomUUID();
      const secondMembershipId = randomUUID();
      const secondSubject = randomUUID();
      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [secondUserId, 'office@integration.test', 'Integration Office'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [randomUUID(), secondUserId, oidc.issuer, secondSubject],
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
           ($1, 'employee.update'), ($1, 'employee.assign_facility'),
           ($1, 'employee.assign_team'), ($1, 'employee.link_user'),
           ($1, 'employee.manage_qualifications'), ($1, 'employee.manage_skills'),
           ($1, 'employee.manage_employment')`,
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

      const caregiverUserId = randomUUID();
      const caregiverSubject = randomUUID();
      const caregiverMembershipId = randomUUID();
      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [caregiverUserId, 'caregiver@integration.test', 'Integration Caregiver'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [randomUUID(), caregiverUserId, oidc.issuer, caregiverSubject],
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
         VALUES ($1, 'client.read'), ($1, 'service.read')`,
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
        3,
      );
      expect(
        (await appRole.query('SELECT membership_id FROM identity.membership_scopes')).rowCount,
      ).toBe(3);
      expect((await appRole.query('SELECT role_id FROM identity.role_permissions')).rowCount).toBe(
        PERMISSIONS.length + 21,
      );
      await appRole.query('COMMIT');
      expect((await appRole.query('SELECT id FROM identity.tenant_memberships')).rowCount).toBe(0);

      app = await NestFactory.create(AppModule, { logger: false });
      const contextMiddleware = new RequestContextMiddleware();
      app.use((request: Request, response: Response, next: NextFunction) =>
        contextMiddleware.use(request as ApiRequest, response, next),
      );
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

      const forbidden = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { ...headers, 'X-Tenant-Id': randomUUID() },
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
          (address) => address.isPrimary,
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

      const insuranceNumber = `PRIVATE-${randomUUID()}`;
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
        summary: string;
        actorId: string;
        action: string;
      }>;
      expect(timeline.map((entry) => entry.summary)).toEqual(
        expect.arrayContaining([
          'Klient angelegt',
          'Adresse hinzugefügt',
          'Kontakt hinzugefügt',
          'Versicherungsverhältnis hinzugefügt',
          'Pflegegradverlauf ergänzt',
          'Versorgerkontext geändert',
        ]),
      );
      expect(timeline.every((entry) => entry.actorId && entry.action)).toBe(true);
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
        body: JSON.stringify({ name: 'Basic care', code: `CAT-${randomUUID().slice(0, 8)}` }),
      });
      expect(serviceCategoryResponse.status).toBe(201);
      const serviceCategory = (await serviceCategoryResponse.json()) as { id: string };
      const serviceResponse = await fetch(`${baseUrl}/api/v1/services`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: `CARE-${randomUUID().slice(0, 8)}`,
          name: 'Morning care',
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
          body: JSON.stringify({ items: [{ organizationId, facilityId }] }),
        },
      );
      expect(serviceAvailabilityResponse.status).toBe(200);
      const serviceSearch = await fetch(
        `${baseUrl}/api/v1/services?q=Morning&organizationId=${organizationId}&facilityId=${facilityId}`,
        { headers },
      );
      expect(await serviceSearch.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: service.id, name: 'Morning care' })],
      });
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
        promotedFacility.facilityAssignments.filter((assignment) => assignment.status === 'active'),
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
      const officeHeaders = { ...headers, Authorization: `Bearer ${officeToken}` };
      const officeCannotListMembers = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers: officeHeaders,
      });
      expect(officeCannotListMembers.status).toBe(403);
      const officeCannotReadAudit = await fetch(`${baseUrl}/api/v1/audit`, {
        headers: officeHeaders,
      });
      expect(officeCannotReadAudit.status).toBe(403);
      const officeCannotAssignAdministrator = await fetch(
        `${baseUrl}/api/v1/admin/members/${secondMembershipId}/roles`,
        {
          method: 'PUT',
          headers: officeHeaders,
          body: JSON.stringify({ roleIds: [roleId] }),
        },
      );
      expect(officeCannotAssignAdministrator.status).toBe(403);
      const caregiverToken = await issueToken(caregiverSubject);
      const caregiverHeaders = { ...headers, Authorization: `Bearer ${caregiverToken}` };
      const caregiverCannotListMembers = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers: caregiverHeaders,
      });
      expect(caregiverCannotListMembers.status).toBe(403);
      const caregiverCannotReadAudit = await fetch(`${baseUrl}/api/v1/audit`, {
        headers: caregiverHeaders,
      });
      expect(caregiverCannotReadAudit.status).toBe(403);
      const caregiverCannotDeactivateMember = await fetch(
        `${baseUrl}/api/v1/admin/members/${caregiverMembershipId}/deactivate`,
        { method: 'POST', headers: caregiverHeaders },
      );
      expect(caregiverCannotDeactivateMember.status).toBe(403);
      const tenantBAdminRequest = await fetch(`${baseUrl}/api/v1/admin/members`, {
        headers: { ...headers, 'X-Tenant-Id': otherTenantId },
      });
      expect(tenantBAdminRequest.status).toBe(403);
      const tenantBInvitationRequest = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
        method: 'POST',
        headers: { ...headers, 'X-Tenant-Id': otherTenantId },
        body: JSON.stringify({ email: `cross-tenant-${randomUUID()}@integration.test` }),
      });
      expect(tenantBInvitationRequest.status).toBe(403);

      const newUserEmail = `invited-${randomUUID()}@integration.test`;
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

      const unverifiedSubject = randomUUID();
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

      const invitedSubject = randomUUID();
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

      const previouslyKnownSubject = randomUUID();
      const previouslyKnownEmail = `known-${randomUUID()}@integration.test`;
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
          [randomUUID(), otherTenantId, userId],
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
          [randomUUID(), tenantId, otherOrganizationId],
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
