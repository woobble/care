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

describe('communications PostgreSQL/API integration', () => {
  test('records, authorizes, amends, and links client communication history', async () => {
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
    let api: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
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
        'communications.read',
        'communications.create',
        'communications.update',
        'communications.amend',
        'communications.preferences.manage',
        'schedule.read',
        'operations.read',
        'operations.tasks.create',
      ];
      for (const permission of permissions) {
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
