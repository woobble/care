import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { expectFocusTrap } from './support/browser';
import type { NavigationFixtureProps } from './support/office-navigation-app';

let output: string;
let css: string;
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'care-navigation-'));
  execFileSync('bun', [
    'run',
    resolve(import.meta.dirname, '../scripts/build-navigation-test.ts'),
    output,
  ]);
  const directory = resolve(import.meta.dirname, '../.next/static/chunks');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.css'));
  if (!files.length) throw new Error('Build the app before styled navigation checks');
  css = (await Promise.all(files.map((file) => readFile(join(directory, file), 'utf8')))).join(
    '\n',
  );
});
test.afterAll(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});

type Scenario = {
  path: string;
  locale: 'en' | 'de';
  planning?: boolean;
  collapsed?: boolean;
  bundle?: string;
};
async function mount(page: Page, scenario: Scenario) {
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === 'care-office-sidebar',
  );
  const permissions = [
    'operations.read',
    'client.read',
    'employee.read',
    'billing.read',
    'claims.read',
    ...(scenario.planning !== false ? ['schedule.read'] : []),
  ];
  const props = JSON.parse(
    execFileSync(
      'bun',
      [
        resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
        JSON.stringify({
          locale: scenario.locale,
          permissions,
          collapsed: cookie ? cookie.value !== 'expanded' : (scenario.collapsed ?? false),
        }),
      ],
      { encoding: 'utf8' },
    ),
  ) as NavigationFixtureProps;
  await page.route('http://navigation.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="${scenario.locale}"><head><title>Navigation fixture</title><style>${css}</style></head><body><div id="root"></div></body></html>`,
    }),
  );
  await page.goto(`http://navigation.test${scenario.path}`);
  await page.addScriptTag({ path: scenario.bundle ?? join(output, 'office-navigation-app.js') });
  await page.evaluate((fixtureProps) => window.navigationHarness.render(fixtureProps), props);
  await expect(page.locator('#office-page-context')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
async function selected(page: Page, href: string | undefined, context: string, mobile = false) {
  const surface = page.locator(mobile ? '#office-mobile-navigation' : '#office-sidebar');
  const current = surface.locator('a[aria-current="page"]');
  await expect(current).toHaveCount(href ? 1 : 0);
  if (href) {
    await expect(current).toHaveAttribute('href', href);
    await expect(current).toHaveAttribute('data-active', 'true');
  }
  if (!mobile) {
    await expect(page.locator('#office-page-context')).toHaveText(context);
    await expect(page.locator('#office-page-context')).toHaveAttribute('aria-current', 'page');
  }
}

for (const locale of ['en', 'de'] as const) {
  const labels = (locale === 'en' ? en : de).Navigation;
  test(`shared selection and before/after screenshots across desktop, mobile and permissions (${locale})`, async ({
    page,
  }, testInfo) => {
    const folder = process.env.NAVIGATION_SCREENSHOTS_DIR ?? testInfo.outputPath('screenshots');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      {
        name: 'visit-expanded',
        width: 1440,
        path: '/visits/synthetic-id',
        href: '/planning',
        label: labels.planning,
      },
      {
        name: 'visit-collapsed',
        width: 1440,
        path: '/visits/synthetic-id?returnTo=%2Fplanning%3Fview%3Dweek',
        href: '/planning',
        label: labels.planning,
        collapsed: true,
      },
      {
        name: 'visit-tablet',
        width: 768,
        path: '/visits/synthetic-id',
        href: '/planning',
        label: labels.planning,
        collapsed: true,
      },
      {
        name: 'visit-mobile',
        width: 390,
        path: '/visits/synthetic-id',
        href: '/planning',
        label: labels.planning,
        mobile: true,
      },
      {
        name: 'planning-control',
        width: 1440,
        path: '/planning',
        href: '/planning',
        label: labels.planning,
      },
      {
        name: 'client-control',
        width: 1440,
        path: '/clients/synthetic-id',
        href: '/clients',
        label: labels.clientRecords,
      },
      {
        name: 'claims-control',
        width: 1440,
        path: '/billing/claims/synthetic-id',
        href: '/billing/claims',
        label: labels.claims,
      },
      {
        name: 'hidden-desktop',
        width: 1440,
        path: '/visits/synthetic-id',
        label: labels.overview,
        planning: false,
      },
      {
        name: 'hidden-mobile',
        width: 390,
        path: '/visits/synthetic-id',
        label: labels.overview,
        planning: false,
        mobile: true,
      },
    ];
    // oxlint-disable no-await-in-loop -- Baseline/current scenarios share a browser page and require ordered interaction.
    for (const scenario of scenarios) {
      for (const phase of process.env.NAVIGATION_BASELINE_BUNDLE
        ? ['before', 'after']
        : ['after']) {
        await page.context().clearCookies();
        await page.setViewportSize({ width: scenario.width, height: 900 });
        await mount(page, {
          ...scenario,
          locale,
          ...(phase === 'before' ? { bundle: process.env.NAVIGATION_BASELINE_BUNDLE! } : {}),
        });
        const visitBefore = phase === 'before' && scenario.path.startsWith('/visits/');
        const expectedHref = visitBefore
          ? undefined
          : 'href' in scenario
            ? scenario.href
            : undefined;
        const expectedLabel = visitBefore ? labels.overview : scenario.label;
        await selected(page, expectedHref, expectedLabel);
        if (scenario.planning === false)
          await expect(page.locator('#office-sidebar a[href="/planning"]')).toHaveCount(0);
        if ('mobile' in scenario && scenario.mobile) {
          await page.getByRole('button', { name: labels.openMenu }).click();
          await expect(page.locator('#office-mobile-navigation')).toBeVisible();
          await selected(page, expectedHref, expectedLabel, true);
          if (scenario.planning === false)
            await expect(page.locator('#office-mobile-navigation a[href="/planning"]')).toHaveCount(
              0,
            );
        } else if ('collapsed' in scenario && scenario.collapsed && expectedHref) {
          await expect(page.locator(`#office-sidebar a[href="${expectedHref}"]`)).toHaveAttribute(
            'aria-label',
            scenario.label,
          );
          await expect(page.locator(`#office-sidebar a[href="${expectedHref}"]`)).toHaveAttribute(
            'title',
            scenario.label,
          );
        }
        const violations = (await new AxeBuilder({ page }).analyze()).violations.map(
          (violation) => violation.id,
        );
        expect(violations).toEqual([]);
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        expect(fits).toBe(true);
        await page.screenshot({
          path: join(folder, `${locale}-${scenario.name}-${scenario.width}-${phase}.png`),
          animations: 'disabled',
        });
        await writeFile(
          join(folder, `${locale}-${scenario.name}-${phase}.json`),
          JSON.stringify(
            {
              route: scenario.path,
              planningVisible: scenario.planning !== false,
              width: scenario.width,
              selectedHref: expectedHref ?? null,
              context: expectedLabel,
              violations,
            },
            null,
            2,
          ),
        );
      }
    }
    // oxlint-enable no-await-in-loop
  });

  test(`desktop collapse shortcut, persistence and nested route transitions remain intact (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mount(page, { locale, path: '/visits/synthetic-id' });
    await selected(page, '/planning', labels.planning);
    await page.getByRole('button', { name: labels.collapseSidebar }).click();
    await expect(page.locator('#office-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(
      (await page.context().cookies()).find((cookie) => cookie.name === 'care-office-sidebar')
        ?.value,
    ).toBe('collapsed');
    await page.reload();
    await mount(page, { locale, path: '/visits/synthetic-id' });
    await expect(page.locator('#office-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.keyboard.press('Control+b');
    await expect(page.locator('#office-sidebar')).toHaveAttribute('data-collapsed', 'false');
    expect(
      (await page.context().cookies()).find((cookie) => cookie.name === 'care-office-sidebar')
        ?.value,
    ).toBe('expanded');
    await page.evaluate(() => window.navigationHarness.navigate('/billing/claims/synthetic-id'));
    await selected(page, '/billing/claims', labels.claims);
    await page.evaluate(() => window.navigationHarness.navigate('/operations'));
    await selected(page, '/operations', labels.overview);
    await page.evaluate(() => window.navigationHarness.navigate('/operations/tasks/synthetic-id'));
    await selected(page, '/operations/worklist', labels.operations);
    await page.evaluate(() => window.navigationHarness.navigate('/visits/synthetic-id/edit'));
    await selected(page, undefined, labels.overview);
    await page.evaluate(() =>
      window.navigationHarness.navigate('/visits/synthetic-id?returnTo=%2Fplanning'),
    );
    await selected(page, '/planning', labels.planning);
  });

  test(`real mobile drawer traps focus, closes on navigation and restores focus (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { locale, path: '/visits/synthetic-id' });
    const trigger = page.getByRole('button', { name: labels.openMenu });
    await expect(page.locator('#office-mobile-navigation')).toHaveCount(0);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await selected(page, '/planning', labels.planning, true);
    await expectFocusTrap(page, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.locator('#office-mobile-navigation a[href="/planning"]').click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL('http://navigation.test/planning');
    await selected(page, '/planning', labels.planning);
    await page.goBack();
    await expect(page).toHaveURL('http://navigation.test/visits/synthetic-id');
    await selected(page, '/planning', labels.planning);
    await page.goForward();
    await selected(page, '/planning', labels.planning);
    await trigger.click();
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#office-page-context')).toBeFocused();
  });
}
