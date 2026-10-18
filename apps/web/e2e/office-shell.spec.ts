import { mkdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import {
  cleanupOfficeAdminSession,
  createOfficeAdminSession,
  required,
} from './support/office-admin';
import {
  captureReviewScreenshot,
  expectFocusTrap,
  expectMobileLayoutToFit,
  reviewDirectory,
} from './support/browser';

test('Office navigation stays responsive across themes and screen sizes', async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  await mkdir(reviewDirectory, { recursive: true });
  page.setDefaultTimeout(15_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  let paginationTenantId: string | undefined;
  const paginationClientIds = Array.from({ length: 11 }, () => uuidv7());
  try {
    const currentOffice = await createOfficeAdminSession(database, page, 'office-shell');
    office = currentOffice;
    paginationTenantId = currentOffice.tenantId;
    const provider = await database.query<{ organization_id: string; facility_id: string }>(
      `SELECT organization.id AS organization_id, facility.id AS facility_id
       FROM organizations.organizations AS organization
       JOIN organizations.facilities AS facility
         ON facility.tenant_id = organization.tenant_id
        AND facility.organization_id = organization.id
       WHERE organization.tenant_id = $1
       ORDER BY organization.created_at, facility.created_at
       LIMIT 1`,
      [currentOffice.tenantId],
    );
    const organizationId = provider.rows[0]?.organization_id;
    const facilityId = provider.rows[0]?.facility_id;
    if (!organizationId || !facilityId) {
      throw new Error('Demo Care provider context is missing; run bun run seed');
    }
    await database.query('BEGIN');
    try {
      const clientRows = paginationClientIds.map((clientId, index) => [
        clientId,
        currentOffice.tenantId,
        organizationId,
        facilityId,
        `E2E ${currentOffice.runId} ${index + 1}`,
      ]);
      const clientValues = clientRows
        .map((_, index) => {
          const first = index * 5 + 1;
          return `($${first}, $${first + 1}, $${first + 2}, $${first + 3}, 'Pagination', $${first + 4}, 'active', now(), now())`;
        })
        .join(', ');
      await database.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status,
            created_at, updated_at)
         VALUES ${clientValues}`,
        clientRows.flat(),
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }
    const { displayName, email } = currentOffice;
    const sidebar = page.locator('#office-sidebar');
    await test.step('office sidebar and responsive navigation', async () => {
      await page.goto('/clients?localeCheck=1');
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
      const keyboardFocusIsVisible = await keyboardExpand.evaluate((element) => {
        if (!element.matches(':focus-visible')) return false;
        const style = getComputedStyle(element);
        return (
          (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none'
        );
      });
      expect(keyboardFocusIsVisible, 'Keyboard focus needs a visible outline or ring').toBe(true);
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
      await Promise.all([
        page.waitForURL((url) => url.pathname === '/clients', { timeout: 30_000 }),
        sidebar.getByRole('link', { name: 'Clients' }).click(),
      ]);
      await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible({
        timeout: 30_000,
      });
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
      await expectFocusTrap(page, page.getByRole('dialog'));
      await page.keyboard.press('Escape');
      await expect(page.locator('#office-mobile-navigation')).not.toBeVisible();
      await expect(mobileNavigationTrigger).toBeFocused();
      await mobileNavigationTrigger.click();
      await page
        .locator('#office-mobile-navigation')
        .getByRole('link', { name: 'Planning', exact: true })
        .click();
      await expect(page).toHaveURL(/\/planning(?:\?|$)/, { timeout: 15_000 });
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
    await page.goto('/operations', { waitUntil: 'domcontentloaded' });
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
    const scheduledVisits = page.getByRole('link', { name: 'Open planning' });
    await expect(scheduledVisits).toBeVisible();
    await scheduledVisits.click();
    await expect(page).toHaveURL(/\/planning(?:\?|$)/);
    await page.goto('/operations', { waitUntil: 'domcontentloaded' });
    const visitIssues = page.getByRole('link', { name: /Visit issues:/ });
    await expect(visitIssues).toBeVisible();
    await visitIssues.click();
    await expect(page).toHaveURL(/\/operations\/worklist\?.*category=visits/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().addCookies([
      {
        name: 'CARE_LOCALE',
        value: 'de',
        url: new URL(required('WEB_ORIGIN')).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/clients?pageSize=10');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const pagination = page.getByRole('navigation', { name: 'Seitennavigation' });
    await expect(pagination).toBeVisible();
    await expect(pagination.getByRole('link', { name: 'Weiter', exact: true })).toBeVisible();
    await expect(pagination.locator('[aria-current="page"]')).toHaveText('1');
    await pagination.getByRole('link', { name: 'Weiter', exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(pagination.getByRole('link', { name: 'Zurück', exact: true })).toBeVisible();
    await expect(pagination.locator('[aria-current="page"]')).toHaveText('2');
  } finally {
    try {
      if (paginationTenantId) {
        await database.query(
          `UPDATE clients.clients
           SET status = 'archived', updated_at = now()
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [paginationTenantId, paginationClientIds],
        );
      }
      if (office) await cleanupOfficeAdminSession(database, office);
    } finally {
      await database.end();
    }
  }
});
