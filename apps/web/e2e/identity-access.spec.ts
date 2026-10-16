import { v7 as uuidv7 } from 'uuid';

import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { Client } from 'pg';

import {
  cleanupOfficeAdminSession,
  createAuthentikUser,
  createOfficeAdminSession,
  required,
  signInWithAuthentik,
  waitForPlatformUser,
} from './support/office-admin';
import {
  acceptDialogDuringAction,
  captureReviewElementScreenshot,
  captureReviewScreenshot,
  expectMembershipScopes,
  expectMobileLayoutToFit,
  expectVisibleTextToOmitIds,
  selectEntity,
  submitServerAction,
} from './support/browser';

test('Office staff can invite users and administer tenant access', async ({ page, browser }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  let invitedAuthentikUserId: number | undefined;
  let invitedSubject: string | undefined;
  let invitedPlatformUserId: string | undefined;
  let invitedMembershipId: string | undefined;
  let invitedContext: BrowserContext | undefined;
  let invitedEmail: string | undefined;
  let concurrentAdminContext: BrowserContext | undefined;
  let concurrentAdmin: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'user-access');
    const { apiToken, authentikOrigin, issuer, platformUserId, tenantId, runId } = office;
    const invitedUsername = `care-invite-${runId}`;
    const invitedName = `Invitee E2E ${runId}`;
    invitedEmail = `${invitedUsername}@example.test`;
    const invitedPassword = `Aa1!${uuidv7()}`;
    let invitationId: string | undefined;
    let pilotTenantId: string | undefined;
    let pilotMembershipId: string | undefined;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/administration');
    await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
    await expect(page.getByText('Current tenant', { exact: true })).toBeVisible();
    await captureReviewScreenshot(page, 'administration-overview-desktop-1440.png', true);
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await captureReviewScreenshot(page, 'administration-overview-desktop-dark-1440.png', true);
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await page.goto('/administration/users');
    await expect(page.getByRole('heading', { name: 'Users & Access' })).toBeVisible();
    await captureReviewScreenshot(page, 'administration-members-desktop-1440.png', true);
    const invitationForm = page.locator('section[aria-labelledby="invite-title"]');
    await captureReviewElementScreenshot(
      invitationForm,
      'administration-invitation-desktop-1440.png',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'administration-members-mobile-390.png', true);
    await captureReviewElementScreenshot(
      invitationForm,
      'administration-invitation-mobile-390.png',
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByLabel('Email').fill(invitedEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Invitation recorded.' }),
    ).toBeVisible();
    await page.getByLabel('Email').fill(invitedEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'A pending invitation already exists' }),
    ).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(invitedEmail);
    const pendingInvitation = await database.query<{ id: string }>(
      "SELECT id FROM identity.tenant_invitations WHERE tenant_id = $1 AND email = $2 AND status = 'pending'",
      [tenantId, invitedEmail],
    );
    invitationId = pendingInvitation.rows[0]?.id;
    if (!invitationId) throw new Error('The administration UI did not create an invitation');

    const invitee = await createAuthentikUser(authentikOrigin, apiToken, {
      username: invitedUsername,
      name: invitedName,
      email: invitedEmail,
      password: invitedPassword,
      emailVerified: true,
    });
    invitedAuthentikUserId = invitee.pk;
    invitedSubject = invitee.uuid;
    invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    await signInWithAuthentik(invitedPage, invitedUsername, invitedPassword);
    await expect(
      invitedPage.getByText('Your account does not have access to an active organization.'),
    ).toBeVisible();
    const invitedProvision = await waitForPlatformUser(database, issuer, invitedSubject);
    invitedPlatformUserId = invitedProvision.id;
    expect(invitedProvision.membershipCount).toBe(1);
    const pendingMembership = await database.query<{ id: string; status: string }>(
      'SELECT id, status FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
      [invitedPlatformUserId, tenantId],
    );
    invitedMembershipId = pendingMembership.rows[0]?.id;
    expect(pendingMembership.rows[0]?.status).toBe('pending');

    const roleAndScope = await database.query<{
      office_role_id: string;
      facility_id: string;
      main_office_id: string;
    }>(
      `SELECT role.id AS office_role_id, facility.id AS facility_id, main_office.id AS main_office_id
       FROM identity.roles AS role
       CROSS JOIN organizations.facilities AS facility
       CROSS JOIN organizations.facilities AS main_office
       WHERE role.tenant_id = $1 AND role.name = 'Office'
         AND facility.tenant_id = $1 AND facility.name = 'Facility West'
         AND main_office.tenant_id = $1 AND main_office.name = 'Main Office'`,
      [tenantId],
    );
    const officeRoleId = roleAndScope.rows[0]?.office_role_id;
    const facilityWestId = roleAndScope.rows[0]?.facility_id;
    const mainOfficeId = roleAndScope.rows[0]?.main_office_id;
    if (!invitedMembershipId || !officeRoleId || !facilityWestId || !mainOfficeId) {
      throw new Error('Seeded member, Office role, or Facility West is missing');
    }

    await page.goto('/administration/users');
    await page.getByRole('link', { name: invitedName }).click();
    await expect(page).toHaveURL(
      new RegExp(`/administration/users/${invitedMembershipId}(?:\\?.*)?$`),
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByRole('heading', { name: invitedName })).toBeVisible({ timeout: 30_000 });
    await captureReviewElementScreenshot(
      page.locator('section[aria-labelledby="identity-title"]'),
      'administration-linked-employee-status-desktop-1440.png',
    );
    await captureReviewElementScreenshot(
      page.locator('section[aria-labelledby="roles-title"]'),
      'administration-role-permissions-desktop-1440.png',
    );
    await page.locator('input[name="scopeMode"][value="scoped"]').check();
    await expect(page.locator('input[name="scopeMode"][value="scoped"]')).toBeChecked();
    const facilityScope = page.locator(`input[name="scope"][value="facility:${facilityWestId}"]`);
    await selectEntity(page, 'Facilities', 'Facility West', /Facility West/);
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save scopes' })),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expectMembershipScopes(database, invitedMembershipId, [
      { scopeType: 'facility', scopeId: facilityWestId },
    ]);
    await expect(facilityScope).toHaveCount(1);
    await page
      .getByRole('group', { name: 'Facilities' })
      .getByRole('button', { name: 'Clear selection' })
      .click();
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save scopes' })),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expectMembershipScopes(database, invitedMembershipId, []);
    await expect(facilityScope).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Facilities' }).click();
    const facilitySearch = page.getByRole('combobox', { name: 'Search by name' });
    await facilitySearch.fill('Facility West');
    const facilityResult = page.getByRole('option', { name: /Facility West/ });
    await expect(facilityResult).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('combobox', { name: 'Facilities' }).scrollIntoViewIfNeeded();
    await captureReviewScreenshot(
      page,
      'administration-member-scopes-search-desktop-1440.png',
      false,
      false,
    );
    await facilitySearch.press('ArrowDown');
    await facilitySearch.press('Enter');
    await expect(facilityScope).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Facilities' }).click();
    await expect(page.getByRole('combobox', { name: 'Facilities' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.getByRole('heading', { name: 'Access scopes' }).scrollIntoViewIfNeeded();
    await captureReviewScreenshot(
      page,
      'administration-member-scopes-reselected-desktop-1440.png',
      false,
      false,
    );
    const scopeSection = page.locator('section[aria-labelledby="scopes-title"]');
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewElementScreenshot(
      scopeSection,
      'administration-member-scopes-reselected-tablet-768.png',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewElementScreenshot(
      scopeSection,
      'administration-member-scopes-reselected-mobile-390.png',
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save scopes' })),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expectMembershipScopes(database, invitedMembershipId, [
      { scopeType: 'facility', scopeId: facilityWestId },
    ]);
    concurrentAdminContext = await browser.newContext();
    const concurrentAdminPage = await concurrentAdminContext.newPage();
    concurrentAdmin = await createOfficeAdminSession(
      database,
      concurrentAdminPage,
      'membership-concurrency',
    );
    await concurrentAdminPage.goto(`/administration/users/${invitedMembershipId}`);
    await expect(concurrentAdminPage.getByRole('heading', { name: invitedName })).toBeVisible();
    await selectEntity(page, 'Facilities', 'Main Office', /Main Office/);
    await concurrentAdminPage
      .getByRole('group', { name: 'Facilities' })
      .getByRole('button', { name: 'Clear selection' })
      .click();
    await Promise.all([
      acceptDialogDuringAction(page, () =>
        submitServerAction(page, page.getByRole('button', { name: 'Save scopes' })),
      ),
      acceptDialogDuringAction(concurrentAdminPage, () =>
        submitServerAction(
          concurrentAdminPage,
          concurrentAdminPage.getByRole('button', { name: 'Save scopes' }),
        ),
      ),
    ]);
    const concurrentScopes = await database.query<{
      scope_type: string;
      scope_id: string;
    }>(
      `SELECT scope_type, scope_id FROM identity.membership_scopes
       WHERE tenant_id = $1 AND membership_id = $2 ORDER BY scope_type, scope_id`,
      [tenantId, invitedMembershipId],
    );
    const resultingScopeKeys = new Set(
      concurrentScopes.rows.map((scope) => `${scope.scope_type}:${scope.scope_id}`),
    );
    const isOneSubmittedReplacement =
      resultingScopeKeys.size === 0 ||
      (resultingScopeKeys.size === 2 &&
        resultingScopeKeys.has(`facility:${facilityWestId}`) &&
        resultingScopeKeys.has(`facility:${mainOfficeId}`));
    expect(isOneSubmittedReplacement).toBe(true);
    await page.reload();
    await page
      .getByRole('group', { name: 'Facilities' })
      .getByRole('button', { name: 'Clear selection' })
      .click();
    await selectEntity(page, 'Facilities', 'Facility West', /Facility West/);
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save scopes' })),
    );
    await expectMembershipScopes(database, invitedMembershipId, [
      { scopeType: 'facility', scopeId: facilityWestId },
    ]);
    const officeRole = page.locator(`button[role="checkbox"][value="${officeRoleId}"]`);
    await officeRole.click();
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save roles' })),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await officeRole.click();
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save roles' })),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expect(officeRole).not.toBeChecked();
    await officeRole.click();
    await acceptDialogDuringAction(page, () =>
      submitServerAction(page, page.getByRole('button', { name: 'Save roles' })),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expect(officeRole).toBeChecked();
    await page.getByRole('button', { name: 'Activate membership' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('Office', { exact: true })).toBeVisible();
    await expect(facilityScope).toHaveCount(1);

    await page.goto('/administration/audit');
    await expect(page.getByText('Membership activated', { exact: true })).toBeVisible();
    await expectVisibleTextToOmitIds(page, [platformUserId, invitedMembershipId]);

    await invitedPage.goto('/');
    await invitedPage.locator('select[name="tenantId"]').selectOption(tenantId);
    await invitedPage.getByRole('button', { name: 'Continue' }).click();
    await expect(invitedPage).toHaveURL(/\/clients$/);
    await invitedPage.goto('/administration/facilities');
    await expect(invitedPage.getByText('Facility West', { exact: true })).toBeVisible();
    await expect(
      invitedPage.locator(`a[href^="/administration/facilities/"]`).filter({
        hasText: 'Facility West',
      }),
    ).toBeVisible();
    await expect(invitedPage.getByText('Main Office', { exact: true })).toHaveCount(0);

    await page.goto(`/administration/users/${invitedMembershipId}`);
    await page.getByRole('button', { name: 'Deactivate membership' }).click();
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activate membership' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await acceptDialogDuringAction(page, () =>
      page.getByRole('button', { name: 'Revoke access' }).click(),
    );
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await expect(page.getByText('Revoked memberships cannot be reactivated.')).toBeVisible();

    const pilotTenant = await database.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'muster-betreuungsdienst-nrw' AND active = true",
    );
    pilotTenantId = pilotTenant.rows[0]?.id;
    if (pilotTenantId) {
      const pilotAdministrator = await database.query<{ id: string }>(
        "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Administrator'",
        [pilotTenantId],
      );
      const pilotAdministratorRoleId = pilotAdministrator.rows[0]?.id;
      if (!pilotAdministratorRoleId || !platformUserId) {
        throw new Error('The pilot tenant or E2E administrator is missing');
      }
      pilotMembershipId = uuidv7();
      await database.query('BEGIN');
      try {
        await database.query(
          "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
          [pilotMembershipId, platformUserId, pilotTenantId],
        );
        await database.query(
          'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
          [pilotMembershipId, pilotTenantId, pilotAdministratorRoleId],
        );
        await database.query(
          "INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id) VALUES ($1, $2, 'tenant', $2)",
          [pilotMembershipId, pilotTenantId],
        );
        await database.query('COMMIT');
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      }

      await page.goto('/');
      await page.locator('select[name="tenantId"]').selectOption(pilotTenantId);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(/\/clients$/);
      await page.goto('/operations/tasks?q=%5BSYNTHETIC%20PILOT%5D', {
        waitUntil: 'domcontentloaded',
      });
      await expect(
        page.getByRole('heading', { name: 'Manual tasks', exact: true, level: 1 }),
      ).toBeVisible();
      await expect(
        page.locator('section[aria-labelledby="task-list-title"] > ul > li'),
      ).toHaveCount(15);
      const claimTaskTitle = '[SYNTHETIC PILOT] Review local claim exercise';
      await page.getByRole('link', { name: /Review local claim exercise/ }).click();
      await expect(page.getByRole('heading', { name: claimTaskTitle })).toBeVisible();
      const claimSourceLink = page.getByRole('link', { name: 'Open source record' });
      await expect(claimSourceLink).toHaveAttribute('href', /^\/billing\/claims\/[0-9a-f-]{36}$/i);
      const claimSourceUrl = new URL((await claimSourceLink.getAttribute('href'))!, page.url())
        .href;
      await claimSourceLink.click();
      await expect(page).toHaveURL(claimSourceUrl);
      await expect(
        page.locator('section[aria-labelledby="claim-summary"]').getByText('Accepted', {
          exact: true,
        }),
      ).toBeVisible();
      await page.goto('/operations/deadlines', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Deadlines & Reminders' })).toBeVisible();

      const pilotOrganization = await database.query<{ id: string }>(
        "SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = 'Muster Betreuungsdienst NRW'",
        [pilotTenantId],
      );
      const pilotOrganizationId = pilotOrganization.rows[0]?.id;
      if (!pilotOrganizationId) throw new Error('The synthetic pilot organization is missing');
      const measuredRoutes = [
        `/operations?organizationId=${pilotOrganizationId}`,
        `/clients?q=Musterkunde&page=1&pageSize=20&organizationId=${pilotOrganizationId}`,
        `/employees?q=Betreuungskraft&page=1&pageSize=20&organizationId=${pilotOrganizationId}`,
        `/planning?date=2026-10-16&view=week&organizationId=${pilotOrganizationId}`,
        `/benefits?period=2026-10&search=Musterkunde`,
        `/billing?from=2026-10-12&until=2026-11-08&organizationId=${pilotOrganizationId}`,
        `/billing/claims?organizationId=${pilotOrganizationId}&page=1&pageSize=20`,
        `/operations/tasks?organizationId=${pilotOrganizationId}&search=%5BSYNTHETIC%20PILOT%5D&page=1&pageSize=20`,
      ];
      const performanceObservations: Array<{ route: string; elapsedMs: number }> = [];
      await measuredRoutes.reduce<Promise<void>>(
        (navigation, route) =>
          navigation.then(async () => {
            const startedAt = Date.now();
            const response = await page.goto(route);
            expect(response?.status(), `Expected ${route} to load successfully`).toBe(200);
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
            performanceObservations.push({ route, elapsedMs: Date.now() - startedAt });
          }),
        Promise.resolve(),
      );
      console.log(`GOAL13_PILOT_PAGE_TIMINGS ${JSON.stringify(performanceObservations)}`);
    }
  } finally {
    try {
      await invitedContext?.close();
    } finally {
      try {
        await concurrentAdminContext?.close();
        if (concurrentAdmin) {
          await cleanupOfficeAdminSession(database, concurrentAdmin);
        }
        if (office) {
          await cleanupOfficeAdminSession(database, {
            ...office,
            ...(invitedEmail ? { invitationEmail: invitedEmail } : {}),
          });
        }
      } finally {
        try {
          if (office && invitedAuthentikUserId !== undefined && invitedSubject) {
            await cleanupOfficeAdminSession(database, {
              apiToken: office.apiToken,
              authentikOrigin: office.authentikOrigin,
              authentikUserId: invitedAuthentikUserId,
              issuer: office.issuer,
              subject: invitedSubject,
              ...(invitedPlatformUserId ? { platformUserId: invitedPlatformUserId } : {}),
              ...(invitedMembershipId ? { membershipId: invitedMembershipId } : {}),
            });
          }
        } finally {
          await database.end();
        }
      }
    }
  }
});
