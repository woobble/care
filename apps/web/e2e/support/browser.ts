import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';
import type { Dialog, Locator, Page } from '@playwright/test';
import { Client } from 'pg';

export const reviewDirectory = process.env.CARE_UI_REVIEW_DIR
  ? resolve(process.env.CARE_UI_REVIEW_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../../artifacts/ui-foundation-review');

export function dateInBerlin(): string {
  return dateInTimezone(new Date(), 'Europe/Berlin');
}

export function addDaysToDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayInBerlin(date: string): number {
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

export async function expectMobileLayoutToFit(page: Page): Promise<void> {
  const { documentWidth, visualWidth, overflowCandidates, shellAncestors } = await page.evaluate(
    () => {
      const width = window.visualViewport?.width ?? window.innerWidth;
      const shell = document.querySelector('main');
      const shellAncestorSummary = [];
      let current = shell;
      while (current && shellAncestorSummary.length < 6) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        shellAncestorSummary.push({
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
        shellAncestors: shellAncestorSummary,
        overflowCandidates: Array.from(document.body.querySelectorAll('*'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const ancestors: Array<Record<string, number | string>> = [];
            let ancestor = element.parentElement;
            while (ancestor && ancestors.length < 5) {
              const ancestorRect = ancestor.getBoundingClientRect();
              const ancestorStyle = getComputedStyle(ancestor);
              ancestors.push({
                tag: ancestor.tagName,
                className: typeof ancestor.className === 'string' ? ancestor.className : '',
                left: Math.round(ancestorRect.left),
                right: Math.round(ancestorRect.right),
                width: Math.round(ancestorRect.width),
                scrollWidth: ancestor.scrollWidth,
                clientWidth: ancestor.clientWidth,
                overflowX: ancestorStyle.overflowX,
                minWidth: ancestorStyle.minWidth,
              });
              ancestor = ancestor.parentElement;
            }
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
              ancestors,
            };
          })
          .filter((element) => element.right > width + 1 || element.left < -1)
          .filter(
            (element) =>
              !element.ancestors.some(
                (ancestor) => ancestor.overflowX === 'auto' || ancestor.overflowX === 'scroll',
              ),
          )
          .sort((left, right) => right.right - left.right)
          .slice(0, 8),
      };
    },
  );
  expect(documentWidth, JSON.stringify({ overflowCandidates, shellAncestors })).toBeLessThanOrEqual(
    visualWidth,
  );
}

export async function selectEntity(
  page: Page,
  controlLabel: string,
  searchText: string,
  optionName: string | RegExp,
  root: Page | Locator = page,
): Promise<void> {
  const trigger = root.getByRole('combobox', { name: controlLabel });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const searchInput = page.getByRole('combobox', { name: 'Search by name' });
  const dialog = page.getByRole('dialog').filter({ has: searchInput });
  await expect(dialog).toBeVisible();
  await searchInput.fill(searchText);
  const targetOption = dialog.getByRole('option', { name: optionName });
  await expect(targetOption).toBeVisible();
  const optionCount = await dialog.getByRole('option').count();
  const matchesOption = (text: string) =>
    typeof optionName === 'string' ? text.includes(optionName) : optionName.test(text);

  for (let index = 0; index < optionCount; index += 1) {
    const activeOption = dialog.locator('[role="option"][aria-selected="true"]').first();
    // The active option must be checked after each keyboard movement.
    // oxlint-disable-next-line no-await-in-loop
    const activeText = (await activeOption.textContent()) ?? '';
    if (matchesOption(activeText)) {
      // oxlint-disable-next-line no-await-in-loop
      await searchInput.press('Enter');
      return;
    }
    // The active option must be checked after each keyboard movement.
    // oxlint-disable-next-line no-await-in-loop
    await searchInput.press('ArrowDown');
  }
  throw new Error(`Could not navigate to the ${String(optionName)} option`);
}

export async function submitServerAction(page: Page, submitButton: Locator): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'POST' && 'next-action' in request.headers();
  });
  await submitButton.click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await page.waitForLoadState('networkidle');
}

export async function retryCareToday(page: Page): Promise<void> {
  const refreshedPage = page.waitForResponse((response) => {
    const request = response.request();
    return (
      new URL(response.url()).pathname === '/care/today' &&
      request.method() === 'GET' &&
      request.headers()['rsc'] === '1'
    );
  });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  expect((await refreshedPage).status()).toBe(200);
}

export async function captureReviewScreenshot(
  page: Page,
  filename: string,
  fullPage = false,
  scrollToTop = true,
): Promise<void> {
  if (scrollToTop) await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: resolve(reviewDirectory, filename), fullPage });
}

export async function captureReviewElementScreenshot(
  locator: Locator,
  filename: string,
): Promise<void> {
  await locator.screenshot({ path: resolve(reviewDirectory, filename) });
}

export async function expectVisibleTextToOmitIds(
  page: Page,
  ids: Array<string | undefined>,
): Promise<void> {
  const visibleText = await page.evaluate(() => document.body.innerText);
  for (const id of ids) {
    if (id) expect(visibleText).not.toContain(id);
  }
}

export async function expectMembershipScopes(
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

export async function acceptDialogDuringAction(
  page: Page,
  action: () => Promise<unknown>,
  onDialog: (dialog: Dialog) => Promise<void> | void = (dialog) => dialog.accept(),
): Promise<void> {
  const dialogPromise = page.waitForEvent('dialog');
  const actionPromise = action();
  await onDialog(await dialogPromise);
  await actionPromise;
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
