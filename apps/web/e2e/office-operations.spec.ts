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
  addDaysToDate,
  captureReviewScreenshot,
  dateInBerlin,
  expectMobileLayoutToFit,
  reviewDirectory,
  selectEntity,
  submitServerAction,
} from './support/browser';

test('Operations dashboards and worklists work across screen sizes', async ({ page }) => {
  test.setTimeout(360_000);
  await mkdir(reviewDirectory, { recursive: true });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'operations-view');
    await test.step('operations dashboard and worklists respond across screen sizes', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/operations', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Operations dashboard' })).toBeVisible();
      await expect(page.getByRole('heading', { name: "Today's schedule" })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Urgent tasks' })).toBeVisible();
      await captureReviewScreenshot(page, 'operations-dashboard-desktop-1440.png', true);
      await expectMobileLayoutToFit(page);

      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await captureReviewScreenshot(page, 'operations-dashboard-desktop-dark-1440.png', true);
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: 'Light' }).click();

      await page.setViewportSize({ width: 768, height: 1024 });
      await captureReviewScreenshot(page, 'operations-dashboard-tablet-768.png', true);
      await expectMobileLayoutToFit(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await captureReviewScreenshot(page, 'operations-dashboard-mobile-390.png', true);
      await expectMobileLayoutToFit(page);

      await page.getByRole('link', { name: /Visit issues:/ }).click();
      await expect(page).toHaveURL(/\/operations\/worklist\?category=visits$/);
      await expect(page.getByRole('heading', { name: 'Action queue' })).toBeVisible();

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/operations/worklist', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /worklist/i, level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Action queue' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(1);
      await captureReviewScreenshot(page, 'operations-worklist-desktop-1440.png', true);
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileWorklistFilters = page.getByRole('button', { name: 'Filters', exact: true });
      await expect(mobileWorklistFilters).toBeVisible();
      await expect(page.getByLabel('Item type')).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Action queue' })).toBeVisible();
      await captureReviewScreenshot(page, 'operations-worklist-mobile-390.png', true);
      await expectMobileLayoutToFit(page);
      await mobileWorklistFilters.click();
      await expect(page.getByLabel('Item type')).toBeVisible();
      await mobileWorklistFilters.click();
      await expect(page.getByLabel('Item type')).toBeHidden();

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByLabel('Item type').selectOption('tasks');
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      await expect(page).toHaveURL(/itemType=tasks/);
      await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(1);

      await page.goto('/operations/tasks', { waitUntil: 'domcontentloaded' });
      await expect(
        page.getByRole('heading', { name: 'Manual tasks', exact: true, level: 1 }),
      ).toBeVisible();
      await captureReviewScreenshot(page, 'operations-tasks-desktop-1440.png', true);
      await page.setViewportSize({ width: 390, height: 844 });
      await captureReviewScreenshot(page, 'operations-tasks-mobile-390.png', true);
      await expectMobileLayoutToFit(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/operations/deadlines', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Deadlines & Reminders' })).toBeVisible();
      await captureReviewScreenshot(page, 'operations-deadlines-desktop-1440.png', true);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
      await captureReviewScreenshot(page, 'operations-deadlines-mobile-390.png', true);
      await expectMobileLayoutToFit(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/operations/recurring-tasks', { waitUntil: 'commit' });
      await expect(page.getByRole('heading', { name: /recurring/i, level: 1 })).toBeVisible({
        timeout: 60_000,
      });
      await captureReviewScreenshot(page, 'operations-recurring-tasks-desktop-1440.png', true);
      await page.goto('/clients?localeCheck=1');
    });
  } finally {
    try {
      if (office) await cleanupOfficeAdminSession(database, office);
    } finally {
      await database.end();
    }
  }
});

test('Office staff can manage operational tasks and recurrence', async ({ page }) => {
  test.setTimeout(360_000);
  await mkdir(reviewDirectory, { recursive: true });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  let operationsTaskId: string | undefined;
  let operationsRecurrenceId: string | undefined;
  let onboardingCaseId: string | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'operations-tasks');
    const { tenantId, displayName, platformUserId, runId } = office;
    await test.step('operations tasks and recurrence can be managed from the office UI', async () => {
      const employeeResult = await database.query<{
        displayName: string;
        organizationName: string;
        organizationId: string;
      }>(
        `SELECT
           concat_ws(' ', coalesce(nullif(employee.preferred_name, ''), employee.first_name), employee.last_name) AS "displayName",
           organization.name AS "organizationName",
           organization.id AS "organizationId"
         FROM employees.employees AS employee
         INNER JOIN organizations.organizations AS organization
           ON organization.tenant_id = employee.tenant_id
          AND organization.id = employee.organization_id
         WHERE employee.tenant_id = $1
           AND employee.status = 'active'
           AND organization.name !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
           AND concat_ws(
             ' ',
             coalesce(nullif(employee.preferred_name, ''), employee.first_name),
             employee.last_name
           ) !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
         ORDER BY employee.id
         LIMIT 1`,
        [tenantId],
      );
      const organizationName = employeeResult.rows[0]?.organizationName;
      const assignedEmployeeName = employeeResult.rows[0]?.displayName;
      const organizationId = employeeResult.rows[0]?.organizationId;
      if (!organizationName || !assignedEmployeeName || !organizationId)
        throw new Error('Demo Care has no active employee with readable references to assign');
      const assignedEmployeeOption = new RegExp(`^${assignedEmployeeName}$`);

      onboardingCaseId = uuidv7();
      await database.query(
        `INSERT INTO onboarding.cases (
           id, tenant_id, organization_id, first_name, last_name, contact_method,
           inquiry_source, stage, next_follow_up_at, last_activity_at, created_by_user_id,
           created_at, updated_at
         ) VALUES ($1, $2, $3, 'E2E', 'Operations History', 'other',
           'Operations worklist E2E fixture', 'inquiry', now() - interval '1 minute', now(), $4,
           now(), now())`,
        [onboardingCaseId, tenantId, organizationId, platformUserId],
      );

      const taskTitle = `E2E Operations task ${runId}`;
      const taskDescription = `Assigned and tracked in the office UI ${runId}`;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/operations/tasks', { waitUntil: 'domcontentloaded' });
      const createTaskForm = page.locator('section[aria-labelledby="create-task-title"]');
      await createTaskForm.locator('#task-title').fill(taskTitle);
      await createTaskForm.locator('#task-description').fill(taskDescription);
      await selectEntity(page, 'Organization', organizationName, organizationName, createTaskForm);
      await selectEntity(
        page,
        'Assigned employee',
        assignedEmployeeName,
        assignedEmployeeOption,
        createTaskForm,
      );
      const taskDueDate = addDaysToDate(dateInBerlin(), 3);
      await createTaskForm.locator('input[name="dueAt"]').fill(`${taskDueDate}T10:00`);
      await submitServerAction(page, createTaskForm.getByRole('button', { name: 'Create task' }));
      await expect(page).toHaveURL(/\/operations\/tasks\/[0-9a-f-]{36}\?updated=created$/i);
      operationsTaskId = new URL(page.url()).pathname.split('/').at(-1);
      await expect(page.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible();
      const taskDetails = page.locator('section[aria-labelledby="task-edit-heading"]');
      await expect(taskDetails.getByText(organizationName, { exact: true })).toBeVisible();
      await expect(taskDetails.getByText(assignedEmployeeName, { exact: true })).toHaveCount(2);
      await expect(page.getByRole('region', { name: 'Activity' })).toContainText(displayName);
      await page.getByLabel('Comment').fill(`E2E task note ${runId}`);
      await submitServerAction(page, page.getByRole('button', { name: 'Add comment' }));
      await expect(page.getByRole('region', { name: 'Activity' })).toContainText(
        `E2E task note ${runId}`,
      );
      const editedTaskDescription = `${taskDescription} after an edit`;
      const taskEditor = page.locator('section[aria-labelledby="task-edit-heading"] form');
      await taskEditor.locator('textarea[name="description"]').fill(editedTaskDescription);
      await taskEditor.locator('select[name="priority"]').selectOption('high');
      await submitServerAction(page, taskEditor.getByRole('button', { name: 'Save' }));
      await expect(page).toHaveURL(/updated=saved$/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        page.locator('section[aria-labelledby="task-edit-heading"] > p.whitespace-pre-wrap'),
      ).toHaveText(editedTaskDescription);
      await expect(page.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
      );
      await captureReviewScreenshot(page, 'operations-task-detail-desktop-1440.png', true);
      await page.setViewportSize({ width: 390, height: 844 });
      await captureReviewScreenshot(page, 'operations-task-detail-mobile-390.png', true);
      await expectMobileLayoutToFit(page);
      await page.setViewportSize({ width: 1440, height: 900 });

      await submitServerAction(page, page.getByRole('button', { name: 'Start work' }));
      await expect(page).toHaveURL(/updated=saved$/);
      await expect(page.getByText('In progress', { exact: true })).toBeVisible();
      await submitServerAction(page, page.getByRole('button', { name: 'Complete' }));
      await expect(page.getByText('Completed', { exact: true })).toBeVisible();
      await submitServerAction(page, page.getByRole('button', { name: 'Reopen' }));
      await expect(page.getByText('Open', { exact: true })).toBeVisible();

      await page.goto('/operations/worklist', { waitUntil: 'domcontentloaded' });
      const worklistFilters = page.locator('form[method="get"]').first();
      await worklistFilters.locator('select[name="itemType"]').selectOption('tasks');
      await worklistFilters.locator('input[name="search"]').fill(taskTitle);
      await worklistFilters.getByRole('button', { name: 'Filter', exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('itemType')).toBe('tasks');
      await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(taskTitle);
      await expect(page.getByRole('link', { name: taskTitle, exact: true })).toBeVisible();

      await page.goto('/operations/worklist?itemType=exceptions&sourceDomain=onboarding', {
        waitUntil: 'domcontentloaded',
      });
      const exceptionWithHistory = page
        .locator('li')
        .filter({ has: page.getByRole('link', { name: 'Exception history', exact: true }) })
        .first();
      await expect(exceptionWithHistory).toBeVisible();
      const sourceRecordLink = exceptionWithHistory.getByRole('link', {
        name: 'Open source record',
        exact: true,
      });
      await expect(sourceRecordLink).toHaveAttribute('href', /^\/admissions\/[0-9a-f-]{36}$/i);
      await sourceRecordLink.click();
      await expect(page).toHaveURL(/\/admissions\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(exceptionWithHistory).toBeVisible();
      await exceptionWithHistory
        .getByRole('link', { name: 'Exception history', exact: true })
        .click();
      await expect(page).toHaveURL(/\/operations\/work-items\/[a-f0-9]{64}\/history$/i);
      await expect(
        page.getByRole('heading', { name: 'Exception history', exact: true }),
      ).toBeVisible();
      await captureReviewScreenshot(page, 'operations-exception-history-desktop-1440.png', true);

      await page.goto(
        `/operations/worklist?itemType=exceptions&sourceDomain=onboarding&search=${encodeURIComponent(`no-match-${runId}`)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await expect(
        page.getByText('No tasks or operational exceptions match these filters.', { exact: true }),
      ).toBeVisible();
      await captureReviewScreenshot(page, 'operations-worklist-empty-desktop-1440.png', true);

      await page.goto('/operations/worklist?error=UNKNOWN_ERROR', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('p[role="alert"]')).toContainText(
        'Something went wrong. Please try again.',
      );
      await captureReviewScreenshot(page, 'operations-worklist-error-desktop-1440.png', true);

      const recurringTitle = `E2E Recurring task ${runId}`;
      const updatedRecurringTitle = `${recurringTitle} updated`;
      await page.goto('/operations/recurring-tasks', { waitUntil: 'domcontentloaded' });
      const createRecurrenceForm = page.locator(
        'section[aria-labelledby="recurring-create-title"] form',
      );
      await createRecurrenceForm.locator('#recurring-title').fill(recurringTitle);
      await selectEntity(
        page,
        'Organization',
        organizationName,
        organizationName,
        createRecurrenceForm,
      );
      await selectEntity(
        page,
        'Assigned employee',
        assignedEmployeeName,
        assignedEmployeeOption,
        createRecurrenceForm,
      );
      const recurrenceStart = addDaysToDate(dateInBerlin(), 1);
      await createRecurrenceForm.locator('select[name="frequency"]').selectOption('daily');
      await createRecurrenceForm.locator('input[name="startDate"]').fill(recurrenceStart);
      await createRecurrenceForm
        .locator('input[name="endDate"]')
        .fill(addDaysToDate(recurrenceStart, 3));
      await submitServerAction(
        page,
        createRecurrenceForm.getByRole('button', { name: 'Create recurring task' }),
      );
      await expect(page).toHaveURL(/\/operations\/recurring-tasks\?updated=created$/);
      const recurrenceRow = page.locator('li').filter({ hasText: recurringTitle });
      await expect(recurrenceRow).toBeVisible();
      await recurrenceRow.locator('input[name="title"]').fill(updatedRecurringTitle);
      await submitServerAction(page, recurrenceRow.getByRole('button', { name: 'Save' }));
      await expect(page).toHaveURL(/updated=saved$/);
      const updatedRecurrenceRow = page.locator('li').filter({ hasText: updatedRecurringTitle });
      await expect(updatedRecurrenceRow).toBeVisible();
      await submitServerAction(
        page,
        updatedRecurrenceRow.getByRole('button', { name: 'Pause recurrence' }),
      );
      await expect(updatedRecurrenceRow).toContainText('Paused');
      await submitServerAction(
        page,
        updatedRecurrenceRow.getByRole('button', { name: 'Resume recurrence' }),
      );
      await expect(updatedRecurrenceRow).toContainText('Active');
      await captureReviewScreenshot(page, 'operations-recurring-tasks-desktop-1440.png', true);
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.getByLabel('Missed occurrence policy')).toHaveValue('generate_missed');
      await expect(
        page.getByText('Generate missed occurrences for up to 30 days.', { exact: true }),
      ).toBeVisible();
      await captureReviewScreenshot(page, 'operations-recurring-tasks-tablet-768.png', true);
      await expectMobileLayoutToFit(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await captureReviewScreenshot(page, 'operations-recurring-tasks-mobile-390.png', true);
      await expectMobileLayoutToFit(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await updatedRecurrenceRow
        .getByRole('link', { name: updatedRecurringTitle, exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: updatedRecurringTitle, exact: true }),
      ).toBeVisible();
      operationsRecurrenceId = new URL(page.url()).pathname.split('/').at(-1);
      await captureReviewScreenshot(
        page,
        'operations-recurring-task-detail-desktop-1440.png',
        true,
      );
    });
  } finally {
    try {
      if (office) {
        try {
          await cleanupOperationsRecords(database, office.tenantId, office.runId, {
            operationsTaskId,
            operationsRecurrenceId,
          });
        } finally {
          try {
            if (onboardingCaseId) {
              const occurrences = await database.query<{ id: string }>(
                `SELECT id FROM operations.exception_occurrences
                 WHERE tenant_id = $1 AND source_domain = 'onboarding' AND source_entity_id = $2`,
                [office.tenantId, onboardingCaseId],
              );
              const occurrenceIds = occurrences.rows.map((row) => row.id);
              if (occurrenceIds.length) {
                await database.query(
                  'DELETE FROM operations.exception_interactions WHERE tenant_id = $1 AND occurrence_id = ANY($2::uuid[])',
                  [office.tenantId, occurrenceIds],
                );
                await database.query(
                  'DELETE FROM operations.exception_occurrences WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
                  [office.tenantId, occurrenceIds],
                );
              }
              await database.query(
                'DELETE FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
                [office.tenantId, onboardingCaseId],
              );
            }
          } finally {
            await cleanupOfficeAdminSession(database, office);
          }
        }
      }
    } finally {
      await database.end();
    }
  }
});

async function cleanupOperationsRecords(
  database: Client,
  tenantId: string,
  runId: string,
  ids: { operationsTaskId: string | undefined; operationsRecurrenceId: string | undefined },
): Promise<void> {
  const recurrenceRows = await database.query<{ id: string }>(
    `SELECT id FROM operations.recurring_task_definitions
     WHERE tenant_id = $1 AND title = ANY($2::text[])`,
    [tenantId, [`E2E Recurring task ${runId}`, `E2E Recurring task ${runId} updated`]],
  );
  const recurrenceIds = [
    ...new Set(
      [ids.operationsRecurrenceId, ...recurrenceRows.rows.map((row) => row.id)].filter(Boolean),
    ),
  ] as string[];
  const occurrenceTasks = recurrenceIds.length
    ? await database.query<{ id: string }>(
        `SELECT task_id AS id FROM operations.recurring_task_occurrences
         WHERE tenant_id = $1 AND recurrence_definition_id = ANY($2::uuid[])`,
        [tenantId, recurrenceIds],
      )
    : { rows: [] as Array<{ id: string }> };
  const manualTasks = await database.query<{ id: string }>(
    'SELECT id FROM operations.tasks WHERE tenant_id = $1 AND title = $2',
    [tenantId, `E2E Operations task ${runId}`],
  );
  const taskIds = [
    ...new Set(
      [
        ids.operationsTaskId,
        ...manualTasks.rows.map((row) => row.id),
        ...occurrenceTasks.rows.map((row) => row.id),
      ].filter(Boolean),
    ),
  ] as string[];
  if (taskIds.length) {
    await database.query(
      'DELETE FROM operations.task_activity WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])',
      [tenantId, taskIds],
    );
    await database.query(
      'DELETE FROM operations.recurring_task_occurrences WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])',
      [tenantId, taskIds],
    );
    await database.query(
      'DELETE FROM operations.tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [tenantId, taskIds],
    );
  }
  if (recurrenceIds.length) {
    await database.query(
      'DELETE FROM operations.recurring_task_occurrences WHERE tenant_id = $1 AND recurrence_definition_id = ANY($2::uuid[])',
      [tenantId, recurrenceIds],
    );
    await database.query(
      'DELETE FROM operations.recurring_task_definitions WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [tenantId, recurrenceIds],
    );
  }
}
