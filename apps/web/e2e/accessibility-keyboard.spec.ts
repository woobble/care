import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Client } from 'pg';

import {
  expectNoWcagAccessibilityViolations,
  sampleRenderedBoundaryContrast,
  scanAccessibility,
  summarizeAccessibilityViolations,
} from './support/accessibility';
import { cleanupLifecycleScenario, seedLifecycleScenario } from './support/lifecycle-scenario';
import type { LifecycleScenario } from './support/lifecycle-scenario';
import {
  dateInBerlin,
  expectClientSectionNavKeyboardVisibility,
  expectAccessiblePageBasics,
  expectKeyboardTabSequence,
  expectMobileLayoutToFit,
  expectReducedMotion,
  measureAccessibilityTokenContrast,
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

async function expectAccessibleControlTokens(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const isDark = await page
    .locator('html')
    .evaluate((element) => element.classList.contains('dark'));
  expect(isDark, `${theme} theme should be active for its color measurements`).toBe(
    theme === 'dark',
  );
  const contrastRatios = await measureAccessibilityTokenContrast(page);
  for (const [token, ratio] of Object.entries(contrastRatios)) {
    expect(
      ratio,
      `${token} should meet the 3:1 non-text contrast threshold`,
    ).toBeGreaterThanOrEqual(3);
  }
  console.info(`[a11y] ${theme} control contrast: ${JSON.stringify(contrastRatios)}`);
}

async function enterContrastReviewValues(
  page: Page,
  label: string,
  viewportWidth: number,
): Promise<void> {
  const fields =
    label === 'administration-memberships' && viewportWidth === 320
      ? [['#invite-email', 'a11y-review@example.test']]
      : label === 'route--services' && viewportWidth === 768
        ? [
            ['input[name="name"]', 'Synthetic contrast review'],
            ['input[name="code"]', 'A11Y-REVIEW'],
          ]
        : label === 'admission-form' && viewportWidth === 390
          ? [
              ['input[name="firstName"]', 'Synthetic'],
              ['input[name="lastName"]', 'Review'],
              ['input[name="requesterName"]', 'Synthetic Requester'],
              ['input[name="requesterRelationship"]', 'Representative'],
              ['input[type="email"]', 'a11y-review@example.test'],
              ['input[type="tel"]', '5551234567'],
              ['textarea[name="requestedServices"]', 'Synthetic service request'],
              ['input[type="date"]', '2026-10-19'],
              ['input[name="serviceLocation"]', 'Synthetic location'],
              ['input[name="inquirySource"]', 'Synthetic review'],
              ['textarea[name="initialNotes"]', 'Synthetic contrast review'],
              ['input[type="datetime-local"]', '2026-10-19T10:00'],
            ]
          : [];

  // oxlint-disable no-await-in-loop -- Each synthetic value is entered before the contrast scan.
  for (const [selector, value] of fields) {
    const field = page.locator(selector!).first();
    await expect(field, `Contrast review field should be present: ${selector}`).toBeVisible();
    await field.fill(value!);
  }
  // oxlint-enable no-await-in-loop

  if (fields.length > 0) {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    console.info(`[a11y] entered synthetic contrast values for ${label}: ${fields.length} fields`);
  }
}

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
    await expectAccessibleControlTokens(page, 'light');
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
          await enterContrastReviewValues(page, label, viewport.width);
          if (label === 'client-profile' && [390, 1440].includes(viewport.width)) {
            await expectClientSectionNavKeyboardVisibility(page);
          }
          // oxlint-disable-next-line no-await-in-loop
          await expectReducedMotion(page);
          // oxlint-disable-next-line no-await-in-loop -- The axe scan evaluates this rendered route and viewport.
          accessibilityScans.push(
            await scanAccessibility(page, testInfo, `en-light-${label}-${viewport.width}`),
          );
          if (label === 'admission-form' && viewport.width === 390) {
            const inputBoundaryContrast = await sampleRenderedBoundaryContrast(
              page,
              testInfo,
              'admission-input-boundary-light-390',
              'input[name="firstName"]',
            );
            expect(inputBoundaryContrast.tenthPercentileRatio ?? 0).toBeGreaterThanOrEqual(3);
          }
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
        await enterContrastReviewValues(page, label, viewport.width);
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
    await expectAccessibleControlTokens(page, 'dark');
    await page.goto('/operations', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
    await expectKeyboardTabSequence(page);
    // oxlint-disable no-await-in-loop -- Dark mode is measured on each route's rendered colors.
    for (const { label, path: route } of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
      if (label === 'admission-form') {
        const inputBoundaryContrast = await sampleRenderedBoundaryContrast(
          page,
          testInfo,
          'admission-input-boundary-dark-1440',
          'input[name="firstName"]',
        );
        expect(inputBoundaryContrast.tenthPercentileRatio ?? 0).toBeGreaterThanOrEqual(3);
      }
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
