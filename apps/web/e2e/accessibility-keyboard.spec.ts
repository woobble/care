import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import {
  expectNoWcagAccessibilityViolations,
  scanAccessibility,
  summarizeAccessibilityViolations,
} from './support/accessibility';
import { cleanupLifecycleScenario, seedLifecycleScenario } from './support/lifecycle-scenario';
import type { LifecycleScenario } from './support/lifecycle-scenario';
import {
  dateInBerlin,
  expectAccessiblePageBasics,
  expectKeyboardTabSequence,
  expectMobileLayoutToFit,
  expectReducedMotion,
} from './support/browser';
import {
  cleanupOfficeAdminSession,
  createOfficeAdminSession,
  required,
} from './support/office-admin';
import type { OfficeAdminSession } from './support/office-admin';

const officeRoutes = [
  '/clients',
  '/employees',
  '/services',
  '/admissions',
  '/planning',
  '/benefits',
  '/billing/invoices',
  '/billing/claims',
  '/documents',
  '/operations/worklist',
  '/administration/users',
];

const targetViewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 720, height: 450 },
  { width: 320, height: 720 },
];

test('high-frequency Office routes support keyboard navigation and reduced motion', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);

  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: OfficeAdminSession | undefined;
  let scenario: LifecycleScenario | undefined;
  const accessibilityScans = [];

  try {
    office = await createOfficeAdminSession(database, page, 'accessibility-keyboard');
    scenario = await seedLifecycleScenario(database, office, { visit: 'planned' });

    const routes = [
      { label: 'office-dashboard', path: '/operations' },
      { label: 'client-search', path: '/clients' },
      { label: 'client-profile', path: `/clients/${scenario.clientId}` },
      { label: 'admission-form', path: '/admissions/new' },
      { label: 'service-agreement', path: `/clients/${scenario.clientId}/service-agreements` },
      { label: 'scheduling-calendar', path: `/planning?date=${dateInBerlin()}` },
      { label: 'benefits-allocation', path: '/benefits' },
      { label: 'invoice-review', path: '/billing/invoices' },
      { label: 'claims', path: '/billing/claims' },
      { label: 'documents', path: '/documents' },
      { label: 'operations-worklist', path: '/operations/worklist' },
      { label: 'operations-tasks', path: '/operations/tasks' },
      { label: 'operations-deadlines', path: '/operations/deadlines' },
      { label: 'administration-memberships', path: '/administration/users' },
      {
        label: 'administration-scope-editor',
        path: `/administration/users/${office.platformUserId}`,
      },
      ...officeRoutes
        .filter(
          (route) =>
            ![
              '/clients',
              '/planning',
              '/benefits',
              '/billing/invoices',
              '/billing/claims',
              '/documents',
              '/operations/worklist',
              '/administration/users',
            ].includes(route),
        )
        .map((route) => ({ label: `route-${route.replaceAll('/', '-')}`, path: route })),
    ];

    // oxlint-disable no-await-in-loop -- Route transitions and browser-state checks are ordered.
    for (const { label, path: route } of routes) {
      // oxlint-disable-next-line no-await-in-loop -- Each Office route is an independent rendered workflow.
      await test.step(route, async () => {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });

        for (const viewport of targetViewports) {
          // oxlint-disable-next-line no-await-in-loop -- Each viewport has its own layout and focus order.
          await page.setViewportSize(viewport);
          if (label === 'scheduling-calendar' && viewport.width === 390) {
            await page.getByRole('button', { name: 'Agenda', exact: true }).click();
            await expect(page).toHaveURL(/view=agenda/);
            await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute(
              'aria-pressed',
              'true',
            );
          }
          // oxlint-disable-next-line no-await-in-loop
          await expectAccessiblePageBasics(page);
          // oxlint-disable-next-line no-await-in-loop
          await expectMobileLayoutToFit(page);
          // oxlint-disable-next-line no-await-in-loop
          await expectKeyboardTabSequence(page);
          // oxlint-disable-next-line no-await-in-loop
          await expectReducedMotion(page);
          // oxlint-disable-next-line no-await-in-loop -- The axe scan evaluates this rendered route and viewport.
          accessibilityScans.push(
            await scanAccessibility(page, testInfo, `en-light-${label}-${viewport.width}`),
          );
          if (['office-dashboard', 'client-profile', 'scheduling-calendar'].includes(label)) {
            await page.screenshot({
              path: testInfo.outputPath(`review-${label}-${viewport.width}.png`),
              fullPage: true,
              animations: 'disabled',
            });
          }
        }
      });
    }
    // oxlint-enable no-await-in-loop

    const germanRoutes = routes.filter(({ label }) =>
      [
        'office-dashboard',
        'client-search',
        'client-profile',
        'admission-form',
        'service-agreement',
        'scheduling-calendar',
        'benefits-allocation',
        'invoice-review',
        'claims',
        'documents',
        'operations-worklist',
        'operations-tasks',
        'operations-deadlines',
        'administration-memberships',
        'administration-scope-editor',
      ].includes(label),
    );
    await page.context().addCookies([
      {
        name: 'CARE_LOCALE',
        value: 'de',
        url: new URL(page.url()).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    // oxlint-disable no-await-in-loop -- Locale navigation and scans depend on prior browser state.
    for (const { label, path: route } of germanRoutes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
      for (const viewport of [targetViewports[0]!, targetViewports[2]!]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('main h1').first()).toBeVisible();
        if (label === 'scheduling-calendar' && viewport.width === 390) {
          await page.getByRole('button', { name: 'Agenda', exact: true }).click();
          await expect(page).toHaveURL(/view=agenda/);
          await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
        }
        accessibilityScans.push(
          await scanAccessibility(page, testInfo, `de-light-${label}-${viewport.width}`),
        );
      }
    }
    // oxlint-enable no-await-in-loop

    await page.context().addCookies([
      {
        name: 'CARE_LOCALE',
        value: 'en',
        url: new URL(page.url()).origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/operations', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
    const appearanceButton = page.getByRole('button', { name: 'Appearance' });
    await appearanceButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.locator('[role="menuitemradio"]:focus')).toHaveCount(1);
    accessibilityScans.push(
      await scanAccessibility(page, testInfo, 'en-light-expanded-appearance-menu'),
    );
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // oxlint-disable no-await-in-loop -- Dark mode is measured on each route's rendered colors.
    for (const { label, path: route } of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
      accessibilityScans.push(await scanAccessibility(page, testInfo, `en-dark-${label}-1440`));
    }
    // oxlint-enable no-await-in-loop
    const report = {
      scanCount: accessibilityScans.length,
      scans: accessibilityScans,
      violations: summarizeAccessibilityViolations(accessibilityScans),
    };
    const reportBody = JSON.stringify(report, null, 2);
    await writeFile(testInfo.outputPath('axe-accessibility-report.json'), reportBody);
    await testInfo.attach('axe-accessibility-report.json', {
      body: reportBody,
      contentType: 'application/json',
    });
    console.info(
      `[a11y] ${report.scanCount} scans; ${report.violations.length} distinct violation rules; ` +
        `${report.violations.reduce((count, violation) => count + violation.occurrences, 0)} rule occurrences.`,
    );
    expectNoWcagAccessibilityViolations(accessibilityScans);
  } finally {
    try {
      if (scenario) await cleanupLifecycleScenario(database, scenario);
    } finally {
      try {
        if (office) await cleanupOfficeAdminSession(database, office);
      } finally {
        await database.end();
      }
    }
  }
});
