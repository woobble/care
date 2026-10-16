import { v7 as uuidv7 } from 'uuid';

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Client } from 'pg';

export interface OfficeAdminSession {
  apiToken: string;
  authentikOrigin: string;
  authentikUserId: number;
  displayName: string;
  email: string;
  issuer: string;
  membershipId: string;
  password: string;
  platformUserId: string;
  runId: string;
  subject: string;
  tenantId: string;
  username: string;
}

export async function createOfficeAdminSession(
  database: Client,
  page: Page,
  prefix: string,
): Promise<OfficeAdminSession> {
  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const runId = uuidv7().replaceAll('-', '').slice(-8).toLowerCase();
  const username = `care-${prefix}-${runId}`;
  const displayName = `Care E2E ${prefix} ${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  await waitForAuthentik(authentikOrigin, issuer);
  const authentikUser = await createAuthentikUser(authentikOrigin, apiToken, {
    username,
    name: displayName,
    email,
    password,
  });
  let platformUserId: string | undefined;
  let membershipId: string | undefined;

  try {
    await signInWithAuthentik(page, username, password);
    await expect(
      page.getByText('Your account does not have access to an active organization.'),
    ).toBeVisible();
    const platformUser = await waitForPlatformUser(database, issuer, authentikUser.uuid);
    platformUserId = platformUser.id;

    const tenant = await database.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'demo-care' AND active = true",
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error('Demo Care tenant is missing; run bun run seed');
    const role = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Administrator'",
      [tenantId],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error('Demo Care Administrator role is missing; run bun run seed');

    membershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [membershipId, platformUserId, tenantId],
      );
      await database.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [membershipId, tenantId, roleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [membershipId, tenantId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    await page.reload();
    await page.locator('select[name="tenantId"]').selectOption(tenantId);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/clients$/);

    return {
      apiToken,
      authentikOrigin,
      authentikUserId: authentikUser.pk,
      displayName,
      email,
      issuer,
      membershipId,
      password,
      platformUserId,
      runId,
      subject: authentikUser.uuid,
      tenantId,
      username,
    };
  } catch (error) {
    await cleanupOfficeAdminSession(database, {
      apiToken,
      authentikOrigin,
      authentikUserId: authentikUser.pk,
      issuer,
      subject: authentikUser.uuid,
      ...(platformUserId ? { platformUserId } : {}),
      ...(membershipId ? { membershipId } : {}),
    });
    throw error;
  }
}

export async function cleanupOfficeAdminSession(
  database: Client,
  session: Pick<
    OfficeAdminSession,
    'apiToken' | 'authentikOrigin' | 'authentikUserId' | 'issuer' | 'subject'
  > & { platformUserId?: string; membershipId?: string; invitationEmail?: string },
): Promise<void> {
  await database.query('BEGIN');
  try {
    const mappedUser = await database.query<{ id: string }>(
      `SELECT users.id FROM identity.users AS users
       JOIN identity.external_identities AS external ON external.user_id = users.id
       WHERE external.issuer = $1 AND external.subject = $2`,
      [session.issuer, session.subject],
    );
    const userIds = [
      ...new Set(
        [session.platformUserId, ...mappedUser.rows.map((row) => row.id)].filter(
          (id): id is string => id !== undefined,
        ),
      ),
    ];
    const memberships = userIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM identity.tenant_memberships WHERE user_id = ANY($1::uuid[])',
          [userIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const membershipIds = [
      ...new Set([session.membershipId, ...memberships.rows.map((row) => row.id)].filter(Boolean)),
    ];
    const invitations = session.invitationEmail
      ? await database.query<{ id: string }>(
          'SELECT id FROM identity.tenant_invitations WHERE email = $1',
          [session.invitationEmail],
        )
      : { rows: [] as Array<{ id: string }> };
    const invitationIds = invitations.rows.map((row) => row.id);
    const resourceIds = [...membershipIds, ...invitationIds];
    await database.query(
      `DELETE FROM audit.audit_entries
       WHERE resource_id = ANY($1::uuid[]) OR actor_id = ANY($2::uuid[])`,
      [resourceIds, userIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE event ->> 'aggregateId' = ANY($1::text[])
          OR event -> 'actor' ->> 'id' = ANY($2::text[])`,
      [resourceIds, userIds],
    );
    if (invitationIds.length) {
      await database.query('DELETE FROM identity.tenant_invitations WHERE id = ANY($1::uuid[])', [
        invitationIds,
      ]);
    }
    if (membershipIds.length) {
      await database.query(
        'DELETE FROM identity.membership_roles WHERE membership_id = ANY($1::uuid[])',
        [membershipIds],
      );
      await database.query(
        'DELETE FROM identity.membership_scopes WHERE membership_id = ANY($1::uuid[])',
        [membershipIds],
      );
      await database.query('DELETE FROM identity.tenant_memberships WHERE id = ANY($1::uuid[])', [
        membershipIds,
      ]);
    }
    const authUsers = await database.query<{ id: string }>(
      `SELECT auth_user.id FROM authentication.users AS auth_user
       JOIN authentication.accounts AS account ON account.user_id = auth_user.id
       WHERE account.provider_id = 'authentik' AND account.account_id = $1`,
      [session.subject],
    );
    const authUserIds = authUsers.rows.map((row) => row.id);
    if (authUserIds.length) {
      await database.query('DELETE FROM authentication.sessions WHERE user_id = ANY($1::text[])', [
        authUserIds,
      ]);
      await database.query('DELETE FROM authentication.accounts WHERE user_id = ANY($1::text[])', [
        authUserIds,
      ]);
      await database.query('DELETE FROM authentication.users WHERE id = ANY($1::text[])', [
        authUserIds,
      ]);
    }
    await database.query(
      'DELETE FROM identity.external_identities WHERE issuer = $1 AND subject = $2',
      [session.issuer, session.subject],
    );
    if (userIds.length) {
      await database.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally {
    await authentikRequest(
      session.authentikOrigin,
      session.apiToken,
      `/api/v3/core/users/${session.authentikUserId}/`,
      { method: 'DELETE' },
      true,
    );
  }
}

export async function createAuthentikUser(
  origin: string,
  token: string,
  input: {
    username: string;
    name: string;
    email: string;
    password: string;
    emailVerified?: boolean;
  },
): Promise<{ pk: number; uuid: string }> {
  const user = await authentikRequest<{ pk: number; uuid: string }>(
    origin,
    token,
    '/api/v3/core/users/',
    {
      method: 'POST',
      body: JSON.stringify({
        username: input.username,
        name: input.name,
        email: input.email,
        is_active: true,
        attributes: { care_email_verified: input.emailVerified === true },
      }),
    },
  );
  await authentikRequest(origin, token, `/api/v3/core/users/${user.pk}/set_password/`, {
    method: 'POST',
    body: JSON.stringify({ password: input.password }),
  });
  return user;
}

export async function signInWithAuthentik(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with Authentik' }).click();
  const usernameField = page.locator('input[name="uidField"]');
  try {
    await expect(usernameField).toBeVisible({ timeout: 30_000 });
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(usernameField).toBeVisible({ timeout: 45_000 });
  }
  await usernameField.fill(username);
  await page
    .getByRole('button', { name: /continue|log in|sign in/i })
    .last()
    .click();
  const passwordField = page.getByLabel('Password');
  await passwordField.fill(password);
  await Promise.all([
    page.waitForURL((url) => url.origin === new URL(required('WEB_ORIGIN')).origin, {
      timeout: 60_000,
    }),
    page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click(),
  ]);
}

async function waitForAuthentik(origin: string, issuer: string): Promise<void> {
  const discoveryUrl = new URL('.well-known/openid-configuration', issuer);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // Authentik may still be starting; poll until its discovery endpoint responds.
    // oxlint-disable-next-line no-await-in-loop
    const response = await fetch(discoveryUrl).catch(() => null);
    if (response?.ok) return;
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Authentik at ${origin} did not become ready`);
}

export async function waitForPlatformUser(
  database: Client,
  issuer: string,
  subject: string,
): Promise<{ id: string; membershipCount: number }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // Login provisioning is asynchronous, so query until the local identity appears.
    // oxlint-disable-next-line no-await-in-loop
    const result = await database.query<{ id: string; membership_count: string }>(
      `SELECT users.id,
              (SELECT count(*) FROM identity.tenant_memberships WHERE user_id = users.id)::text AS membership_count
       FROM identity.external_identities
       JOIN identity.users ON users.id = external_identities.user_id
       WHERE external_identities.issuer = $1 AND external_identities.subject = $2`,
      [issuer, subject],
    );
    if (result.rows[0]) {
      return {
        id: result.rows[0].id,
        membershipCount: Number(result.rows[0].membership_count),
      };
    }
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Authentik login did not provision the platform identity');
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

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for focused Authentik browser tests`);
  return value;
}
