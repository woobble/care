import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import type { FormTestOptions } from './support/form-action-app';

let output: string;
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'care-form-browser-'));
  execFileSync('bun', [
    'run',
    resolve(import.meta.dirname, '../scripts/build-form-test.ts'),
    output,
  ]);
});
test.afterAll(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});

async function openForm(page: Page, options: FormTestOptions = { structured: true }) {
  await page.route('http://form.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>Form test</title></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://form.test/');
  await page.addScriptTag({ path: join(output, 'form-action-app.js') });
  await page.evaluate((fixtureOptions) => window.formHarness.render(fixtureOptions), options);
  await expect(page.locator('#firstName')).toHaveValue('Ada');
}
async function result(page: Page, value: unknown) {
  await page.evaluate((nextResult) => {
    window.formHarness.results.push(nextResult);
  }, value);
}
async function submit(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}
async function counts(page: Page) {
  return page.evaluate(() => ({
    calls: window.formHarness.calls,
    refreshes: window.formHarness.refreshes,
    errors: window.formHarness.errors,
  }));
}

test('legacy false, string, void and true retain failure, callback and refresh behavior', async ({
  page,
}) => {
  await openForm(page, { customError: true });
  await result(page, false);
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText(en.Clients.detail.saveFailed);
  expect(await counts(page)).toEqual({ calls: 1, refreshes: 0, errors: 0 });
  await result(page, 'legacy string');
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText(en.Clients.detail.saveFailed);
  expect(await counts(page)).toEqual({ calls: 2, refreshes: 1, errors: 0 });
  await submit(page); // No queued result: void success.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => counts(page)).toEqual({ calls: 3, refreshes: 2, errors: 0 });
  await result(page, true);
  await submit(page);
  await expect.poll(() => counts(page)).toEqual({ calls: 4, refreshes: 3, errors: 0 });
});

test('legacy strings without a custom error still display as before; objects require opt-in', async ({
  page,
}) => {
  await openForm(page, {});
  await result(page, 'Existing action message');
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText('Existing action message');
  await result(page, { ok: false, fieldErrors: { firstName: ['required'] } });
  await submit(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#firstName')).not.toHaveAttribute('aria-invalid', 'true');
  expect((await counts(page)).refreshes).toBe(2);
});

for (const locale of ['en', 'de'] as const) {
  test(`structured field errors announce labels, focus and ARIA references; edits and retry clear them (${locale})`, async ({
    page,
  }) => {
    const messages = locale === 'en' ? en : de;
    await openForm(page, { structured: true, locale });
    await page.locator('#firstName').evaluate((input) => {
      input.setAttribute('aria-describedby', 'help');
      const help = document.createElement('p');
      help.id = 'help';
      help.textContent = 'Help';
      input.after(help);
    });
    await result(page, {
      ok: false,
      fieldErrors: { lastName: ['required'], firstName: ['required'] },
    });
    await submit(page);
    await expect(page.locator('#firstName')).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(2);
    await Promise.all(
      (['firstName', 'lastName'] as const).map(async (name) => {
        const input = page.locator(`#${name}`);
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        const ids = (await input.getAttribute('aria-describedby'))!.split(' ');
        const errorId = ids.find((id) => id.includes('-server-'))!;
        const error = page.locator(`[id="${errorId}"]`);
        await expect(error).toHaveText(
          `${messages.Clients.form[name]} *: ${messages.Common.formValidation.required}`,
        );
      }),
    );
    await page.locator('#firstName').fill('Corrected');
    await expect(page.locator('#firstName')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#firstName')).toHaveAttribute('aria-describedby', 'help');
    await expect(page.locator('#firstName')).toBeFocused();
    await expect(page.locator('#lastName')).toHaveAttribute('aria-invalid', 'true');
    await submit(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => counts(page)).toEqual({ calls: 2, refreshes: 1, errors: 0 });
  });
}

test('structured form failures use safe translated text and never refresh; corrected submissions succeed', async ({
  page,
}) => {
  await openForm(page);
  await result(page, { ok: false, formError: 'actionFailed' });
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText(en.Common.formValidation.actionFailed);
  expect((await counts(page)).refreshes).toBe(0);
  await page.locator('#lastName').fill('Corrected');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await result(page, { ok: false, formError: 'private backend error' });
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText(en.Common.formValidation.actionFailed);
  await submit(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await counts(page)).refreshes).toBe(1);
});

test('native required validation blocks action calls and remains separate from server errors', async ({
  page,
}) => {
  await openForm(page);
  await page.locator('#firstName').fill('');
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText(en.Common.formValidation.required);
  await expect(page.locator('#firstName')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#firstName')).toBeFocused();
  expect((await counts(page)).calls).toBe(0);
  await page.locator('#firstName').fill('Ada');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await result(page, {
    ok: false,
    fieldErrors: { lastName: ['required'] },
    formError: 'actionFailed',
  });
  await submit(page);
  await expect(page.getByRole('alert')).toHaveCount(2);
  await expect(page.locator('#lastName')).toBeFocused();
  expect((await counts(page)).refreshes).toBe(0);
});

test('pending submissions lock controls, announce saving and preserve keyboard/unsaved warnings', async ({
  page,
}) => {
  await openForm(page);
  await page.locator('#firstName').fill('Changed');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Leave' }).click();
  await expect(page).toHaveURL('http://form.test/');
  await page.locator('#firstName').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#lastName')).toBeFocused();
  await result(page, 'defer');
  await submit(page);
  await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText(en.Common.formValidation.saving);
  await expect(page.locator('#firstName')).toBeDisabled();
  await page.evaluate(() =>
    window.formHarness.deferred[0]!({ ok: false, fieldErrors: { firstName: ['required'] } }),
  );
  await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await expect(page.locator('#firstName')).toBeFocused();
});

test('a late asynchronous result cannot replace a newer submission or refresh it', async ({
  page,
}) => {
  await openForm(page);
  await result(page, 'defer');
  await submit(page);
  await expect.poll(() => page.evaluate(() => window.formHarness.deferred.length)).toBe(1);
  await result(page, { ok: false, fieldErrors: { firstName: ['required'] } });
  // Simulate overlapping programmatic submission despite the UI's submit lock.
  await page
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })),
    );
  await expect.poll(() => counts(page)).toEqual({ calls: 2, refreshes: 0, errors: 0 });
  await page.evaluate(() =>
    window.formHarness.deferred[0]!({ ok: false, fieldErrors: { lastName: ['required'] } }),
  );
  await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#firstName')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#lastName')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveCount(1);
});

test('ordinary exceptions retain onActionError behavior; redirect signals reach the boundary', async ({
  page,
}) => {
  await openForm(page, { errorCallback: true });
  await result(page, 'throw');
  await submit(page);
  await expect.poll(() => counts(page)).toEqual({ calls: 1, refreshes: 0, errors: 1 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await result(page, 'redirect');
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText('NEXT_REDIRECT;push;/clients;307;');
  expect((await counts(page)).errors).toBe(1);
});

test('structured field failure markup has no axe violations', async ({ page }) => {
  await openForm(page);
  await result(page, { ok: false, fieldErrors: { firstName: ['required'] } });
  await submit(page);
  await expect(page.locator('#firstName')).toHaveAttribute('aria-invalid', 'true');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('server fields preserve existing client errors and clear only their own errors', async ({
  page,
}) => {
  await openForm(page);
  await result(page, 'defer');
  await submit(page);
  await expect.poll(() => page.evaluate(() => window.formHarness.deferred.length)).toBe(1);
  await page.evaluate(() => {
    window.formHarness.clientError();
    window.formHarness.deferred[0]!({
      ok: false,
      fieldErrors: { firstName: ['required'], lastName: ['required'] },
    });
  });
  await expect(page.getByRole('alert')).toHaveCount(2);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Existing client validation error' }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Last name *: This field is required.' }),
  ).toHaveCount(0);
  await page.locator('#firstName').fill('Corrected');
  await expect(page.getByRole('alert')).toHaveText('Existing client validation error');
});

test('an edit invalidates an in-flight server failure and does not steal focus', async ({
  page,
}) => {
  await openForm(page);
  await result(page, 'defer');
  await submit(page);
  await expect.poll(() => page.evaluate(() => window.formHarness.deferred.length)).toBe(1);
  await page.locator('#firstName').evaluate((input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Newer value',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() =>
    window.formHarness.deferred[0]!({ ok: false, fieldErrors: { firstName: ['required'] } }),
  );
  await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#firstName')).toHaveValue('Newer value');
  expect((await counts(page)).refreshes).toBe(0);
});

test('unexpected exceptions have safe feedback without a callback', async ({ page }) => {
  await openForm(page);
  await result(page, 'throw');
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText(en.Common.formValidation.actionFailed);
  expect((await counts(page)).refreshes).toBe(0);
});
