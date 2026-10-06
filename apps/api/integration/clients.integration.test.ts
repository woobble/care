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
      await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [userId]);
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [randomUUID(), userId, oidc.issuer, subject],
      );
      await owner.query(
        'INSERT INTO identity.tenant_memberships (id, user_id, tenant_id) VALUES ($1, $2, $3)',
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
        [roleId, ['client.read', 'client.create', 'client.update', 'client.archive']],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, role_id) VALUES ($1, $2)',
        [membershipId, roleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, scope_type, scope_id)
         VALUES ($1, 'tenant', $2)`,
        [membershipId, tenantId],
      );
      const secondUserId = randomUUID();
      const secondMembershipId = randomUUID();
      await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [secondUserId]);
      await owner.query(
        'INSERT INTO identity.tenant_memberships (id, user_id, tenant_id) VALUES ($1, $2, $3)',
        [secondMembershipId, secondUserId, tenantId],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, role_id) VALUES ($1, $2)',
        [secondMembershipId, roleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, scope_type, scope_id)
         VALUES ($1, 'tenant', $2)`,
        [secondMembershipId, tenantId],
      );

      expect((await appRole.query('SELECT id FROM identity.tenant_memberships')).rowCount).toBe(0);
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      expect((await appRole.query('SELECT id FROM identity.tenant_memberships')).rowCount).toBe(1);
      expect((await appRole.query('SELECT id FROM identity.roles')).rowCount).toBe(0);
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      expect((await appRole.query('SELECT role_id FROM identity.membership_roles')).rowCount).toBe(
        1,
      );
      expect(
        (await appRole.query('SELECT membership_id FROM identity.membership_scopes')).rowCount,
      ).toBe(1);
      expect((await appRole.query('SELECT role_id FROM identity.role_permissions')).rowCount).toBe(
        4,
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
