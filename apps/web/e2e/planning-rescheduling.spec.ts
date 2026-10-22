import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { auth } from '../src/auth';
import en from '../messages/en.json' with { type: 'json' };
import de from '../messages/de.json' with { type: 'json' };
import { addDaysToDate, dateInBerlin } from './support/browser';
import {
  cleanupOfficeAdminSession,
  createOfficeAdminSession,
  required,
  type OfficeAdminSession,
} from './support/office-admin';
import {
  cleanupLifecycleScenario,
  seedLifecycleScenario,
  type LifecycleScenario,
} from './support/lifecycle-scenario';

type Interval = { start: string; end: string; timezone: string };

// Coordinates come from the rendered event and 15-minute grid, never fixed screen positions.
async function moveEvent(
  page: Page,
  event: Locator,
  minutes: number,
  resize: boolean | 'protected-edge' = false,
) {
  const wrapper = event.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rbc-event ")][1]',
  );
  // Hydration can replace the single-day column with employee resource columns.
  await expect(async () => {
    await expect(event).toBeVisible();
    await wrapper.scrollIntoViewIfNeeded();
    await wrapper.hover();
  }).toPass({ timeout: 15_000 });
  const handle =
    resize === true ? wrapper.locator('.rbc-addons-dnd-resize-ns-anchor').last() : wrapper;
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  const displayed = await event.locator('.care-calendar-event-time').innerText();
  const sourceTime = displayed.split('–')[resize ? 1 : 0]!;
  const [hours, minute] = sourceTime.split(':').map(Number);
  const targetMinute = hours! * 60 + minute! + minutes;
  // The current calendar starts at 06:00 and renders four slots per hour.
  const slotIndex = (targetMinute - 6 * 60) / 15;
  const target = await page
    .locator('.rbc-day-slot')
    .first()
    .locator('.rbc-time-slot')
    .nth(slotIndex)
    .boundingBox();
  if (!box || !target) throw new Error('Calendar event or target quarter-hour is not measurable');
  // Use the event's blank right edge so the native detail link does not start an HTML link drag.
  const x = resize ? box.x + box.width / 2 : box.x + box.width - 8;
  const y = box.y + (resize === 'protected-edge' ? box.height - 2 : box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y + 2, { steps: 3 });
  // Drag preserves the grab offset; resize places its endpoint directly in the chosen slot.
  const targetY = target.y + target.height / 2 + (resize ? 0 : y - box.y);
  await page.mouse.move(x, targetY, { steps: 16 });
  await page.mouse.up();
}

async function readInterval(
  database: Client,
  tenantId: string,
  visitId: string,
): Promise<Interval> {
  const result = await database.query<Interval>(
    `SELECT to_char(planned_start AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') AS start,
            to_char(planned_end AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') AS end,
            timezone
     FROM scheduling.visits WHERE tenant_id = $1 AND id = $2`,
    [tenantId, visitId],
  );
  const interval = result.rows[0];
  if (!interval) throw new Error('The tenant-scoped fixture visit is missing');
  return interval;
}

for (const locale of ['en', 'de'] as const) {
  test(`authenticated calendar persists moves and resize, rolls back conflicts and protects execution (${locale})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
    await database.connect();
    let office: OfficeAdminSession | undefined;
    let scenario: LifecycleScenario | undefined;
    const visitIds: string[] = [];
    try {
      office = await createOfficeAdminSession(database, page, `rescheduling-${locale}`);
      const date = addDaysToDate(dateInBerlin(), 1);
      scenario = await seedLifecycleScenario(database, office, {
        visit: 'planned',
        visitDate: date,
      });
      if (!scenario.visitId) throw new Error('The editable visit was not seeded');
      const tenantId = scenario.tenantId;
      const movedId = scenario.visitId;
      visitIds.push(movedId);
      // Complete the existing fixture employee's provider assignment for validated scheduling commands.
      await database.query(
        'UPDATE employees.employees SET organization_id = $3 WHERE tenant_id = $1 AND id = $2',
        [tenantId, scenario.employeeId, scenario.organizationId],
      );
      await database.query(
        `INSERT INTO employees.employee_facility_assignments
           (id, tenant_id, organization_id, employee_id, facility_id, is_primary, status)
         VALUES ($1, $2, $3, $4, $5, true, 'active')`,
        [uuidv7(), tenantId, scenario.organizationId, scenario.employeeId, scenario.facilityId],
      );

      // Obtain the real OAuth access token through the existing Better Auth account boundary.
      const cookies = await page.context().cookies(required('WEB_ORIGIN'));
      const headers = new Headers({
        cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
      });
      const account = (await auth.api.listUserAccounts({ headers })).find(
        (value) => value.providerId === 'authentik',
      );
      if (!account) throw new Error('The real authenticated Office account is missing');
      const { accessToken } = await auth.api.getAccessToken({
        headers,
        body: { accountId: account.id },
      });
      const api = async (path: string, method: string, body?: unknown, selectedTenant = tenantId) =>
        fetch(new URL(path, required('API_INTERNAL_URL')), {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Tenant-Id': selectedTenant,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).catch(() => {
          throw new Error(
            `The E2E API at ${new URL(required('API_INTERNAL_URL')).origin} is unavailable for ${method} ${path}`,
          );
        });
      const createVisit = async (start: string, end: string) => {
        const response = await api('/api/v1/visits', 'POST', {
          clientId: scenario!.clientId,
          localDate: date,
          localStartTime: start,
          localEndTime: end,
          employeeIds: [scenario!.employeeId],
          services: [{ serviceDefinitionId: scenario!.serviceId, plannedQuantity: '1' }],
        });
        expect(response.status).toBe(201);
        const visit = (await response.json()) as { id: string };
        visitIds.push(visit.id);
        return visit.id;
      };
      const resizedId = await createVisit('11:30', '12:00');
      const blockerId = await createVisit('13:00', '14:00');
      const protectedId = await createVisit('14:30', '15:30');
      // An in-progress execution is the existing domain-supported planning lock.
      await database.query(
        `INSERT INTO visit_execution.executions
           (id, tenant_id, visit_id, status, actual_start, started_by_employee_id, created_at, updated_at)
         SELECT $1, tenant_id, id, 'in_progress', planned_start, $4, now(), now()
         FROM scheduling.visits WHERE tenant_id = $2 AND id = $3`,
        [uuidv7(), tenantId, protectedId, scenario.employeeId],
      );
      await page
        .context()
        .addCookies([{ name: 'CARE_LOCALE', value: locale, url: required('WEB_ORIGIN') }]);
      await page.setViewportSize({ width: 1440, height: 1100 });
      const planningUrl = `/planning?date=${date}&view=day&employeeId=${scenario.employeeId}&organizationId=${scenario.organizationId}`;
      const event = (id: string) => page.locator(`#visit-${id}`);
      const interval = (start: string, end: string): Interval => ({
        start: `${date} ${start}`,
        end: `${date} ${end}`,
        timezone: 'Europe/Berlin',
      });
      const expectDisplayed = async (id: string, start: string, end: string) => {
        await expect(event(id).locator('.care-calendar-event-time')).toHaveText(`${start}–${end}`);
      };
      const expectStored = async (id: string, start: string, end: string) => {
        await expect.poll(() => readInterval(database, tenantId, id)).toEqual(interval(start, end));
      };

      await page.goto(planningUrl);
      await expectDisplayed(movedId, '09:00', '10:00');
      await test.step('drag persists the Berlin-local interval across reload', async () => {
        await moveEvent(page, event(movedId), 60);
        await expectStored(movedId, '10:00', '11:00');
        await expectDisplayed(movedId, '10:00', '11:00');
        await page.reload();
        await expectDisplayed(movedId, '10:00', '11:00');
        await expectStored(movedId, '10:00', '11:00');
      });
      await test.step('resize changes only the end and survives reload', async () => {
        await moveEvent(page, event(resizedId), 30, true);
        await expectStored(resizedId, '11:30', '12:30');
        await expectDisplayed(resizedId, '11:30', '12:30');
        await page.reload();
        await expectDisplayed(resizedId, '11:30', '12:30');
        await expectStored(resizedId, '11:30', '12:30');
      });
      await test.step('conflicting drag restores the visual and persisted state', async () => {
        const original = await readInterval(database, tenantId, movedId);
        const blocker = await readInterval(database, tenantId, blockerId);
        const conflict = await api(`/api/v1/visits/${movedId}`, 'PATCH', {
          localDate: date,
          localStartTime: '13:00',
          localEndTime: '14:00',
        });
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toMatchObject({ code: 'VISIT_CLIENT_CONFLICT' });
        expect(await readInterval(database, tenantId, movedId)).toEqual(original);
        await moveEvent(page, event(movedId), 180);
        await expect(
          page
            .getByRole('alert')
            .filter({ hasText: (locale === 'en' ? en : de).Planning.calendarRescheduleError }),
        ).toBeVisible();
        await expectDisplayed(movedId, '10:00', '11:00');
        expect(await readInterval(database, tenantId, movedId)).toEqual(original);
        expect(await readInterval(database, tenantId, blockerId)).toEqual(blocker);
        await page.reload();
        await expectDisplayed(movedId, '10:00', '11:00');
        await expectDisplayed(blockerId, '13:00', '14:00');
        expect(await readInterval(database, tenantId, movedId)).toEqual(original);
        expect(await readInterval(database, tenantId, blockerId)).toEqual(blocker);
      });
      await test.step('execution protection denies pointer moves and backend mutations', async () => {
        const original = await readInterval(database, tenantId, protectedId);
        const wrapper = event(protectedId).locator(
          'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rbc-event ")][1]',
        );
        await expect(wrapper.locator('.rbc-addons-dnd-resize-ns-anchor')).toHaveCount(0);
        const actionRequests: string[] = [];
        const observeAction = (request: Request) => {
          if (request.method() === 'POST' && request.headers()['next-action'])
            actionRequests.push(request.url());
        };
        page.on('request', observeAction);
        try {
          await moveEvent(page, event(protectedId), 30);
          await moveEvent(page, event(protectedId), 15, 'protected-edge');
          await expectDisplayed(protectedId, '14:30', '15:30');
        } finally {
          page.off('request', observeAction);
        }
        expect(actionRequests).toEqual([]);
        await expectDisplayed(protectedId, '14:30', '15:30');
        const response = await api(`/api/v1/visits/${protectedId}`, 'PATCH', {
          localDate: date,
          localStartTime: '15:00',
          localEndTime: '16:00',
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'VISIT_EXECUTION_PLANNING_LOCKED' });
        expect(await readInterval(database, tenantId, protectedId)).toEqual(original);
        await page.goto(planningUrl);
        await expectDisplayed(protectedId, '14:30', '15:30');
      });
      await test.step('keyboard opens the resulting visit and a foreign tenant is denied', async () => {
        await expect(async () => {
          await event(movedId).focus();
          await expect(event(movedId)).toBeFocused();
          await event(movedId).press('Enter');
          await expect(page.getByRole('dialog')).toBeVisible();
        }).toPass({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(event(movedId)).toBeFocused();
        const denied = await api(
          `/api/v1/visits/${movedId}`,
          'PATCH',
          { localDate: date, localStartTime: '10:15', localEndTime: '11:15' },
          uuidv7(),
        );
        expect(denied.status).toBe(403);
        await expectStored(movedId, '10:00', '11:00');
      });
      await testInfo.attach('persisted-intervals.json', {
        body: JSON.stringify(
          (
            await database.query(
              'SELECT id, planned_start, planned_end, timezone FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY planned_start',
              [tenantId, visitIds],
            )
          ).rows,
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      await page
        .screenshot({ path: testInfo.outputPath('failure.png'), fullPage: true })
        .catch(() => undefined);
      throw error;
    } finally {
      try {
        if (scenario) {
          await database.query(
            'DELETE FROM employees.employee_facility_assignments WHERE tenant_id = $1 AND employee_id = $2',
            [scenario.tenantId, scenario.employeeId],
          );
          await cleanupLifecycleScenario(database, scenario);
          const remaining = await database.query<{ count: string }>(
            'SELECT count(*) FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
            [scenario.tenantId, visitIds],
          );
          expect(remaining.rows[0]?.count).toBe('0');
        }
      } finally {
        try {
          if (office) await cleanupOfficeAdminSession(database, office);
        } finally {
          await database.end();
        }
      }
    }
  });
}
