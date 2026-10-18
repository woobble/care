import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import {
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
];

test('high-frequency Office routes support keyboard navigation and reduced motion', async ({
  page,
}) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);

  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: OfficeAdminSession | undefined;

  try {
    office = await createOfficeAdminSession(database, page, 'accessibility-keyboard');

    for (const route of officeRoutes) {
      // oxlint-disable-next-line no-await-in-loop -- Each Office route is an independent rendered workflow.
      await test.step(route, async () => {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('main h1').first()).toBeVisible();

        for (const viewport of targetViewports) {
          // oxlint-disable-next-line no-await-in-loop -- Each viewport has its own layout and focus order.
          await page.setViewportSize(viewport);
          // oxlint-disable-next-line no-await-in-loop
          await expectAccessiblePageBasics(page);
          // oxlint-disable-next-line no-await-in-loop
          await expectMobileLayoutToFit(page);
          // oxlint-disable-next-line no-await-in-loop
          await expectKeyboardTabSequence(page);
          // oxlint-disable-next-line no-await-in-loop
          await expectReducedMotion(page);
        }
      });
    }
  } finally {
    if (office) await cleanupOfficeAdminSession(database, office);
    await database.end();
  }
});
