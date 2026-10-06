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
    const facilityId = randomUUID();
    const secondFacilityId = randomUUID();
    const otherOrganizationId = randomUUID();
    const otherFacilityId = randomUUID();
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
        'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3), ($4, $5, $6)',
        [
          organizationId,
          tenantId,
          'Integration Organization',
          otherOrganizationId,
          otherTenantId,
          'Other Integration Organization',
        ],
      );
      await owner.query(
        'INSERT INTO organizations.facilities (id, tenant_id, organization_id, name) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)',
        [
          facilityId,
          tenantId,
          organizationId,
          'Integration Facility One',
          secondFacilityId,
          tenantId,
          organizationId,
          'Integration Facility Two',
          otherFacilityId,
          otherTenantId,
          otherOrganizationId,
          'Other Integration Facility',
        ],
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
         VALUES ($1, 'client.read'), ($1, 'organization.read'), ($1, 'facility.read')`,
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
        "INSERT INTO identity.role_permissions (role_id, permission) VALUES ($1, 'client.read')",
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
        PERMISSIONS.length + 4,
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

      const createdResponse = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace' }),
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as { id: string; status: string };
      expect(created.status).toBe('pending');

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
      expect(audit.rows[0]?.count).toBe('4');
      expect(events.rows[0]?.count).toBe('4');

      const pendingIds = await outbox.pendingIds();
      expect(pendingIds).toHaveLength(4);
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
