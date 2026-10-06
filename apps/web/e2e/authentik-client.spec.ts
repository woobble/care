import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';

test('Authentik login provisions a user and permits the demo client lifecycle', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = randomUUID().slice(0, 8);
  const username = `care-e2e-${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${randomUUID()}`;
  let authentikUserId: number | undefined;
  let subject: string | undefined;
  let platformUserId: string | undefined;
  let tenantId: string | undefined;
  let membershipId: string | undefined;
  let roleId: string | undefined;
  let clientId: string | undefined;

  await database.connect();
  try {
    await waitForAuthentik(authentikOrigin, issuer);
    const createdUser = await authentikRequest<{ pk: number; uuid: string }>(
      authentikOrigin,
      apiToken,
      '/api/v3/core/users/',
      {
        method: 'POST',
        body: JSON.stringify({ username, name: `Care E2E ${runId}`, email, is_active: true }),
      },
    );
    authentikUserId = createdUser.pk;
    subject = createdUser.uuid;
    await authentikRequest(
      authentikOrigin,
      apiToken,
      `/api/v3/core/users/${authentikUserId}/set_password/`,
      { method: 'POST', body: JSON.stringify({ password }) },
    );

    await page.goto('/');
    await page.getByRole('button', { name: 'Mit Authentik anmelden' }).click();
    await page.locator('input[name="uidField"]').fill(username);
    await page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click();
    const passwordField = page.getByLabel('Password');
    await passwordField.fill(password);
    await expect(passwordField).toHaveValue(password);
    const webOrigin = new URL(required('WEB_ORIGIN')).origin;
    await Promise.all([
      page.waitForURL((url) => url.origin === webOrigin, { timeout: 60_000 }),
      page
        .getByRole('button', { name: /continue|log in|sign in/i })
        .last()
        .click(),
    ]);
    await expect(
      page.getByText('Ihr Benutzerkonto hat noch keinen aktiven Mandantenzugriff.'),
    ).toBeVisible();

    const provisioned = await waitForPlatformUser(database, issuer, subject);
    platformUserId = provisioned.id;
    expect(provisioned.membershipCount).toBe(0);

    const tenant = await database.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'demo-care' AND active = true",
    );
    tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error('Demo Care tenant is missing; run the development seed');

    roleId = randomUUID();
    membershipId = randomUUID();
    await database.query('BEGIN');
    try {
      await database.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        roleId,
        tenantId,
        `E2E ${runId}`,
      ]);
      await database.query(
        `INSERT INTO identity.role_permissions (role_id, permission)
         VALUES ($1, 'client.read'), ($1, 'client.create'), ($1, 'client.update'), ($1, 'client.archive')`,
        [roleId],
      );
      await database.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [membershipId, platformUserId, tenantId],
      );
      await database.query(
        'INSERT INTO identity.membership_roles (membership_id, role_id) VALUES ($1, $2)',
        [membershipId, roleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, scope_type, scope_id)
         VALUES ($1, 'tenant', $2)`,
        [membershipId, tenantId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    await page.reload();
    await page.getByLabel('Mandant').selectOption(tenantId);
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('heading', { name: 'Klientinnen und Klienten' })).toBeVisible();

    await page.getByRole('link', { name: 'Klient anlegen' }).click();
    await page.getByLabel('Vorname').fill('E2E');
    await page.getByLabel('Nachname').fill(runId);
    await page.getByRole('button', { name: 'Klient anlegen' }).click();
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible();
    await expect(page.getByText('Ausstehend')).toBeVisible();
    clientId = (await page.locator('input[name="id"]').getAttribute('value')) ?? undefined;

    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(page.getByText('Aktiv')).toBeVisible();
    await page.getByRole('button', { name: 'Archivieren' }).click();
    await expect(page.getByText('Archiviert')).toBeVisible();

    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
    await page.goto('/clients/new');
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  } finally {
    try {
      await cleanup(database, {
        issuer,
        ...(subject ? { subject } : {}),
        ...(platformUserId ? { platformUserId } : {}),
        ...(membershipId ? { membershipId } : {}),
        ...(roleId ? { roleId } : {}),
        ...(clientId ? { clientId } : {}),
      });
    } finally {
      await database.end();
      if (authentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${authentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
    }
  }
});

async function waitForAuthentik(origin: string, issuer: string): Promise<void> {
  const discoveryUrl = new URL('.well-known/openid-configuration', issuer);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(discoveryUrl).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Authentik at ${origin} did not become ready`);
}

async function authentikRequest<T = unknown>(
  origin: string,
  token: string,
  path: string,
  init: RequestInit,
  allowMissing = false,
): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (allowMissing && response.status === 404) return undefined as T;
  if (!response.ok) throw new Error(`Authentik API ${path} returned ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function waitForPlatformUser(
  database: Client,
  issuer: string,
  subject: string,
): Promise<{ id: string; membershipCount: number }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await database.query<{ id: string; membership_count: string }>(
      `SELECT users.id,
              (SELECT count(*) FROM identity.tenant_memberships WHERE user_id = users.id)::text AS membership_count
       FROM identity.external_identities
       JOIN identity.users ON users.id = external_identities.user_id
       WHERE external_identities.issuer = $1 AND external_identities.subject = $2`,
      [issuer, subject],
    );
    if (result.rows[0]) {
      return { id: result.rows[0].id, membershipCount: Number(result.rows[0].membership_count) };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Authentik login did not provision the platform identity');
}

async function cleanup(
  database: Client,
  input: {
    issuer: string;
    subject?: string;
    platformUserId?: string;
    membershipId?: string;
    roleId?: string;
    clientId?: string;
  },
): Promise<void> {
  await database.query('BEGIN');
  try {
    const userId =
      input.platformUserId ??
      (
        await database.query<{ user_id: string }>(
          'SELECT user_id FROM identity.external_identities WHERE issuer = $1 AND subject = $2',
          [input.issuer, input.subject],
        )
      ).rows[0]?.user_id;
    if (input.clientId) {
      await database.query('DELETE FROM audit.audit_entries WHERE resource_id = $1', [
        input.clientId,
      ]);
      await database.query(
        `DELETE FROM platform.outbox_messages
         WHERE event ->> 'aggregateId' = $1 OR event -> 'payload' ->> 'clientId' = $1`,
        [input.clientId],
      );
      await database.query('DELETE FROM clients.clients WHERE id = $1', [input.clientId]);
    }
    if (input.membershipId) {
      await database.query('DELETE FROM identity.membership_roles WHERE membership_id = $1', [
        input.membershipId,
      ]);
      await database.query('DELETE FROM identity.membership_scopes WHERE membership_id = $1', [
        input.membershipId,
      ]);
      await database.query('DELETE FROM identity.tenant_memberships WHERE id = $1', [
        input.membershipId,
      ]);
    }
    if (input.roleId) {
      await database.query('DELETE FROM identity.role_permissions WHERE role_id = $1', [
        input.roleId,
      ]);
      await database.query('DELETE FROM identity.roles WHERE id = $1', [input.roleId]);
    }
    const authUserIds = await database.query<{ id: string }>(
      `SELECT auth_user.id
       FROM authentication.users AS auth_user
       JOIN authentication.accounts AS account ON account.user_id = auth_user.id
       WHERE account.provider_id = 'authentik' AND account.account_id = $1`,
      [input.subject],
    );
    const ids = authUserIds.rows.map((row) => row.id);
    if (ids.length) {
      await database.query('DELETE FROM authentication.sessions WHERE user_id = ANY($1::text[])', [
        ids,
      ]);
      await database.query('DELETE FROM authentication.accounts WHERE user_id = ANY($1::text[])', [
        ids,
      ]);
      await database.query('DELETE FROM authentication.users WHERE id = ANY($1::text[])', [ids]);
    }
    if (userId) {
      await database.query(
        'DELETE FROM identity.external_identities WHERE issuer = $1 AND subject = $2 AND user_id = $3',
        [input.issuer, input.subject, userId],
      );
      await database.query('DELETE FROM identity.users WHERE id = $1', [userId]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Authentik E2E test`);
  return value;
}
