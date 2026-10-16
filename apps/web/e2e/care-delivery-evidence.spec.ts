import { devices, expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { Client } from 'pg';

import {
  acceptDialogDuringAction,
  dateInBerlin,
  expectMobileLayoutToFit,
  retryCareToday,
} from './support/browser';
import {
  cleanupOfficeAdminSession,
  createOfficeAdminSession,
  required,
} from './support/office-admin';
import type { OfficeAdminSession } from './support/office-admin';
import {
  cleanupLifecycleScenario,
  createUnlinkedCaregiverIdentity,
  seedLifecycleScenario,
} from './support/lifecycle-scenario';
import type { CaregiverIdentity, LifecycleScenario } from './support/lifecycle-scenario';

test('Caregivers can complete visits, finalize documentation, and acknowledge evidence', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: OfficeAdminSession | undefined;
  let scenario: LifecycleScenario | undefined;
  let caregiver: CaregiverIdentity | undefined;
  let caregiverContext: BrowserContext | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'care-delivery');
    scenario = await seedLifecycleScenario(database, office, { visit: 'planned' });
    caregiverContext = await browser.newContext({
      ...devices['Pixel 7'],
      locale: 'en',
      timezoneId: 'Europe/Berlin',
    });
    const caregiverPage = await caregiverContext.newPage();
    caregiverPage.setDefaultTimeout(15_000);
    caregiver = await createUnlinkedCaregiverIdentity(database, office, caregiverPage);

    await caregiverPage.goto('/');
    await caregiverPage.locator('select[name="tenantId"]').selectOption(office.tenantId);
    await caregiverPage.getByRole('button', { name: 'Continue' }).click();
    await expect(caregiverPage).toHaveURL(/\/clients$/);
    await caregiverPage.goto('/care/today');
    const unlinkedEmployeeError = caregiverPage.getByText(
      'Your account is not linked to an active employee profile. Ask your organization administrator to link it, then try again.',
      { exact: true },
    );
    await expect(unlinkedEmployeeError).toBeVisible();

    const caregiverName = `Caregiver E2E ${scenario.runId}`;
    await page.goto(`/employees/${scenario.employeeId}`);
    await page.getByRole('combobox', { name: 'Link an active user' }).click();
    await page.getByRole('combobox', { name: 'Search by name' }).fill(caregiverName);
    const caregiverOption = page
      .getByRole('dialog')
      .getByRole('option', { name: new RegExp(`${caregiverName}.*${caregiver.email}`) });
    await expect(caregiverOption).toBeVisible();
    await caregiverOption.click();
    await acceptDialogDuringAction(page, () =>
      page.getByRole('button', { name: 'Link user' }).click(),
    );
    const linkedScenario = scenario;
    if (!linkedScenario) throw new Error('The caregiver visit scenario is missing');
    await expect(page).toHaveURL(
      new RegExp(`/employees/${linkedScenario.employeeId}\\?updated=access$`),
    );
    await expect
      .poll(async () => {
        const linkedEmployee = await database.query<{ user_id: string | null }>(
          'SELECT user_id FROM employees.employees WHERE tenant_id = $1 AND id = $2',
          [linkedScenario.tenantId, linkedScenario.employeeId],
        );
        return linkedEmployee.rows[0]?.user_id;
      })
      .toBe(caregiver.platformUserId);
    await retryCareToday(caregiverPage);

    const startsAt = new Date(`${dateInBerlin()}T09:00:00.000Z`);
    const careDate = new Intl.DateTimeFormat('en', {
      dateStyle: 'full',
      timeZone: 'Europe/Berlin',
    }).format(startsAt);
    await caregiverPage.goto('/care/today');
    await expect(caregiverPage.getByRole('heading', { name: 'My visits' })).toBeVisible();
    await expect(caregiverPage.getByText(`Visits for ${careDate}`, { exact: true })).toBeVisible();
    await expect(unlinkedEmployeeError).toBeHidden();
    const visitLink = caregiverPage.getByRole('link', { name: scenario.clientName });
    await expect(visitLink).toBeVisible();
    await visitLink.click();
    await expect(caregiverPage.getByRole('heading', { name: scenario.clientName })).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);

    await caregiverPage.getByRole('button', { name: 'Start visit' }).tap();
    await expect(caregiverPage.getByText('In progress', { exact: true })).toBeVisible();
    const plannedServiceForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Save outcome' }),
    });
    await plannedServiceForm.locator('select[name="status"]').selectOption('performed');
    await plannedServiceForm.locator('input[name="actualQuantity"]').fill('1');
    await plannedServiceForm.getByRole('button', { name: 'Save outcome' }).tap();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service outcome saved.' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Start documentation' }).tap();
    await expect(caregiverPage).toHaveURL(/notice=documentation-created/);
    const documentation = await database.query<{ id: string }>(
      'SELECT id FROM care_documentation.documents WHERE tenant_id = $1 AND visit_id = $2',
      [scenario.tenantId, scenario.visitId],
    );
    const documentationId = documentation.rows[0]?.id;
    if (!documentationId) throw new Error('Starting documentation did not create a document');
    const interruptedEntry = `Interrupted E2E draft ${scenario.runId}`;
    const interruptedEntryForm = caregiverPage.locator('form').filter({
      has: caregiverPage.locator('input[name="type"][value="care_note"]'),
    });
    await interruptedEntryForm.locator('textarea[name="content"]').fill(interruptedEntry);
    await expect(interruptedEntryForm.getByRole('status')).toHaveText(
      'Draft kept temporarily in this browser tab; it has not been sent to the server.',
    );
    const storedCareDraftCount = () =>
      caregiverPage.evaluate(
        () =>
          Object.keys(window.sessionStorage).filter((key) => key.startsWith('care-draft:v1:'))
            .length,
      );
    await expect.poll(storedCareDraftCount).toBeGreaterThan(0);
    // Simulate an interrupted tab after local autosave and before the server action is submitted.
    await caregiverPage.reload();
    await expect.poll(storedCareDraftCount).toBeGreaterThan(0);
    await expect(interruptedEntryForm.getByText(/An unsent draft from/)).toBeVisible();
    await interruptedEntryForm.getByRole('button', { name: 'Restore draft' }).click();
    await expect(interruptedEntryForm.locator('textarea[name="content"]')).toHaveValue(
      interruptedEntry,
    );
    const draftState = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM care_documentation.entries
       WHERE tenant_id = $1 AND documentation_id = $2 AND content = $3`,
      [scenario.tenantId, documentationId, interruptedEntry],
    );
    expect(draftState.rows[0]?.count).toBe(0);

    let interruptedActionRequests = 0;
    const visitActionPath = new RegExp(`/care/visits/${scenario.visitId}(?:\\?.*)?$`);
    await caregiverPage.route(visitActionPath, async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        interruptedActionRequests += 1;
        await route.fulfill({ status: 503, body: 'Synthetic E2E action interruption' });
        return;
      }
      await route.continue();
    });
    await interruptedEntryForm.getByRole('button', { name: 'Save changes', exact: true }).tap();
    await expect.poll(() => interruptedActionRequests).toBe(1);
    await expect.poll(storedCareDraftCount).toBeGreaterThan(0);
    const afterInterruptedSubmit = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM care_documentation.entries
       WHERE tenant_id = $1 AND documentation_id = $2 AND content = $3`,
      [scenario.tenantId, documentationId, interruptedEntry],
    );
    expect(afterInterruptedSubmit.rows[0]?.count).toBe(0);
    await expect(
      interruptedEntryForm
        .getByRole('status')
        .filter({ hasText: 'The submission result is unclear.' }),
    ).toBeVisible({ timeout: 20_000 });
    await caregiverPage.unroute(visitActionPath);
    await caregiverPage.reload();
    await expect(interruptedEntryForm.getByText(/An unsent draft from/)).toBeVisible();
    await interruptedEntryForm.getByRole('button', { name: 'Restore draft' }).click();
    await expect(interruptedEntryForm.locator('textarea[name="content"]')).toHaveValue(
      interruptedEntry,
    );

    const observations = caregiverPage
      .getByRole('heading', { name: 'Observations', level: 3 })
      .locator('..');
    const observationText = `E2E observation ${scenario.runId}`;
    await observations.locator('textarea[name="content"]').fill(observationText);
    await observations.getByRole('button', { name: 'Save changes' }).tap();
    await expect(observations.locator('li > p').filter({ hasText: observationText })).toBeVisible();
    await caregiverPage.reload();
    await caregiverPage.getByRole('button', { name: 'Complete visit' }).tap();
    await expect(caregiverPage.getByText('Completed', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${scenario.visitId}`);
    const evidenceRow = caregiverPage
      .getByRole('heading', { name: 'Service documentation' })
      .locator('..')
      .locator('li')
      .first();
    await evidenceRow
      .locator('textarea[name="note"]')
      .fill(`E2E service evidence ${scenario.runId}`);
    await evidenceRow.getByRole('button', { name: 'Save evidence' }).tap();
    await expect(evidenceRow.getByText('Evidence recorded', { exact: true })).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Finalize documentation' }).tap();
    await expect(caregiverPage.getByText('Finalized', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${scenario.visitId}/evidence`);
    await caregiverPage.getByRole('button', { name: 'Create service evidence' }).tap();
    await expect(caregiverPage.getByText('Version 1', { exact: true })).toBeVisible();
    await caregiverPage
      .getByLabel('Select the person acknowledging')
      .selectOption(`representative:${scenario.representativeContactId}`);
    await caregiverPage.locator('input[name="method-choice"][value="typed_confirmation"]').check();
    await caregiverPage.locator('input[name="confirmationName"]').fill('E2E Representative');
    await acceptDialogDuringAction(caregiverPage, () =>
      caregiverPage.getByRole('button', { name: 'Record acknowledgement' }).tap(),
    );
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
    ).toBeVisible();
    const evidence = await database.query<{ status: string; version: number }>(
      `SELECT acknowledgement.status, package.version
       FROM service_evidence.evidence_packages AS package
       JOIN service_evidence.acknowledgements AS acknowledgement
         ON acknowledgement.tenant_id = package.tenant_id
        AND acknowledgement.evidence_package_id = package.id
        AND acknowledgement.revoked_at IS NULL
       WHERE package.tenant_id = $1 AND package.documentation_id = (
         SELECT id FROM care_documentation.documents WHERE tenant_id = $1 AND visit_id = $2
       )
       ORDER BY package.version DESC LIMIT 1`,
      [scenario.tenantId, scenario.visitId],
    );
    expect(evidence.rows[0]).toEqual({ status: 'acknowledged', version: 1 });
  } finally {
    try {
      await caregiverContext?.close().catch(() => undefined);
      if (scenario && caregiver) {
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND id = $2',
          [scenario.tenantId, scenario.employeeId],
        );
      }
      if (caregiver) {
        await cleanupOfficeAdminSession(database, {
          apiToken: caregiver.apiToken,
          authentikOrigin: caregiver.authentikOrigin,
          authentikUserId: caregiver.authentikUserId,
          issuer: caregiver.issuer,
          subject: caregiver.subject,
          platformUserId: caregiver.platformUserId,
          membershipId: caregiver.membershipId,
        });
      }
      if (scenario) await cleanupLifecycleScenario(database, scenario);
      if (office) await cleanupOfficeAdminSession(database, office);
    } finally {
      await database.end();
    }
  }
});
