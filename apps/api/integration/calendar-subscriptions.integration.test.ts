import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ICAL from 'ical.js';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '@app/api/app.module';
import { configureApiHttp, createApiFastifyAdapter } from '@app/api/http/fastify';
import { startCareTestDatabase } from '@care/testing';

describe('caregiver calendar subscriptions API', () => {
  test('syncs assigned visits and denies revoked, inactive, and cross-tenant access', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const keyId = uuidv7();
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const oidc = await startOidcServer(publicJwk);
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const organizationId = uuidv7();
    const facilityId = uuidv7();
    const clientId = uuidv7();
    const roleId = uuidv7();
    const userA = makeUserIds();
    const userB = makeUserIds();
    const employeeA = uuidv7();
    const employeeB = uuidv7();
    const visitId = uuidv7();
    const assignmentAId = uuidv7();
    const subscriptionHeaders = (token: string, selectedTenant = tenantId) => ({
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': selectedTenant,
      'Content-Type': 'application/json',
    });
    const now = new Date();
    const plannedStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const plannedEnd = new Date(plannedStart.getTime() + 60 * 60 * 1000);
    const rescheduledStart = new Date(plannedStart.getTime() + 90 * 60 * 1000);
    const rescheduledEnd = new Date(plannedEnd.getTime() + 90 * 60 * 1000);
    let app: NestFastifyApplication | undefined;

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = database.appUrl;
    process.env.OIDC_ISSUER = oidc.issuer;
    process.env.OIDC_CLIENT_ID = 'care-integration-test';
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.API_PUBLIC_ORIGIN = 'https://api.care.example';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:8333';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = 'care-test-private';
    process.env.S3_ACCESS_KEY = 'care-test-access';
    process.env.S3_SECRET_KEY = 'care-test-secret';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    delete process.env.ROUTING_OSRM_URL;

    try {
      await owner.connect();
      await seedCalendarFixture(owner, {
        tenantId,
        otherTenantId,
        organizationId,
        facilityId,
        clientId,
        roleId,
        userA,
        userB,
        employeeA,
        employeeB,
        visitId,
        assignmentAId,
        now,
        plannedStart,
        plannedEnd,
      });

      app = await NestFactory.create<NestFastifyApplication>(AppModule, createApiFastifyAdapter(), {
        logger: false,
      });
      await configureApiHttp(app, 'http://localhost:3000');
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const tokenA = await issueToken(privateKey, keyId, oidc.issuer, userA.subject);
      const tokenB = await issueToken(privateKey, keyId, oidc.issuer, userB.subject);

      const createdAResponse = await fetch(`${baseUrl}/api/v1/me/calendar-subscription`, {
        method: 'POST',
        headers: subscriptionHeaders(tokenA),
      });
      expect(createdAResponse.status).toBe(201);
      const createdA = (await createdAResponse.json()) as {
        httpsUrl: string;
        webcalUrl: string;
      };
      expect(createdA.httpsUrl).toStartWith(
        'https://api.care.example/api/v1/calendar-subscriptions/',
      );
      expect(createdA.webcalUrl).toStartWith(
        'webcal://api.care.example/api/v1/calendar-subscriptions/',
      );
      const feedPathA = new URL(createdA.httpsUrl).pathname;
      const tokenASecret = feedPathA.match(/\/([^/]+)\.ics$/)?.[1];
      expect(tokenASecret).toBeDefined();

      const storedHash = await owner.query<{ token_hash: string }>(
        'SELECT token_hash FROM scheduling.calendar_subscriptions WHERE tenant_id = $1 AND employee_id = $2',
        [tenantId, employeeA],
      );
      expect(storedHash.rows[0]?.token_hash).not.toBe(tokenASecret);
      expect(storedHash.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);

      const feedAResponse = await fetch(`${baseUrl}${feedPathA}`);
      expect(feedAResponse.status).toBe(200);
      expect(feedAResponse.headers.get('content-type')).toContain('text/calendar');
      expect(feedAResponse.headers.get('cache-control')).toContain('no-store');
      expect(feedAResponse.headers.get('referrer-policy')).toBe('no-referrer');
      const firstFeed = await feedAResponse.text();
      const firstEvent = parseFirstEvent(firstFeed);
      expect(firstEvent.uid).toBe(`${visitId}@calendar.care-platform.invalid`);
      expect(firstEvent.summary).toBe('Care visit');
      expect(firstEvent.startDate.toJSDate().toISOString()).toBe(icalIso(plannedStart));
      expect(firstEvent.component.getFirstPropertyValue('status')).toBe('TENTATIVE');
      expect(firstFeed).not.toContain('Private Client Name');
      expect(firstFeed).not.toContain('Private Street');
      expect(firstFeed).not.toContain(clientId);
      const originalSequence = Number(firstEvent.component.getFirstPropertyValue('sequence'));

      const rescheduleResponse = await fetch(`${baseUrl}/api/v1/visits/${visitId}`, {
        method: 'PATCH',
        headers: subscriptionHeaders(tokenA),
        body: JSON.stringify({
          plannedStart: rescheduledStart.toISOString(),
          plannedEnd: rescheduledEnd.toISOString(),
        }),
      });
      expect(rescheduleResponse.status).toBe(200);
      const rescheduledFeed = await (await fetch(`${baseUrl}${feedPathA}`)).text();
      const rescheduledEvent = parseFirstEvent(rescheduledFeed);
      expect(rescheduledEvent.uid).toBe(firstEvent.uid);
      expect(rescheduledEvent.startDate.toJSDate().toISOString()).toBe(icalIso(rescheduledStart));
      expect(Number(rescheduledEvent.component.getFirstPropertyValue('sequence'))).toBeGreaterThan(
        originalSequence,
      );
      expect(getLastModified(rescheduledEvent).getTime()).toBeGreaterThan(
        getLastModified(firstEvent).getTime(),
      );

      const unassignResponse = await fetch(
        `${baseUrl}/api/v1/visits/${visitId}/assignments/${assignmentAId}`,
        { method: 'DELETE', headers: subscriptionHeaders(tokenA) },
      );
      expect(unassignResponse.status).toBe(204);
      const assignBResponse = await fetch(`${baseUrl}/api/v1/visits/${visitId}/assignments`, {
        method: 'POST',
        headers: subscriptionHeaders(tokenA),
        body: JSON.stringify({ employeeId: employeeB }),
      });
      expect(assignBResponse.status).toBe(201);
      const formerFeedEvent = parseFirstEvent(await (await fetch(`${baseUrl}${feedPathA}`)).text());
      expect(formerFeedEvent.uid).toBe(firstEvent.uid);
      expect(formerFeedEvent.component.getFirstPropertyValue('status')).toBe('CANCELLED');

      const createdBResponse = await fetch(`${baseUrl}/api/v1/me/calendar-subscription`, {
        method: 'POST',
        headers: subscriptionHeaders(tokenB),
      });
      expect(createdBResponse.status).toBe(201);
      const createdB = (await createdBResponse.json()) as { httpsUrl: string };
      const feedPathB = new URL(createdB.httpsUrl).pathname;
      const activeBEvent = parseFirstEvent(await (await fetch(`${baseUrl}${feedPathB}`)).text());
      expect(activeBEvent.uid).toBe(firstEvent.uid);
      expect(activeBEvent.component.getFirstPropertyValue('status')).toBe('TENTATIVE');
      const crossTenantFeed = await fetch(
        `${baseUrl}${feedPathB.replace(tenantId, otherTenantId)}`,
      );
      expect(crossTenantFeed.status).toBe(404);

      const cancelResponse = await fetch(`${baseUrl}/api/v1/visits/${visitId}/cancel`, {
        method: 'POST',
        headers: subscriptionHeaders(tokenB),
      });
      expect(cancelResponse.status).toBe(200);
      const cancelledEvent = parseFirstEvent(await (await fetch(`${baseUrl}${feedPathB}`)).text());
      expect(cancelledEvent.uid).toBe(firstEvent.uid);
      expect(cancelledEvent.component.getFirstPropertyValue('status')).toBe('CANCELLED');
      expect(cancelledEvent.description).toBe('Cancelled caregiver visit.');

      await owner.query(
        "UPDATE identity.tenant_memberships SET status = 'inactive' WHERE user_id = $1 AND tenant_id = $2",
        [userB.id, tenantId],
      );
      expect((await fetch(`${baseUrl}${feedPathB}`)).status).toBe(404);
      await owner.query(
        "UPDATE identity.tenant_memberships SET status = 'active' WHERE user_id = $1 AND tenant_id = $2",
        [userB.id, tenantId],
      );
      expect((await fetch(`${baseUrl}${feedPathB}`)).status).toBe(200);

      const revokeResponse = await fetch(`${baseUrl}/api/v1/me/calendar-subscription`, {
        method: 'DELETE',
        headers: subscriptionHeaders(tokenB),
      });
      expect(revokeResponse.status).toBe(200);
      expect((await fetch(`${baseUrl}${feedPathB}`)).status).toBe(404);
    } finally {
      await app?.close();
      await closeServer(oidc.server);
      await owner.end();
      await database.container.stop();
    }
  }, 300_000);
});

function makeUserIds() {
  return { id: uuidv7(), membershipId: uuidv7(), subject: uuidv7() };
}

async function seedCalendarFixture(
  owner: Client,
  input: {
    tenantId: string;
    otherTenantId: string;
    organizationId: string;
    facilityId: string;
    clientId: string;
    roleId: string;
    userA: ReturnType<typeof makeUserIds>;
    userB: ReturnType<typeof makeUserIds>;
    employeeA: string;
    employeeB: string;
    visitId: string;
    assignmentAId: string;
    now: Date;
    plannedStart: Date;
    plannedEnd: Date;
  },
): Promise<void> {
  await owner.query(
    'INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
    [
      input.tenantId,
      'Calendar Tenant',
      `calendar-${input.tenantId}`,
      input.otherTenantId,
      'Other Tenant',
      `other-${input.otherTenantId}`,
    ],
  );
  await owner.query(
    'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
    [input.organizationId, input.tenantId, 'Calendar Organization'],
  );
  await owner.query(
    'INSERT INTO organizations.facilities (id, tenant_id, organization_id, name) VALUES ($1, $2, $3, $4)',
    [input.facilityId, input.tenantId, input.organizationId, 'Calendar Facility'],
  );
  await owner.query(
    `INSERT INTO clients.clients
       (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Private Client', 'Name', 'active', $5, $5)`,
    [input.clientId, input.tenantId, input.organizationId, input.facilityId, input.now],
  );

  for (const [user, label] of [
    [input.userA, 'Caregiver A'],
    [input.userB, 'Caregiver B'],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- Seed each user's identity and membership before adding the next fixture user.
    await owner.query('INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)', [
      user.id,
      `${user.id}@calendar.test`,
      label,
    ]);
    // oxlint-disable-next-line no-await-in-loop -- The external identity references the user inserted immediately above.
    await owner.query(
      'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
      [uuidv7(), user.id, process.env.OIDC_ISSUER, user.subject],
    );
    // oxlint-disable-next-line no-await-in-loop -- Membership creation follows its user row.
    await owner.query(
      "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
      [user.membershipId, user.id, input.tenantId],
    );
  }
  await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
    input.roleId,
    input.tenantId,
    'Caregiver',
  ]);
  await owner.query(
    `INSERT INTO identity.role_permissions (role_id, permission)
     SELECT $1, permission FROM unnest($2::text[]) AS permission`,
    [
      input.roleId,
      [
        'client.read',
        'schedule.read',
        'schedule.update',
        'schedule.assign',
        'schedule.cancel',
        'visit_execution.read',
      ],
    ],
  );
  for (const user of [input.userA, input.userB]) {
    // oxlint-disable-next-line no-await-in-loop -- Each role link and scope is seeded before advancing to the next user.
    await owner.query(
      'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
      [user.membershipId, input.tenantId, input.roleId],
    );
    // oxlint-disable-next-line no-await-in-loop -- The scope belongs to the membership linked above.
    await owner.query(
      "INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id) VALUES ($1, $2, 'tenant', $2)",
      [user.membershipId, input.tenantId],
    );
  }
  await owner.query(
    `INSERT INTO employees.employees
       (id, tenant_id, organization_id, user_id, first_name, last_name, status, employment_type, created_at)
     VALUES ($1, $2, $3, $4, 'Caregiver', 'One', 'active', 'care', $7),
            ($5, $2, $3, $6, 'Caregiver', 'Two', 'active', 'care', $7)`,
    [
      input.employeeA,
      input.tenantId,
      input.organizationId,
      input.userA.id,
      input.employeeB,
      input.userB.id,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO employees.employee_facility_assignments
       (id, tenant_id, organization_id, employee_id, facility_id, is_primary, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, 'active', $6, $6),
            ($7, $2, $3, $8, $5, true, 'active', $6, $6)`,
    [
      uuidv7(),
      input.tenantId,
      input.organizationId,
      input.employeeA,
      input.facilityId,
      input.now,
      uuidv7(),
      input.employeeB,
    ],
  );
  await owner.query(
    `INSERT INTO scheduling.visits
       (id, tenant_id, client_id, organization_id, facility_id, origin, status,
        planned_start, planned_end, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'planned', $6, $7, 'Europe/Berlin', $8, $8)`,
    [
      input.visitId,
      input.tenantId,
      input.clientId,
      input.organizationId,
      input.facilityId,
      input.plannedStart,
      input.plannedEnd,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO scheduling.visit_assignments
       (id, tenant_id, visit_id, employee_id, role, status, assigned_at, assigned_by)
     VALUES ($1, $2, $3, $4, 'primary', 'active', $5, $6)`,
    [
      input.assignmentAId,
      input.tenantId,
      input.visitId,
      input.employeeA,
      input.now,
      input.userA.id,
    ],
  );
}

function parseFirstEvent(feed: string): ICAL.Event {
  const calendar = new ICAL.Component(ICAL.parse(feed));
  const [component] = calendar.getAllSubcomponents('vevent');
  if (!component) throw new Error('Calendar feed did not contain an event');
  return new ICAL.Event(component);
}

function getLastModified(event: ICAL.Event): Date {
  const value = event.component.getFirstPropertyValue('last-modified');
  if (!value || typeof value !== 'object' || !('toJSDate' in value)) {
    throw new Error('Event did not contain a valid LAST-MODIFIED value');
  }
  return (value as { toJSDate(): Date }).toJSDate();
}

function icalIso(value: Date): string {
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000).toISOString();
}

async function issueToken(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  keyId: string,
  issuer: string,
  subject: string,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: keyId })
    .setIssuer(issuer)
    .setAudience('care-integration-test')
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('10 minutes')
    .sign(privateKey);
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
