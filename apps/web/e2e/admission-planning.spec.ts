import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import {
  acceptDialogDuringAction,
  addDaysToDate,
  dateInBerlin,
  expectFocusTrap,
  expectMobileLayoutToFit,
  expectTargetViewportLayouts,
  selectEntity,
} from './support/browser';
import {
  cleanupOfficeAdminSession,
  createOfficeAdminSession,
  required,
} from './support/office-admin';
import {
  cleanupAdmissionCase,
  cleanupLifecycleScenario,
  seedLifecycleScenario,
} from './support/lifecycle-scenario';

const calendarReviewDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../artifacts/calendar-review',
);

test('Office staff can admit an existing client and plan visits', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  let scenario: Awaited<ReturnType<typeof seedLifecycleScenario>> | undefined;
  let admissionCaseId: string | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'admission-planning');
    scenario = await seedLifecycleScenario(database, office);
    const serviceDate = dateInBerlin();
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

    await page.goto('/admissions/new');
    await expect(page.getByRole('heading', { name: 'Create admission case' })).toBeVisible();
    await expectTargetViewportLayouts(page);
    await page.getByLabel('Prospect first name').fill('Agreement');
    await page.getByLabel('Prospect last name').fill(`E2E ${scenario.runId}`);
    await selectEntity(page, 'Organization', scenario.organizationName, scenario.organizationName);
    await selectEntity(page, 'Facility', scenario.facilityName, scenario.facilityName);
    await page.getByLabel('Inquiry source').fill('E2E browser journey');
    await page.getByLabel('Preferred start date').fill(serviceDate);
    await page.getByLabel('Requested services, one per line').fill(scenario.serviceName);
    await selectEntity(
      page,
      'Link an existing client (optional)',
      scenario.clientName,
      new RegExp(scenario.clientName),
    );
    await page.locator('summary').filter({ hasText: 'Funding details' }).click();
    await page.getByLabel('Funding plan').selectOption('benefits');
    await page.getByRole('button', { name: 'New admission case' }).click();
    await expect(page).toHaveURL(/\/admissions\/[0-9a-f-]{36}$/i);
    admissionCaseId = new URL(page.url()).pathname.split('/').at(-1);
    if (!admissionCaseId) throw new Error('The admission detail page did not expose its ID');
    await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();
    await expect(
      page.getByText('Needs assessment complete', { exact: true }).first(),
    ).toBeVisible();
    await expectTargetViewportLayouts(page);

    await page.goto(`/admissions?search=${encodeURIComponent(scenario.clientName)}`);
    const admissionLink = page.locator(`a[href="/admissions/${admissionCaseId}"]:visible`);
    await expect(admissionLink).toHaveText(scenario.clientName);
    await expectTargetViewportLayouts(page);
    await admissionLink.click();
    await expect(page.getByRole('heading', { name: 'Admission readiness' })).toBeVisible();
    const stageForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Move to stage' }),
    });
    await stageForm.getByLabel('Move to stage').selectOption('assessment');
    await acceptDialogDuringAction(page, () =>
      stageForm.getByRole('button', { name: 'Move to stage' }).click(),
    );
    await expect(page.getByTestId('admission-stage')).toHaveText('Assessment');
    const assessmentForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Save assessment' }),
    });
    await assessmentForm.getByLabel('Services requested').fill(scenario.serviceName);
    await assessmentForm.getByLabel('Household support needed').fill('Weekly household support');
    await assessmentForm.getByLabel('Visits per week').fill('2');
    await assessmentForm.getByLabel('Monday').check();
    await assessmentForm.getByRole('button', { name: 'Save assessment' }).click();
    await expect(assessmentForm.getByLabel('Household support needed')).toHaveValue(
      'Weekly household support',
    );

    await page.goto(`/clients/${scenario.clientId}/service-agreements`);
    await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();
    const generationPanel = page.locator('details').filter({ hasText: 'Generate visits' }).first();
    await generationPanel.locator('summary').click();
    await expectTargetViewportLayouts(page);
    const generationForm = generationPanel.locator('form');
    const generationFrom = addDaysToDate(serviceDate, 1);
    const generationUntil = addDaysToDate(generationFrom, 6);
    await generationForm.locator('input[name="from"]').fill(generationFrom);
    await generationForm.locator('input[name="until"]').fill(generationUntil);
    await generationForm.getByRole('button', { name: 'Generate visits' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Visit generation is complete.' }),
    ).toBeVisible();
    const generatedVisit = await database.query<{ id: string; visit_date: string }>(
      `SELECT id, (planned_start AT TIME ZONE 'Europe/Berlin')::date::text AS visit_date
       FROM scheduling.visits
       WHERE tenant_id = $1 AND client_id = $2 AND service_agreement_id IS NOT NULL
       ORDER BY planned_start, id LIMIT 1`,
      [scenario.tenantId, scenario.clientId],
    );
    const visit = generatedVisit.rows[0];
    if (!visit) throw new Error('The active agreement did not generate a visit');
    await page.goto(`/planning?date=${visit.visit_date}`);
    await expect(page.getByRole('heading', { name: 'Week overview' })).toBeVisible();
    const visitLink = page.locator(`a[href^="/visits/${visit.id}"]`);
    await expect(visitLink).toBeVisible();
    await mkdir(calendarReviewDirectory, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page).toHaveURL(/view=month/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toBeVisible();
    await expect(visitLink).toBeVisible();
    await expectMobileLayoutToFit(page);
    await page.screenshot({
      path: resolve(calendarReviewDirectory, 'planning-month-desktop-1440.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page).toHaveURL(/view=week/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toBeVisible();
    await expect(visitLink).toBeVisible();
    await expectMobileLayoutToFit(page);
    await page.screenshot({
      path: resolve(calendarReviewDirectory, 'planning-week-tablet-768.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await expect(page).toHaveURL(/view=agenda/);
    await expect(visitLink).toBeVisible();
    await expect(page.getByText('Monday, October 26, 2026', { exact: true })).toHaveCount(0);
    await expectMobileLayoutToFit(page);
    await page.screenshot({
      path: resolve(calendarReviewDirectory, 'planning-agenda-mobile-390.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page).toHaveURL(/view=day/);
    await expect(page.locator('.care-calendar .rbc-calendar')).toBeVisible();
    const earlyDaySlot = page.locator('.rbc-day-slot .rbc-time-slot').nth(4);
    await earlyDaySlot.scrollIntoViewIfNeeded();
    await earlyDaySlot.evaluate((element) => {
      const { top } = element.getBoundingClientRect();
      window.scrollBy({ top: top - window.innerHeight / 2, behavior: 'instant' });
    });
    const slotBounds = await earlyDaySlot.boundingBox();
    if (!slotBounds) throw new Error('The empty calendar time slot is not visible');
    await page.mouse.click(
      slotBounds.x + slotBounds.width / 2,
      slotBounds.y + slotBounds.height / 2,
    );
    await expect(page).toHaveURL(/createVisit=1/);
    const createVisit = page.locator('#create-visit');
    await expect(createVisit.getByLabel('Date')).toHaveValue(visit.visit_date);
    await expect(createVisit.getByLabel('Start')).toHaveValue('08:00');
    await expect(createVisit.getByLabel('End')).toHaveValue('09:00');

    await page.goto(`/planning?date=${visit.visit_date}&view=day`);
    await expect(visitLink).toBeVisible();
    // oxlint-disable no-await-in-loop
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await visitLink.click();
      const visitDetails = page.getByRole('dialog');
      await expect(visitDetails).toBeVisible();
      await expectFocusTrap(page, visitDetails);
      await Promise.all(
        ['Date', 'Start', 'End', 'Planning note'].map((label) =>
          expect(visitDetails.getByLabel(label, { exact: true })).toBeVisible(),
        ),
      );
      await expectMobileLayoutToFit(page, visitDetails);
      await page.keyboard.press('Escape');
      await expect(visitDetails).not.toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/planning\\?date=${visit.visit_date}&view=day$`));
      await expect(visitLink).toBeFocused();
    }
    // oxlint-enable no-await-in-loop
  } finally {
    try {
      if (scenario && admissionCaseId) {
        await cleanupAdmissionCase(database, scenario.tenantId, admissionCaseId);
      }
      if (scenario) await cleanupLifecycleScenario(database, scenario);
      if (office) await cleanupOfficeAdminSession(database, office);
    } finally {
      await database.end();
    }
  }
});
