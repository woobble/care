import { v7 as uuidv7 } from 'uuid';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { devices, expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { loadStorageConfig } from '@care/config';
import { createS3ObjectStorage } from '@care/storage';

const retiredModuleNavigationName =
  /^(?:Medications?|Clinical Documentation|Care Planning|Competency Policies|Workforce Compliance|Medikamente?|Klinische Dokumentation|Pflegeplanung|Kompetenzrichtlinien|Personal Compliance)$/i;
const reviewDirectory = process.env.CARE_UI_REVIEW_DIR
  ? resolve(process.env.CARE_UI_REVIEW_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../artifacts/ui-foundation-review');

test('Authentik users can be invited and administered from the office UI', async ({
  page,
  browser,
}, testInfo) => {
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
  const invitedUsername = `care-invite-${runId}`;
  const invitedName = `Invitee E2E ${runId}`;
  const invitedEmail = `${invitedUsername}@example.test`;
  const invitedPassword = `Aa1!${uuidv7()}`;
  const caregiverUsername = `caregiver-e2e-${runId}`;
  const caregiverName = `Caregiver E2E ${runId}`;
  const caregiverEmail = `${caregiverUsername}@example.test`;
  const caregiverPassword = `Aa1!${uuidv7()}`;
  const replacementEmployeePersonnelNumber = `E2E-COVER-${runId}`;
  const e2ePayerName = `E2E Payer ${runId}`;
  const executionMarker = `execution-note-${runId}`;
  const admissionVisitMarker = `admission-first-visit-${runId}`;
  let authentikUserId: number | undefined;
  let invitedAuthentikUserId: number | undefined;
  let caregiverAuthentikUserId: number | undefined;
  let subject: string | undefined;
  let invitedSubject: string | undefined;
  let caregiverSubject: string | undefined;
  let platformUserId: string | undefined;
  let invitedPlatformUserId: string | undefined;
  let caregiverPlatformUserId: string | undefined;
  let tenantId: string | undefined;
  let pilotTenantId: string | undefined;
  let adminMembershipId: string | undefined;
  let pilotMembershipId: string | undefined;
  let invitedMembershipId: string | undefined;
  let caregiverMembershipId: string | undefined;
  let replacementEmployeeId: string | undefined;
  let invitationId: string | undefined;
  let clientId: string | undefined;
  let agreementClientId: string | undefined;
  let admissionCaseId: string | undefined;
  let admissionClientId: string | undefined;
  let admissionVisitId: string | undefined;
  let serviceId: string | undefined;
  let executionVisitId: string | undefined;
  let initialEvidencePackageId: string | undefined;
  let replacementEvidencePackageId: string | undefined;
  let finalEvidencePackageId: string | undefined;
  let invoiceId: string | undefined;
  let claimId: string | undefined;
  let billingRecordsMayExist = false;
  let representativeContactId: string | undefined;
  const serviceCategoryName = `E2E Category ${runId}`;
  const codeSuffix = runId.slice(-24);
  const serviceCategoryCode = `E2E-CAT-${codeSuffix}`;
  const serviceCode = `E2E-SVC-${codeSuffix}`;
  const e2eOrganizationName = `E2E Organization ${runId}`;
  const e2eFacilityName = `E2E Facility ${runId}`;
  const e2eTeamName = `E2E Team ${runId}`;
  const caregiverPersonnelNumber = `E2E-${runId}`;
  let invitedContext: BrowserContext | undefined;
  let caregiverContext: BrowserContext | undefined;

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

    const sidebar = page.locator('#office-sidebar');
    await test.step('office sidebar and responsive navigation', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const expandSidebar = page.getByRole('button', { name: 'Expand sidebar' });
      const topbarBrand = page.getByRole('banner').getByText('Care Platform', { exact: true });
      const topbarBrandMark = page.getByRole('banner').locator('svg.lucide-heart-handshake');
      await expect(expandSidebar).toBeVisible();
      await expect(expandSidebar).toHaveAttribute('aria-expanded', 'false');
      await expect(topbarBrand).toBeVisible();
      await expect(topbarBrandMark).toBeHidden();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      const activeLabel = sidebar.locator('a[aria-current="page"] > span').nth(1);
      await expect(activeLabel).toHaveCSS('opacity', '0');
      const collapsedIconBox = await sidebar.locator('a[aria-current="page"] svg').boundingBox();
      expect(collapsedIconBox).not.toBeNull();
      await page.screenshot({
        path: testInfo.outputPath('office-1440-collapsed-light.png'),
        fullPage: true,
      });
      await page.evaluate(() => {
        document.querySelector('main h1')?.setAttribute('data-shell-node-check', 'kept');
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reducedTransitionDuration = await sidebar.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      );
      expect(Number.parseFloat(reducedTransitionDuration)).toBeLessThanOrEqual(0.001);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const accountTrigger = page.getByRole('button', { name: /Account: / });
      await accountTrigger.click();
      const accountMenu = page.getByRole('menu');
      await expect(accountMenu.getByText(displayName, { exact: true })).toBeVisible();
      await expect(accountMenu.getByText(email, { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('office-account-menu.png') });
      await page.keyboard.press('Escape');

      await expandSidebar.click();
      await page.waitForTimeout(90);
      const transitioningSidebarWidth = await page
        .locator('#office-sidebar')
        .evaluate((element) => element.getBoundingClientRect().width);
      const transitioningMainLeft = await page
        .locator('main')
        .evaluate((element) => element.getBoundingClientRect().left);
      expect(transitioningSidebarWidth).toBeGreaterThan(72);
      expect(transitioningSidebarWidth).toBeLessThan(256);
      expect(transitioningMainLeft).toBeGreaterThan(72);
      expect(transitioningMainLeft).toBeLessThan(256);
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
      await expect(topbarBrand).toBeHidden();
      await page.waitForFunction(() => {
        const element = document.querySelector('#office-sidebar');
        return (
          element instanceof HTMLElement &&
          Math.abs(element.getBoundingClientRect().width - 256) < 1
        );
      });
      await expect(activeLabel).toHaveAttribute('aria-hidden', 'false');
      await expect(activeLabel).toHaveCSS('opacity', '1');
      const expandedIconBox = await sidebar.locator('a[aria-current="page"] svg').boundingBox();
      expect(expandedIconBox).not.toBeNull();
      expect(Math.abs(expandedIconBox!.x - collapsedIconBox!.x - 10)).toBeLessThan(1);
      await page.screenshot({
        path: testInfo.outputPath('office-1440-expanded-light.png'),
        fullPage: true,
      });
      await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
      await expect(page.locator('main h1')).toHaveAttribute('data-shell-node-check', 'kept');
      await page.reload({ waitUntil: 'load' });
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
      const keyboardCollapse = page.getByRole('button', { name: 'Collapse sidebar' });
      await keyboardCollapse.focus();
      await page.keyboard.press('Space');
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      const keyboardExpand = page.getByRole('button', { name: 'Expand sidebar' });
      await expect(keyboardExpand).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');

      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.screenshot({
        path: testInfo.outputPath('office-1440-expanded-dark.png'),
        fullPage: true,
      });
      const hoveredNavigationItem = sidebar.getByRole('link', { name: 'Benefits & budgets' });
      await hoveredNavigationItem.hover();
      const hoverBackgroundInsets = await hoveredNavigationItem.evaluate((element) => {
        const before = getComputedStyle(element, '::before');
        return { left: before.left, right: before.right };
      });
      expect(hoverBackgroundInsets).toEqual({ left: '12px', right: '12px' });
      await expect
        .poll(() =>
          hoveredNavigationItem.evaluate(
            (element) => getComputedStyle(element, '::before').opacity,
          ),
        )
        .toBe('1');
      await page.screenshot({
        path: testInfo.outputPath('office-1440-expanded-hover-dark.png'),
        fullPage: true,
      });
      await hoveredNavigationItem.click();
      await expect(hoveredNavigationItem).toHaveAttribute('aria-current', 'page');
      const activeBackground = await hoveredNavigationItem.evaluate((element) => {
        const before = getComputedStyle(element, '::before');
        return {
          left: before.left,
          right: before.right,
          opacity: before.opacity,
          usesFullWidthLinkBackground: element.classList.contains('bg-sidebar-accent'),
        };
      });
      expect(activeBackground).toEqual({
        left: '12px',
        right: '12px',
        opacity: '1',
        usesFullWidthLinkBackground: false,
      });
      const activeBenefitLabel = hoveredNavigationItem.locator('span').nth(1);
      const activeBenefitDot = hoveredNavigationItem.locator('span').nth(2);
      const activeBenefitLabelBox = await activeBenefitLabel.boundingBox();
      const activeBenefitDotBox = await activeBenefitDot.boundingBox();
      expect(activeBenefitLabelBox).not.toBeNull();
      expect(activeBenefitDotBox).not.toBeNull();
      expect(
        activeBenefitDotBox!.x - (activeBenefitLabelBox!.x + activeBenefitLabelBox!.width),
      ).toBeGreaterThanOrEqual(10);
      const activeBenefitLinkBox = await hoveredNavigationItem.boundingBox();
      expect(activeBenefitLinkBox).not.toBeNull();
      expect(
        activeBenefitLinkBox!.x +
          activeBenefitLinkBox!.width -
          12 -
          (activeBenefitDotBox!.x + activeBenefitDotBox!.width),
      ).toBeGreaterThanOrEqual(7);
      await page.screenshot({
        path: testInfo.outputPath('office-1440-expanded-benefits-active-dark.png'),
        fullPage: true,
      });
      await sidebar.getByRole('link', { name: 'Clients' }).click();
      await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await page.screenshot({
        path: testInfo.outputPath('office-1440-collapsed-dark.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'Light' }).click();

      await page.emulateMedia({ colorScheme: 'dark' });
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'System' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).not.toHaveClass(/dark/);

      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath('office-1024-navigation-rail.png'),
        fullPage: true,
      });
      await expectMobileLayoutToFit(page);
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('office-768-tablet.png'), fullPage: true });
      await expectMobileLayoutToFit(page);
      await page.getByRole('button', { name: 'Appearance' }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Language' }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Deutsch' })).toBeVisible();
      await page.keyboard.press('Escape');
      const tabletAccountTrigger = page.getByRole('button', { name: /Account: / });
      await tabletAccountTrigger.click();
      await expect(page.getByRole('menu').getByText(email, { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
      await expectMobileLayoutToFit(page);
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await expect(
        (await page.context().cookies()).find((cookie) => cookie.name === 'care-office-sidebar')
          ?.value,
      ).toBe('collapsed');

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(topbarBrandMark).toBeVisible();
      await expect(sidebar).not.toBeVisible();
      const mobileNavigationTrigger = page.locator(
        'button[aria-controls="office-mobile-navigation"]',
      );
      await expect(mobileNavigationTrigger).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('office-390-mobile.png'), fullPage: true });
      await expectMobileLayoutToFit(page);
      await mobileNavigationTrigger.click();
      await expect(page.locator('#office-mobile-navigation')).toBeVisible();
      await expect(mobileNavigationTrigger).toHaveAttribute('aria-expanded', 'true');
      await page.screenshot({ path: testInfo.outputPath('office-390-mobile-drawer.png') });
      await page.keyboard.press('Escape');
      await expect(page.locator('#office-mobile-navigation')).not.toBeVisible();
      await expect(mobileNavigationTrigger).toBeFocused();
      await mobileNavigationTrigger.click();
      await page
        .locator('#office-mobile-navigation')
        .getByRole('link', { name: 'Planning', exact: true })
        .click();
      await expect(page).toHaveURL(/\/planning(?:\?|$)/);
      await expect(page.locator('#office-mobile-navigation')).not.toBeVisible();
      await page.goto('/clients?localeCheck=1');
      await page.setViewportSize({ width: 390, height: 844 });
      await mobileNavigationTrigger.click();
      await expect(page.locator('#office-mobile-navigation')).toBeVisible();
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.locator('#office-mobile-navigation')).not.toBeVisible();
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await expect(page.locator('#office-page-context')).toBeFocused();
      await expect(
        (await page.context().cookies()).find((cookie) => cookie.name === 'care-office-sidebar')
          ?.value,
      ).toBe('collapsed');
      await expectMobileLayoutToFit(page);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Operations dashboard' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('operations-1440-light.png'),
      fullPage: true,
    });
    await captureReviewScreenshot(page, 'office-dashboard-desktop-expanded-light.png');
    await expectMobileLayoutToFit(page);
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.screenshot({
      path: testInfo.outputPath('operations-1440-dark.png'),
      fullPage: true,
    });
    await captureReviewScreenshot(page, 'office-dashboard-desktop-expanded-dark.png');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await page.waitForFunction(() => {
      const element = document.querySelector('#office-sidebar');
      return (
        element instanceof HTMLElement && Math.abs(element.getBoundingClientRect().width - 72) < 1
      );
    });
    await captureReviewScreenshot(page, 'office-dashboard-desktop-collapsed-dark.png');
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await page.waitForFunction(() => {
      const element = document.querySelector('#office-sidebar');
      return (
        element instanceof HTMLElement && Math.abs(element.getBoundingClientRect().width - 72) < 1
      );
    });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(() => {
      const element = document.querySelector('#office-sidebar');
      return (
        element instanceof HTMLElement && Math.abs(element.getBoundingClientRect().width - 72) < 1
      );
    });
    await captureReviewScreenshot(page, 'office-dashboard-1024-compact.png');
    await page.screenshot({
      path: testInfo.outputPath('operations-1024.png'),
      fullPage: true,
    });
    await expectMobileLayoutToFit(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await captureReviewScreenshot(page, 'office-dashboard-tablet-768.png');
    await expectMobileLayoutToFit(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.screenshot({
      path: testInfo.outputPath('operations-390-mobile.png'),
      fullPage: true,
    });
    await captureReviewScreenshot(page, 'office-dashboard-mobile-390.png', true);
    await expectMobileLayoutToFit(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const scheduledVisits = page.getByRole('link', { name: /Today's scheduled visits:/ });
    await expect(scheduledVisits).toBeVisible();
    await scheduledVisits.click();
    await expect(page).toHaveURL(/\/planning(?:\?|$)/);
    await page.goto('/operations');
    const visitIssues = page.getByRole('link', { name: /Visit issues:/ });
    await expect(visitIssues).toBeVisible();
    await visitIssues.click();
    await expect(page).toHaveURL(/\/operations\/worklist\?.*category=visits/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/clients?localeCheck=1');

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
    await page.getByLabel('Personnel number').fill(caregiverPersonnelNumber);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await page.waitForURL(/\/employees\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible({
      timeout: 30_000,
    });
    const caregiverEmployeeRow = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, caregiverPersonnelNumber],
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
    for (const weekday of availabilityWeekdays) {
      await page.locator(`input[name="window_${weekday}_1_start"]`).fill('00:00');
      await page.locator(`input[name="window_${weekday}_1_end"]`).fill('23:59');
    }
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
      await page.setViewportSize({ width, height });
      await expectMobileLayoutToFit(page);
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
    await expect(page.getByText('Eligible for this service date')).toBeVisible();

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

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.getByText('Service planning activated', { exact: true })).toBeVisible();
    await expect(agreementCard.getByText('Active', { exact: true }).first()).toBeVisible();
    await agreementCard.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'agreement-detail-desktop-1440.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await agreementCard.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(page, 'agreement-detail-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    if (process.env.CARE_SERVICE_AGREEMENTS_FOCUS === 'true') return;

    await test.step('complete an admission with existing client handoff', async () => {
      const viewportScreens = [
        [390, 844, 'mobile-390'],
        [768, 1024, 'tablet-768'],
        [1440, 900, 'desktop-1440'],
      ] as const;

      await page.goto('/admissions/new');
      await expect(page.getByRole('heading', { name: 'Create admission case' })).toBeVisible();
      for (const [width, height, suffix] of viewportScreens) {
        await page.setViewportSize({ width, height });
        await expectMobileLayoutToFit(page);
        await captureReviewScreenshot(page, `admissions-intake-${suffix}.png`, true);
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByLabel('Prospect first name').fill('Agreement E2E');
      await page.getByLabel('Prospect last name').fill(runId);
      await selectEntity(page, 'Organization', e2eOrganizationName, e2eOrganizationName);
      await selectEntity(page, 'Facility', e2eFacilityName, /E2E Facility/);
      await page.getByLabel('Inquiry source').fill('E2E browser journey');
      await page.getByLabel('Preferred start date').fill(serviceValidFrom);
      await page.getByLabel('Requested services, one per line').fill('E2E Service ' + runId);
      await selectEntity(
        page,
        'Link an existing client (optional)',
        'Agreement E2E ' + runId,
        new RegExp(`Agreement E2E ${runId}`),
      );
      await page.locator('summary').filter({ hasText: 'Funding details' }).click();
      await page.getByLabel('Funding plan').selectOption('benefits');
      await page.getByRole('button', { name: 'New admission case' }).click();
      await expect(page).toHaveURL(/\/admissions\/[0-9a-f-]{36}$/i);
      admissionCaseId = new URL(page.url()).pathname.split('/').at(-1);
      if (!admissionCaseId) throw new Error('The admission detail page did not expose its ID');
      admissionClientId = agreementClientId;

      const createdAdmission = await database.query<{
        id: string;
        client_id: string | null;
        stage: string;
      }>(
        'SELECT id, client_id, stage FROM onboarding.cases WHERE tenant_id = $1 AND id = $2 AND first_name = $3 AND last_name = $4',
        [tenantId, admissionCaseId, 'Agreement E2E', runId],
      );
      expect(createdAdmission.rows[0]).toMatchObject({
        id: admissionCaseId,
        client_id: agreementClientId,
        stage: 'inquiry',
      });
      await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();
      await expect(
        page.getByText('Needs assessment complete', { exact: true }).first(),
      ).toBeVisible();
      await expectVisibleTextToOmitIds(page, [
        admissionCaseId,
        agreementClientId,
        e2eOrganizationId,
        e2eFacilityId,
      ]);

      await page.goto(`/admissions?search=${encodeURIComponent(`Agreement E2E ${runId}`)}`);
      await expect(page.getByRole('heading', { name: 'Admission worklist' })).toBeVisible();
      const admissionListLink = page.locator(`a[href="/admissions/${admissionCaseId}"]:visible`);
      await expect(admissionListLink).toHaveText(`Agreement E2E ${runId}`);
      for (const [width, height, suffix] of viewportScreens) {
        await page.setViewportSize({ width, height });
        await expectMobileLayoutToFit(page);
        await captureReviewScreenshot(page, `admissions-list-${suffix}.png`, true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await admissionListLink.click();
      await expect(page).toHaveURL(`/admissions/${admissionCaseId}`);
      await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();

      for (const [width, height, suffix] of viewportScreens) {
        await page.setViewportSize({ width, height });
        await expectMobileLayoutToFit(page);
        await captureReviewScreenshot(page, `admissions-detail-${suffix}.png`, true);
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('summary').filter({ hasText: 'Save case' }).click();
      const caseUpdateForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Save case' }),
      });
      const recoverableValue = 'admission-recoverable-' + runId;
      await caseUpdateForm.locator('textarea[name="initialNotes"]').fill(recoverableValue);
      await caseUpdateForm.locator('input[name="expectedVersion"]').evaluate((element) => {
        (element as HTMLInputElement).value = '999';
      });
      await caseUpdateForm.getByRole('button', { name: 'Save case' }).click();
      await expect(
        caseUpdateForm.getByRole('alert').filter({ hasText: 'Your changes are still here.' }),
      ).toBeVisible();
      await expect(caseUpdateForm.locator('textarea[name="initialNotes"]')).toHaveValue(
        recoverableValue,
      );
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();

      const moveAdmissionTo = async (
        stage: 'assessment' | 'preparation' | 'ready_for_admission',
      ) => {
        const stageForm = page.locator('form').filter({
          has: page.getByRole('button', { name: 'Move to stage' }),
        });
        await stageForm.getByLabel('Move to stage').selectOption(stage);
        page.once('dialog', (dialog) => dialog.accept());
        await stageForm.getByRole('button', { name: 'Move to stage' }).click();
        await expect(page.getByTestId('admission-stage')).toHaveText(
          stage === 'assessment'
            ? 'Assessment'
            : stage === 'preparation'
              ? 'Preparation'
              : 'Ready for admission',
        );
        const savedCase = await database.query<{ version: number; stage: string }>(
          'SELECT version, stage FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
          [tenantId, admissionCaseId],
        );
        expect(savedCase.rows[0]?.stage).toBe(stage);
        await expect
          .poll(async () =>
            Number(await stageForm.locator('input[name="expectedVersion"]').inputValue()),
          )
          .toBe(savedCase.rows[0]?.version);
        const assessmentForm = page.locator('form').filter({
          has: page.getByRole('button', { name: 'Save assessment' }),
        });
        await expect
          .poll(async () =>
            Number(await assessmentForm.locator('input[name="expectedVersion"]').inputValue()),
          )
          .toBe(savedCase.rows[0]?.version);
      };

      await moveAdmissionTo('assessment');
      const assessmentForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Save assessment' }),
      });
      await assessmentForm.getByLabel('Services requested').fill('E2E Service ' + runId);
      await assessmentForm.getByLabel('Household support needed').fill('Weekly household support');
      await assessmentForm.getByLabel('Visits per week').fill('2');
      await assessmentForm.getByLabel('Monday').check();
      await assessmentForm.getByRole('button', { name: 'Save assessment' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toHaveCount(0);
      await expect(assessmentForm.getByText(/^Last updated/)).toBeVisible();
      await expect(assessmentForm.getByLabel('Household support needed')).toHaveValue(
        'Weekly household support',
      );
      await expect(
        page.getByText('Needs assessment complete', { exact: true }).first(),
      ).toBeVisible();
      await moveAdmissionTo('preparation');
      await moveAdmissionTo('ready_for_admission');
      const readinessRegion = page.getByRole('region', { name: 'Admission readiness' });
      await expect(readinessRegion.getByText('Ready', { exact: true })).toBeVisible();
      await expect(readinessRegion.getByText('No blockers', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'E2E-' + runId })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Review benefits and funding' })).toBeVisible();

      await page.getByRole('link', { name: 'Review benefits and funding' }).click();
      await expect(page.getByRole('heading', { name: 'Benefits & budgets' })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();
      await page.getByRole('link', { name: 'E2E-' + runId }).click();
      await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'E2E-' + runId })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Admit client' }).click();
      await expect(page.getByText('Admitted', { exact: true }).first()).toBeVisible();
      const admittedClient = await database.query<{ status: string }>(
        'SELECT status FROM clients.clients WHERE tenant_id = $1 AND id = $2',
        [tenantId, agreementClientId],
      );
      expect(admittedClient.rows[0]?.status).toBe('active');
      const linkedCaseClient = await database.query<{ client_id: string | null; stage: string }>(
        'SELECT client_id, stage FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
        [tenantId, admissionCaseId],
      );
      expect(linkedCaseClient.rows[0]).toEqual({
        client_id: agreementClientId,
        stage: 'admitted',
      });

      await page.getByRole('link', { name: 'Plan first visit' }).click();
      await expect(page.getByRole('heading', { name: 'Plan a visit manually' })).toBeVisible();
      const admissionVisitForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Create visit' }),
      });
      const admissionVisitDate = addCalendarDays(serviceValidFrom, 1);
      await admissionVisitForm.locator('input[name="localDate"]').fill(admissionVisitDate);
      await admissionVisitForm.locator('input[name="localStartTime"]').fill('09:15');
      await admissionVisitForm.locator('input[name="localEndTime"]').fill('09:45');
      await admissionVisitForm.locator('textarea[name="note"]').fill(admissionVisitMarker);
      await expect(admissionVisitForm.locator('input[name="clientId"]')).toHaveValue(
        agreementClientId!,
      );
      await expect(admissionVisitForm.locator('input[name="admissionCaseId"]')).toHaveValue(
        admissionCaseId!,
      );
      await expect(
        admissionVisitForm.locator('input[name="expectedAdmissionVersion"]'),
      ).toHaveValue(/^[1-9]\d*$/);
      await expect(admissionVisitForm.locator('input[name="serviceDefinitionIds"]')).toHaveValue(
        serviceId!,
      );
      await admissionVisitForm.getByRole('button', { name: 'Create visit' }).click();
      await expect(page).toHaveURL(
        new RegExp(`/admissions/${admissionCaseId}\\?updated=first_visit$`),
        { timeout: 30_000 },
      );
      await expect(
        page.getByRole('status').filter({ hasText: 'First visit planned' }),
      ).toBeVisible();
      const firstVisitLink = await database.query<{ first_visit_id: string | null }>(
        'SELECT first_visit_id FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
        [tenantId, admissionCaseId],
      );
      admissionVisitId = firstVisitLink.rows[0]?.first_visit_id ?? undefined;
      if (!admissionVisitId) throw new Error('The first visit was not linked to the admission');
      const scheduledAdmissionVisit = await database.query<{ id: string }>(
        'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND id = $2 AND note = $3',
        [tenantId, admissionVisitId, admissionVisitMarker],
      );
      expect(scheduledAdmissionVisit.rows[0]?.id).toBe(admissionVisitId);
      const firstVisitReference = page.locator(`a[href="/visits/${admissionVisitId}"]`);
      await expect(firstVisitReference).toBeVisible();
      await expect(firstVisitReference).not.toHaveText(admissionVisitId);
      await expect(
        page.locator('#first-visit-title').getByText('Not assigned', { exact: true }),
      ).toBeVisible();
      await expectVisibleTextToOmitIds(page, [
        admissionCaseId,
        agreementClientId,
        admissionVisitId,
        e2eOrganizationId,
        e2eFacilityId,
      ]);
    });

    await page.goto(`/clients/${agreementClientId}/service-agreements`);
    await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();
    const generationFrom = addCalendarDays(dateInBerlin(), 1);
    const generationUntil = addCalendarDays(generationFrom, 6);
    const generationDetails = page
      .locator('details')
      .filter({ hasText: 'Generate visits' })
      .first();
    await generationDetails.locator('summary').click();
    const generationForm = generationDetails.locator('form');
    await generationForm.locator('input[name="from"]').fill(generationFrom);
    await generationForm.locator('input[name="until"]').fill(generationUntil);
    await generationForm.getByRole('button', { name: 'Generate visits' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Visit generation is complete.' }),
    ).toBeVisible();
    const generatedRows = await database.query<{ id: string; planned_start: Date }>(
      `SELECT id, planned_start FROM scheduling.visits
       WHERE tenant_id = $1 AND client_id = $2 AND service_agreement_id IS NOT NULL
       ORDER BY planned_start, id`,
      [tenantId, agreementClientId],
    );
    const generatedVisit = generatedRows.rows[0];
    if (!generatedVisit) throw new Error('The agreement UI did not generate a visit');
    const generatedDate = dateInTimezone(generatedVisit.planned_start, 'Europe/Berlin');
    await page.goto(`/planning?clientId=${agreementClientId}&date=${generatedDate}`);
    await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
    const generatedVisitLink = page.locator(`a[href="/visits/${generatedVisit.id}"]`);
    await expect(generatedVisitLink).toContainText(`Agreement E2E ${runId}`);
    await generatedVisitLink.click();
    const visitDetailDialog = page.getByRole('dialog');
    await expect(visitDetailDialog).toBeVisible();
    await expect(page.getByRole('heading', { name: `Agreement E2E ${runId}` })).toBeVisible();
    await selectEntity(page, 'Assign employee', runId, new RegExp(`^E2E ${runId}$`));
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Employees' })
        .getByRole('listitem')
        .filter({ has: page.getByText(`E2E ${runId}`, { exact: true }) }),
    ).toBeVisible();

    await visitDetailDialog.locator('input[name="localStartTime"]').fill('08:15');
    await visitDetailDialog.locator('input[name="localEndTime"]').fill('08:45');
    await expect(visitDetailDialog.locator('input[name="localStartTime"]')).toHaveValue('08:15');
    await expect(visitDetailDialog.locator('input[name="localEndTime"]')).toHaveValue('08:45');
    await visitDetailDialog.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/updated=updated/);
    const rescheduledVisit = await database.query<{
      planned_start: Date;
      planned_end: Date;
      manually_adjusted: boolean;
    }>(
      `SELECT planned_start, planned_end, manually_adjusted
       FROM scheduling.visits WHERE tenant_id = $1 AND id = $2`,
      [tenantId, generatedVisit.id],
    );
    expect(timeInTimezone(rescheduledVisit.rows[0]!.planned_start, 'Europe/Berlin')).toBe('08:15');
    expect(timeInTimezone(rescheduledVisit.rows[0]!.planned_end, 'Europe/Berlin')).toBe('08:45');
    expect(rescheduledVisit.rows[0]!.manually_adjusted).toBe(true);
    await expect(page.getByText('Yes', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(
      visitDetailDialog.getByRole('region', { name: 'Visit' }).getByText('Confirmed', {
        exact: true,
      }),
    ).toBeVisible();

    const generatedAssignment = await database.query<{
      employee_id: string;
      facility_id: string;
    }>(
      `SELECT assignment.employee_id, visit.facility_id
       FROM scheduling.visit_assignments AS assignment
       JOIN scheduling.visits AS visit
         ON visit.tenant_id = assignment.tenant_id AND visit.id = assignment.visit_id
       WHERE assignment.tenant_id = $1 AND assignment.visit_id = $2 AND assignment.status = 'active'
       LIMIT 1`,
      [tenantId, generatedVisit.id],
    );
    const generatedScope = generatedAssignment.rows[0];
    if (!generatedScope) throw new Error('The generated visit does not have an active employee');

    await test.step('day, week, and searchable list planner across desktop and mobile', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const scopedQuery =
        `date=${generatedDate}&employeeId=${generatedScope.employee_id}` +
        `&facilityId=${generatedScope.facility_id}`;

      await page.goto(`/planning?view=day&clientId=${agreementClientId}&${scopedQuery}`);
      const tourVisitForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Create visit' }),
      });
      await expect(tourVisitForm.locator('input[name="clientId"]')).toHaveValue(agreementClientId!);
      await tourVisitForm.locator('input[name="localDate"]').fill(generatedDate);
      await tourVisitForm.locator('input[name="localStartTime"]').fill('10:00');
      await tourVisitForm.locator('input[name="localEndTime"]').fill('10:30');
      await selectEntity(
        page,
        'Services (select multiple)',
        serviceCode,
        new RegExp(`^${serviceCode} · E2E Service ${runId}$`),
        tourVisitForm,
      );
      await selectEntity(
        page,
        'Employees (optional)',
        runId,
        new RegExp(`^E2E ${runId}$`),
        tourVisitForm,
      );
      await tourVisitForm.locator('textarea[name="note"]').fill(`Tour order E2E ${runId}`);
      await tourVisitForm.getByRole('button', { name: 'Create visit' }).click();
      await expect(page).toHaveURL(/(?:\?|&)updated=visit(?:&|$)/);

      await page.goto(`/planning?view=day&${scopedQuery}`);
      await expect(page.getByRole('heading', { name: 'Day overview' })).toBeVisible();
      await expect(page.locator(`a[href^="/visits/${generatedVisit.id}"]`)).toBeVisible();
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await captureReviewScreenshot(page, 'planning-day-desktop-dark.png');

      const tourSection = page.locator('section[aria-labelledby="tour-planning-title"]');
      await expect(tourSection.getByText('2 assigned visits', { exact: true })).toBeVisible();
      await tourSection.getByRole('button', { name: 'Create draft tour' }).click();
      await expect(page).toHaveURL(/updated=tour_created/);
      const dailyTours = page.getByRole('region', { name: 'Daily tours' });
      await expect(dailyTours.getByText(/Draft changes/)).toBeVisible();
      const tourQuery = new URLSearchParams(new URL(page.url()).searchParams);
      const createdTourId = tourQuery.get('tourId');
      if (!createdTourId) throw new Error('The Office UI did not return the created tour');
      const tourEditor = page
        .locator('form')
        .filter({ has: page.getByRole('button', { name: 'Save stop order' }) });
      await expect(tourEditor.getByRole('button', { name: /Move .* down/ }).first()).toBeEnabled();
      await tourEditor
        .getByRole('button', { name: /Move .* down/ })
        .first()
        .click();
      await expect(
        page.getByText('Stop order changed. Save to update the tour draft.'),
      ).toBeVisible();
      await tourEditor.getByRole('button', { name: 'Save stop order' }).click();
      await expect(page).toHaveURL(/updated=tour_reordered/);
      await expect(page.getByRole('status')).toContainText('Tour order saved.');
      await expect(dailyTours.getByText(/Draft changes/)).toBeVisible();
      await dailyTours.getByRole('button', { name: 'Estimate travel' }).click();
      await expect(page).toHaveURL(/updated=travel_estimated/);
      await expect(page.getByRole('status')).toContainText('Travel estimates updated.');
      await expect(page.getByText('Routing service is unavailable', { exact: true })).toBeVisible();
      await dailyTours.getByRole('button', { name: 'Publish schedule' }).click();
      await expect(page).toHaveURL(/updated=tour_published/);
      await expect(dailyTours.getByText(/Published schedule/)).toBeVisible();
      await expect(dailyTours.getByText(/Published version 1/)).toBeVisible();
      await dailyTours.scrollIntoViewIfNeeded();
      await captureReviewScreenshot(page, 'tour-workspace-desktop.png');
      await page.setViewportSize({ width: 768, height: 1024 });
      await expectMobileLayoutToFit(page);
      await dailyTours.scrollIntoViewIfNeeded();
      await captureReviewScreenshot(page, 'tour-workspace-tablet-768.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await expectMobileLayoutToFit(page);
      await dailyTours.scrollIntoViewIfNeeded();
      await captureReviewScreenshot(page, 'tour-workspace-mobile-390.png');
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.locator(`a[href^="/visits/${generatedVisit.id}"]`).first().click();
      const visitSheet = page.getByRole('dialog');
      await expect(visitSheet).toBeVisible();
      await expect(visitSheet.locator('input[name="localStartTime"]')).toBeVisible();
      await expect
        .poll(() => visitSheet.evaluate((element) => element.getBoundingClientRect().width))
        .toBeGreaterThan(600);
      await captureReviewScreenshot(page, 'visit-editor-desktop.png');
      await visitSheet.getByRole('button', { name: 'Close visit details' }).click();
      await expect(page).toHaveURL(/view=day/);

      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'Light' }).click();
      await page.goto(`/planning?view=week&${scopedQuery}`);
      await expect(page.getByRole('heading', { name: 'Week overview' })).toBeVisible();
      await expect(page.locator(`a[href^="/visits/${generatedVisit.id}"]`)).toBeVisible();
      await captureReviewScreenshot(page, 'planning-week-desktop-light.png');

      await page.goto(
        `/planning?view=list&${scopedQuery}&search=${encodeURIComponent(`E2E Service ${runId}`)}`,
      );
      await expect(page.getByRole('heading', { name: 'Visits in this week' })).toBeVisible();
      await expect(page.locator(`a[href^="/visits/${generatedVisit.id}"]`)).toBeVisible();
      await captureReviewScreenshot(page, 'planning-list-desktop.png');

      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/planning?view=day&${scopedQuery}`);
      await expectMobileLayoutToFit(page);
      await expect(page.locator(`a[href^="/visits/${generatedVisit.id}"]`)).toBeVisible();
      await captureReviewScreenshot(page, 'planning-day-tablet-768.png');

      await page.setViewportSize({ width: 390, height: 844 });
      await expectMobileLayoutToFit(page);
      await expect(page.locator(`a[href^="/visits/${generatedVisit.id}"]`)).toBeVisible();
      await captureReviewScreenshot(page, 'planning-agenda-mobile-390.png', true);
      await page.locator(`a[href^="/visits/${generatedVisit.id}"]`).first().click();
      const mobileVisitSheet = page.getByRole('dialog');
      await expect(mobileVisitSheet).toBeVisible();
      await expect
        .poll(() => mobileVisitSheet.evaluate((element) => element.getBoundingClientRect().width))
        .toBeGreaterThan(380);
      await captureReviewScreenshot(page, 'visit-editor-mobile-390.png', true);
      await mobileVisitSheet.getByRole('button', { name: 'Close visit details' }).click();
      await expect(page).toHaveURL(/view=day/);
    });

    await page.goto(`/clients/${agreementClientId}`);
    await expect(page.locator('#visits-title')).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/employees/${caregiverEmployeeId}`);
    await expect(page.getByRole('heading', { name: 'Upcoming visits' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true }).first()).toBeVisible();
    await captureReviewScreenshot(page, 'employee-profile-desktop-1440.png', true);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'employee-profile-tablet-768.png', true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'employee-profile-mobile-390.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`/visits/${generatedVisit.id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancel visit' }).click();
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    const remainingVisits = await database.query<{ id: string; status: string }>(
      `SELECT id, status FROM scheduling.visits
       WHERE tenant_id = $1 AND client_id = $2 AND service_agreement_id IS NOT NULL
         AND status <> 'cancelled'
       ORDER BY planned_start, id`,
      [tenantId, agreementClientId],
    );
    for (const visit of remainingVisits.rows) {
      await page.goto(`/visits/${visit.id}`);
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Cancel visit' }).click();
      await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    }

    await page.goto(`/clients/${agreementClientId}/service-agreements`);
    await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(agreementCard.getByText('Suspended', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(agreementCard.getByText('Active', { exact: true }).first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await expect(agreementCard.getByText('Ended', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Service planning ended', { exact: true })).toBeVisible();

    const caregiver = await createAuthentikUser(authentikOrigin, apiToken, {
      username: caregiverUsername,
      name: caregiverName,
      email: caregiverEmail,
      password: caregiverPassword,
      emailVerified: true,
    });
    caregiverAuthentikUserId = caregiver.pk;
    caregiverSubject = caregiver.uuid;
    caregiverContext = await browser.newContext({
      ...devices['Pixel 7'],
      locale: 'en',
      timezoneId: 'Europe/Berlin',
    });
    const caregiverPage = await caregiverContext.newPage();
    caregiverPage.setDefaultTimeout(15_000);
    await caregiverPage.addInitScript(() => {
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
    await signInWithAuthentik(caregiverPage, caregiverUsername, caregiverPassword);
    await expect(
      caregiverPage.getByText('Your account does not have access to an active organization.'),
    ).toBeVisible();
    const caregiverProvision = await waitForPlatformUser(database, issuer, caregiverSubject);
    caregiverPlatformUserId = caregiverProvision.id;
    expect(caregiverProvision.membershipCount).toBe(0);
    const caregiverRole = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Caregiver'",
      [tenantId],
    );
    const caregiverRoleId = caregiverRole.rows[0]?.id;
    if (!caregiverRoleId || !caregiverPlatformUserId) {
      throw new Error('The seeded Caregiver role or provisioned caregiver user is missing');
    }
    caregiverMembershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [caregiverMembershipId, caregiverPlatformUserId, tenantId],
      );
      await database.query(
        `INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id)
         VALUES ($1, $2, $3)`,
        [caregiverMembershipId, tenantId, caregiverRoleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [caregiverMembershipId, tenantId, tenantId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    await caregiverPage.goto('/');
    await caregiverPage.locator('select[name="tenantId"]').selectOption(tenantId);
    await caregiverPage.getByRole('button', { name: 'Continue' }).click();
    await expect(caregiverPage).toHaveURL(/\/clients$/);
    await caregiverPage.goto('/care/today');
    const employeeLinkError = caregiverPage.getByText(
      'Your account is not linked to an active employee profile. Ask your organization administrator to link it, then try again.',
      { exact: true },
    );
    await expect(employeeLinkError).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await caregiverPage.screenshot({
      path: testInfo.outputPath('caregiver-unlinked-error-390-mobile.png'),
      fullPage: true,
    });
    await retryCareToday(caregiverPage, 'Try again');
    await expect(employeeLinkError).toBeVisible();

    await page.goto(`/employees/${caregiverEmployeeId}`);
    await page.getByRole('combobox', { name: 'Link an active user' }).click();
    await page.getByRole('combobox', { name: 'Search by name' }).fill(caregiverName);
    const linkableAccount = page
      .getByRole('dialog')
      .getByRole('option', { name: new RegExp(`${caregiverName}.*${caregiverEmail}`) });
    await expect(linkableAccount).toBeVisible();
    await captureReviewScreenshot(page, 'employee-account-link-dialog.png');
    await linkableAccount.click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Link user' }).click();
    await expect(page.getByText(caregiverName, { exact: true })).toBeVisible();
    await retryCareToday(caregiverPage, 'Try again');
    await expect(employeeLinkError).toHaveCount(0);
    await expect(caregiverPage.getByRole('heading', { name: 'No visits today' })).toBeVisible();
    await retryCareToday(caregiverPage, 'Refresh');
    await expect(caregiverPage.getByRole('heading', { name: 'No visits today' })).toBeVisible();

    await page.goto('/');
    if (await page.getByRole('button', { name: 'Sign in with Authentik' }).isVisible()) {
      await signInWithAuthentik(page, username, password);
    }
    await page.locator('select[name="tenantId"]').selectOption(tenantId);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/clients$/);

    if (!serviceId || !agreementClientId) {
      throw new Error('The E2E service and client must exist before execution');
    }
    await page.goto(`/services/${serviceId}`);
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    const executionSchedule = nextVisitTimesInBerlin();
    const executionDate = executionSchedule.date;
    const executionDateAtNoonUtc = new Date(`${executionDate}T12:00:00.000Z`);
    const englishCareDate = new Intl.DateTimeFormat('en', {
      dateStyle: 'full',
      timeZone: 'Europe/Berlin',
    }).format(executionDateAtNoonUtc);
    const germanCareDate = new Intl.DateTimeFormat('de', {
      dateStyle: 'full',
      timeZone: 'Europe/Berlin',
    }).format(executionDateAtNoonUtc);
    await page.goto(`/planning?date=${executionDate}`);
    const manualVisitForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create visit' }),
    });
    await selectEntity(
      page,
      'Client',
      runId,
      new RegExp(`^Agreement E2E ${runId}$`),
      manualVisitForm,
    );
    await manualVisitForm.locator('input[name="localDate"]').fill(executionDate);
    await manualVisitForm.locator('input[name="localStartTime"]').fill(executionSchedule.start);
    await manualVisitForm.locator('input[name="localEndTime"]').fill(executionSchedule.end);
    await selectEntity(
      page,
      'Services (select multiple)',
      serviceCode,
      new RegExp(`^${serviceCode} · E2E Service ${runId}$`),
      manualVisitForm,
    );
    await selectEntity(
      page,
      'Employees (optional)',
      runId,
      new RegExp(`^E2E ${runId}$`),
      manualVisitForm,
    );
    await manualVisitForm.locator('textarea[name="note"]').fill(executionMarker);
    await manualVisitForm.getByRole('button', { name: 'Create visit' }).click();
    await expect(page).toHaveURL(/(?:\?|&)updated=visit(?:&|$)/);
    const executionVisit = await database.query<{ id: string }>(
      'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND note = $2',
      [tenantId, executionMarker],
    );
    executionVisitId = executionVisit.rows[0]?.id;
    if (!executionVisitId) {
      throw new Error('The Office UI reported success but the execution visit was not persisted');
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'planning-1024-compact.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'planning-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await captureReviewScreenshot(page, 'planning-mobile-390.png', true);
    await page.setViewportSize({ width: 1440, height: 900 });

    await caregiverPage.goto('/');
    await caregiverPage.locator('select[name="tenantId"]').selectOption(tenantId);
    await caregiverPage.getByRole('button', { name: 'Continue' }).click();
    await expect(caregiverPage).toHaveURL(/\/clients$/);
    await caregiverPage.goto('/care/today');
    await expect(caregiverPage).toHaveURL(/\/care\/today$/);
    await expect(caregiverPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(caregiverPage.getByRole('heading', { name: 'My visits' })).toBeVisible();
    await expect(
      caregiverPage
        .locator('nav[aria-label]')
        .getByRole('link', { name: retiredModuleNavigationName }),
    ).toHaveCount(0);
    const mobileVisitLink = caregiverPage.getByRole('link', {
      name: `Agreement E2E ${runId}`,
    });
    const mobileVisitRow = caregiverPage.getByRole('listitem').filter({ has: mobileVisitLink });
    await expect(
      caregiverPage.getByText(`Visits for ${englishCareDate}`, { exact: true }),
    ).toBeVisible();
    await caregiverPage.screenshot({
      path: testInfo.outputPath('caregiver-mobile-today.png'),
      fullPage: true,
    });
    await captureReviewScreenshot(caregiverPage, 'caregiver-today-mobile-light.png', true);
    await caregiverPage.getByRole('button', { name: 'Appearance' }).click();
    await caregiverPage.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(caregiverPage.locator('html')).toHaveClass(/dark/);
    await caregiverPage.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await captureReviewScreenshot(caregiverPage, 'caregiver-today-mobile-dark.png', true);
    await caregiverPage.getByRole('button', { name: 'Appearance' }).click();
    await caregiverPage.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(caregiverPage.locator('html')).not.toHaveClass(/dark/);
    await expectMobileLayoutToFit(caregiverPage);
    await expect(mobileVisitRow).toContainText('Next visit');
    await expect(mobileVisitRow).toContainText('Not started');
    await selectCaregiverLocale(caregiverPage, 'en', 'de');
    await expect(caregiverPage.locator('html')).toHaveAttribute('lang', 'de');
    await expect(caregiverPage.getByRole('heading', { name: 'Meine Einsätze' })).toBeVisible();
    await expect(
      caregiverPage
        .locator('nav[aria-label]')
        .getByRole('link', { name: retiredModuleNavigationName }),
    ).toHaveCount(0);
    await expect(
      caregiverPage.getByText(`Einsätze am ${germanCareDate}`, { exact: true }),
    ).toBeVisible();
    await expect(mobileVisitRow).toContainText('Nächster Einsatz');
    await expect(mobileVisitRow).toContainText('Nicht gestartet');
    await caregiverPage.reload();
    await caregiverPage.getByRole('button', { name: /Konto/ }).click();
    await caregiverPage.getByRole('menuitem', { name: /Sprache/ }).click();
    await expect(caregiverPage.getByRole('menuitemradio', { name: 'Deutsch' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await caregiverPage.keyboard.press('Escape');
    await caregiverPage.keyboard.press('Escape');
    await expect(
      caregiverPage.getByText(`Einsätze am ${germanCareDate}`, { exact: true }),
    ).toBeVisible();
    await selectCaregiverLocale(caregiverPage, 'de', 'en');
    await expect(caregiverPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(caregiverPage.getByRole('heading', { name: 'My visits' })).toBeVisible();
    await expect(
      caregiverPage.getByText(`Visits for ${englishCareDate}`, { exact: true }),
    ).toBeVisible();
    await expect(mobileVisitLink).toContainText(`Agreement E2E ${runId}`);
    await mobileVisitLink.click();
    await expect(
      caregiverPage.getByRole('heading', { name: `Agreement E2E ${runId}` }),
    ).toBeVisible({ timeout: 30_000 });
    await expectMobileLayoutToFit(caregiverPage);
    await caregiverPage.setViewportSize({ width: 390, height: 844 });
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-visit-before-start-mobile-390.png',
      true,
    );
    await caregiverPage.setViewportSize({ width: 768, height: 1024 });
    await expectMobileLayoutToFit(caregiverPage);
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-visit-before-start-tablet-768.png',
      true,
    );
    await caregiverPage.setViewportSize({ width: 1440, height: 900 });
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-visit-before-start-desktop-1440.png',
      true,
    );
    await caregiverPage.setViewportSize({ width: 390, height: 844 });
    if (!replacementEmployeeId) throw new Error('The cover employee is missing for reassignment');
    await page.goto(`/visits/${executionVisitId}`);
    await selectEntity(page, 'Assign employee', runId, new RegExp(`^Cover E2E ${runId}$`));
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/visits/${executionVisitId}\\?updated=assigned$`));
    await expect(
      page
        .getByRole('region', { name: 'Employees' })
        .getByRole('listitem')
        .filter({ has: page.getByText(`Cover E2E ${runId}`, { exact: true }) }),
    ).toBeVisible();
    const formerAssignment = page
      .getByRole('region', { name: 'Employees' })
      .getByRole('listitem')
      .filter({ has: page.getByText(`E2E ${runId}`, { exact: true }) });
    await formerAssignment.getByRole('button', { name: 'Unassign', exact: true }).click();
    await expect(formerAssignment).toHaveCount(0);

    await caregiverPage.getByRole('button', { name: 'Start visit' }).tap();
    const reassignmentDeniedAlert = caregiverPage
      .getByRole('alert')
      .filter({ hasText: 'You are not assigned to this visit.' });
    await expect(reassignmentDeniedAlert).toContainText('You are not assigned to this visit.');
    const deniedExecution = await database.query<{ id: string }>(
      'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = $2',
      [tenantId, executionVisitId],
    );
    expect(deniedExecution.rows).toHaveLength(0);

    await selectEntity(page, 'Assign employee', runId, new RegExp(`^E2E ${runId}$`));
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/visits/${executionVisitId}\\?updated=assigned$`));
    await expect(
      page
        .getByRole('region', { name: 'Employees' })
        .getByRole('listitem')
        .filter({ has: page.getByText(`E2E ${runId}`, { exact: true }) }),
    ).toBeVisible();
    await caregiverPage.reload();
    await expect(caregiverPage.getByRole('button', { name: 'Start visit' })).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Start visit' }).tap();
    await expect(caregiverPage.getByText('In progress', { exact: true })).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await expect(caregiverPage.getByRole('heading', { name: 'Planned services' })).toBeVisible();
    await captureReviewScreenshot(caregiverPage, 'caregiver-active-visit-mobile-390.png', true);
    const plannedServiceForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Save outcome' }),
    });
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-performed-service-editor-mobile-390.png',
      true,
    );
    const plannedExecutionVersion = await plannedServiceForm
      .locator('input[name="expectedVersion"]')
      .inputValue();
    await plannedServiceForm.locator('select[name="status"]').selectOption('performed');
    await plannedServiceForm.locator('input[name="actualQuantity"]').fill('1');
    await plannedServiceForm.getByRole('button', { name: 'Save outcome' }).tap();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service outcome saved.' }),
    ).toBeVisible();

    const unplannedForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Record service' }),
    });
    await expect(unplannedForm.locator('input[name="expectedVersion"]')).not.toHaveValue(
      plannedExecutionVersion,
    );
    await unplannedForm.locator('select[name="serviceDefinitionId"]').selectOption(serviceId);
    await unplannedForm.locator('select[name="status"]').selectOption('performed');
    await unplannedForm.locator('input[name="actualQuantity"]').fill('1');
    await unplannedForm.getByRole('button', { name: 'Record service' }).tap();
    await expect(
      caregiverPage.getByRole('heading', { name: 'Additional services recorded' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Start documentation' }).tap();
    await expect(
      caregiverPage.getByRole('heading', { name: 'Service documentation' }),
    ).toBeVisible();
    await captureReviewScreenshot(caregiverPage, 'caregiver-documentation-mobile-390.png', true);

    const observationText = `E2E observation ${runId}`;
    const observationSection = caregiverPage
      .getByRole('heading', { name: 'Observations', level: 3 })
      .locator('..');
    const observationForm = observationSection.locator('form');
    await observationSection.locator('textarea[name="content"]').fill(observationText);
    await expect(observationForm.getByRole('status')).toContainText(
      'Draft kept temporarily in this browser tab',
    );
    await caregiverContext.setOffline(true);
    await observationForm.getByRole('button', { name: 'Save changes' }).tap();
    await expect(observationForm.getByRole('status')).toContainText(
      'You are offline. Your local draft is not on the server; reconnect before submitting.',
    );
    await expect(observationSection.locator('textarea[name="content"]')).toHaveValue(
      observationText,
    );
    await caregiverContext.setOffline(false);
    await caregiverPage.goto('/care/today');
    await caregiverPage.goto(`/care/visits/${executionVisitId}`);
    const recoveredObservationForm = caregiverPage
      .getByRole('heading', { name: 'Observations', level: 3 })
      .locator('..')
      .locator('form');
    await expect(recoveredObservationForm.getByText('An unsent draft from')).toBeVisible();
    await recoveredObservationForm.getByRole('button', { name: 'Restore draft' }).tap();
    await expect(recoveredObservationForm.locator('textarea[name="content"]')).toHaveValue(
      observationText,
    );
    await expectMobileLayoutToFit(caregiverPage);
    await captureReviewScreenshot(caregiverPage, 'caregiver-visit-detail-mobile-390.png', true);
    const visitPath = new URL(caregiverPage.url()).pathname;
    const observationSaveResponse = caregiverPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.headers()['content-type']?.startsWith('text/x-component') === true &&
        new URL(response.url()).pathname === visitPath,
    );
    await Promise.all([
      recoveredObservationForm.getByRole('button', { name: 'Save changes' }).tap(),
      observationSaveResponse,
    ]);
    await expect(
      caregiverPage
        .getByRole('heading', { name: 'Observations', level: 3 })
        .locator('..')
        .locator('li > p')
        .filter({ hasText: observationText }),
    ).toBeVisible();
    await expect(
      recoveredObservationForm
        .getByRole('status')
        .filter({ hasText: 'The server confirmed this submission.' }),
    ).toBeVisible();
    const remainingObservationDrafts = await caregiverPage.evaluate((visitId) => {
      const visitPart = encodeURIComponent(visitId);
      const formPart = encodeURIComponent('entry-new:observation');
      return Array.from({ length: window.sessionStorage.length }, (_, index) =>
        window.sessionStorage.key(index),
      ).filter((key) => key?.includes(visitPart) && key?.includes(formPart)).length;
    }, executionVisitId);
    expect(remainingObservationDrafts).toBe(0);

    const deviationText = `E2E deviation ${runId}`;
    const deviationSection = caregiverPage
      .getByRole('heading', { name: 'Deviations' })
      .locator('..');
    await deviationSection.locator('textarea[name="content"]').fill(deviationText);
    await deviationSection.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      deviationSection.locator('li > p').filter({ hasText: deviationText }),
    ).toBeVisible();

    const incidentText = `E2E incident ${runId}`;
    const incidentSection = caregiverPage.getByRole('heading', { name: 'Incidents' }).locator('..');
    await incidentSection.locator('textarea[name="content"]').fill(incidentText);
    await incidentSection.locator('select[name="severity"]').selectOption('low');
    await incidentSection.getByRole('button', { name: 'Save changes' }).click();
    await expect(incidentSection.locator('li > p').filter({ hasText: incidentText })).toBeVisible();
    await expect(
      caregiverPage
        .getByRole('heading', { name: 'Finalize documentation' })
        .locator('..')
        .getByText(/Service evidence is missing/)
        .first(),
    ).toBeVisible();
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-completion-review-mobile-390.png',
      true,
    );

    await caregiverPage.getByRole('button', { name: 'Complete visit' }).click();
    await expect(caregiverPage.getByText('Completed', { exact: true })).toBeVisible();

    await caregiverPage.goto('/care/today');
    await expect(caregiverPage.getByText('⚠ Documentation incomplete')).toBeVisible();
    await page.goto('/documentation');
    await expect(page.getByRole('heading', { name: 'Incomplete documentation' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();
    const documentationClientFilter = page.getByLabel('Client');
    await documentationClientFilter.fill(`Agreement E2E ${runId}`);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
    await documentationClientFilter.fill('Unknown client');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('0 visits', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}`);
    const evidenceSection = caregiverPage
      .getByRole('heading', { name: 'Service documentation' })
      .locator('..');
    const evidenceRows = evidenceSection.locator('li');
    await expect(evidenceRows).toHaveCount(2);
    const staleDraftForm = caregiverPage.locator('form').filter({
      has: caregiverPage.locator('input[name="type"][value="care_note"]'),
    });
    await staleDraftForm.locator('textarea[name="content"]').fill(`Stale E2E draft ${runId}`);
    await expect(staleDraftForm.getByRole('status')).toContainText(
      'Draft kept temporarily in this browser tab',
    );
    for (let index = 0; index < (await evidenceRows.count()); index += 1) {
      const row = evidenceRows.nth(index);
      await row.locator('textarea[name="note"]').fill(`E2E service evidence ${index + 1} ${runId}`);
      await row.getByRole('button', { name: 'Save evidence' }).tap();
      await expect(row.getByText('Evidence recorded', { exact: true })).toBeVisible();
    }
    await caregiverPage.reload();
    const staleDraftAfterReload = caregiverPage.locator('form').filter({
      has: caregiverPage.locator('input[name="type"][value="care_note"]'),
    });
    await expect(
      staleDraftAfterReload.getByText(
        'A draft from an earlier server version cannot be restored safely',
      ),
    ).toBeVisible();
    await expect(staleDraftAfterReload.locator('textarea[name="content"]')).toHaveValue('');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await staleDraftAfterReload.getByRole('button', { name: 'Discard draft' }).tap();
    await expect(
      staleDraftAfterReload.getByText(
        'A draft from an earlier server version cannot be restored safely',
      ),
    ).toHaveCount(0);
    const remainingStaleDrafts = await caregiverPage.evaluate((visitId) => {
      const visitPart = encodeURIComponent(visitId);
      const formPart = encodeURIComponent('entry-new:care_note');
      return Array.from({ length: window.sessionStorage.length }, (_, index) =>
        window.sessionStorage.key(index),
      ).filter((key) => key?.includes(visitPart) && key?.includes(formPart)).length;
    }, executionVisitId);
    expect(remainingStaleDrafts).toBe(0);
    await expect(
      caregiverPage.getByRole('button', { name: 'Finalize documentation' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Finalize documentation' }).tap();
    await expect(caregiverPage.getByText('Finalized', { exact: true })).toBeVisible();
    await expect(caregiverPage.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(caregiverPage.getByRole('button', { name: 'Save evidence' })).toHaveCount(0);

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByRole('heading', { name: 'Review service evidence' }),
    ).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await caregiverPage.getByRole('button', { name: 'Create service evidence' }).click();
    await expect(caregiverPage.getByText('Version 1', { exact: true })).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await captureReviewScreenshot(caregiverPage, 'caregiver-evidence-mobile-390.png', true);
    await expect(
      caregiverPage.getByText(`E2E Service ${runId}`, { exact: true }).first(),
    ).toBeVisible();
    const firstSignaturePad = caregiverPage.locator('#acknowledge-evidence').getByRole('img');
    await firstSignaturePad.scrollIntoViewIfNeeded();
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-signature-interface-mobile-390.png',
      true,
    );
    const signatureBounds = await firstSignaturePad.boundingBox();
    if (!signatureBounds) throw new Error('The mobile signature pad is not visible');
    const touch = await caregiverPage.context().newCDPSession(caregiverPage);
    const touchPoint = (x: number, y: number) => ({
      id: 1,
      x,
      y,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        touchPoint(
          signatureBounds.x + signatureBounds.width * 0.2,
          signatureBounds.y + signatureBounds.height * 0.6,
        ),
      ],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        touchPoint(
          signatureBounds.x + signatureBounds.width * 0.45,
          signatureBounds.y + signatureBounds.height * 0.35,
        ),
      ],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        touchPoint(
          signatureBounds.x + signatureBounds.width * 0.75,
          signatureBounds.y + signatureBounds.height * 0.55,
        ),
      ],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    const acknowledgementFormState = await caregiverPage
      .locator('#acknowledge-evidence')
      .evaluate((form) => {
        const formElement = form as HTMLFormElement;
        const invalidControls = Array.from(formElement.elements)
          .filter(
            (
              element,
            ): element is
              | HTMLButtonElement
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement =>
              element instanceof HTMLButtonElement ||
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement,
          )
          .filter((element) => !element.checkValidity())
          .map(
            (element) => `${element.tagName.toLowerCase()}[name="${element.getAttribute('name')}"]`,
          );
        return {
          online: navigator.onLine,
          valid: formElement.checkValidity(),
          invalidControls,
          serializedStrokeCount: JSON.parse(
            formElement.querySelector<HTMLInputElement>('input[name="strokes"]')?.value ?? '[]',
          ).length,
        };
      });
    expect(acknowledgementFormState.online).toBe(true);
    expect(acknowledgementFormState.valid).toBe(true);
    expect(acknowledgementFormState.serializedStrokeCount).toBeGreaterThan(0);
    let acknowledgementDialogSeen = false;
    await caregiverPage.once('dialog', async (dialog) => {
      acknowledgementDialogSeen = true;
      await dialog.accept();
    });
    const signatureSubmit = caregiverPage.getByRole('button', { name: 'Confirm signature' });
    await expect(signatureSubmit).toBeEnabled();
    await signatureSubmit.click();
    expect(acknowledgementDialogSeen).toBe(true);
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
    ).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    const firstPackage = await database.query<{ id: string }>(
      `SELECT package.id
       FROM service_evidence.evidence_packages AS package
       JOIN care_documentation.documents AS documentation
         ON documentation.tenant_id = package.tenant_id AND documentation.id = package.documentation_id
       WHERE package.tenant_id = $1 AND documentation.visit_id = $2
       ORDER BY package.version DESC LIMIT 1`,
      [tenantId, executionVisitId],
    );
    initialEvidencePackageId = firstPackage.rows[0]?.id;
    if (!initialEvidencePackageId) throw new Error('The first evidence package was not persisted');

    await page.goto(`/visits/${executionVisitId}`);
    await expect(page.getByRole('heading', { name: 'Execution' })).toBeVisible();
    await expect(page.getByText('Visit completed', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('office-visit-detail-390-mobile.png'),
      fullPage: true,
    });
    await expectMobileLayoutToFit(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByText(`E2E Service ${runId}`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(observationText, { exact: true })).toBeVisible();
    await expect(page.getByText(deviationText, { exact: true })).toBeVisible();
    await expect(page.getByText(incidentText, { exact: true })).toBeVisible();
    const amendmentDetails = page.locator('details').filter({ hasText: 'Amend documentation' });
    await amendmentDetails.locator('summary').click();
    await amendmentDetails.locator('input[name="reason"]').fill(`E2E correction reason ${runId}`);
    await amendmentDetails.locator('textarea[name="correction"]').fill(`E2E amendment ${runId}`);
    await amendmentDetails.getByRole('button', { name: 'Save addition' }).click();
    await expect(page.getByText(`E2E amendment ${runId}`, { exact: true })).toBeVisible();
    const correctionDetails = page
      .locator('details')
      .filter({ hasText: 'Correct execution times' });
    await correctionDetails.locator('summary').click();
    const actualStartInput = correctionDetails.locator('input[name="actualStart"]');
    await actualStartInput.fill(shiftDateTimeLocal(await actualStartInput.inputValue(), -1));
    await correctionDetails.locator('textarea[name="reason"]').fill('E2E correction reason');
    await correctionDetails.getByRole('button', { name: 'Correct times' }).click();
    await expect(page.getByText('Visit times corrected', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByText('A new version is required', { exact: true }),
    ).toBeVisible();
    await expect(
      caregiverPage.getByText('The earlier acknowledgement remains recorded', { exact: false }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Create current service evidence' }).click();
    await expect(caregiverPage.getByText('Version 2', { exact: true })).toBeVisible();
    const signatoryPicker = caregiverPage.getByLabel('Select the person acknowledging');
    await signatoryPicker.selectOption(`representative:${representativeContactId}`);
    await caregiverPage.locator('input[name="method-choice"][value="typed_confirmation"]').check();
    await caregiverPage.locator('input[name="confirmationName"]').fill('E2E Representative');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await caregiverPage.getByRole('button', { name: 'Record acknowledgement' }).click();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
    ).toBeVisible();
    const replacementPackage = await database.query<{ id: string; version: number }>(
      `SELECT package.id, package.version
       FROM service_evidence.evidence_packages AS package
       JOIN care_documentation.documents AS documentation
         ON documentation.tenant_id = package.tenant_id AND documentation.id = package.documentation_id
       WHERE package.tenant_id = $1 AND documentation.visit_id = $2
       ORDER BY package.version DESC LIMIT 1`,
      [tenantId, executionVisitId],
    );
    replacementEvidencePackageId = replacementPackage.rows[0]?.id;
    if (replacementPackage.rows[0]?.version !== 2 || !replacementEvidencePackageId) {
      throw new Error('The replacement evidence package was not persisted as version 2');
    }

    await page.goto(
      `/service-evidence?clientQuery=${encodeURIComponent(`Agreement E2E ${runId}`)}`,
    );
    await expect(page.getByRole('heading', { name: 'Service evidence' })).toBeVisible();
    const acknowledgedRow = page.getByRole('row').filter({
      has: page.locator(`a[href="/service-evidence/${replacementEvidencePackageId}"]`),
    });
    await expect(acknowledgedRow).toContainText('Acknowledged');
    await expect(acknowledgedRow).toContainText('E2E Representative');
    await expect(acknowledgedRow.getByRole('link')).toHaveAttribute(
      'href',
      `/service-evidence/${replacementEvidencePackageId}`,
    );
    await acknowledgedRow.getByRole('link').click();
    await expect(page.getByText('E2E Representative', { exact: true })).toBeVisible();
    await expect(page.getByText('authorized representative', { exact: true })).toBeVisible();
    await expect(page.getByText('Name confirmation', { exact: true })).toBeVisible();
    const initialVersionLink = page.locator(
      `a[href="/service-evidence/${initialEvidencePackageId}"]`,
    );
    await expect(initialVersionLink).toBeVisible();
    await initialVersionLink.click();
    await expect(page.getByRole('img', { name: 'Saved signature' })).toBeVisible();
    await page.goto(`/service-evidence/${replacementEvidencePackageId}`);
    const revokeForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Revoke acknowledgement' }),
    });
    await revokeForm.locator('input[name="reason"]').fill(`E2E revocation ${runId}`);
    await page.once('dialog', (dialog) => dialog.accept());
    await revokeForm.getByRole('button', { name: 'Revoke acknowledgement' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'The acknowledgement was revoked.' }),
    ).toBeVisible();
    await expect(page.getByText('Revoked', { exact: true }).first()).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await caregiverPage
      .getByLabel('Select the person acknowledging')
      .selectOption(`representative:${representativeContactId}`);
    await caregiverPage
      .locator('details')
      .filter({
        hasText: 'Acknowledgement declined or unavailable',
      })
      .locator('summary')
      .click();
    const declineForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Record decline' }),
    });
    await declineForm.locator('select[name="reasonCode"]').selectOption('disagrees_with_record');
    await declineForm.locator('textarea[name="note"]').fill(`E2E decline note ${runId}`);
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await declineForm.getByRole('button', { name: 'Record decline' }).click();
    await expect(
      caregiverPage
        .getByRole('status')
        .filter({ hasText: 'The decline is recorded for this version' }),
    ).toBeVisible();
    await captureReviewScreenshot(
      caregiverPage,
      'caregiver-declined-acknowledgement-mobile-390.png',
      true,
    );
    expect(
      await caregiverPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const claimEvidenceRefresh = `E2E claim evidence refresh ${runId}`;
    await page.goto(`/visits/${executionVisitId}`);
    const claimEvidenceAmendment = page
      .locator('details')
      .filter({ hasText: 'Amend documentation' });
    await claimEvidenceAmendment.locator('summary').click();
    await claimEvidenceAmendment
      .locator('input[name="reason"]')
      .fill(`E2E billing evidence reason ${runId}`);
    await claimEvidenceAmendment.locator('textarea[name="correction"]').fill(claimEvidenceRefresh);
    await claimEvidenceAmendment.getByRole('button', { name: 'Save addition' }).click();
    await expect(page.getByText(claimEvidenceRefresh, { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByText('A new version is required', { exact: true }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Create current service evidence' }).tap();
    await expect(caregiverPage.getByText('Version 3', { exact: true })).toBeVisible();
    await caregiverPage
      .getByLabel('Select the person acknowledging')
      .selectOption(`representative:${representativeContactId}`);
    await caregiverPage.locator('input[name="method-choice"][value="typed_confirmation"]').check();
    await caregiverPage.locator('input[name="confirmationName"]').fill('E2E Representative');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await caregiverPage.getByRole('button', { name: 'Record acknowledgement' }).tap();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
    ).toBeVisible();
    const finalPackage = await database.query<{
      id: string;
      version: number;
      status: string;
    }>(
      `SELECT package.id, package.version, acknowledgement.status
       FROM service_evidence.evidence_packages AS package
       JOIN care_documentation.documents AS documentation
         ON documentation.tenant_id = package.tenant_id AND documentation.id = package.documentation_id
       LEFT JOIN service_evidence.acknowledgements AS acknowledgement
         ON acknowledgement.tenant_id = package.tenant_id
         AND acknowledgement.evidence_package_id = package.id
         AND acknowledgement.revoked_at IS NULL
       WHERE package.tenant_id = $1 AND documentation.visit_id = $2
       ORDER BY package.version DESC LIMIT 1`,
      [tenantId, executionVisitId],
    );
    finalEvidencePackageId = finalPackage.rows[0]?.id;
    if (
      finalPackage.rows[0]?.version !== 3 ||
      finalPackage.rows[0]?.status !== 'acknowledged' ||
      !finalEvidencePackageId
    ) {
      throw new Error('The latest evidence package was not acknowledged after the amendment');
    }
    await page.goto(
      `/service-evidence?clientQuery=${encodeURIComponent(`Agreement E2E ${runId}`)}`,
    );
    const finalEvidenceRow = page.getByRole('row').filter({
      has: page.locator(`a[href="/service-evidence/${finalEvidencePackageId}"]`),
    });
    await expect(finalEvidenceRow).toContainText('Acknowledged');
    await expect(finalEvidenceRow).toContainText('E2E Representative');

    await page.goto(`/clients/${agreementClientId}`);
    await expect(page.getByText('Visit started', { exact: true })).toBeVisible();
    await expect(page.getByText('Visit completed', { exact: true })).toBeVisible();
    await expect(page.getByText('Documentation finalized', { exact: true })).toBeVisible();
    await expect(page.getByText('Incident documented', { exact: true })).toBeVisible();
    await expect(page.getByText('Documentation amended', { exact: true }).first()).toBeVisible();
    const clientExecutionRow = page.locator(`#visits a[href="/visits/${executionVisitId}"]`);
    await expect(clientExecutionRow).toContainText('Execution: Completed');
    await expect(clientExecutionRow).toContainText('Actual');
    await page.goto(`/employees/${caregiverEmployeeId}`);
    const employeeExecutionRow = page.locator(
      `section[aria-labelledby="schedule-title"] > ol a[href="/visits/${executionVisitId}"]`,
    );
    await expect(employeeExecutionRow).toContainText('Execution: Completed');
    await expect(employeeExecutionRow).toContainText('Actual');

    await page.goto('/benefits');
    await expectVisibleTextToOmitIds(page, [agreementClientId, executionVisitId, serviceId]);
    const completedService = page
      .getByRole('heading', { name: `E2E Service ${runId} · Agreement E2E ${runId}` })
      .first()
      .locator('xpath=ancestor::li[1]');
    await expect(
      completedService.getByRole('link', { name: `Agreement E2E ${runId}` }),
    ).toHaveAttribute('href', `/clients/${agreementClientId}`);
    const allocationForm = completedService.locator('form');
    const allocationSourceOption = await allocationForm
      .locator('select[name="allocation-0-selection"] option')
      .filter({ hasText: 'E2E Pflegekasse' })
      .getAttribute('value');
    if (!allocationSourceOption)
      throw new Error('The service allocation form has no eligible §45b source');
    await allocationForm
      .locator('select[name="allocation-0-selection"]')
      .selectOption(allocationSourceOption);
    await allocationForm.locator('input[name="allocation-0-amount"]').fill('45');
    await allocationForm.locator('select[name="allocation-0-status"]').selectOption('confirmed');
    await allocationForm.getByRole('button', { name: 'Allocate funding' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Service funding was allocated.' }),
    ).toBeVisible({ timeout: 30_000 });

    await page.goto(`/clients/${agreementClientId}/benefits`);
    const budgetHistory = page.locator('section[aria-labelledby="history-title"]');
    await expect(budgetHistory.getByRole('heading', { name: 'Budget history' })).toBeVisible();
    await expect(
      budgetHistory.getByRole('table').getByText('Completed service allocation', { exact: true }),
    ).toBeVisible();

    if (process.env.CARE_E2E_STOP_BEFORE_BILLING === 'true') return;

    const billingFilters = new URLSearchParams({
      from: serviceValidFrom,
      until: serviceValidFrom,
      organizationId: e2eOrganizationId,
      facilityId: e2eFacilityId,
      clientId: agreementClientId,
      ready: 'true',
    });
    await page.goto(`/billing?${billingFilters.toString()}`);
    await expect(page.getByRole('heading', { name: 'Billable service worklist' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectMobileLayoutToFit(page);
    await page.screenshot({
      path: testInfo.outputPath('billing-worklist-390-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const payerInvoiceGroup = page.locator('#worklist section').filter({
      has: page.locator('header p').filter({ hasText: 'E2E Pflegekasse' }),
    });
    if ((await payerInvoiceGroup.count()) === 0) {
      const readyWorklist = (await page.locator('#worklist').innerText()).slice(0, 4_000);
      const blockedFilters = new URLSearchParams(billingFilters);
      blockedFilters.set('ready', 'false');
      await page.goto(`/billing?${blockedFilters.toString()}`);
      throw new Error(
        `No ready payer invoice group. Ready worklist: ${readyWorklist}\n` +
          `Blocked worklist: ${(await page.locator('#worklist').innerText()).slice(0, 4_000)}`,
      );
    }
    await expect(payerInvoiceGroup).toHaveCount(1);
    await expect(payerInvoiceGroup.locator('header p')).toContainText('Payer invoice');
    await expect(payerInvoiceGroup.locator('header p')).toContainText('E2E Pflegekasse');
    const payerCandidate = payerInvoiceGroup
      .locator('li')
      .filter({ hasText: `E2E Service ${runId}` })
      .filter({ hasText: 'E2E Pflegekasse' })
      .first();
    const includeCandidate = payerCandidate.getByRole('checkbox', { name: 'Include this service' });
    await expect(includeCandidate).toBeEnabled();
    await includeCandidate.click();
    await payerInvoiceGroup.getByRole('button', { name: 'Create draft invoice' }).click();
    await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]{36}\?updated=draft$/i);
    invoiceId = new URL(page.url()).pathname.split('/').at(-1);
    if (!invoiceId) throw new Error('The billing worklist did not open the invoice draft');
    await expect(page.getByRole('heading', { name: 'Invoice lines' })).toBeVisible();
    await expect(page.getByText(`E2E Service ${runId}`, { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Invoice summary' })
        .getByRole('definition')
        .filter({ hasText: 'E2E Pflegekasse' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${invoiceId}\\?updated=issued$`));
    await expect(page.getByRole('status')).toHaveText('Invoice issued.');
    await expect(page.locator('section[aria-labelledby="draft-actions-title"]')).toHaveCount(0);

    const invoiceTotals = await database.query<{ grand_total_cents: number }>(
      'SELECT grand_total_cents FROM billing.invoices WHERE tenant_id = $1 AND id = $2',
      [tenantId, invoiceId],
    );
    const invoiceAmountCents = invoiceTotals.rows[0]?.grand_total_cents;
    if (!invoiceAmountCents || invoiceAmountCents <= 0) {
      throw new Error('The issued invoice does not have a billable total');
    }
    const invoiceAmount = (invoiceAmountCents / 100).toFixed(2);
    const invoicePdfLink = page.getByRole('link', { name: 'Download invoice PDF' });
    await expect
      .poll(
        async () => {
          await page.reload();
          return invoicePdfLink.isVisible();
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(true);
    const invoicePdfResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/billing/invoices/${invoiceId}/pdf` &&
        response.request().method() === 'GET',
    );
    await invoicePdfLink.click();
    const invoicePdfResponse = await invoicePdfResponsePromise;
    expect(invoicePdfResponse.status()).toBe(200);
    expect(invoicePdfResponse.headers()['content-type']).toContain('application/pdf');

    await page.goto(`/billing/invoices/${invoiceId}`);
    await page.getByRole('link', { name: 'Create claim' }).click();
    await expect(page).toHaveURL(new RegExp(`/billing/claims/new\\?invoiceId=${invoiceId}$`));
    const claimCreationForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create claim draft' }),
    });
    await claimCreationForm.locator('select[name="payerBillingProfileId"]').selectOption({
      index: 1,
    });
    await claimCreationForm.getByRole('button', { name: 'Create claim draft' }).click();
    await expect(page).toHaveURL(/\/billing\/claims\/[0-9a-f-]{36}\?updated=created$/i);
    claimId = new URL(page.url()).pathname.split('/').at(-1);
    if (!claimId) throw new Error('The issued invoice did not create a payer claim draft');
    await expectVisibleTextToOmitIds(page, [claimId, invoiceId, agreementClientId]);
    await expect(page.getByRole('heading', { name: 'Readiness' })).toBeVisible();
    await expect(page.getByText('All configured readiness checks are satisfied.')).toBeVisible();
    const prepareClaimButton = page.getByRole('button', { name: 'Prepare submission package' });
    await expect(prepareClaimButton).toBeEnabled();
    await prepareClaimButton.click();
    await expect(page.getByRole('status')).toHaveText('Submission package prepared.');
    const claimDocumentRows = page
      .locator('section[aria-labelledby="claim-documents"]')
      .locator('li');
    await expect(claimDocumentRows).toHaveCount(3);
    const claimDocumentResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/billing/claims/${claimId}/documents/`) &&
        response.request().method() === 'GET',
    );
    await claimDocumentRows.first().getByRole('link', { name: 'Download' }).click();
    const claimDocumentResponse = await claimDocumentResponsePromise;
    expect(claimDocumentResponse.status()).toBe(200);
    expect(claimDocumentResponse.headers()['content-type']).toContain('application/pdf');

    await page.goto(`/billing/claims/${claimId}`);
    const claimSubmissionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Record submission' }),
    });
    await claimSubmissionForm
      .locator('input[name="externalReference"]')
      .fill(`E2E submission ${runId}`);
    await claimSubmissionForm
      .locator('input[name="protectedNote"]')
      .fill('Submitted manually through the payer portal.');
    await claimSubmissionForm.getByRole('button', { name: 'Record submission' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Manual submission recorded.' }),
    ).toBeVisible();
    const claimDecisionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Save payer decision' }),
    });
    await claimDecisionForm
      .locator('input[name="externalReference"]')
      .fill(`E2E decision ${runId}`);
    await claimDecisionForm.getByRole('button', { name: 'Save payer decision' }).click();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();

    await page.goto('/billing/payments');
    const paymentEntryForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Record payment' }),
    });
    await selectEntity(
      page,
      'Organization',
      e2eOrganizationName,
      e2eOrganizationName,
      paymentEntryForm,
    );
    await paymentEntryForm.locator('input[name="payerName"]').fill(e2ePayerName);
    await paymentEntryForm.locator('input[name="payerReference"]').fill(`E2E-PAYER-${runId}`);
    await paymentEntryForm.locator('input[name="amount"]').fill(invoiceAmount);
    const paymentReference = `E2E-CLAIM-PAYMENT-${runId}`;
    await paymentEntryForm.locator('input[name="reference"]').fill(paymentReference);
    await paymentEntryForm.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payment recorded.' })).toBeVisible();

    await page.goto(`/billing/claims/${claimId}`);
    const claimPaymentForm = page
      .locator('form')
      .filter({
        has: page.getByRole('button', { name: 'Link payment' }),
      })
      .filter({ hasText: paymentReference });
    await expect(claimPaymentForm).toBeVisible();
    await claimPaymentForm.getByRole('button', { name: 'Link payment' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Payment linked to claim.' }),
    ).toBeVisible();

    await page.goto(`/billing/invoices/${invoiceId}`);
    const invoiceSummary = page.locator('section[aria-labelledby="invoice-summary-title"]');
    await expect(invoiceSummary).toContainText('Paid');
    await page.goto(`/clients/${agreementClientId}/invoices`);
    await expectVisibleTextToOmitIds(page, [agreementClientId, invoiceId, claimId]);
    const clientInvoiceRow = page
      .locator('section[aria-labelledby="client-invoice-history"]')
      .getByRole('row')
      .filter({
        has: page.locator(`a[href="/billing/invoices/${invoiceId}"]`),
      });
    await expect(clientInvoiceRow).toContainText('Paid');

    if (!serviceId) throw new Error('The service detail page did not expose its ID');
    await page.goto(`/services/${serviceId}`);
    const serviceArchivePath = new URL(page.url()).pathname;
    const serviceArchiveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === serviceArchivePath,
    );
    await Promise.all([
      page.getByRole('button', { name: 'Archive service' }).click(),
      serviceArchiveResponse,
    ]);
    await page.reload();
    await expect(page.locator('span').filter({ hasText: /^Archived$/ })).toBeVisible();

    await page.goto('/administration/users');
    await expect(page.getByRole('heading', { name: 'Users & Access' })).toBeVisible();
    await page.getByLabel('Email').fill(invitedEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitation created.' })).toBeVisible();
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

    const roleAndScope = await database.query<{ office_role_id: string; facility_id: string }>(
      `SELECT role.id AS office_role_id, facility.id AS facility_id
       FROM identity.roles AS role
       CROSS JOIN organizations.facilities AS facility
       WHERE role.tenant_id = $1 AND role.name = 'Office'
         AND facility.tenant_id = $1 AND facility.name = 'Facility West'`,
      [tenantId],
    );
    const officeRoleId = roleAndScope.rows[0]?.office_role_id;
    const facilityWestId = roleAndScope.rows[0]?.facility_id;
    if (!invitedMembershipId || !officeRoleId || !facilityWestId) {
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
    const officeRole = page.locator(`button[role="checkbox"][value="${officeRoleId}"]`);
    await officeRole.click();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await officeRole.click();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expect(officeRole).not.toBeChecked();
    await officeRole.click();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();

    await page.locator('input[name="scopeMode"][value="scoped"]').check();
    const facilityScope = page.locator(`input[name="scope"][value="facility:${facilityWestId}"]`);
    await selectEntity(page, 'Facilities', 'Facility West', /Facility West/);
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expectMembershipScopes(database, invitedMembershipId, [
      { scopeType: 'facility', scopeId: facilityWestId },
    ]);
    await expect(facilityScope).toHaveCount(1);
    await selectEntity(page, 'Facilities', 'Facility West', /Facility West/);
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expectMembershipScopes(database, invitedMembershipId, []);
    await expect(facilityScope).toHaveCount(0);
    await selectEntity(page, 'Facilities', 'Facility West', /Facility West/);
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Access record updated.' }),
    ).toBeVisible();
    await expectMembershipScopes(database, invitedMembershipId, [
      { scopeType: 'facility', scopeId: facilityWestId },
    ]);
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
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Revoke access' }).click();
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
      await page.goto('/operations/tasks?q=%5BSYNTHETIC%20PILOT%5D');
      await expect(
        page.getByRole('heading', { name: 'Manual tasks', exact: true, level: 1 }),
      ).toBeVisible();
      await expect(page.locator('section[aria-labelledby="task-list-title"] ul > li')).toHaveCount(
        15,
      );
      const claimTaskTitle = '[SYNTHETIC PILOT] Review local claim exercise';
      await page.getByRole('link', { name: /Review local claim exercise/ }).click();
      await expect(page.getByRole('heading', { name: claimTaskTitle })).toBeVisible();
      const claimSourceLink = page.getByRole('link', { name: 'Open source record' });
      await expect(claimSourceLink).toHaveAttribute('href', /^\/billing\/claims\/[0-9a-f-]{36}$/i);
      const claimSourceUrl = new URL((await claimSourceLink.getAttribute('href'))!, page.url())
        .href;
      await claimSourceLink.click();
      await expect(page).toHaveURL(claimSourceUrl);
      await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
      await page.goto('/operations/deadlines');
      await expect(page.getByRole('heading', { name: 'Deadlines & Reminders' })).toBeVisible();
    }
  } finally {
    try {
      await Promise.all(
        [caregiverContext, invitedContext]
          .filter((context): context is BrowserContext => context !== undefined)
          .map((context) => context.close().catch(() => undefined)),
      );
      if (pilotTenantId && pilotMembershipId) {
        await cleanupPilotMembership(database, pilotTenantId, pilotMembershipId);
      }
      // Payer profiles and their actor references are retained with financial history in this
      // disposable Compose database, which is removed after the browser run.
      if (tenantId && !billingRecordsMayExist) {
        const testClientIds = [...new Set([agreementClientId, admissionClientId])].filter(
          (id): id is string => id !== undefined,
        );
        if (admissionCaseId) await cleanupAdmissionRecords(database, tenantId, admissionCaseId);
        await cleanupBenefitsRecords(database, tenantId, testClientIds, e2eOrganizationName);
        if (testClientIds.length) {
          await cleanupServiceAgreementRecords(
            database,
            tenantId,
            testClientIds,
            [executionVisitId].filter((id): id is string => id !== undefined),
          );
        }
        await cleanupServiceCatalogRecords(database, tenantId, {
          serviceCode,
          serviceCategoryCode,
        });
        await cleanupOnboardingTemplates(database, tenantId, e2eOrganizationName);
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND personnel_number = ANY($2::text[])',
          [tenantId, [caregiverPersonnelNumber]],
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
            {
              ...(invitedSubject ? { subject: invitedSubject } : {}),
              ...(invitedPlatformUserId ? { userId: invitedPlatformUserId } : {}),
            },
            {
              ...(caregiverSubject ? { subject: caregiverSubject } : {}),
              ...(caregiverPlatformUserId ? { userId: caregiverPlatformUserId } : {}),
            },
          ],
          membershipIds: [adminMembershipId, invitedMembershipId, caregiverMembershipId].filter(
            (id): id is string => id !== undefined,
          ),
          invitationIds: invitationId ? [invitationId] : [],
          invitationEmails: [invitedEmail, caregiverEmail],
          ...(tenantId ? { tenantId } : {}),
          ...(clientId || agreementClientId || admissionClientId
            ? {
                clientIds: [...new Set([clientId, agreementClientId, admissionClientId])].filter(
                  (id): id is string => id !== undefined,
                ),
              }
            : {}),
        });
        if (tenantId) {
          await cleanupOrganizationRecords(database, tenantId, {
            organizationName: e2eOrganizationName,
            facilityName: e2eFacilityName,
            teamName: e2eTeamName,
            personnelNumbers: [caregiverPersonnelNumber, replacementEmployeePersonnelNumber],
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
      if (!billingRecordsMayExist && invitedAuthentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${invitedAuthentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
      if (!billingRecordsMayExist && caregiverAuthentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${caregiverAuthentikUserId}/`,
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

function dateInBerlin(): string {
  return dateInTimezone(new Date(), 'Europe/Berlin');
}

function addDaysToDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekdayInBerlin(date: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
  }).format(new Date(`${date}T12:00:00Z`));
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const value = weekdays[weekday];
  if (!value) throw new Error(`Unexpected weekday ${weekday}`);
  return value;
}

function nextVisitTimesInBerlin(): { date: string; start: string; end: string } {
  const timezone = 'Europe/Berlin';
  const today = dateInTimezone(new Date(), timezone);
  let startDate = new Date(Date.now() + 45 * 60_000);
  if (dateInTimezone(startDate, timezone) !== today) {
    startDate = new Date(Date.now() + 5 * 60_000);
  }
  if (dateInTimezone(startDate, timezone) !== today) {
    throw new Error('The browser E2E needs at least one minute left in today’s Berlin schedule');
  }

  const endDate = new Date(startDate.getTime() + 30 * 60_000);
  const end =
    dateInTimezone(endDate, timezone) === today ? timeInTimezone(endDate, timezone) : '23:59';
  return { date: today, start: timeInTimezone(startDate, timezone), end };
}

function timeInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('hour')}:${part('minute')}`;
}

function shiftDateTimeLocal(value: string, minutes: number): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error('Expected a local datetime input value');
  }
  const date = new Date(`${value}:00.000Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

function dateInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addCalendarDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
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
}

async function reauthenticateOffice(
  page: Page,
  username: string,
  password: string,
  tenantId: string,
): Promise<void> {
  await page.context().clearCookies();
  await signInWithAuthentik(page, username, password);
  await page.locator('select[name="tenantId"]').selectOption(tenantId);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/clients$/);
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

async function cleanupAdmissionRecords(
  database: Client,
  tenantId: string,
  caseId: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = $2 OR event -> 'payload' ->> 'caseId' = $2)`,
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_documents WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_tasks WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_communications WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM communications.prospect_interactions WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.checklist_responses WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.assessments WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.transitions WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query('DELETE FROM onboarding.cases WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      caseId,
    ]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupPilotMembership(
  database: Client,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await database.query(
      'DELETE FROM identity.membership_scopes WHERE tenant_id = $1 AND membership_id = $2',
      [tenantId, membershipId],
    );
    await database.query(
      'DELETE FROM identity.membership_roles WHERE tenant_id = $1 AND membership_id = $2',
      [tenantId, membershipId],
    );
    await database.query(
      'DELETE FROM identity.tenant_memberships WHERE tenant_id = $1 AND id = $2',
      [tenantId, membershipId],
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupOnboardingTemplates(
  database: Client,
  tenantId: string,
  organizationName: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const organizations = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, organizationName],
    );
    const templateRows = await database.query<{ id: string }>(
      'SELECT id FROM onboarding.checklist_templates WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])',
      [tenantId, organizations.rows.map((organization) => organization.id)],
    );
    const templateIds = templateRows.rows.map((template) => template.id);
    if (templateIds.length) {
      await database.query(
        'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
        [tenantId, templateIds],
      );
      await database.query(
        "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
        [tenantId, templateIds],
      );
      await database.query(
        'DELETE FROM onboarding.checklist_template_items WHERE tenant_id = $1 AND template_id = ANY($2::uuid[])',
        [tenantId, templateIds],
      );
      await database.query(
        'DELETE FROM onboarding.checklist_templates WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, templateIds],
      );
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function expectMobileLayoutToFit(page: Page): Promise<void> {
  const { documentWidth, visualWidth, overflowCandidates, shellAncestors } = await page.evaluate(
    () => {
      const width = window.visualViewport?.width ?? window.innerWidth;
      const shell = document.querySelector('main');
      const shellAncestors = [];
      let current = shell;
      while (current && shellAncestors.length < 6) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        shellAncestors.push({
          tag: current.tagName,
          className: typeof current.className === 'string' ? current.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          minWidth: style.minWidth,
          flex: style.flex,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          boxSizing: style.boxSizing,
        });
        current = current.parentElement;
      }
      return {
        documentWidth: document.documentElement.scrollWidth,
        visualWidth: width,
        shellAncestors,
        overflowCandidates: Array.from(document.body.querySelectorAll('*'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              id: element.id,
              className: typeof element.className === 'string' ? element.className : '',
              text: element.textContent?.trim().slice(0, 100) ?? '',
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
          })
          .filter((element) => element.right > width + 1 || element.left < -1)
          .sort((left, right) => right.right - left.right)
          .slice(0, 8),
      };
    },
  );
  expect(documentWidth, JSON.stringify({ overflowCandidates, shellAncestors })).toBeLessThanOrEqual(
    visualWidth,
  );
}

async function expectVisibleTextToOmitIds(
  page: Page,
  ids: Array<string | undefined>,
): Promise<void> {
  const visibleText = await page.evaluate(() => document.body.innerText);
  for (const id of ids) {
    if (id) expect(visibleText).not.toContain(id);
  }
}

async function expectMembershipScopes(
  database: Client,
  membershipId: string,
  expected: Array<{ scopeType: string; scopeId: string }>,
): Promise<void> {
  await expect
    .poll(async () => {
      const result = await database.query<{ scopeType: string; scopeId: string }>(
        `SELECT scope_type AS "scopeType", scope_id AS "scopeId"
         FROM identity.membership_scopes
         WHERE membership_id = $1
         ORDER BY scope_type, scope_id`,
        [membershipId],
      );
      return result.rows;
    })
    .toEqual(expected);
}

async function selectEntity(
  page: Page,
  controlLabel: string,
  searchText: string,
  optionName: string | RegExp,
  root: Page | Locator = page,
): Promise<void> {
  const trigger = root.getByRole('combobox', { name: controlLabel });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const search = page.getByRole('combobox', { name: 'Search by name' });
  await search.fill(searchText);
  const dialog = page.getByRole('dialog');
  const targetOption = dialog.getByRole('option', { name: optionName });
  await expect(targetOption).toBeVisible();
  const optionCount = await dialog.getByRole('option').count();
  const matchesOption = (text: string) =>
    typeof optionName === 'string' ? text.includes(optionName) : optionName.test(text);

  for (let index = 0; index < optionCount; index += 1) {
    const activeOption = dialog.locator('[role="option"][aria-selected="true"]').first();
    const activeText = (await activeOption.textContent()) ?? '';
    if (matchesOption(activeText)) {
      await search.press('Enter');
      return;
    }
    await search.press('ArrowDown');
  }
  throw new Error(`Could not navigate to the ${String(optionName)} option`);
}

async function captureReviewScreenshot(
  page: Page,
  filename: string,
  fullPage = false,
): Promise<void> {
  await page.screenshot({ path: resolve(reviewDirectory, filename), fullPage });
}

async function blurFocusedElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function retryCareToday(page: Page, buttonName: string): Promise<void> {
  const refreshedPage = page.waitForResponse((response) => {
    const request = response.request();
    return (
      new URL(response.url()).pathname === '/care/today' &&
      request.method() === 'GET' &&
      request.headers()['rsc'] === '1'
    );
  });
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  expect((await refreshedPage).status()).toBe(200);
}

async function selectCaregiverLocale(
  page: Page,
  currentLocale: 'en' | 'de',
  nextLocale: 'en' | 'de',
) {
  const accountTrigger = page.getByRole('button', {
    name: currentLocale === 'en' ? /Account/ : /Konto/,
  });
  await expect(accountTrigger).toBeVisible();
  await accountTrigger.click({ timeout: 10_000 });
  const accountMenu = page.getByRole('menu').first();
  const languageTrigger = accountMenu.getByRole('menuitem', {
    name: currentLocale === 'en' ? /Language/ : /Sprache/,
  });
  await expect(languageTrigger).toBeVisible();
  await languageTrigger.click({ timeout: 10_000 });
  const localeOption = page.getByRole('menuitemradio', {
    name: nextLocale === 'de' ? 'Deutsch' : 'English',
  });
  await expect(localeOption).toBeVisible();
  await localeOption.press('Enter', { timeout: 10_000 });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Authentik E2E test`);
  return value;
}
