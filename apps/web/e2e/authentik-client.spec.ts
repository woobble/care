import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { loadStorageConfig } from '@care/config';
import { createS3ObjectStorage } from '@care/storage';

import { required } from './support/office-admin';
import {
  acceptDialogDuringAction,
  addDaysToDate,
  captureReviewScreenshot,
  dateInBerlin,
  expectMobileLayoutToFit,
  reviewDirectory,
  selectEntity,
  weekdayInBerlin,
} from './support/browser';

const retiredModuleNavigationName =
  /^(?:Medications?|Clinical Documentation|Care Planning|Competency Policies|Workforce Compliance|Medikamente?|Klinische Dokumentation|Pflegeplanung|Kompetenzrichtlinien|Personal Compliance)$/i;

test('Office staff can configure services, clients, benefits, and agreements', async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(reviewDirectory, { recursive: true });
  page.setDefaultTimeout(15_000);
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
  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = uuidv7().replaceAll('-', '').slice(-8).toLowerCase();
  const serviceValidFrom = dateInBerlin();
  const username = `care-e2e-${runId}`;
  const displayName = `Care E2E ${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  const caregiverEmail = `caregiver-e2e-${runId}@example.test`;
  const e2ePayerName = `E2E Payer ${runId}`;
  let authentikUserId: number | undefined;
  let subject: string | undefined;
  let platformUserId: string | undefined;
  let tenantId: string | undefined;
  let adminMembershipId: string | undefined;
  let clientId: string | undefined;
  let agreementClientId: string | undefined;
  let replacementEmployeeId: string | undefined;
  let serviceId: string | undefined;
  let billingRecordsMayExist = false;
  let representativeContactId: string | undefined;
  const serviceCategoryName = `E2E Category ${runId}`;
  const codeSuffix = runId.slice(-24);
  const serviceCategoryCode = `E2E-CAT-${codeSuffix}`;
  const serviceCode = `E2E-SVC-${codeSuffix}`;
  const e2eOrganizationName = `E2E Organization ${runId}`;
  const e2eFacilityName = `E2E Facility ${runId}`;
  const e2eTeamName = `E2E Team ${runId}`;
  const employeePersonnelNumber = `E2E-${runId}`;
  const replacementEmployeePersonnelNumber = `E2E-COVER-${runId}`;

  await database.connect();
  try {
    await waitForAuthentik(authentikOrigin, issuer);
    await page.goto('/');
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'CARE_LOCALE')).toBe(
      false,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByRole('button', { name: 'Sprache' })).toBeVisible();
    await page.getByRole('button', { name: 'Sprache' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const createdUser = await createAuthentikUser(authentikOrigin, apiToken, {
      username,
      name: displayName,
      email,
      password,
    });
    authentikUserId = createdUser.pk;
    subject = createdUser.uuid;
    await signInWithAuthentik(page, username, password);
    const noAccessMessage = page.getByText(
      'Your account does not have access to an active organization.',
    );
    if (!(await noAccessMessage.isVisible())) {
      const authState = await database.query<{
        session_count: string;
        account_count: string;
        access_token_count: string;
        refresh_token_count: string;
      }>(
        `SELECT
           (SELECT count(*) FROM authentication.sessions AS session
            JOIN authentication.users AS auth_user ON auth_user.id = session.user_id
            WHERE auth_user.email = $1)::text AS session_count,
           (SELECT count(*) FROM authentication.accounts AS account
            JOIN authentication.users AS auth_user ON auth_user.id = account.user_id
            WHERE auth_user.email = $1)::text AS account_count,
           (SELECT count(*) FROM authentication.accounts AS account
            JOIN authentication.users AS auth_user ON auth_user.id = account.user_id
            WHERE auth_user.email = $1 AND account.access_token IS NOT NULL)::text AS access_token_count,
           (SELECT count(*) FROM authentication.accounts AS account
            JOIN authentication.users AS auth_user ON auth_user.id = account.user_id
            WHERE auth_user.email = $1 AND account.refresh_token IS NOT NULL)::text AS refresh_token_count`,
        [email],
      );
      throw new Error(
        `Authentik login reached ${new URL(page.url()).pathname}${new URL(page.url()).search}; ` +
          `Better Auth records: ${JSON.stringify(authState.rows[0] ?? {})}`,
      );
    }

    const provisioned = await waitForPlatformUser(database, issuer, subject);
    platformUserId = provisioned.id;
    expect(provisioned.membershipCount).toBe(0);

    const tenant = await database.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'demo-care' AND active = true",
    );
    tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error('Demo Care tenant is missing; run the development seed');

    const adminRole = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Administrator'",
      [tenantId],
    );
    const adminRoleId = adminRole.rows[0]?.id;
    if (!adminRoleId) throw new Error('Demo Care Administrator role is missing; run bun run seed');
    adminMembershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [adminMembershipId, platformUserId, tenantId],
      );
      await database.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [adminMembershipId, tenantId, adminRoleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [adminMembershipId, tenantId, tenantId],
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
    await page.goto('/clients?localeCheck=1');
    await expect(page).toHaveURL(/\/clients\?localeCheck=1$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.locator('nav[aria-label]').getByRole('link', { name: retiredModuleNavigationName }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();

    const sidebar = page.locator('#office-sidebar');
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();
    await expect(page).toHaveURL(/\/clients\?localeCheck=1$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(
      page.getByRole('heading', { name: 'Klientinnen und Klienten', exact: true }),
    ).toBeVisible();
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByRole('button', { name: 'Sprache' })).toBeVisible();
    await page.getByRole('button', { name: 'Sprache' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/clients\?localeCheck=1$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/new$/, { timeout: 30_000 });
    await page.locator('#firstName').fill('E2E');
    await page.locator('#lastName').fill(runId);
    await selectEntity(page, 'Organization', 'Demo Pflegedienst', 'Demo Pflegedienst');
    await selectEntity(page, 'Primary facility', 'Facility West', /Facility West/);
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/i);
    clientId = new URL(page.url()).pathname.split('/').at(-1);
    if (!clientId) throw new Error('The office UI did not redirect to the created client');
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^Pending$/ })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'Add address' }).click();
    await page.locator('#new-address-street').fill(`E2E Street ${runId}`);
    await page.locator('#new-address-house').fill('12');
    await page.locator('#new-address-postal').fill('10115');
    await page.locator('#new-address-city').fill('Berlin');
    const addressForm = page.locator('details').filter({ hasText: 'Add address' }).locator('form');
    await addressForm.getByRole('checkbox', { name: 'Use as primary address' }).click();
    const clientPath = new URL(page.url()).pathname;
    const addressResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === clientPath,
    );
    await Promise.all([
      addressForm.getByRole('button', { name: 'Add address' }).click(),
      addressResponse,
    ]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Home address · Primary' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add contact' }).click();
    await page.locator('#new-contact-first').fill('E2E');
    await page.locator('#new-contact-last').fill('Kontakt');
    await page.getByRole('checkbox', { name: 'Primary contact' }).click();
    await page.getByRole('checkbox', { name: 'Emergency contact' }).click();
    await page.getByRole('button', { name: 'Add contact' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Kontakt' })).toBeVisible();
    const savedContact = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'E2E Kontakt' }) });
    await expect(savedContact).toContainText('Emergency contact');

    await page.locator('summary').filter({ hasText: 'Add insurance relationship' }).click();
    const insuranceForm = page
      .locator('details')
      .filter({ hasText: 'Add insurance relationship' })
      .locator('form');
    await insuranceForm.locator('#new-insurer-name').fill('E2E Demo Insurance');
    await insuranceForm.locator('#new-insurance-number').fill(`E2E-PRIVATE-${runId}`);
    await insuranceForm.getByRole('checkbox', { name: 'Primary insurance' }).click();
    await insuranceForm.getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'E2E Demo Insurance · Primary' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add care level record' }).click();
    await page.locator('#new-grade').fill('3');
    await page.locator('#new-grade-from').fill('2000-01-01');
    await page.locator('#new-grade-status').selectOption('confirmed');
    await page.getByRole('button', { name: 'Save care level' }).click();
    await expect(page.getByText('Care level 3 · Confirmed')).toBeVisible();
    await expect(page.getByText('Care level history added', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('span').filter({ hasText: /^Active$/ })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    if ((await sidebar.getAttribute('data-collapsed')) === 'true') {
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
    }
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await captureReviewScreenshot(page, 'client-detail-desktop-dark.png', true);
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await captureReviewScreenshot(page, 'client-detail-desktop-light.png', true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'client-detail-mobile-390.png', true);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'client-detail-tablet-768.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    const clientArchivePath = new URL(page.url()).pathname;
    const clientArchiveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === clientArchivePath,
    );
    await Promise.all([
      page.getByRole('button', { name: 'Archive' }).click(),
      clientArchiveResponse,
    ]);
    await page.reload();
    await expect(page.locator('span').filter({ hasText: /^Archived$/ })).toBeVisible();

    await page.goto('/administration/organizations');
    await expect(page.getByRole('heading', { name: 'Create organization' })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(e2eOrganizationName);
    await page.getByLabel('Legal name').fill(`E2E Betreuungsdienst ${runId}`);
    await page.getByLabel('Address').fill('E2E Provider Street 1, 10115 Berlin');
    const organizationCreateUrlBefore = page.url();
    const organizationCreateNavigation = page.waitForURL(
      (url) => url.href !== organizationCreateUrlBefore,
      { timeout: 15_000 },
    );
    await Promise.all([
      page.getByRole('button', { name: 'Create organization' }).click(),
      organizationCreateNavigation,
    ]);
    const organizationCreateUrl = new URL(page.url());
    if (organizationCreateUrl.pathname === '/administration/organizations') {
      const alertText = await page.getByRole('alert').textContent();
      throw new Error(
        `Organization creation failed: ${organizationCreateUrl.searchParams.get('error') ?? 'unknown'}; ${alertText?.trim() ?? 'no error message'}`,
      );
    }
    await expect(page.getByRole('heading', { name: e2eOrganizationName })).toBeVisible();
    const e2eOrganizationRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, e2eOrganizationName],
    );
    const e2eOrganizationId = e2eOrganizationRow.rows[0]?.id;
    if (!e2eOrganizationId) throw new Error('The office UI did not create the organization');

    await page.goto(`/administration/organizations?q=${encodeURIComponent(e2eOrganizationName)}`);
    await expect(page.getByRole('heading', { name: e2eOrganizationName })).toBeVisible();
    await captureReviewScreenshot(page, 'administration-organizations-desktop-light.png', true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'administration-organizations-mobile-390.png', true);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'administration-organizations-tablet-768.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/administration/facilities');
    await expect(page.getByRole('heading', { name: 'Create facility' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'All facilities' })).toBeVisible();
    await page.goto(`/administration/organizations/${e2eOrganizationId}`);
    await page.locator('#facility-name').fill(e2eFacilityName);
    await page.getByRole('button', { name: 'Create facility' }).click();
    await expect(page.getByRole('heading', { name: e2eFacilityName })).toBeVisible();
    const e2eFacilityRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.facilities WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, e2eOrganizationId, e2eFacilityName],
    );
    const e2eFacilityId = e2eFacilityRow.rows[0]?.id;
    if (!e2eFacilityId) throw new Error('The office UI did not create the facility');

    await page.goto(`/administration/facilities?q=${encodeURIComponent(e2eFacilityName)}`);
    await expect(page.getByRole('link', { name: e2eFacilityName })).toBeVisible();
    await captureReviewScreenshot(page, 'administration-facilities-desktop-1440.png', true);
    await page.goto(`/administration/facilities/${e2eFacilityId}`);
    await expect(page.getByRole('heading', { name: e2eFacilityName })).toBeVisible();

    await page.locator('#team-name').fill(e2eTeamName);
    const teamCreateNavigation = page.waitForURL(
      (url) => url.pathname.startsWith('/administration/teams/'),
      { timeout: 30_000 },
    );
    await Promise.all([
      page.getByRole('button', { name: 'Create team' }).click(),
      teamCreateNavigation,
    ]);
    await expect(page.getByRole('heading', { name: e2eTeamName })).toBeVisible();
    const e2eTeamRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.teams WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, e2eOrganizationId, e2eTeamName],
    );
    const e2eTeamId = e2eTeamRow.rows[0]?.id;
    if (!e2eTeamId) throw new Error('The office UI did not create the team');

    await page.goto('/employees/new');
    await selectEntity(page, 'Organization', e2eOrganizationName, e2eOrganizationName);
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(runId);
    await page.getByLabel('Email').fill(caregiverEmail);
    await page.getByLabel('Personnel number').fill(employeePersonnelNumber);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await page.waitForURL(/\/employees\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible({
      timeout: 30_000,
    });
    const caregiverEmployeeRow = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, employeePersonnelNumber],
    );
    const caregiverEmployeeId = caregiverEmployeeRow.rows[0]?.id;
    if (!caregiverEmployeeId) throw new Error('The office UI did not create the employee');

    await page.goto(
      `/employees?q=${encodeURIComponent(caregiverEmail)}&status=active&sortBy=status`,
    );
    await expect(page.getByRole('link', { name: `E2E ${runId}` })).toBeVisible();
    await captureReviewScreenshot(page, 'employees-directory-desktop-1440.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await expect(page.getByRole('link', { name: `E2E ${runId}` })).toBeVisible();
    await captureReviewScreenshot(page, 'employees-directory-mobile-390.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/employees/${caregiverEmployeeId}`);
    await page.getByLabel('Phone').fill('+49 30 5550101');
    await page.getByRole('button', { name: 'Save master data' }).click();
    await expect(page).toHaveURL(/updated=employee/);
    await expect(page.getByLabel('Phone')).toHaveValue('+49 30 5550101');

    await selectEntity(page, 'Assign facility', e2eFacilityName, /E2E Facility/);
    await page.getByRole('button', { name: 'Assign facility' }).click();
    await expect(
      page.getByText(`${e2eFacilityName} · Primary facility`, { exact: true }),
    ).toBeVisible();
    await selectEntity(page, 'Assign to team', e2eTeamName, /E2E Team/);
    const teamAssignmentPath = new URL(page.url()).pathname;
    const teamAssignmentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === teamAssignmentPath,
    );
    await Promise.all([
      page.getByRole('button', { name: 'Assign to team' }).click(),
      teamAssignmentResponse,
    ]);
    await page.reload();
    await expect(
      page.locator('#assignments article').filter({ hasText: e2eTeamName }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await page.getByRole('heading', { name: 'Weekly hours' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Save availability' })).toBeVisible();
    await captureReviewScreenshot(page, 'employee-availability-editor-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    const availabilityDate = dateInBerlin();
    const availabilityWeekdays = new Set([
      weekdayInBerlin(availabilityDate),
      weekdayInBerlin(addDaysToDate(availabilityDate, 1)),
      1,
      3,
    ]);
    await Promise.all(
      [...availabilityWeekdays].map((weekday) =>
        Promise.all([
          page.locator(`input[name="window_${weekday}_1_start"]`).fill('00:00'),
          page.locator(`input[name="window_${weekday}_1_end"]`).fill('23:59'),
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Save availability' }).click();
    await expect(page).toHaveURL(/updated=availability/);
    const absenceDate = addDaysToDate(dateInBerlin(), 14);
    await page.getByLabel('Starts at').fill(`${absenceDate}T09:00`);
    await page.getByLabel('Ends at').fill(`${absenceDate}T17:00`);
    await page.getByRole('button', { name: 'Record absence' }).click();
    await expect(page).toHaveURL(/updated=absence/);
    await expect(page.locator('#availability')).toContainText('Vacation');
    await page.getByRole('combobox', { name: 'Add qualification' }).click();
    await page.getByRole('combobox', { name: 'Search by name' }).fill('Pflegefachkraft');
    await page
      .getByRole('dialog')
      .getByRole('option', { name: /Pflegefachkraft.*PFK/ })
      .click();
    await page.getByRole('button', { name: 'Save qualification' }).click();
    await expect(
      page.locator('#qualifications li').filter({ hasText: 'Pflegefachkraft (PFK)' }),
    ).toBeVisible();
    expect(caregiverEmployeeId).toMatch(/^[0-9a-f-]+$/i);

    await page.goto('/employees/new');
    await selectEntity(page, 'Organization', e2eOrganizationName, e2eOrganizationName);
    await page.getByLabel('First name').fill('Cover E2E');
    await page.getByLabel('Last name').fill(runId);
    await page.getByLabel('Personnel number').fill(replacementEmployeePersonnelNumber);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page.getByRole('heading', { name: `Cover E2E ${runId}` })).toBeVisible({
      timeout: 30_000,
    });
    const replacementEmployeeRow = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, replacementEmployeePersonnelNumber],
    );
    replacementEmployeeId = replacementEmployeeRow.rows[0]?.id;
    if (!replacementEmployeeId) throw new Error('The office UI did not create the cover employee');
    await selectEntity(page, 'Assign facility', e2eFacilityName, /E2E Facility/);
    await page.getByRole('button', { name: 'Assign facility' }).click();
    await expect(
      page.getByText(`${e2eFacilityName} · Primary facility`, { exact: true }),
    ).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Service catalog' })).toBeVisible();
    const catalogFilters = page.getByRole('region', { name: 'Search and filters' });
    await catalogFilters
      .getByRole('textbox', { name: 'Name, code, or description' })
      .fill('COMPANIONSHIP');
    await catalogFilters.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('link', { name: 'Companionship', exact: true })).toBeVisible();
    await captureReviewScreenshot(page, 'service-catalog-desktop-light-1440.png');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await captureReviewScreenshot(page, 'service-catalog-desktop-dark-1440.png');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'service-catalog-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    const categoryForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create category' }),
    });
    await categoryForm.locator('input[name="name"]').fill(serviceCategoryName);
    await categoryForm.locator('input[name="code"]').fill(serviceCategoryCode);
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(page.locator(`input[name="code"][value="${serviceCategoryCode}"]`)).toBeVisible();
    await page.getByRole('link', { name: 'Create service' }).click();
    await page.locator('#code').fill(serviceCode);
    await page.locator('#name').fill(`E2E Service ${runId}`);
    await page.locator('#categoryId').selectOption({ label: serviceCategoryName });
    await page.locator('#unit').selectOption('occurrence');
    await page.locator('#benefitCategory').selectOption('recognized_support');
    await page.locator('#defaultDurationMinutes').fill('30');
    await page.locator('#validFrom').fill(serviceValidFrom);
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    serviceId = new URL(page.url()).pathname.split('/').at(-1);
    await selectEntity(page, 'Organizations', e2eOrganizationName, e2eOrganizationName);
    await selectEntity(page, 'Facilities', e2eFacilityName, /E2E Facility/);
    await page.getByRole('button', { name: 'Save availability' }).click();
    await expect(page.getByRole('table').getByText(e2eFacilityName)).toBeVisible();
    const priceForm = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Record price' }) });
    await selectEntity(page, 'Organization', e2eOrganizationName, e2eOrganizationName, priceForm);
    await selectEntity(page, 'Facility', e2eFacilityName, /E2E Facility/, priceForm);
    await priceForm.locator('input[name="price"]').fill('45.00');
    await priceForm.locator('select[name="pricingUnit"]').selectOption('visit');
    await priceForm.locator('input[name="validFrom"]').fill(serviceValidFrom);
    await priceForm.getByRole('button', { name: 'Record price' }).click();
    await expect(page.getByText('Price recorded.', { exact: true })).toBeVisible();
    const effectivePrice = page.getByText('€45.00', { exact: true }).first();
    await expect(effectivePrice).toBeVisible();
    await captureReviewScreenshot(page, 'service-detail-desktop-1440.png');
    await effectivePrice.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'service-detail-pricing-desktop-1440.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureReviewScreenshot(page, 'service-detail-mobile-390.png');
    await effectivePrice.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'service-detail-pricing-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/clients/new');
    await selectEntity(page, 'Organization', e2eOrganizationName, e2eOrganizationName);
    await selectEntity(page, 'Primary facility', e2eFacilityName, /E2E Facility/);
    await page.getByLabel('First name').fill('Agreement E2E');
    await page.getByLabel('Last name').fill(runId);
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/i);
    await expect(page.getByRole('heading', { name: `Agreement E2E ${runId}` })).toBeVisible();
    agreementClientId = new URL(page.url()).pathname.split('/').at(-1);
    if (!agreementClientId) throw new Error('The client detail page did not expose its ID');
    await page.locator('summary').filter({ hasText: 'Add contact' }).click();
    const agreementPrimaryContactForm = page
      .locator('details')
      .filter({ hasText: 'Add contact' })
      .locator('form');
    await agreementPrimaryContactForm.locator('#new-contact-first').fill('Admission');
    await agreementPrimaryContactForm.locator('#new-contact-last').fill('Primary ' + runId);
    await agreementPrimaryContactForm.getByRole('checkbox', { name: 'Primary contact' }).check();
    await agreementPrimaryContactForm.getByRole('button', { name: 'Add contact' }).click();
    await expect(
      page.getByRole('heading', { name: 'Admission Primary ' + runId, exact: true }),
    ).toBeVisible();
    representativeContactId = uuidv7();
    await database.query(
      `INSERT INTO clients.client_contacts
         (id, tenant_id, client_id, first_name, last_name, relationship_type,
          representation_type, representation_valid_from, representation_valid_until,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E', 'Representative', 'legal_representative',
               'power_of_attorney', '2000-01-01', '2099-12-31', now(), now())`,
      [representativeContactId, tenantId, agreementClientId],
    );
    await database.query(
      `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
       VALUES ($1, $2, $3, 'legal_representative')`,
      [tenantId, agreementClientId, representativeContactId],
    );
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('span').filter({ hasText: /^Active$/ })).toBeVisible();

    await page.goto(`/clients?q=${encodeURIComponent(`Agreement E2E ${runId}`)}`);
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
    const existingClientListLink = page.getByRole('link', {
      name: `Agreement E2E ${runId}`,
      exact: true,
    });
    await expect(existingClientListLink).toHaveAttribute('href', `/clients/${agreementClientId}`);
    for (const [width, height, suffix] of [
      [390, 844, 'mobile-390'],
      [768, 1024, 'tablet-768'],
      [1440, 900, 'desktop-1440'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop
      await page.setViewportSize({ width, height });
      // oxlint-disable-next-line no-await-in-loop
      await expectMobileLayoutToFit(page);
      // oxlint-disable-next-line no-await-in-loop
      await captureReviewScreenshot(page, `clients-list-regression-${suffix}.png`, true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await existingClientListLink.click();
    await expect(page).toHaveURL(`/clients/${agreementClientId}`);
    await expect(page.getByRole('heading', { name: `Agreement E2E ${runId}` })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add insurance relationship' }).click();
    const benefitInsuranceForm = page
      .locator('details')
      .filter({ hasText: 'Add insurance relationship' })
      .locator('form');
    await benefitInsuranceForm.locator('#new-insurer-name').fill('E2E Pflegekasse');
    await benefitInsuranceForm.locator('#new-insurance-number').fill(`E2E-KASSE-${runId}`);
    await benefitInsuranceForm.getByRole('checkbox', { name: 'Primary insurance' }).click();
    await benefitInsuranceForm.getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'E2E Pflegekasse · Primary' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add care level record' }).click();
    await page.locator('#new-grade').fill('3');
    await page.locator('#new-grade-from').fill('2000-01-01');
    await page.locator('#new-grade-status').selectOption('confirmed');
    await page.getByRole('button', { name: 'Save care level' }).click();
    await expect(page.getByText('Care level 3 · Confirmed')).toBeVisible();

    await page.goto(`/clients/${agreementClientId}/benefits`);
    const fundingSourceForm = page.locator('form').filter({ has: page.locator('#sourceType') });
    await fundingSourceForm
      .locator('#sourceType')
      .selectOption('statutory_long_term_care_insurance');
    const insuranceOption = await fundingSourceForm
      .locator('#clientInsuranceId option')
      .filter({ hasText: 'E2E Pflegekasse' })
      .getAttribute('value');
    if (!insuranceOption) throw new Error('The benefits form did not include the Pflegekasse');
    await fundingSourceForm.locator('#clientInsuranceId').selectOption(insuranceOption);
    await fundingSourceForm.locator('#funding-label').fill('E2E Pflegekasse');
    await fundingSourceForm.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'benefits-funding-source-editor-desktop-1440.png');
    await fundingSourceForm.getByRole('button', { name: 'Add source' }).click();
    await expect(page).toHaveURL(/updated=funding_source/);

    const entitlementForm = page.locator('form').filter({ has: page.locator('#benefitType') });
    await entitlementForm.locator('#benefitType').selectOption('entlastungsbetrag_45b');
    const entitlementSourceOption = await entitlementForm
      .locator('#entitlement-source option')
      .filter({ hasText: 'E2E Pflegekasse' })
      .getAttribute('value');
    if (!entitlementSourceOption)
      throw new Error('The entitlement form did not include the Pflegekasse');
    await entitlementForm.locator('#entitlement-source').selectOption(entitlementSourceOption);
    await entitlementForm.locator('#entitlement-validFrom').fill(serviceValidFrom);
    await entitlementForm.locator('#entitlement-source-info').selectOption('payer_confirmed');
    await entitlementForm.getByRole('button', { name: 'Add entitlement' }).click();
    await expect(page).toHaveURL(/updated=entitlement/);
    await expect(page.getByRole('heading', { name: 'Entlastungsbetrag (§45b)' })).toBeVisible();
    await expect(page.getByText(/Pflegegrad on/)).toBeVisible();

    await page.goto(`/clients/${agreementClientId}/benefits`);
    const privateFundingSourceForm = page
      .locator('form')
      .filter({ has: page.locator('#sourceType') });
    await privateFundingSourceForm.locator('#sourceType').selectOption('self_pay');
    await privateFundingSourceForm.locator('#clientInsuranceId').selectOption('');
    await privateFundingSourceForm.locator('#funding-label').fill('E2E Private payment');
    await privateFundingSourceForm.getByRole('button', { name: 'Add source' }).click();
    await expect(page).toHaveURL(/updated=funding_source/);

    const privateEntitlementForm = page
      .locator('form')
      .filter({ has: page.locator('#benefitType') });
    await privateEntitlementForm.locator('#benefitType').selectOption('private');
    const privateEntitlementSourceOption = await privateEntitlementForm
      .locator('#entitlement-source option')
      .filter({ hasText: 'E2E Private payment' })
      .getAttribute('value');
    if (!privateEntitlementSourceOption)
      throw new Error('The private payment source was not available for an entitlement');
    await privateEntitlementForm
      .locator('#entitlement-source')
      .selectOption(privateEntitlementSourceOption);
    await privateEntitlementForm.locator('#entitlement-validFrom').fill(serviceValidFrom);
    await privateEntitlementForm.locator('#entitlement-source-info').selectOption('contract');
    await privateEntitlementForm.getByRole('button', { name: 'Add entitlement' }).click();
    await expect(page).toHaveURL(/updated=entitlement/);

    const fundingPeriod = serviceValidFrom.slice(0, 7);
    await page.goto(`/clients/${agreementClientId}/benefits?period=${fundingPeriod}`);
    await expect(
      page.getByRole('heading', { name: 'Recorded budget by entitlement' }),
    ).toBeVisible();
    await expect(page.getByLabel('Funding period')).toHaveValue(fundingPeriod);
    await expect(page.getByRole('heading', { name: 'Entlastungsbetrag (§45b)' })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureReviewScreenshot(page, 'benefits-client-funding-overview-desktop-1440.png');
    await page.locator('section[aria-labelledby="summary-title"]').evaluate((section) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 88));
    });
    await captureReviewScreenshot(page, 'benefits-funding-period-balances-desktop-1440.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'benefits-client-funding-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await page.locator('section[aria-labelledby="summary-title"]').evaluate((section) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 88));
    });
    await captureReviewScreenshot(page, 'benefits-client-funding-overview-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/billing/claims/settings');
    await expect(page.getByRole('heading', { name: 'Claims settings' })).toBeVisible();
    await captureReviewScreenshot(page, 'billing-claims-settings-desktop-light.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'billing-claims-settings-mobile-390.png', true);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'billing-claims-settings-tablet-768.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    const payerSettingsForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Open payer settings' }),
    });
    await selectEntity(
      page,
      'Organization',
      e2eOrganizationName,
      e2eOrganizationName,
      payerSettingsForm,
    );
    await payerSettingsForm.getByRole('button', { name: 'Open payer settings' }).click();
    const payerOrganizationSection = page.getByRole('region', { name: e2eOrganizationName });
    const payerCreationForm = payerOrganizationSection.locator('form').filter({
      has: page.getByRole('button', { name: 'Create payer' }),
    });
    await payerCreationForm.locator('input[name="name"]').fill(e2ePayerName);
    await payerCreationForm.locator('input[name="payerIdentifier"]').fill(`E2E-${codeSuffix}`);
    await payerCreationForm
      .locator('input[name="addressText"]')
      .fill(`E2E Payer Street 1, 10115 Berlin`);
    billingRecordsMayExist = true;
    await payerCreationForm.getByRole('button', { name: 'Create payer' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Payer directory entry saved.' }),
    ).toBeVisible();
    await page.reload();
    const payerArticle = page.locator('article').filter({ hasText: e2ePayerName });
    const payerRequirementsForm = payerArticle.locator('form').filter({
      has: page.getByRole('button', { name: 'Save new requirements version' }),
    });
    await payerRequirementsForm.locator('select[name="channel"]').selectOption('manual_email');
    await payerRequirementsForm
      .locator('select[name="fundingSourceType"]')
      .selectOption('statutory_long_term_care_insurance');
    await payerRequirementsForm.locator('input[name="validFrom"]').fill(serviceValidFrom);
    await payerRequirementsForm
      .locator('input[name="sourceName"]')
      .fill('E2E payer billing requirements');
    await payerRequirementsForm.locator('input[name="sourceVersion"]').fill('1');
    await payerRequirementsForm.locator('input[name="sourceEffectiveDate"]').fill(serviceValidFrom);
    await payerRequirementsForm
      .getByRole('button', { name: 'Save new requirements version' })
      .click();
    await expect(
      page.getByText('Payer requirements version saved.', { exact: true }),
    ).toBeVisible();

    await page.goto(`/clients/${agreementClientId}/invoices`);
    const payerArrangementForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Save payer arrangement' }),
    });
    const payerRows = await database.query<{ id: string }>(
      'SELECT id FROM billing.payers WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, e2eOrganizationId, e2ePayerName],
    );
    const payerId = payerRows.rows[0]?.id;
    if (!payerId) throw new Error('The payer directory entry was not persisted');
    await selectEntity(
      page,
      'Payer directory entry',
      e2ePayerName,
      e2ePayerName,
      payerArrangementForm,
    );
    const payerAssociation = payerArrangementForm.locator('select[name="payerAssociation"]');
    await payerAssociation.selectOption({ label: 'E2E Pflegekasse' });
    await expect(payerAssociation).toHaveValue(/^funding:/);
    await payerArrangementForm.locator('input[name="payerReference"]').fill(`E2E-${runId}`);
    await payerArrangementForm
      .locator('select[name="payerType"]')
      .selectOption('statutory_insurance');
    await payerArrangementForm
      .locator('select[name="arrangementType"]')
      .selectOption('direct_payer_billing');
    await payerArrangementForm.locator('select[name="recipientType"]').selectOption('insurance');
    await payerArrangementForm.locator('input[name="recipientName"]').fill('E2E Pflegekasse');
    await payerArrangementForm
      .locator('input[name="recipientAddress"]')
      .fill('E2E Payer Street 1, 10115 Berlin');
    await payerArrangementForm.locator('select[name="mandateStatus"]').selectOption('authorized');
    await payerArrangementForm.locator('input[name="validFrom"]').fill(serviceValidFrom);
    await payerArrangementForm.locator('input[name="documentedSource"]').fill('E2E payer mandate');
    await payerArrangementForm
      .locator('input[name="documentedReference"]')
      .fill(`E2E mandate ${runId}`);
    await payerArrangementForm.getByRole('button', { name: 'Save payer arrangement' }).click();
    await expect(page).toHaveURL(/updated=PAYER_ARRANGEMENT_SAVED/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Payer arrangement saved.' }),
    ).toBeVisible();

    await page.goto('/billing/settings');
    const billingProfileSection = page.getByRole('region', { name: e2eOrganizationName });
    await billingProfileSection
      .locator('input[name="bankAccountHolder"]')
      .fill(e2eOrganizationName);
    await billingProfileSection.locator('input[name="iban"]').fill('DE89370400440532013000');
    await billingProfileSection
      .locator('select[name="taxTreatment"]')
      .selectOption('small_business');
    await billingProfileSection.locator('input[name="taxExemptionBasis"]').fill('§ 19 UStG');
    await billingProfileSection.locator('select[name="requiredInvoiceFormat"]').selectOption('pdf');
    await billingProfileSection
      .getByRole('checkbox', {
        name: 'Require current service acknowledgement before issuance',
      })
      .click();
    await billingProfileSection.getByRole('button', { name: 'Save billing profile' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Billing profile saved.' }),
    ).toBeVisible();

    await page.goto('/benefits', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const recognitionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Record recognition' }),
    });
    await selectEntity(
      page,
      'Organization',
      e2eOrganizationName,
      e2eOrganizationName,
      recognitionForm,
    );
    await recognitionForm
      .locator('#recognized-offering')
      .fill('Angebote zur Unterstützung im Alltag');
    await recognitionForm.locator('#recognition-valid-from').fill(serviceValidFrom);
    await recognitionForm.locator('#recognition-reference').fill(`E2E Anerkennung ${runId}`);
    await recognitionForm.getByRole('button', { name: 'Record recognition' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Provider recognition recorded.' }),
    ).toBeVisible();

    await page.goto(
      `/planning?date=${serviceValidFrom}&estimateClientId=${agreementClientId}&estimateServiceId=${serviceId}&estimateDate=${serviceValidFrom}&estimateQuantity=1`,
    );
    await expect(
      page.getByRole('heading', { name: 'Planned service budget estimate' }),
    ).toBeVisible();
    await page
      .locator('details')
      .filter({ has: page.getByRole('heading', { name: 'Planned service budget estimate' }) })
      .locator('summary')
      .click();
    await expect(page.getByText('Estimated service cost', { exact: true })).toBeVisible();
    await expect(page.getByText('Eligible for this service date').first()).toBeVisible();

    await page.goto(`/clients/${agreementClientId}`);
    await page.getByRole('link', { name: 'Service planning', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Create service planning' }).click();
    await page.locator('#new-agreement-from').fill(serviceValidFrom);
    await page.locator('#new-agreement-reference').fill(`E2E-${runId}`);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { name: `E2E-${runId}` })).toBeVisible();
    const agreementCard = page.locator('article[id^="agreement-"]');

    await page.getByRole('button', { name: 'Search available services' }).click();
    const agreementServiceForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Add service' }),
    });
    await selectEntity(page, 'Service', serviceCode, new RegExp(serviceCode), agreementServiceForm);
    await agreementServiceForm.locator('input[name="quantity"]').fill('1');
    await agreementServiceForm.locator('select[name="cadence"]').selectOption('weekly');
    await agreementServiceForm.getByRole('checkbox', { name: 'Monday' }).click();
    await agreementServiceForm.getByRole('checkbox', { name: 'Wednesday' }).click();
    await agreementServiceForm.locator('input[name="preferredTimeStart"]').fill('08:00');
    await agreementServiceForm.locator('input[name="preferredTimeEnd"]').fill('09:00');
    await expect(agreementCard.getByText('Estimated agreement total:')).toBeVisible({
      timeout: 15_000,
    });
    await agreementCard.scrollIntoViewIfNeeded();
    await blurFocusedElement(page);
    await captureReviewScreenshot(page, 'agreement-editor-desktop-1440.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await agreementCard.scrollIntoViewIfNeeded();
    await blurFocusedElement(page);
    await captureReviewScreenshot(page, 'agreement-editor-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await agreementCard.scrollIntoViewIfNeeded();
    await blurFocusedElement(page);
    await captureReviewScreenshot(page, 'agreement-editor-mobile-390.png');
    await agreementServiceForm.locator('input[name="quantity"]').scrollIntoViewIfNeeded();
    await blurFocusedElement(page);
    await captureReviewScreenshot(page, 'agreement-editor-quantity-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await agreementServiceForm.getByRole('button', { name: 'Add service' }).click();
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    await expect(page.getByText('Weekly: Monday, Wednesday')).toBeVisible();

    await acceptDialogDuringAction(page, () =>
      page.getByRole('button', { name: 'Activate', exact: true }).click(),
    );
    await expect(page.getByText('Service planning activated', { exact: true })).toBeVisible();
    await expect(agreementCard.getByText('Active', { exact: true }).first()).toBeVisible();
    await agreementCard.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'agreement-detail-desktop-1440.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await agreementCard.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'agreement-detail-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    return;
  } finally {
    const testClientIds = [clientId, agreementClientId].filter(
      (id): id is string => id !== undefined,
    );
    try {
      // Payer profiles and their actor references are retained with financial history in this
      // disposable Compose database, which is removed after the browser run.
      if (tenantId && !billingRecordsMayExist) {
        await cleanupBenefitsRecords(database, tenantId, testClientIds, e2eOrganizationName);
        if (agreementClientId) {
          await cleanupServiceAgreementRecords(database, tenantId, [agreementClientId], []);
        }
        await cleanupServiceCatalogRecords(database, tenantId, {
          serviceCode,
          serviceCategoryCode,
        });
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND personnel_number = ANY($2::text[])',
          [tenantId, [employeePersonnelNumber]],
        );
      }
      if (!billingRecordsMayExist) {
        await cleanup(database, {
          issuer,
          users: [
            {
              ...(subject ? { subject } : {}),
              ...(platformUserId ? { userId: platformUserId } : {}),
            },
          ],
          membershipIds: [adminMembershipId].filter((id): id is string => id !== undefined),
          invitationIds: [],
          invitationEmails: [caregiverEmail],
          ...(tenantId ? { tenantId } : {}),
          ...(testClientIds.length ? { clientIds: testClientIds } : {}),
        });
        if (tenantId) {
          await cleanupOrganizationRecords(database, tenantId, {
            organizationName: e2eOrganizationName,
            facilityName: e2eFacilityName,
            teamName: e2eTeamName,
            personnelNumbers: [employeePersonnelNumber, replacementEmployeePersonnelNumber],
          });
        }
      }
    } finally {
      await database.end();
      if (!billingRecordsMayExist && authentikUserId !== undefined) {
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
    // oxlint-disable-next-line no-await-in-loop
    const response = await fetch(discoveryUrl).catch(() => null);
    if (response?.ok) return;
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`Authentik at ${origin} did not become ready`);
}

async function cleanupServiceCatalogRecords(
  database: Client,
  tenantId: string,
  codes: { serviceCode: string; serviceCategoryCode: string },
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const serviceRows = await database.query<{ id: string }>(
      'SELECT id FROM services.service_definitions WHERE tenant_id = $1 AND code = $2',
      [tenantId, codes.serviceCode],
    );
    const categoryRows = await database.query<{ id: string }>(
      'SELECT id FROM services.service_categories WHERE tenant_id = $1 AND code = $2',
      [tenantId, codes.serviceCategoryCode],
    );
    const serviceIds = serviceRows.rows.map((row) => row.id);
    const visitRows = serviceIds.length
      ? await database.query<{ id: string }>(
          `SELECT DISTINCT visit_id AS id FROM scheduling.visit_services
           WHERE tenant_id = $1 AND service_definition_id = ANY($2::uuid[])`,
          [tenantId, serviceIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const visitIds = visitRows.rows.map((row) => row.id);
    const executionRows = visitIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const executionIds = executionRows.rows.map((row) => row.id);
    const resourceIds = [
      ...serviceIds,
      ...categoryRows.rows.map((row) => row.id),
      ...visitIds,
      ...executionIds,
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, resourceIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = ANY($2::text[])
           OR event -> 'payload' ->> 'visitId' = ANY($3::text[]))`,
      [tenantId, resourceIds, visitIds],
    );
    if (serviceRows.rows.length) {
      if (visitIds.length) {
        await database.query(
          'DELETE FROM visit_execution.performed_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM scheduling.visit_assignments WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM scheduling.visit_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
      }
      await database.query(
        'DELETE FROM services.service_prices WHERE tenant_id = $1 AND service_id = ANY($2::uuid[])',
        [tenantId, serviceIds],
      );
      await database.query(
        'DELETE FROM services.service_availability WHERE tenant_id = $1 AND service_id = ANY($2::uuid[])',
        [tenantId, serviceIds],
      );
      await database.query(
        'DELETE FROM services.service_definitions WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, serviceIds],
      );
    }
    if (categoryRows.rows.length) {
      await database.query(
        'DELETE FROM services.service_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, categoryRows.rows.map((row) => row.id)],
      );
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupBenefitsRecords(
  database: Client,
  tenantId: string,
  clientIds: string[],
  organizationName: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const organization = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, organizationName],
    );
    const organizationIds = organization.rows.map((row) => row.id);
    const sources = await database.query<{ id: string }>(
      'SELECT id FROM benefits.funding_sources WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const entitlements = await database.query<{ id: string }>(
      'SELECT id FROM benefits.client_entitlements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const buckets = await database.query<{ id: string }>(
      'SELECT id FROM benefits.allocation_buckets WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const allocations = await database.query<{ id: string }>(
      'SELECT id FROM benefits.service_allocations WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const reversals = await database.query<{ id: string }>(
      'SELECT id FROM benefits.service_allocation_reversals WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const ledger = await database.query<{ id: string }>(
      'SELECT id FROM benefits.ledger_entries WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const recognitions = organizationIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM benefits.provider_recognitions WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])',
          [tenantId, organizationIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const resourceIds = [
      ...sources.rows.map((row) => row.id),
      ...entitlements.rows.map((row) => row.id),
      ...buckets.rows.map((row) => row.id),
      ...allocations.rows.map((row) => row.id),
      ...reversals.rows.map((row) => row.id),
      ...ledger.rows.map((row) => row.id),
      ...recognitions.rows.map((row) => row.id),
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, resourceIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = ANY($2::text[])
           OR event -> 'payload' ->> 'clientId' = ANY($3::text[]))`,
      [tenantId, resourceIds, clientIds],
    );
    for (const [table, trigger] of [
      ['service_allocation_reversals', 'service_allocation_reversals_immutable'],
      ['service_allocations', 'service_allocations_immutable'],
      ['ledger_entries', 'benefit_ledger_entries_immutable'],
      ['allocation_buckets', 'benefit_allocation_buckets_immutable'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop
      await database.query(`ALTER TABLE benefits.${table} DISABLE TRIGGER ${trigger}`);
    }
    await database.query(
      'DELETE FROM benefits.ledger_entries WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.service_allocation_reversals WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.service_allocations WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.allocation_buckets WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.client_entitlements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.funding_sources WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    if (organizationIds.length) {
      await database.query(
        'DELETE FROM benefits.provider_recognitions WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])',
        [tenantId, organizationIds],
      );
    }
    for (const [table, trigger] of [
      ['allocation_buckets', 'benefit_allocation_buckets_immutable'],
      ['ledger_entries', 'benefit_ledger_entries_immutable'],
      ['service_allocations', 'service_allocations_immutable'],
      ['service_allocation_reversals', 'service_allocation_reversals_immutable'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop
      await database.query(`ALTER TABLE benefits.${table} ENABLE TRIGGER ${trigger}`);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupServiceAgreementRecords(
  database: Client,
  tenantId: string,
  clientIds: string[],
  additionalVisitIds: string[] = [],
): Promise<void> {
  let signatureStorageKeys: string[] = [];
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const agreements = await database.query<{ id: string }>(
      'SELECT id FROM service_agreements.agreements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const agreementIds = agreements.rows.map((agreement) => agreement.id);
    const generationRows = agreementIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM scheduling.schedule_generations WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[])',
          [tenantId, agreementIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const visitRows = await database.query<{ id: string }>(
      'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const generationIds = generationRows.rows.map((row) => row.id);
    const visitIds = [...new Set([...visitRows.rows.map((row) => row.id), ...additionalVisitIds])];
    const executionRows = visitIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const executionIds = executionRows.rows.map((row) => row.id);
    const documentationRows = visitIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM care_documentation.documents WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const documentationIds = documentationRows.rows.map((row) => row.id);
    const evidencePackageRows = documentationIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM service_evidence.evidence_packages WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const evidencePackageIds = evidencePackageRows.rows.map((row) => row.id);
    const acknowledgementRows = evidencePackageIds.length
      ? await database.query<{ id: string; signature_storage_key: string | null }>(
          `SELECT id, signature_storage_key FROM service_evidence.acknowledgements
           WHERE tenant_id = $1 AND evidence_package_id = ANY($2::uuid[])`,
          [tenantId, evidencePackageIds],
        )
      : { rows: [] as Array<{ id: string; signature_storage_key: string | null }> };
    const acknowledgementIds = acknowledgementRows.rows.map((row) => row.id);
    signatureStorageKeys = acknowledgementRows.rows
      .map((row) => row.signature_storage_key)
      .filter((key): key is string => key !== null);
    const schedulingResourceIds = [
      ...generationIds,
      ...visitIds,
      ...executionIds,
      ...agreementIds,
      ...evidencePackageIds,
      ...acknowledgementIds,
    ];
    await database.query(
      `DELETE FROM audit.audit_entries
       WHERE tenant_id = $1 AND
         (resource_id = ANY($2::uuid[]) OR (resource_type = 'client' AND resource_id = ANY($3::uuid[])))`,
      [tenantId, schedulingResourceIds, clientIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = ANY($2::text[])
           OR event -> 'payload' ->> 'agreementId' = ANY($3::text[])
           OR event -> 'payload' ->> 'clientId' = ANY($4::text[])
           OR event -> 'payload' ->> 'visitId' = ANY($5::text[]))`,
      [tenantId, schedulingResourceIds, agreementIds, clientIds, visitIds],
    );
    if (visitIds.length) {
      if (documentationIds.length) {
        await database.query(
          'ALTER TABLE service_evidence.acknowledgements DISABLE TRIGGER acknowledgements_append_only',
        );
        await database.query(
          'ALTER TABLE service_evidence.evidence_packages DISABLE TRIGGER evidence_packages_immutable',
        );
        await database.query(
          'DELETE FROM service_evidence.acknowledgements WHERE tenant_id = $1 AND evidence_package_id = ANY($2::uuid[])',
          [tenantId, evidencePackageIds],
        );
        await database.query(
          'DELETE FROM service_evidence.evidence_packages WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, evidencePackageIds],
        );
        await database.query(
          'ALTER TABLE service_evidence.evidence_packages ENABLE TRIGGER evidence_packages_immutable',
        );
        await database.query(
          'ALTER TABLE service_evidence.acknowledgements ENABLE TRIGGER acknowledgements_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.entries DISABLE TRIGGER documentation_entries_draft_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.service_evidence DISABLE TRIGGER service_evidence_draft_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.amendments DISABLE TRIGGER documentation_amendments_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.history DISABLE TRIGGER documentation_history_append_only',
        );
        await database.query(
          'DELETE FROM care_documentation.service_evidence WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.entries WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.amendments WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.history WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'ALTER TABLE care_documentation.amendments ENABLE TRIGGER documentation_amendments_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.history ENABLE TRIGGER documentation_history_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.service_evidence ENABLE TRIGGER service_evidence_draft_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.entries ENABLE TRIGGER documentation_entries_draft_only',
        );
      }
      await database.query(
        'ALTER TABLE visit_execution.performed_services DISABLE TRIGGER performed_services_completed_immutable',
      );
      await database.query(
        'DELETE FROM visit_execution.performed_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'ALTER TABLE visit_execution.performed_services ENABLE TRIGGER performed_services_completed_immutable',
      );
      await database.query(
        'DELETE FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visit_assignments WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visit_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
    }
    if (agreementIds.length) {
      await database.query(
        'DELETE FROM scheduling.schedule_generations WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[])',
        [tenantId, agreementIds],
      );
      await database.query(
        'DELETE FROM service_agreements.agreement_services WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[])',
        [tenantId, agreementIds],
      );
      await database.query(
        'DELETE FROM service_agreements.agreements WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, agreementIds],
      );
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
  if (signatureStorageKeys.length) {
    const config = loadStorageConfig();
    const storage = createS3ObjectStorage({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKey: config.S3_ACCESS_KEY,
      secretKey: config.S3_SECRET_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
    await Promise.all(signatureStorageKeys.map((key) => storage.delete(key)));
  }
}

async function cleanupOrganizationRecords(
  database: Client,
  tenantId: string,
  names: {
    organizationName: string;
    facilityName: string;
    teamName: string;
    personnelNumbers: readonly string[];
  },
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const organizations = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.organizationName],
    );
    const facilities = await database.query<{ id: string }>(
      'SELECT id FROM organizations.facilities WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.facilityName],
    );
    const teams = await database.query<{ id: string }>(
      'SELECT id FROM organizations.teams WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.teamName],
    );
    const employees = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = ANY($2::text[])',
      [tenantId, names.personnelNumbers],
    );
    const resourceIds = [
      ...organizations.rows.map((row) => row.id),
      ...facilities.rows.map((row) => row.id),
      ...teams.rows.map((row) => row.id),
      ...employees.rows.map((row) => row.id),
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, resourceIds],
    );
    await database.query(
      "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
      [tenantId, resourceIds],
    );
    await database.query(
      `DELETE FROM operations.exception_interactions
       WHERE tenant_id = $1
         AND occurrence_id IN (
           SELECT id FROM operations.exception_occurrences
           WHERE tenant_id = $1
             AND (organization_id = ANY($2::uuid[]) OR facility_id = ANY($3::uuid[]))
         )`,
      [tenantId, organizations.rows.map((row) => row.id), facilities.rows.map((row) => row.id)],
    );
    await database.query(
      `DELETE FROM operations.exception_occurrences
       WHERE tenant_id = $1
         AND (organization_id = ANY($2::uuid[]) OR facility_id = ANY($3::uuid[]))`,
      [tenantId, organizations.rows.map((row) => row.id), facilities.rows.map((row) => row.id)],
    );
    if (employees.rows.length) {
      const employeeIds = employees.rows.map((row) => row.id);
      await database.query(
        'DELETE FROM scheduling.employee_unavailability WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM scheduling.employee_availability_exceptions WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM scheduling.employee_availability WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_facility_assignments WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_team_memberships WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_qualifications WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_skills WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employees WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
    }
    await database.query('DELETE FROM organizations.teams WHERE tenant_id = $1 AND name = $2', [
      tenantId,
      names.teamName,
    ]);
    await database.query(
      'DELETE FROM organizations.facilities WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.facilityName],
    );
    await database.query(
      'DELETE FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.organizationName],
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function createAuthentikUser(
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

async function signInWithAuthentik(page: Page, username: string, password: string): Promise<void> {
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
  await expect(passwordField).toHaveValue(password);
  const webOrigin = new URL(required('WEB_ORIGIN')).origin;
  await Promise.all([
    page.waitForURL((url) => url.origin === webOrigin, { timeout: 60_000 }),
    page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click(),
  ]);
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
      return { id: result.rows[0].id, membershipCount: Number(result.rows[0].membership_count) };
    }
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('Authentik login did not provision the platform identity');
}

async function cleanup(
  database: Client,
  input: {
    issuer: string;
    users: Array<{ subject?: string; userId?: string }>;
    membershipIds: string[];
    invitationIds: string[];
    invitationEmails: string[];
    tenantId?: string;
    clientId?: string;
    clientIds?: string[];
  },
): Promise<void> {
  await database.query('BEGIN');
  try {
    if (input.tenantId) {
      await database.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenantId]);
    }
    const subjects = input.users.flatMap((user) => (user.subject ? [user.subject] : []));
    const mappedUsers = subjects.length
      ? await database.query<{ id: string }>(
          `SELECT users.id
           FROM identity.users AS users
           JOIN identity.external_identities AS external ON external.user_id = users.id
           WHERE external.issuer = $1 AND external.subject = ANY($2::text[])`,
          [input.issuer, subjects],
        )
      : { rows: [] as Array<{ id: string }> };
    const userIds = [
      ...new Set([
        ...input.users.flatMap((user) => (user.userId ? [user.userId] : [])),
        ...mappedUsers.rows.map((row) => row.id),
      ]),
    ];
    const mappedMemberships = userIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM identity.tenant_memberships WHERE user_id = ANY($1::uuid[])',
          [userIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const membershipIds = [
      ...new Set([...input.membershipIds, ...mappedMemberships.rows.map((row) => row.id)]),
    ];
    const mappedInvitations = input.invitationEmails.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM identity.tenant_invitations WHERE email = ANY($1::text[])',
          [input.invitationEmails],
        )
      : { rows: [] as Array<{ id: string }> };
    const invitationIds = [
      ...new Set([...input.invitationIds, ...mappedInvitations.rows.map((row) => row.id)]),
    ];
    const clientIds = [
      ...new Set([...(input.clientId ? [input.clientId] : []), ...(input.clientIds ?? [])]),
    ];
    const aggregateIds = [...membershipIds, ...invitationIds];
    aggregateIds.push(...clientIds);
    let clientResourceIds = aggregateIds;
    if (clientIds.length && input.tenantId) {
      const childRows = await database.query<{ id: string }>(
        `SELECT id FROM clients.client_addresses WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         UNION ALL SELECT id FROM clients.client_contacts WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         UNION ALL SELECT id FROM clients.client_insurances WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         UNION ALL SELECT id FROM clients.pflegegrad_records WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])`,
        [input.tenantId, clientIds],
      );
      clientResourceIds = [...aggregateIds, ...childRows.rows.map((row) => row.id)];
    }
    await database.query(
      `DELETE FROM audit.audit_entries
       WHERE resource_id = ANY($1::uuid[]) OR actor_id = ANY($2::uuid[])`,
      [clientResourceIds, userIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE event ->> 'aggregateId' = ANY($1::text[])
          OR event -> 'actor' ->> 'id' = ANY($2::text[])
          OR event -> 'payload' ->> 'clientId' = ANY($3::text[])`,
      [clientResourceIds, userIds, clientIds],
    );
    if (clientIds.length && input.tenantId) {
      await database.query(
        `DELETE FROM operations.exception_interactions
         WHERE tenant_id = $1
           AND occurrence_id IN (
             SELECT id FROM operations.exception_occurrences
             WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
           )`,
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM operations.exception_occurrences WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_contact_roles WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_addresses WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_contacts WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_insurances WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.pflegegrad_records WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.clients WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
    } else if (clientIds.length) {
      await database.query('DELETE FROM clients.clients WHERE id = ANY($1::uuid[])', [clientIds]);
    }
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
    const authUserIds = subjects.length
      ? await database.query<{ id: string }>(
          `SELECT auth_user.id
           FROM authentication.users AS auth_user
           JOIN authentication.accounts AS account ON account.user_id = auth_user.id
           WHERE account.provider_id = 'authentik' AND account.account_id = ANY($1::text[])`,
          [subjects],
        )
      : { rows: [] as Array<{ id: string }> };
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
    if (subjects.length) {
      await database.query(
        'DELETE FROM identity.external_identities WHERE issuer = $1 AND subject = ANY($2::text[])',
        [input.issuer, subjects],
      );
    }
    if (userIds.length) {
      await database.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function blurFocusedElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}
