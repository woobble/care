import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { expectTargetViewportLayouts } from './support/browser';

const reviewDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../artifacts/ui-foundation-review',
);

test('Caregiver Today review screenshots use a temporary assigned employee', async ({ page }) => {
  test.setTimeout(120_000);
  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = uuidv7();
  const username = `care-review-${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  const displayName = `Care Review ${runId}`;
  let user: { pk: number; uuid: string } | undefined;
  let platformUserId: string | undefined;
  let tenantId: string | undefined;
  let membershipId: string | undefined;
  let employeeId: string | undefined;
  let previousEmployeeUserId: string | null = null;

  await database.connect();
  try {
    const target = await database.query<{
      employee_id: string;
      tenant_id: string;
      user_id: string | null;
      visit_id: string;
      visit_date: string;
      execution_id: string | null;
    }>(`
      SELECT employee.id AS employee_id, employee.tenant_id, employee.user_id,
        visit.id AS visit_id,
        (visit.planned_start AT TIME ZONE 'Europe/Berlin')::date::text AS visit_date,
        execution.id AS execution_id
      FROM employees.employees AS employee
      JOIN scheduling.visit_assignments AS assignment
        ON assignment.tenant_id = employee.tenant_id AND assignment.employee_id = employee.id
      JOIN scheduling.visits AS visit
        ON visit.tenant_id = assignment.tenant_id AND visit.id = assignment.visit_id
      LEFT JOIN visit_execution.executions AS execution
        ON execution.tenant_id = visit.tenant_id AND execution.visit_id = visit.id
      WHERE employee.status = 'active'
        AND employee.user_id IS NULL
        AND assignment.status = 'active'
        AND visit.status IN ('planned', 'confirmed')
        AND (visit.planned_start AT TIME ZONE 'Europe/Berlin')::date =
            (now() AT TIME ZONE 'Europe/Berlin')::date
      ORDER BY visit.planned_start, employee.id
      LIMIT 1
    `);
    const employee = target.rows[0];
    if (!employee)
      throw new Error('No unlinked caregiver with an assigned visit today is available');
    employeeId = employee.employee_id;
    tenantId = employee.tenant_id;
    previousEmployeeUserId = employee.user_id;
    user = await createAuthentikUser(authentikOrigin, apiToken, {
      username,
      email,
      name: displayName,
      password,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const hideNextDevToolbar = () => {
        const style = document.createElement('style');
        style.textContent = 'nextjs-portal { display: none !important; }';
        document.head?.append(style);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideNextDevToolbar, { once: true });
      } else {
        hideNextDevToolbar();
      }
    });
    await signInWithAuthentik(page, username, password);
    await expect(
      page.getByText('Your account does not have access to an active organization.'),
    ).toBeVisible();
    platformUserId = await waitForPlatformUser(database, issuer, user.uuid);

    const role = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Caregiver'",
      [tenantId],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error('The assigned visit tenant has no Caregiver role');

    membershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [membershipId, platformUserId, tenantId],
      );
      await database.query(
        `INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id)
         VALUES ($1, $2, $3)`,
        [membershipId, tenantId, roleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [membershipId, tenantId, tenantId],
      );
      await database.query(
        'UPDATE employees.employees SET user_id = $1 WHERE tenant_id = $2 AND id = $3 AND user_id IS NULL',
        [platformUserId, tenantId, employeeId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    page.setDefaultTimeout(15_000);
    await page.goto('/');
    await page.locator('select[name="tenantId"]').selectOption(tenantId);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await page.goto('/care/today');
    await expect(page.getByRole('heading', { name: 'My visits' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'My visits' }).getByRole('listitem').first(),
    ).toBeVisible();

    await mkdir(reviewDirectory, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'caregiver-today-desktop-light.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await capture(page, 'caregiver-today-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'caregiver-today-mobile-light.png', true);
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await capture(page, 'caregiver-today-mobile-dark.png', true);

    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await page.goto(`/care/calendar?date=${employee.visit_date}&view=agenda`);
    await expect(page.getByRole('heading', { name: 'My calendar' })).toBeVisible();
    const calendarVisitLink = page.locator(`a[href="/care/visits/${employee.visit_id}"]`).first();
    await expect(calendarVisitLink).toBeVisible();
    const visitDateLabel = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeZone: 'Europe/Berlin',
    }).format(new Date(`${employee.visit_date}T12:00:00.000Z`));
    await expect(page.getByText(visitDateLabel, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Monday, October 26, 2026', { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page).toHaveURL(/view=day/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toBeVisible();
    await expect(calendarVisitLink).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await capture(page, 'caregiver-calendar-desktop-1440.png', true);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page).toHaveURL(/view=week/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await capture(page, 'caregiver-calendar-tablet-768.png', true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await expect(page).toHaveURL(/view=agenda/);
    await expect(calendarVisitLink).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await capture(page, 'caregiver-calendar-mobile-390.png', true);

    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page).toHaveURL(/view=month/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await expect(page).toHaveURL(/view=agenda/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toHaveCount(0);
    const assignedVisit = page.locator(`a[href="/care/visits/${employee.visit_id}"]`).first();
    await expect(assignedVisit).toBeVisible();
    const clientName = (await assignedVisit.textContent())?.trim();
    if (!clientName) throw new Error('The assigned visit link has no client name');
    await assignedVisit.click();
    await expect(page).toHaveURL(`/care/visits/${employee.visit_id}`);
    await expect(page.getByRole('heading', { name: clientName, exact: true })).toBeVisible();
    if (!employee.execution_id) {
      await expect(page.getByRole('button', { name: 'Start visit' })).toBeVisible();
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoHorizontalOverflow(page);
    await capture(
      page,
      employee.execution_id
        ? 'caregiver-assigned-visit-desktop.png'
        : 'caregiver-visit-before-start-desktop.png',
      true,
    );
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await capture(
      page,
      employee.execution_id
        ? 'caregiver-assigned-visit-tablet-768.png'
        : 'caregiver-visit-before-start-tablet-768.png',
      true,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(
      page,
      employee.execution_id
        ? 'caregiver-assigned-visit-mobile-390.png'
        : 'caregiver-visit-before-start-mobile-390.png',
      true,
    );
    await page.setViewportSize({ width: 360, height: 844 });
    await assertNoHorizontalOverflow(page);
  } finally {
    if (platformUserId && tenantId && membershipId) {
      await cleanupReviewIdentity(database, {
        ...(employeeId ? { employeeId } : {}),
        membershipId,
        platformUserId,
        previousEmployeeUserId,
        ...(user ? { subject: user.uuid } : {}),
        tenantId,
        issuer,
      });
    }
    await database.end().catch(() => undefined);
    if (user) {
      await authentikRequest(authentikOrigin, apiToken, `/api/v3/core/users/${user.pk}/`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
});

async function cleanupReviewIdentity(
  database: Client,
  input: {
    employeeId?: string;
    membershipId: string;
    platformUserId: string;
    previousEmployeeUserId: string | null;
    subject?: string;
    tenantId: string;
    issuer: string;
  },
): Promise<void> {
  await database.query('BEGIN');
  try {
    if (input.employeeId) {
      await database.query(
        'UPDATE employees.employees SET user_id = $1 WHERE tenant_id = $2 AND id = $3 AND user_id = $4',
        [input.previousEmployeeUserId, input.tenantId, input.employeeId, input.platformUserId],
      );
    }
    await database.query('DELETE FROM identity.membership_roles WHERE membership_id = $1', [
      input.membershipId,
    ]);
    await database.query('DELETE FROM identity.membership_scopes WHERE membership_id = $1', [
      input.membershipId,
    ]);
    await database.query('DELETE FROM identity.tenant_memberships WHERE id = $1', [
      input.membershipId,
    ]);
    if (input.subject) {
      await database.query(
        'DELETE FROM identity.external_identities WHERE issuer = $1 AND subject = $2',
        [input.issuer, input.subject],
      );
      const authUsers = await database.query<{ id: string }>(
        `SELECT auth_user.id
         FROM authentication.users AS auth_user
         JOIN authentication.accounts AS account ON account.user_id = auth_user.id
         WHERE account.provider_id = 'authentik' AND account.account_id = $1`,
        [input.subject],
      );
      const authUserIds = authUsers.rows.map(({ id }) => id);
      if (authUserIds.length) {
        await database.query(
          'DELETE FROM authentication.sessions WHERE user_id = ANY($1::text[])',
          [authUserIds],
        );
        await database.query(
          'DELETE FROM authentication.accounts WHERE user_id = ANY($1::text[])',
          [authUserIds],
        );
        await database.query('DELETE FROM authentication.users WHERE id = ANY($1::text[])', [
          authUserIds,
        ]);
      }
    }
    await database.query('DELETE FROM identity.users WHERE id = $1', [input.platformUserId]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function createAuthentikUser(
  origin: string,
  token: string,
  input: { username: string; name: string; email: string; password: string },
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
        attributes: { care_email_verified: true },
      }),
    },
  );
  await authentikRequest(origin, token, `/api/v3/core/users/${user.pk}/set_password/`, {
    method: 'POST',
    body: JSON.stringify({ password: input.password }),
  });
  return user;
}

async function signInWithAuthentik(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with Authentik' }).click();
  await page.locator('input[name="uidField"]').fill(username);
  await page
    .getByRole('button', { name: /continue|log in|sign in/i })
    .last()
    .click();
  const passwordField = page.getByLabel('Password');
  await passwordField.fill(password);
  const webOrigin = new URL(required('WEB_ORIGIN')).origin;
  await Promise.all([
    page.waitForURL((url) => url.origin === webOrigin, { timeout: 60_000 }),
    page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click(),
  ]);
}

async function waitForPlatformUser(
  database: Client,
  issuer: string,
  subject: string,
): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
    const result = await database.query<{ id: string }>(
      `SELECT users.id
       FROM identity.external_identities
       JOIN identity.users ON users.id = external_identities.user_id
       WHERE external_identities.issuer = $1 AND external_identities.subject = $2`,
      [issuer, subject],
    );
    if (result.rows[0]) return result.rows[0].id;
    // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('Authentik login did not provision the platform identity');
}

async function authentikRequest<T = unknown>(
  origin: string,
  token: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Authentik API ${path} returned ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function capture(page: Page, filename: string, fullPage = false): Promise<void> {
  await expectTargetViewportLayouts(page);
  await page.screenshot({ path: resolve(reviewDirectory, filename), fullPage });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for caregiver review capture`);
  return value;
}
