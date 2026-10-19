import { v7 as uuidv7 } from 'uuid';

import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { Client } from 'pg';

import { acceptDialogDuringAction, addDaysToDate, dateInBerlin } from './support/browser';
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

test('An absence substitution moves caregiver visibility and access to the confirmed assignee', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: OfficeAdminSession | undefined;
  let scenario: LifecycleScenario | undefined;
  let originalCaregiver: CaregiverIdentity | undefined;
  let substituteCaregiver: CaregiverIdentity | undefined;
  let originalContext: BrowserContext | undefined;
  let substituteContext: BrowserContext | undefined;
  let substituteEmployeeId: string | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'substitution-access');
    const officeSession = office;
    if (!officeSession) throw new Error('The office administrator session was not created');
    const absenceDate = addDaysToDate(dateInBerlin(), 1);
    scenario = await seedLifecycleScenario(database, office, {
      visit: 'planned',
      visitDate: absenceDate,
    });
    substituteEmployeeId = uuidv7();
    const now = new Date();
    await database.query('BEGIN');
    try {
      await database.query("SELECT set_config('app.tenant_id', $1, true)", [office.tenantId]);
      await database.query(
        `INSERT INTO employees.employees
           (id, tenant_id, organization_id, first_name, last_name, email,
            employment_type, start_date, weekly_hours, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'E2E Cover', $4, $5, 'part_time', '2020-01-01', 20,
                 'active', $6, $6)`,
        [
          substituteEmployeeId,
          scenario.tenantId,
          scenario.organizationId,
          scenario.runId,
          `cover-${scenario.runId}@example.test`,
          now,
        ],
      );
      await database.query(
        `INSERT INTO employees.employee_facility_assignments
           (id, tenant_id, organization_id, employee_id, facility_id, is_primary,
            status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, 'active', $6, $6)`,
        [
          uuidv7(),
          scenario.tenantId,
          scenario.organizationId,
          substituteEmployeeId,
          scenario.facilityId,
          now,
        ],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    originalContext = await browser.newContext({ locale: 'en', timezoneId: 'Europe/Berlin' });
    substituteContext = await browser.newContext({ locale: 'en', timezoneId: 'Europe/Berlin' });
    const originalPage = await originalContext.newPage();
    const substitutePage = await substituteContext.newPage();
    originalPage.setDefaultTimeout(15_000);
    substitutePage.setDefaultTimeout(15_000);
    originalCaregiver = await createUnlinkedCaregiverIdentity(
      database,
      office,
      originalPage,
      'original',
    );
    substituteCaregiver = await createUnlinkedCaregiverIdentity(
      database,
      office,
      substitutePage,
      'substitute',
    );

    const linkEmployee = async (
      employeeId: string,
      caregiver: CaregiverIdentity,
      label: string,
    ) => {
      const caregiverName = `Caregiver E2E ${officeSession.runId} ${label}`;
      await page.goto(`/employees/${employeeId}`);
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
      await expect(page).toHaveURL(new RegExp(`/employees/${employeeId}\\?updated=access$`));
      await expect
        .poll(async () => {
          const linkedEmployee = await database.query<{ user_id: string | null }>(
            'SELECT user_id FROM employees.employees WHERE tenant_id = $1 AND id = $2',
            [officeSession.tenantId, employeeId],
          );
          return linkedEmployee.rows[0]?.user_id;
        })
        .toBe(caregiver.platformUserId);
    };

    await linkEmployee(scenario.employeeId, originalCaregiver, 'original');
    await linkEmployee(substituteEmployeeId, substituteCaregiver, 'substitute');

    await page.goto(`/employees/${scenario.employeeId}`);
    await page.getByLabel('Starts at').fill(`${absenceDate}T08:00`);
    await page.getByLabel('Ends at').fill(`${absenceDate}T11:00`);
    await page.getByRole('button', { name: 'Record absence' }).click();
    await expect(page).toHaveURL(/updated=absence/);
    const affectedVisit = page.locator(`a[href="/visits/${scenario.visitId}"]`);
    await expect(affectedVisit.first()).toContainText(scenario.clientName);

    const assignmentResult = await database.query<{ id: string; status: string }>(
      `SELECT id, status FROM scheduling.visit_assignments
       WHERE tenant_id = $1 AND visit_id = $2 AND employee_id = $3`,
      [scenario.tenantId, scenario.visitId, scenario.employeeId],
    );
    const originalAssignmentId = assignmentResult.rows[0]?.id;
    expect(assignmentResult.rows[0]?.status).toBe('active');
    if (!originalAssignmentId) throw new Error('The pilot visit has no original assignment');

    await page.goto(`/visits/${scenario.visitId}`);
    const proposal = page.locator('form').filter({
      has: page.locator('select[name="substituteEmployeeId"]'),
    });
    await proposal
      .locator('select[name="substituteEmployeeId"]')
      .selectOption(substituteEmployeeId);
    await proposal.locator('input[name="reason"]').fill('Synthetic absence coverage');
    await proposal.getByRole('button', { name: 'Propose substitute' }).click();
    await expect(page).toHaveURL(/updated=substitution_proposed/);
    await expect(page.getByText(/Synthetic absence coverage/)).toBeVisible();
    const proposedAssignment = await database.query<{ status: string }>(
      'SELECT status FROM scheduling.visit_assignments WHERE tenant_id = $1 AND id = $2',
      [scenario.tenantId, originalAssignmentId],
    );
    expect(proposedAssignment.rows[0]?.status).toBe('active');

    await page.getByRole('button', { name: 'Confirm substitution' }).click();
    await expect(page).toHaveURL(/updated=substitution_confirmed/);
    const confirmedState = await database.query<{
      substitute_status: string;
      original_status: string;
      substitution_status: string;
    }>(
      `SELECT substitute.status AS substitute_status,
              original.status AS original_status,
              substitution.status AS substitution_status
       FROM scheduling.visit_substitutions AS substitution
       JOIN scheduling.visit_assignments AS original
         ON original.tenant_id = substitution.tenant_id
        AND original.id = substitution.original_assignment_id
       JOIN scheduling.visit_assignments AS substitute
         ON substitute.tenant_id = substitution.tenant_id
        AND substitute.visit_id = substitution.visit_id
        AND substitute.employee_id = substitution.substitute_employee_id
       WHERE substitution.tenant_id = $1 AND substitution.visit_id = $2`,
      [scenario.tenantId, scenario.visitId],
    );
    expect(confirmedState.rows[0]).toEqual({
      substitute_status: 'active',
      original_status: 'unassigned',
      substitution_status: 'confirmed',
    });

    await originalPage.goto('/');
    await originalPage.locator('select[name="tenantId"]').selectOption(office.tenantId);
    await originalPage.getByRole('button', { name: 'Continue' }).click();
    await expect(originalPage).toHaveURL(/\/clients$/);
    await expect(
      originalPage.getByRole('button', {
        name: new RegExp(`CE Caregiver E2E ${office.runId} original`),
      }),
    ).toBeVisible();
    const deniedVisit = await originalPage.goto(`/care/visits/${scenario.visitId}`);
    expect(deniedVisit?.status()).toBeLessThan(500);
    await expect(originalPage.getByRole('heading', { name: scenario.clientName })).toHaveCount(0);

    await substitutePage.goto('/');
    await substitutePage.locator('select[name="tenantId"]').selectOption(office.tenantId);
    await substitutePage.getByRole('button', { name: 'Continue' }).click();
    await expect(substitutePage).toHaveURL(/\/clients$/);
    await expect(
      substitutePage.getByRole('button', {
        name: new RegExp(`CE Caregiver E2E ${office.runId} substitute`),
      }),
    ).toBeVisible();
    const assignedVisit = await substitutePage.goto(`/care/visits/${scenario.visitId}`);
    expect(assignedVisit?.status()).toBe(200);
    await expect(substitutePage.getByRole('heading', { name: scenario.clientName })).toBeVisible();
  } finally {
    try {
      await originalContext?.close().catch(() => undefined);
      await substituteContext?.close().catch(() => undefined);
      if (scenario) {
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND id = $2',
          [scenario.tenantId, scenario.employeeId],
        );
      }
      if (scenario && substituteEmployeeId) {
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND id = $2',
          [scenario.tenantId, substituteEmployeeId],
        );
      }
      if (originalCaregiver) {
        await cleanupOfficeAdminSession(database, {
          apiToken: originalCaregiver.apiToken,
          authentikOrigin: originalCaregiver.authentikOrigin,
          authentikUserId: originalCaregiver.authentikUserId,
          issuer: originalCaregiver.issuer,
          subject: originalCaregiver.subject,
          platformUserId: originalCaregiver.platformUserId,
          membershipId: originalCaregiver.membershipId,
        });
      }
      if (substituteCaregiver) {
        await cleanupOfficeAdminSession(database, {
          apiToken: substituteCaregiver.apiToken,
          authentikOrigin: substituteCaregiver.authentikOrigin,
          authentikUserId: substituteCaregiver.authentikUserId,
          issuer: substituteCaregiver.issuer,
          subject: substituteCaregiver.subject,
          platformUserId: substituteCaregiver.platformUserId,
          membershipId: substituteCaregiver.membershipId,
        });
      }
      if (scenario)
        await cleanupLifecycleScenario(database, scenario, {
          ...(substituteEmployeeId ? { additionalEmployeeIds: [substituteEmployeeId] } : {}),
        });
      if (office) await cleanupOfficeAdminSession(database, office);
    } finally {
      await database.end();
    }
  }
});
