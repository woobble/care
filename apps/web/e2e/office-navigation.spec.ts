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
  permissions?: string[];
  props?: NavigationFixtureProps;
  landing?: boolean;
};
async function mount(page: Page, scenario: Scenario) {
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === 'care-office-sidebar',
  );
  const permissions = scenario.permissions ?? [
    'operations.read',
    'client.read',
    'employee.read',
    'billing.read',
    'claims.read',
    ...(scenario.planning !== false ? ['schedule.read'] : []),
  ];
  const props =
    scenario.props ??
    (JSON.parse(
      execFileSync(
        'bun',
        [
          resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
          JSON.stringify({
            locale: scenario.locale,
            permissions,
            landing: scenario.landing ?? false,
            collapsed: cookie ? cookie.value !== 'expanded' : (scenario.collapsed ?? false),
          }),
        ],
        { encoding: 'utf8' },
      ),
    ) as NavigationFixtureProps);
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

for (const locale of ['en', 'de'] as const) {
  const labels = (locale === 'en' ? en : de).Navigation;
  test(`settings-only Administration visibility, landing links and before/after evidence (${locale})`, async ({
    page,
  }, testInfo) => {
    const folder =
      process.env.ADMINISTRATION_SCREENSHOTS_DIR ?? testInfo.outputPath('administration');
    await mkdir(folder, { recursive: true });
    const cases = [
      {
        name: 'settings-1',
        permissions: ['billing.settings.manage'],
        hrefs: ['/billing/settings'],
        visible: true,
      },
      {
        name: 'settings-2',
        permissions: ['claims.settings.manage'],
        hrefs: ['/billing/claims/settings'],
        visible: true,
      },
      {
        name: 'settings-4',
        permissions: ['operations.reminder_settings.manage'],
        hrefs: ['/operations/reminder-settings'],
        visible: true,
      },
      {
        name: 'settings-7',
        permissions: [
          'billing.settings.manage',
          'claims.settings.manage',
          'operations.reminder_settings.manage',
        ],
        hrefs: ['/billing/settings', '/billing/claims/settings', '/operations/reminder-settings'],
        visible: true,
      },
      { name: 'unrelated', permissions: ['client.read'], hrefs: [], visible: false },
      { name: 'settings-0', permissions: [], hrefs: [], visible: false },
      { name: 'audit.read', permissions: ['audit.read'], hrefs: [], visible: true },
    ];
    const surfaces = [
      { name: 'expanded', width: 1440, collapsed: false, mobile: false },
      { name: 'collapsed', width: 1440, collapsed: true, mobile: false },
      { name: 'mobile', width: 390, collapsed: false, mobile: true },
    ];
    // oxlint-disable no-await-in-loop -- Capture ordered before/after views with the same browser and real drawer.
    for (const permissionCase of cases)
      for (const surface of surfaces) {
        for (const phase of process.env.ADMINISTRATION_BASELINE_DIR
          ? ['before', 'after']
          : ['after']) {
          await page.context().clearCookies();
          await page.setViewportSize({ width: surface.width, height: 900 });
          const props =
            phase === 'before'
              ? {
                  ...(JSON.parse(
                    await readFile(
                      join(
                        process.env.ADMINISTRATION_BASELINE_DIR!,
                        `${locale}-${permissionCase.name}.json`,
                      ),
                      'utf8',
                    ),
                  ) as NavigationFixtureProps),
                  initialCollapsed: surface.collapsed,
                }
              : undefined;
          await mount(page, {
            path: '/administration',
            locale,
            permissions: permissionCase.permissions,
            collapsed: surface.collapsed,
            landing: true,
            ...(props ? { props } : {}),
          });
          const visible =
            phase === 'before' ? permissionCase.name === 'audit.read' : permissionCase.visible;
          const expectedContext = visible ? labels.administration : labels.overview;
          await selected(page, visible ? '/administration' : undefined, expectedContext);
          const sidebar = page.locator('#office-sidebar');
          await expect(
            sidebar.locator('a[data-sidebar="menu-button"][href="/administration"]'),
          ).toHaveCount(visible ? 1 : 0);
          if (visible) {
            await expect(sidebar.getByText(labels.management, { exact: true })).toHaveCount(1);
            if (surface.collapsed) {
              await expect(
                sidebar.locator('a[data-sidebar="menu-button"][href="/administration"]'),
              ).toHaveAttribute('aria-label', labels.administration);
              await expect(
                sidebar.locator('a[data-sidebar="menu-button"][href="/administration"]'),
              ).toHaveAttribute('title', labels.administration);
            }
          }
          const entryPoints = page.locator('section[aria-labelledby="admin-entrypoints-title"]');
          expect(
            await entryPoints
              .locator('a')
              .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
          ).toEqual(permissionCase.hrefs);
          if (surface.mobile) {
            await page.getByRole('button', { name: labels.openMenu }).click();
            await expect(page.locator('#office-mobile-navigation')).toBeVisible();
            await selected(page, visible ? '/administration' : undefined, expectedContext, true);
            await expect(
              page.locator(
                '#office-mobile-navigation a[data-sidebar="menu-button"][href="/administration"]',
              ),
            ).toHaveCount(visible ? 1 : 0);
          }
          const violations = (await new AxeBuilder({ page }).analyze()).violations.map(
            (violation) => violation.id,
          );
          expect(violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          const name = `${locale}-${permissionCase.name}-${surface.name}-${phase}`;
          await page.screenshot({ path: join(folder, `${name}.png`), animations: 'disabled' });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                route: '/administration',
                permissions: permissionCase.permissions,
                width: surface.width,
                collapsed: surface.collapsed,
                administrationVisible: visible,
                context: expectedContext,
                landingHrefs: permissionCase.hrefs,
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

  test(`settings-only Administration keyboard focus and mobile interaction stay intact (${locale})`, async ({
    page,
  }) => {
    const scenario = {
      path: '/administration',
      locale,
      permissions: ['billing.settings.manage'],
      landing: true,
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await mount(page, scenario);
    const sidebar = page.locator('#office-sidebar');
    await sidebar.getByRole('link', { name: labels.brand, exact: true }).focus();
    await page.keyboard.press('Tab');
    const administration = sidebar.locator('a[data-sidebar="menu-button"][href="/administration"]');
    await expect(administration).toBeFocused();
    expect(await administration.evaluate((link) => link.matches(':focus-visible'))).toBe(true);
    await expect(administration).not.toHaveCSS('box-shadow', 'none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('http://navigation.test/administration');
    await selected(page, '/administration', labels.administration);
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.getByRole('button', { name: labels.openMenu });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expectFocusTrap(page, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page
      .locator('#office-mobile-navigation a[data-sidebar="menu-button"][href="/administration"]')
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await selected(page, '/administration', labels.administration);
    // The settings path now falls back to the existing visible Administration item.
    await expect(
      page.locator(
        'section[aria-labelledby="admin-entrypoints-title"] a[href="/billing/settings"]',
      ),
    ).toHaveAttribute('href', '/billing/settings');
    // Landing HTML is server-rendered without Next hydration; exercise the existing
    // pathname bridge rather than treating an ordinary anchor reload as Next routing.
    await page.evaluate(() => window.navigationHarness.navigate('/billing/settings'));
    await expect(page).toHaveURL('http://navigation.test/billing/settings');
    await selected(page, '/administration', labels.administration);
  });
}

for (const locale of ['en', 'de'] as const) {
  test(`actual settings headers preserve controls and permission-aware return links on desktop/mobile (${locale})`, async ({
    page,
  }, testInfo) => {
    const messages = locale === 'en' ? en : de;
    const folder = process.env.SETTINGS_SCREENSHOTS_DIR ?? testInfo.outputPath('settings');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      {
        name: 'claims-both',
        settings: 'claims',
        permissions: ['claims.read', 'claims.settings.manage'],
        href: '/billing/claims',
        label: messages.Billing.claims,
      },
      {
        name: 'claims-manage',
        settings: 'claims',
        permissions: ['claims.settings.manage'],
        href: '/administration',
        label: messages.Navigation.administration,
      },
      {
        name: 'claims-neither',
        settings: 'claims',
        permissions: [],
        href: null,
        label: messages.Billing.claims,
      },
      {
        name: 'reminders-both',
        settings: 'reminders',
        permissions: ['operations.read', 'operations.reminder_settings.manage'],
        href: '/operations',
        label: messages.Operations.dashboardTitle,
      },
      {
        name: 'reminders-manage',
        settings: 'reminders',
        permissions: ['operations.reminder_settings.manage'],
        href: '/administration',
        label: messages.Navigation.administration,
      },
      {
        name: 'reminders-denied',
        settings: 'reminders',
        permissions: ['operations.read'],
        href: null,
        label: messages.Operations.noAccess,
      },
    ];
    // oxlint-disable no-await-in-loop -- Before/after captures and Tab interactions share one browser page.
    for (const scenario of scenarios) {
      const after = JSON.parse(
        execFileSync(
          'bun',
          [
            resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
            JSON.stringify({
              locale,
              permissions: scenario.permissions,
              settings: scenario.settings,
              collapsed: false,
            }),
          ],
          { encoding: 'utf8' },
        ),
      ) as NavigationFixtureProps;
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const phases = process.env.SETTINGS_BASELINE_DIR ? ['before', 'after'] : ['after'];
        for (const phase of phases) {
          const props =
            phase === 'after'
              ? after
              : (JSON.parse(
                  await readFile(
                    join(process.env.SETTINGS_BASELINE_DIR!, `${locale}-${scenario.name}.json`),
                    'utf8',
                  ),
                ) as NavigationFixtureProps);
          await page.context().clearCookies();
          await page.unrouteAll();
          await mount(page, {
            locale,
            path:
              scenario.settings === 'claims'
                ? '/billing/claims/settings'
                : '/operations/reminder-settings',
            props,
          });
          const content = page.getByRole('main');
          const header = content.locator('header');
          const denied = scenario.name === 'reminders-denied';
          const oldHref = scenario.settings === 'claims' ? '/billing/claims' : '/operations';
          const oldLabel =
            scenario.settings === 'claims'
              ? messages.Billing.claims
              : messages.Operations.dashboardTitle;
          const href = phase === 'before' && !denied ? oldHref : scenario.href;
          const label = phase === 'before' && !denied ? oldLabel : scenario.label;
          await expect(header).toHaveCount(denied ? 0 : 1);
          const link = header.getByRole('link');
          await expect(link).toHaveCount(href ? 1 : 0);
          if (href) {
            await expect(link).toHaveAttribute('href', href);
            await expect(link).toHaveAccessibleName(label);
            // Tab from the start to prove native keyboard reachability in the real shell.
            await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
            let reached = false;
            for (let index = 0; index < 25; index++) {
              await page.keyboard.press('Tab');
              if (await link.evaluate((element) => element === document.activeElement)) {
                reached = true;
                break;
              }
            }
            expect(reached).toBe(true);
            expect(
              await link.evaluate((element) => {
                const style = getComputedStyle(element);
                return (
                  element.matches(':focus-visible') &&
                  (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
                );
              }),
            ).toBe(true);
            if (scenario.settings === 'reminders')
              await expect(link).toHaveAttribute('data-variant', 'secondary');
          } else {
            await expect(header.locator('a,button,[tabindex],[role="link"]')).toHaveCount(0);
            if (denied)
              await expect(content.getByRole('alert')).toHaveText(messages.Operations.noAccess);
            else await expect(header.locator('p').first()).toHaveText(messages.Billing.claims);
          }
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
          const name = `${locale}-${scenario.name}-${width}-${phase}`;
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: join(folder, `${name}.png`),
            fullPage: true,
            animations: 'disabled',
          });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                scenario: scenario.name,
                width,
                phase,
                href,
                label,
                violations: axe.violations,
                headerHtml: (await header.count())
                  ? await header.evaluate((element) => element.outerHTML)
                  : null,
              },
              null,
              2,
            ),
          );
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });
}

for (const locale of ['en', 'de'] as const) {
  test(`Billing organization note preserves readers and removes only the unavailable link (${locale})`, async ({
    page,
  }, testInfo) => {
    const messages = locale === 'en' ? en : de;
    const folder = process.env.BILLING_NOTE_SCREENSHOTS_DIR ?? testInfo.outputPath('billing-note');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      { name: 'both', permissions: ['billing.settings.manage', 'organization.read'], read: true },
      { name: 'manage', permissions: ['billing.settings.manage'], read: false },
      { name: 'read', permissions: ['organization.read'], read: true },
      { name: 'neither', permissions: [], read: false },
    ];
    // oxlint-disable no-await-in-loop -- Captures and keyboard checks share one browser page.
    for (const scenario of scenarios) {
      const after = JSON.parse(
        execFileSync(
          'bun',
          [
            resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
            JSON.stringify({
              locale,
              permissions: scenario.permissions,
              settings: 'billing',
              populated: true,
              query: { updated: 'saved' },
              collapsed: false,
            }),
          ],
          { encoding: 'utf8' },
        ),
      ) as NavigationFixtureProps;
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        let compatibility: string[] | undefined;
        for (const phase of process.env.BILLING_NOTE_BASELINE_DIR
          ? ['before', 'after']
          : ['after']) {
          const props =
            phase === 'after'
              ? after
              : (JSON.parse(
                  await readFile(
                    join(
                      process.env.BILLING_NOTE_BASELINE_DIR!,
                      `${locale}-billing-${scenario.name}.json`,
                    ),
                    'utf8',
                  ),
                ) as NavigationFixtureProps);
          await page.context().clearCookies();
          await page.unrouteAll();
          await mount(page, { locale, path: '/billing/settings', props });
          const content = page.getByRole('main');
          const note = content
            .locator('p')
            .filter({ hasText: messages.Billing.organizationAddressNote });
          await expect(note).toHaveCount(1);
          await expect(note).toHaveText(
            `${messages.Billing.organizationAddressNote} ${messages.Billing.manageOrganizations}`,
          );
          await expect(note).toHaveAttribute(
            'class',
            'rounded-md border border-primary/20 bg-accent p-3 text-sm text-primary',
          );
          const link = note.getByRole('link');
          const linked = phase === 'before' || scenario.read;
          await expect(link).toHaveCount(linked ? 1 : 0);
          if (linked) {
            await expect(link).toHaveAttribute('href', '/administration/organizations');
            await expect(link).toHaveAttribute('class', 'font-medium underline');
            await expect(link).toHaveAccessibleName(messages.Billing.manageOrganizations);
          } else {
            await expect(
              note.locator('a,button,[role],[tabindex],.underline,.font-medium'),
            ).toHaveCount(0);
            expect(
              await note.evaluate((element) => getComputedStyle(element).textDecorationLine),
            ).toBe('none');
          }
          const controls = content.locator('nav,[role="status"],h2');
          const current = await controls.evaluateAll((elements) =>
            elements.map((element) => element.outerHTML),
          );
          if (compatibility) expect(current).toEqual(compatibility);
          compatibility = current;
          await expect(content.getByRole('status')).toHaveText(
            messages.Billing.billingProfileSaved,
          );
          await expect(
            content.getByRole('heading', { name: 'Synthetic organization' }),
          ).toHaveCount(1);
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
          await page.evaluate(() => document.fonts.ready);
          const name = `${locale}-billing-${scenario.name}-${width}-${phase}`;
          await page.screenshot({
            path: join(folder, `${name}.png`),
            fullPage: true,
            animations: 'disabled',
          });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                scenario: scenario.name,
                permissions: scenario.permissions,
                width,
                phase,
                linked,
                noteHtml: await note.evaluate((element) => element.outerHTML),
                noteBounds: await note.boundingBox(),
                compatibility: current,
                violations: axe.violations,
              },
              null,
              2,
            ),
          );
          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
          let reached = false;
          for (let index = 0; index < 25; index++) {
            await page.keyboard.press('Tab');
            if (await note.evaluate((element) => element.contains(document.activeElement))) {
              reached = true;
              break;
            }
          }
          expect(reached).toBe(linked);
          if (linked)
            expect(
              await link.evaluate((element) => {
                const style = getComputedStyle(element);
                return (
                  element.matches(':focus-visible') &&
                  (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
                );
              }),
            ).toBe(true);
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });
}

for (const locale of ['en', 'de'] as const) {
  const labels = (locale === 'en' ? en : de).Navigation;
  test(`settings context fallback before/after across owners and navigation surfaces (${locale})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const folder =
      process.env.SETTINGS_CONTEXT_SCREENSHOTS_DIR ?? testInfo.outputPath('settings-context');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      {
        name: 'billing-only',
        path: '/billing/settings',
        permissions: ['billing.settings.manage'],
        href: '/administration',
        label: labels.administration,
        changed: true,
      },
      {
        name: 'claims-only',
        path: '/billing/claims/settings',
        permissions: ['claims.settings.manage'],
        href: '/administration',
        label: labels.administration,
        changed: true,
      },
      {
        name: 'reminders-only',
        path: '/operations/reminder-settings',
        permissions: ['operations.reminder_settings.manage'],
        href: '/administration',
        label: labels.administration,
        changed: true,
      },
      {
        name: 'billing-read',
        path: '/billing/settings',
        permissions: ['billing.settings.manage', 'billing.read'],
        href: '/billing',
        label: labels.billing,
      },
      {
        name: 'claims-read',
        path: '/billing/claims/settings',
        permissions: ['claims.settings.manage', 'claims.read'],
        href: '/billing/claims',
        label: labels.claims,
      },
      {
        name: 'operations-read',
        path: '/operations/reminder-settings',
        permissions: ['operations.reminder_settings.manage', 'operations.read'],
        href: '/operations/worklist',
        label: labels.operations,
      },
      {
        name: 'billing-parent',
        path: '/billing/claims/settings',
        permissions: ['claims.settings.manage', 'billing.read'],
        href: '/billing',
        label: labels.billing,
      },
      {
        name: 'hidden-admin',
        path: '/billing/settings',
        permissions: ['client.read'],
        href: undefined,
        label: labels.overview,
      },
      {
        name: 'unrelated-route',
        path: '/unmatched',
        permissions: ['billing.settings.manage'],
        href: undefined,
        label: labels.overview,
      },
    ];
    const surfaces = [
      { name: 'expanded', width: 1440, collapsed: false, mobile: false },
      { name: 'collapsed', width: 1440, collapsed: true, mobile: false },
      { name: 'mobile', width: 390, collapsed: false, mobile: true },
    ];
    // oxlint-disable no-await-in-loop -- Baseline/current screenshots share a page and real mobile drawer.
    for (const scenario of scenarios) {
      for (const surface of surfaces) {
        const props = JSON.parse(
          execFileSync(
            'bun',
            [
              resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
              JSON.stringify({
                locale,
                permissions: scenario.permissions,
                collapsed: surface.collapsed,
              }),
            ],
            { encoding: 'utf8' },
          ),
        ) as NavigationFixtureProps;
        for (const phase of process.env.SETTINGS_CONTEXT_BASELINE_BUNDLE
          ? ['before', 'after']
          : ['after']) {
          await page.context().clearCookies();
          await page.unrouteAll();
          await page.setViewportSize({ width: surface.width, height: 900 });
          await mount(page, {
            locale,
            path: scenario.path,
            props,
            ...(phase === 'before'
              ? { bundle: process.env.SETTINGS_CONTEXT_BASELINE_BUNDLE! }
              : {}),
          });
          const changed = phase === 'before' && scenario.changed;
          const href = changed ? undefined : scenario.href;
          const context = changed ? labels.overview : scenario.label;
          await selected(page, href, context);
          const topbar = await page
            .locator('#office-page-context')
            .evaluate((element) => element.closest('header')!.getBoundingClientRect().toJSON());
          if (surface.mobile) {
            await page.getByRole('button', { name: labels.openMenu }).click();
            await expect(page.locator('#office-mobile-navigation')).toBeVisible();
            await selected(page, href, context, true);
          }
          const nav = page.locator(
            surface.mobile ? '#office-mobile-navigation' : '#office-sidebar',
          );
          expect(
            await nav
              .locator('a[data-sidebar="menu-button"]')
              .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
          ).toEqual(props.groups.flatMap((group) => group.items.map((item) => item.href)));
          await expect(
            nav.locator('a[data-active="true"][data-sidebar="menu-button"]'),
          ).toHaveCount(href ? 1 : 0);
          if (!surface.mobile && surface.collapsed && href) {
            const item = nav.locator(`a[data-sidebar="menu-button"][href="${href}"]`);
            await expect(item).toHaveAttribute('aria-label', context);
            await expect(item).toHaveAttribute('title', context);
          }
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.evaluate(() => document.fonts.ready);
          const navigation = surface.mobile
            ? await page.getByRole('dialog').boundingBox()
            : await nav.boundingBox();
          const name = `${locale}-${scenario.name}-${surface.name}-${phase}`;
          await page.screenshot({ path: join(folder, `${name}.png`), animations: 'disabled' });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                route: scenario.path,
                permissions: scenario.permissions,
                surface: surface.name,
                phase,
                selectedHref: href ?? null,
                context,
                regions: { topbar, navigation },
                violations: axe.violations,
              },
              null,
              2,
            ),
          );
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });

  test(`settings fallback retains keyboard focus, collapse persistence and drawer interaction (${locale})`, async ({
    page,
  }) => {
    const permissions = [
      'billing.settings.manage',
      'claims.settings.manage',
      'operations.reminder_settings.manage',
    ];
    const paths = [
      '/billing/settings',
      '/billing/claims/settings',
      '/operations/reminder-settings',
    ];
    await page.setViewportSize({ width: 1440, height: 900 });
    await mount(page, { locale, path: paths[0]!, permissions });
    const sidebar = page.locator('#office-sidebar');
    const administration = sidebar.locator('a[data-sidebar="menu-button"][href="/administration"]');
    // oxlint-disable no-await-in-loop -- Exercise state transitions on the same shell.
    for (const path of paths) {
      await page.evaluate((route) => window.navigationHarness.navigate(route), path);
      await selected(page, '/administration', labels.administration);
      await sidebar.getByRole('link', { name: labels.brand, exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(administration).toBeFocused();
      expect(await administration.evaluate((element) => element.matches(':focus-visible'))).toBe(
        true,
      );
      await expect(administration).not.toHaveCSS('box-shadow', 'none');
      await page.keyboard.press('Control+b');
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await selected(page, '/administration', labels.administration);
      await expect(administration).toHaveAttribute('aria-label', labels.administration);
      await expect(administration).toHaveAttribute('title', labels.administration);
      await page.keyboard.press('Control+b');
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    }
    await page.keyboard.press('Control+b');
    expect(
      (await page.context().cookies()).find((cookie) => cookie.name === 'care-office-sidebar')
        ?.value,
    ).toBe('collapsed');
    await page.reload();
    await mount(page, { locale, path: paths[2]!, permissions });
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await selected(page, '/administration', labels.administration);
    await page.setViewportSize({ width: 390, height: 900 });
    const trigger = page.getByRole('button', { name: labels.openMenu });
    for (const path of paths) {
      await page.evaluate((route) => window.navigationHarness.navigate(route), path);
      await selected(page, '/administration', labels.administration);
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await selected(page, '/administration', labels.administration, true);
      await expectFocusTrap(page, dialog);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page
        .locator('#office-mobile-navigation a[data-sidebar="menu-button"][href="/administration"]')
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await selected(page, '/administration', labels.administration);
    }
    // oxlint-enable no-await-in-loop
  });
}

async function billingNavigationProps(locale: 'en' | 'de', permissions: string[]) {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
        JSON.stringify({ locale, permissions, billingNavigation: true, collapsed: false }),
      ],
      { encoding: 'utf8' },
    ),
  ) as NavigationFixtureProps;
}
const billingGrants = [
  'billing.read',
  'billing.payments.read',
  'claims.read',
  'claims.settings.manage',
  'billing.settings.manage',
];
for (const locale of ['en', 'de'] as const) {
  const messages = (locale === 'en' ? en : de).Billing;
  test(`real Billing client renderer before/after across routes, permissions and widths (${locale})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const folder =
      process.env.BILLING_NAV_SCREENSHOTS_DIR ?? testInfo.outputPath('billing-navigation');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      { name: 'overview', path: '/billing', current: '/billing', mask: 31 },
      { name: 'worklist', path: '/billing#worklist', current: '/billing', mask: 31 },
      {
        name: 'invoice-detail',
        path: '/billing/invoices/synthetic-id',
        current: '/billing/invoices',
        mask: 31,
      },
      {
        name: 'receivables',
        path: '/billing/receivables',
        current: '/billing/receivables',
        mask: 31,
      },
      { name: 'payments', path: '/billing/payments', current: '/billing/payments', mask: 31 },
      { name: 'claims', path: '/billing/claims', current: '/billing/claims', mask: 31 },
      {
        name: 'claims-settings',
        path: '/billing/claims/settings',
        current: '/billing/claims/settings',
        mask: 31,
      },
      {
        name: 'billing-settings',
        path: '/billing/settings',
        current: '/billing/settings',
        mask: 31,
      },
      {
        name: 'hidden-child',
        path: '/billing/claims/settings',
        current: '/billing/claims',
        mask: 4,
      },
      {
        name: 'hidden-parent-child',
        path: '/billing/claims/settings',
        current: undefined,
        mask: 1,
      },
      { name: 'unmatched', path: '/billing-other', current: undefined, mask: 31 },
    ];
    // oxlint-disable no-await-in-loop -- Compare original server HTML with the live renderer in one browser.
    for (const scenario of scenarios) {
      const props = await billingNavigationProps(
        locale,
        billingGrants.filter((_grant, index) => scenario.mask & (1 << index)),
      );
      for (const width of [1440, 390]) {
        let beforeGeometry: unknown;
        let primaryContext: string | null = null;
        for (const phase of process.env.BILLING_NAV_BASELINE_DIR
          ? ['before', 'after']
          : ['after']) {
          const navigation = props.billingNavigation!;
          const old =
            phase === 'before'
              ? (JSON.parse(
                  await readFile(
                    join(process.env.BILLING_NAV_BASELINE_DIR!, `${locale}-${scenario.mask}.json`),
                    'utf8',
                  ),
                ).billingNavigation as { html: string })
              : undefined;
          const phaseProps = {
            ...props,
            billingNavigation: { ...navigation, ...(old ? { beforeHtml: old.html } : {}) },
          };
          await page.context().clearCookies();
          await page.unrouteAll();
          await page.setViewportSize({ width, height: 900 });
          await mount(page, { locale, path: scenario.path, props: phaseProps });
          await page.evaluate(() => window.scrollTo(0, 0));
          const nav = page.getByRole('navigation', { name: messages.navigation, exact: true });
          const links = nav.getByRole('link');
          expect(
            await links.evaluateAll((elements) =>
              elements.map((element) => ({
                href: element.getAttribute('href'),
                label: element.textContent,
              })),
            ),
          ).toEqual(navigation.links);
          const current = nav.locator('a[aria-current="page"]');
          const expectedHref = phase === 'before' ? undefined : scenario.current;
          await expect(current).toHaveCount(expectedHref ? 1 : 0);
          if (expectedHref) {
            await expect(current).toHaveAttribute('href', expectedHref);
            await expect(current).toHaveAccessibleName(
              navigation.links.find((link) => link.href === expectedHref)!.label,
            );
            expect(
              await current.evaluate((element) => getComputedStyle(element).textDecorationLine),
            ).toContain('underline');
            expect(
              await current.evaluate((element) => getComputedStyle(element).backgroundColor),
            ).not.toBe('rgba(0, 0, 0, 0)');
          }
          const worklist = nav.locator('a[href="/billing#worklist"]');
          if (await worklist.count()) await expect(worklist).not.toHaveAttribute('aria-current');
          const context = await page.locator('#office-page-context').textContent();
          if (phase === 'before') primaryContext = context;
          else if (primaryContext) expect(context).toBe(primaryContext);
          const geometry = await links.evaluateAll((elements) =>
            elements.map((element) => {
              const { x, y, width: linkWidth, height } = element.getBoundingClientRect();
              return { x, y, width: linkWidth, height };
            }),
          );
          expect(geometry.every((box) => box.height >= 40)).toBe(true);
          if (phase === 'before') beforeGeometry = geometry;
          else if (beforeGeometry) expect(geometry).toEqual(beforeGeometry);
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.evaluate(() => document.fonts.ready);
          const name = `${locale}-${scenario.name}-${width}-${phase}`;
          await page.screenshot({ path: join(folder, `${name}.png`), animations: 'disabled' });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                route: scenario.path,
                width,
                phase,
                currentHref: expectedHref ?? null,
                links: navigation.links,
                geometry,
                primaryContext: context,
                navBounds: await nav.boundingBox(),
                violations: axe.violations,
              },
              null,
              2,
            ),
          );
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });

  test(`Billing client updates pathname/visibility, keeps focus order and ordinary native hash navigation (${locale})`, async ({
    page,
  }) => {
    const props = await billingNavigationProps(locale, billingGrants);
    await page.setViewportSize({ width: 390, height: 900 });
    await mount(page, { locale, path: '/billing', props });
    const nav = page.getByRole('navigation', { name: messages.navigation, exact: true });
    const links = nav.getByRole('link');
    await links.first().focus();
    await page.keyboard.press('Tab');
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(links.first()).toBeFocused();
    expect(
      await links.first().evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.matches(':focus-visible') &&
          (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
        );
      }),
    ).toBe(true);
    await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/billing');
    // oxlint-disable no-await-in-loop -- Observe derived state after each pathname transition.
    for (const [path, href] of [
      ['/billing/invoices/id', '/billing/invoices'],
      ['/billing/claims/id', '/billing/claims'],
      ['/billing/claims/settings', '/billing/claims/settings'],
      ['/billing/settings', '/billing/settings'],
      ['/unmatched', undefined],
      ['/billing/', '/billing'],
      ['/billing?view=synthetic', '/billing'],
    ]) {
      await page.evaluate((route) => window.navigationHarness.navigate(route!), path);
      const current = nav.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(href ? 1 : 0);
      if (href) await expect(current).toHaveAttribute('href', href);
    }
    // oxlint-enable no-await-in-loop
    await page.evaluate(() => window.navigationHarness.navigate('/billing/claims/settings'));
    const parent = await billingNavigationProps(locale, ['claims.read']);
    await page.evaluate((next) => window.navigationHarness.render(next), parent);
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/billing/claims');
    const hidden = await billingNavigationProps(locale, ['billing.read']);
    await page.evaluate((next) => window.navigationHarness.render(next), hidden);
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.locator('a[aria-current]')).toHaveCount(0);
    const empty = await billingNavigationProps(locale, []);
    await page.evaluate((next) => window.navigationHarness.render(next), empty);
    await expect(nav.getByRole('link')).toHaveCount(0);
    await page.evaluate((next) => window.navigationHarness.render(next), props);
    await page.evaluate(() => window.navigationHarness.navigate('/billing'));
    const worklist = nav.getByRole('link', { name: messages.billableServices, exact: true });
    await worklist.click();
    await expect(page).toHaveURL('http://navigation.test/billing#worklist');
    await expect(page.getByRole('heading', { name: 'Synthetic worklist' })).toBeInViewport();
    await expect(worklist).not.toHaveAttribute('aria-current');
    await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/billing');
  });
}

async function administrationNavigationProps(locale: 'en' | 'de', permissions: string[]) {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
        JSON.stringify({ locale, permissions, administrationNavigation: true, collapsed: false }),
      ],
      { encoding: 'utf8' },
    ),
  ) as NavigationFixtureProps;
}
const administrationGrants = [
  'tenant.members.read',
  'audit.read',
  'organization.read',
  'facility.read',
  'team.read',
  'employee.read',
  'documents.templates.manage',
  'billing.settings.manage',
  'claims.settings.manage',
  'operations.reminder_settings.manage',
];
for (const locale of ['en', 'de'] as const) {
  const labels = (locale === 'en' ? en : de).Navigation;
  test(`real Administration client groups before/after across routes and permissions (${locale})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const folder =
      process.env.ADMIN_NAV_SCREENSHOTS_DIR ?? testInfo.outputPath('administration-navigation');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      {
        name: 'overview',
        path: '/administration',
        current: '/administration',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'users',
        path: '/administration/users',
        current: '/administration/users',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'user-detail',
        path: '/administration/users/synthetic-id',
        current: '/administration/users',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'invitations',
        path: '/administration/users#invitations-title',
        current: '/administration/users',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'organization-detail',
        path: '/administration/organizations/synthetic-id',
        current: '/administration/organizations',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'facility-detail',
        path: '/administration/facilities/synthetic-id',
        current: '/administration/facilities',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'team-detail',
        path: '/administration/teams/synthetic-id',
        current: '/administration/teams',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'qualifications',
        path: '/administration/qualifications',
        current: '/administration/qualifications',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'audit',
        path: '/administration/audit',
        current: '/administration/audit',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'templates',
        path: '/administration/document-templates',
        current: '/administration/document-templates',
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'hidden-users',
        path: '/administration/users',
        current: undefined,
        baseline: 'organization',
        permissions: ['organization.read'],
      },
      {
        name: 'unmatched',
        path: '/administration/unknown',
        current: undefined,
        baseline: 'all',
        permissions: administrationGrants,
      },
      {
        name: 'settings-only',
        path: '/administration',
        current: '/administration',
        baseline: 'billing-settings',
        permissions: ['billing.settings.manage'],
      },
    ];
    // oxlint-disable no-await-in-loop -- Compare original layout HTML with the real live renderer on one page.
    for (const scenario of scenarios) {
      const props = await administrationNavigationProps(locale, scenario.permissions);
      const navigation = props.administrationNavigation!;
      for (const width of [1440, 390]) {
        let originalGeometry: unknown;
        let originalContext: string | null = null;
        for (const phase of process.env.ADMIN_NAV_BASELINE_DIR ? ['before', 'after'] : ['after']) {
          const old =
            phase === 'before'
              ? (JSON.parse(
                  await readFile(
                    join(
                      process.env.ADMIN_NAV_BASELINE_DIR!,
                      `${locale}-${scenario.baseline}.json`,
                    ),
                    'utf8',
                  ),
                ).administrationNavigation as { html: string })
              : undefined;
          await page.context().clearCookies();
          await page.unrouteAll();
          await page.setViewportSize({ width, height: 900 });
          await mount(page, {
            locale,
            path: scenario.path,
            props: {
              ...props,
              administrationNavigation: { ...navigation, ...(old ? { beforeHtml: old.html } : {}) },
            },
          });
          await page.evaluate(() => window.scrollTo(0, 0));
          const nav = page
            .getByRole('main')
            .getByRole('navigation', { name: labels.administration, exact: true });
          expect(
            await nav.locator(':scope > section').evaluateAll((sections) =>
              sections.map((section) => ({
                heading: section.querySelector('h2')!.textContent,
                links: [...section.querySelectorAll('a')].map((link) => ({
                  href: link.getAttribute('href'),
                  label: link.textContent,
                })),
              })),
            ),
          ).toEqual(
            navigation.groups.map((group) => ({ heading: group.label, links: group.links })),
          );
          const current = nav.locator('a[aria-current="page"]');
          const href = phase === 'before' ? undefined : scenario.current;
          await expect(current).toHaveCount(href ? 1 : 0);
          if (href) {
            await expect(current).toHaveAttribute('href', href);
            await expect(current).toHaveAccessibleName(
              navigation.groups.flatMap((group) => group.links).find((link) => link.href === href)!
                .label,
            );
            expect(
              await current.evaluate((element) => getComputedStyle(element).textDecorationLine),
            ).toContain('underline');
            expect(
              await current.evaluate((element) => getComputedStyle(element).backgroundColor),
            ).not.toBe('rgba(0, 0, 0, 0)');
          }
          const invitations = nav.locator('a[href="/administration/users#invitations-title"]');
          if (await invitations.count())
            await expect(invitations).not.toHaveAttribute('aria-current');
          const geometry = await nav.locator('section,h2,a').evaluateAll((elements) =>
            elements.map((element) => {
              const { x, y, width: elementWidth, height } = element.getBoundingClientRect();
              return { tag: element.tagName, x, y, width: elementWidth, height };
            }),
          );
          expect(geometry.filter((box) => box.tag === 'A').every((box) => box.height >= 40)).toBe(
            true,
          );
          const primaryContext = await page.locator('#office-page-context').textContent();
          if (phase === 'before') {
            originalGeometry = geometry;
            originalContext = primaryContext;
          } else if (originalGeometry) {
            expect(geometry).toEqual(originalGeometry);
            expect(primaryContext).toBe(originalContext);
          }
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.evaluate(() => document.fonts.ready);
          const name = `${locale}-${scenario.name}-${width}-${phase}`;
          await page.screenshot({ path: join(folder, `${name}.png`), animations: 'disabled' });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                route: scenario.path,
                width,
                phase,
                currentHref: href ?? null,
                groups: navigation.groups,
                geometry,
                primaryContext,
                navBounds: await nav.boundingBox(),
                violations: axe.violations,
              },
              null,
              2,
            ),
          );
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });

  test(`Administration client updates groups and path, preserves focus and native invitations jump (${locale})`, async ({
    page,
  }) => {
    const props = await administrationNavigationProps(locale, administrationGrants);
    await page.setViewportSize({ width: 390, height: 900 });
    await mount(page, { locale, path: '/administration', props });
    const nav = page
      .getByRole('main')
      .getByRole('navigation', { name: labels.administration, exact: true });
    const links = nav.getByRole('link');
    await links.first().focus();
    await page.keyboard.press('Tab');
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(links.first()).toBeFocused();
    expect(
      await links.first().evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.matches(':focus-visible') &&
          (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
        );
      }),
    ).toBe(true);
    // oxlint-disable no-await-in-loop -- Observe every transition in the same mounted renderer.
    for (const [path, href] of [
      ['/administration/users/id', '/administration/users'],
      ['/administration/organizations/id', '/administration/organizations'],
      ['/administration/facilities/id', '/administration/facilities'],
      ['/administration/teams/id', '/administration/teams'],
      ['/administration/audit', '/administration/audit'],
      ['/administration/unknown', undefined],
      ['/administration/', '/administration'],
      ['/administration?view=synthetic', '/administration'],
    ]) {
      await page.evaluate((route) => window.navigationHarness.navigate(route!), path);
      const current = nav.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(href ? 1 : 0);
      if (href) await expect(current).toHaveAttribute('href', href);
    }
    await page.evaluate(() => window.navigationHarness.navigate('/administration/users'));
    const hidden = await administrationNavigationProps(locale, ['organization.read']);
    await page.evaluate((next) => window.navigationHarness.render(next), hidden);
    await expect(nav.locator('section')).toHaveCount(2);
    await expect(nav.getByRole('link')).toHaveCount(2);
    await expect(nav.locator('a[aria-current]')).toHaveCount(0);
    const none = await administrationNavigationProps(locale, []);
    await page.evaluate((next) => window.navigationHarness.render(next), none);
    await expect(nav.locator('section')).toHaveCount(1);
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.locator('a[aria-current]')).toHaveCount(0);
    for (const phase of process.env.ADMIN_NAV_BASELINE_DIR ? ['before', 'after'] : ['after']) {
      const old =
        phase === 'before'
          ? (JSON.parse(
              await readFile(
                join(process.env.ADMIN_NAV_BASELINE_DIR!, `${locale}-all.json`),
                'utf8',
              ),
            ).administrationNavigation as { html: string })
          : undefined;
      await page.evaluate((next) => window.navigationHarness.render(next), {
        ...props,
        administrationNavigation: {
          ...props.administrationNavigation!,
          ...(old ? { beforeHtml: old.html } : {}),
        },
      });
      await page.evaluate(() => window.navigationHarness.navigate('/administration/users'));
      const invitations = nav.getByRole('link', { name: labels.invitations, exact: true });
      await invitations.click();
      await expect(page).toHaveURL('http://navigation.test/administration/users#invitations-title');
      await expect(page.getByRole('heading', { name: 'Synthetic invitations' })).toBeInViewport();
      await expect(invitations).not.toHaveAttribute('aria-current');
      if (phase === 'after')
        await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute(
          'href',
          '/administration/users',
        );
    }
    // oxlint-enable no-await-in-loop
    // The test preview mirrors segment unmounting; it does not keep this nav on Billing pages.
    await page.evaluate(() => window.navigationHarness.navigate('/administration'));
    await nav.getByRole('link', { name: labels.billingSettings, exact: true }).click();
    await expect(page).toHaveURL('http://navigation.test/billing/settings');
    await expect(nav).toHaveCount(0);
  });
}

async function newClientProps(locale: 'en' | 'de', permissions: string[]) {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
        JSON.stringify({ locale, permissions, newClient: true, collapsed: false }),
      ],
      { encoding: 'utf8' },
    ),
  ) as NavigationFixtureProps;
}
for (const locale of ['en', 'de'] as const) {
  const messages = locale === 'en' ? en : de;
  test(`actual New Client return controls before/after preserve geometry and permissions (${locale})`, async ({
    page,
  }, testInfo) => {
    const folder = process.env.NEW_CLIENT_SCREENSHOTS_DIR ?? testInfo.outputPath('new-client');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      { name: 'read', permissions: ['client.create', 'client.read'], read: true, baseline: 'read' },
      { name: 'create', permissions: ['client.create'], read: false, baseline: 'create' },
      {
        name: 'create-duplicate',
        permissions: ['client.create', 'client.create'],
        read: false,
        baseline: 'create',
      },
      {
        name: 'read-reordered',
        permissions: ['client.read', 'client.create'],
        read: true,
        baseline: 'reordered',
      },
    ];
    // oxlint-disable no-await-in-loop -- Ordered captures share the same real shell and RHF projection.
    for (const scenario of scenarios) {
      const props = await newClientProps(locale, scenario.permissions);
      for (const width of [1440, 390]) {
        let beforeGeometry: unknown;
        for (const phase of process.env.NEW_CLIENT_BASELINE_DIR ? ['before', 'after'] : ['after']) {
          const presentation =
            phase === 'before'
              ? JSON.parse(
                  await readFile(
                    join(
                      process.env.NEW_CLIENT_BASELINE_DIR!,
                      `${locale}-${scenario.baseline}.json`,
                    ),
                    'utf8',
                  ),
                ).newClient
              : props.newClient;
          await page.context().clearCookies();
          await page.unrouteAll();
          await page.setViewportSize({ width, height: 900 });
          await mount(page, {
            locale,
            path: '/clients/new',
            props: { ...props, newClient: presentation },
          });
          const main = page.getByRole('main');
          const header = main.locator('header');
          const form = main.locator('form');
          const cancel = form.getByRole('link', {
            name: messages.Common.actions.cancel,
            exact: true,
          });
          const hasEyebrowLink = phase === 'before' || scenario.read;
          await expect(header.getByRole('link')).toHaveCount(hasEyebrowLink ? 1 : 0);
          if (hasEyebrowLink) {
            await expect(header.getByRole('link')).toHaveAttribute('href', '/clients');
            await expect(header.getByRole('link')).toHaveAccessibleName(messages.Clients.title);
          } else {
            await expect(header.locator('p').first()).toHaveText(messages.Clients.title);
            await expect(header.locator('a,button,[role],[tabindex]')).toHaveCount(0);
          }
          await expect(header.getByRole('heading', { level: 1 })).toHaveText(
            messages.Clients.create,
          );
          await expect(header.locator('p').last()).toHaveText(messages.Clients.newDescription);
          const href = phase === 'before' || scenario.read ? '/clients' : '/';
          await expect(cancel).toHaveAttribute('href', href);
          await expect(cancel).toHaveAttribute('data-variant', 'secondary');
          await expect(cancel).not.toHaveAttribute('type', 'submit');
          await expect(
            form.getByRole('button', { name: messages.Clients.create, exact: true }),
          ).toHaveAttribute('type', 'submit');
          await expect(form.getByRole('link')).toHaveCount(1);
          await expect(form.locator('button[type="submit"]')).toHaveCount(1);
          const geometry = {
            header: await header.boundingBox(),
            form: await form.boundingBox(),
            cancel: await cancel.boundingBox(),
          };
          if (phase === 'before') beforeGeometry = geometry;
          else if (beforeGeometry) expect(geometry).toEqual(beforeGeometry);
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.evaluate(() => document.fonts.ready);
          const name = `${locale}-${scenario.name}-${width}-${phase}`;
          await page.screenshot({ path: join(folder, `${name}.png`), animations: 'disabled' });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                permissions: scenario.permissions,
                width,
                phase,
                href,
                hasEyebrowLink,
                geometry,
                violations: axe.violations,
              },
              null,
              2,
            ),
          );
          // Keyboard checks occur after capture so focus paint does not affect comparisons.
          const input = form.locator('#firstName');
          await input.focus();
          await page.keyboard.press('Tab');
          await expect(
            form.getByRole('button', { name: messages.Clients.create, exact: true }),
          ).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(cancel).toBeFocused();
          expect(
            await cancel.evaluate((element) => {
              const style = getComputedStyle(element);
              return (
                element.matches(':focus-visible') &&
                (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
              );
            }),
          ).toBe(true);
          if (hasEyebrowLink) {
            await header.getByRole('link').focus();
            await page.keyboard.press('Tab');
            await expect(input).toBeFocused();
          }
          expect(await page.evaluate(() => window.navigationHarness.newClientSubmissions)).toBe(0);
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });

  test(`real RHF guards both New Client Cancel destinations without submitting or changing tenant (${locale})`, async ({
    page,
  }) => {
    // oxlint-disable no-await-in-loop -- Observe clean, rejected and accepted navigation on one form at a time.
    for (const permissions of [['client.create', 'client.read'], ['client.create']]) {
      const props = await newClientProps(locale, permissions);
      const href = permissions.includes('client.read') ? '/clients' : '/';
      await page.context().clearCookies();
      await page
        .context()
        .addCookies([
          { name: 'care-tenant', value: 'synthetic-tenant', url: 'http://navigation.test' },
        ]);
      await page.unrouteAll();
      await mount(page, { locale, path: '/clients/new', props });
      const cancel = page
        .getByRole('main')
        .getByRole('link', { name: messages.Common.actions.cancel, exact: true });
      const unexpectedDialog = (dialog: import('@playwright/test').Dialog) => {
        void dialog.dismiss();
        throw new Error('Clean Cancel unexpectedly requested confirmation');
      };
      page.on('dialog', unexpectedDialog);
      await cancel.click();
      await expect(page).toHaveURL(`http://navigation.test${href}`);
      page.off('dialog', unexpectedDialog);
      expect(await page.evaluate(() => window.navigationHarness.newClientSubmissions)).toBe(0);
      await page.unrouteAll();
      await mount(page, { locale, path: '/clients/new', props });
      const field = page.locator('#firstName');
      await field.fill('Synthetic unsaved draft');
      const rejectedDialog = page.waitForEvent('dialog');
      const rejectedClick = cancel.click();
      const rejection = await rejectedDialog;
      expect(rejection.type()).toBe('confirm');
      expect(rejection.message()).toBe(messages.Common.formValidation.unsavedChanges);
      await rejection.dismiss();
      await rejectedClick;
      await expect(page).toHaveURL('http://navigation.test/clients/new');
      await expect(field).toHaveValue('Synthetic unsaved draft');
      expect(await page.evaluate(() => window.navigationHarness.newClientSubmissions)).toBe(0);
      const acceptedDialog = page.waitForEvent('dialog');
      await cancel.focus();
      const acceptedClick = page.keyboard.press('Enter');
      const acceptance = await acceptedDialog;
      expect(acceptance.type()).toBe('confirm');
      expect(acceptance.message()).toBe(messages.Common.formValidation.unsavedChanges);
      await acceptance.accept();
      await acceptedClick;
      await expect(page).toHaveURL(`http://navigation.test${href}`);
      await expect(page.getByRole('main').locator('form')).toHaveCount(0);
      expect(
        await page.evaluate(() => ({
          submissions: window.navigationHarness.newClientSubmissions,
          refreshes: window.navigationHarness.newClientRefreshes,
        })),
      ).toEqual({ submissions: 0, refreshes: 0 });
      expect(
        (await page.context().cookies()).find((cookie) => cookie.name === 'care-tenant')?.value,
      ).toBe('synthetic-tenant');
    }
    for (const permissions of [['client.read'], [], ['organization.read']]) {
      const denied = await newClientProps(locale, permissions);
      expect(denied.newClient).toEqual({
        redirect: '/clients?error=INSUFFICIENT_PERMISSION',
        calls: [],
        formCount: 0,
      });
    }
    // oxlint-enable no-await-in-loop
  });
}

async function newAdmissionProps(locale: 'en' | 'de', permissions: string[]) {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        resolve(import.meta.dirname, '../scripts/office-navigation.fixture.ts'),
        JSON.stringify({ locale, permissions, newAdmission: true, collapsed: false }),
      ],
      { encoding: 'utf8' },
    ),
  ) as NavigationFixtureProps;
}
for (const locale of ['en', 'de'] as const) {
  const messages = locale === 'en' ? en : de;
  test(`actual New Admission return controls before/after preserve geometry and permissions (${locale})`, async ({
    page,
  }, testInfo) => {
    const folder =
      process.env.NEW_ADMISSION_SCREENSHOTS_DIR ?? testInfo.outputPath('new-admission');
    await mkdir(folder, { recursive: true });
    const scenarios = [
      {
        name: 'read',
        permissions: ['onboarding.create', 'organization.read', 'onboarding.read'],
        read: true,
        baseline: 'read',
      },
      {
        name: 'create',
        permissions: ['onboarding.create', 'organization.read'],
        read: false,
        baseline: 'create',
      },
      {
        name: 'mixed-read',
        permissions: [
          'onboarding.create',
          'organization.read',
          'onboarding.read',
          'facility.read',
          'employee.read',
          'client.read',
        ],
        read: true,
        baseline: 'mixed-read',
      },
      {
        name: 'create-duplicate',
        permissions: [
          'onboarding.create',
          'organization.read',
          'onboarding.create',
          'organization.read',
        ],
        read: false,
        baseline: 'create',
      },
      {
        name: 'read-reordered',
        permissions: ['onboarding.read', 'onboarding.create', 'organization.read'],
        read: true,
        baseline: 'reordered-read',
      },
    ];
    // oxlint-disable no-await-in-loop -- Ordered captures share the same real shell and RHF projection.
    for (const scenario of scenarios) {
      const props = await newAdmissionProps(locale, scenario.permissions);
      for (const width of [1440, 390]) {
        let beforeGeometry: unknown;
        let beforeOverflow: number | undefined;
        for (const phase of process.env.NEW_ADMISSION_BASELINE_DIR
          ? ['before', 'after']
          : ['after']) {
          const presentation =
            phase === 'before'
              ? JSON.parse(
                  await readFile(
                    join(
                      process.env.NEW_ADMISSION_BASELINE_DIR!,
                      `${locale}-${scenario.baseline}.json`,
                    ),
                    'utf8',
                  ),
                ).newAdmission
              : props.newAdmission;
          await page.context().clearCookies();
          await page.unrouteAll();
          await page.setViewportSize({ width, height: 900 });
          await mount(page, {
            locale,
            path: '/admissions/new',
            props: { ...props, newAdmission: presentation },
          });
          const main = page.getByRole('main');
          const header = main.locator('header');
          const form = main.locator('form');
          const cancel = form.getByRole('link', {
            name: messages.Common.actions.cancel,
            exact: true,
          });
          const hasEyebrowLink = phase === 'before' || scenario.read;
          await expect(header.getByRole('link')).toHaveCount(hasEyebrowLink ? 1 : 0);
          if (hasEyebrowLink) {
            await expect(header.getByRole('link')).toHaveAttribute('href', '/admissions');
            await expect(header.getByRole('link')).toHaveAccessibleName(messages.Onboarding.title);
          } else {
            await expect(header.locator('p').first()).toHaveText(messages.Onboarding.title);
            await expect(header.locator('a,button,[role],[tabindex]')).toHaveCount(0);
          }
          await expect(header.getByRole('heading', { level: 1 })).toHaveText(
            messages.Onboarding.createTitle,
          );
          const href = phase === 'before' || scenario.read ? '/admissions' : '/';
          await expect(cancel).toHaveAttribute('href', href);
          await expect(cancel).toHaveAttribute('data-variant', 'secondary');
          await expect(cancel).not.toHaveAttribute('type', 'submit');
          await expect(
            form.getByRole('button', { name: messages.Onboarding.newCase, exact: true }),
          ).toHaveAttribute('type', 'submit');
          await expect(form.getByRole('link')).toHaveCount(1);
          await expect(form.locator('button[type="submit"]')).toHaveCount(1);
          const geometry = {
            header: await header.boundingBox(),
            form: await form.boundingBox(),
            cancel: await cancel.boundingBox(),
          };
          if (phase === 'before') beforeGeometry = geometry;
          else if (beforeGeometry) expect(geometry).toEqual(beforeGeometry);
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
          const overflow = await page.evaluate(() =>
            Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          );
          if (phase === 'before') beforeOverflow = overflow;
          else if (beforeOverflow !== undefined) expect(overflow).toBe(beforeOverflow);
          // The unchanged German action labels already exceed the mobile row.
          // Preserve the baseline and forbid any new overflow from return controls.
          if (locale !== 'de' || width !== 390) expect(overflow).toBe(0);
          await page.evaluate(() => document.fonts.ready);
          const name = `${locale}-${scenario.name}-${width}-${phase}`;
          await page.screenshot({ path: join(folder, `${name}.png`), animations: 'disabled' });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                locale,
                permissions: scenario.permissions,
                width,
                phase,
                href,
                hasEyebrowLink,
                geometry,
                overflow,
                violations: axe.violations,
              },
              null,
              2,
            ),
          );
          // Keyboard checks occur after capture so focus paint does not affect comparisons.
          const input = form.locator('input[name=firstName]');
          await input.focus();
          await page.keyboard.press('Tab');
          await expect(
            form.getByRole('button', { name: messages.Onboarding.newCase, exact: true }),
          ).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(cancel).toBeFocused();
          expect(
            await cancel.evaluate((element) => {
              const style = getComputedStyle(element);
              return (
                element.matches(':focus-visible') &&
                (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
              );
            }),
          ).toBe(true);
          if (hasEyebrowLink) {
            await header.getByRole('link').focus();
            await page.keyboard.press('Tab');
            await expect(input).toBeFocused();
          }
          expect(await page.evaluate(() => window.navigationHarness.newClientSubmissions)).toBe(0);
        }
      }
    }
    // oxlint-enable no-await-in-loop
  });

  test(`real RHF guards both New Admission Cancel destinations without submitting or changing tenant (${locale})`, async ({
    page,
  }) => {
    // oxlint-disable no-await-in-loop -- Observe clean, rejected and accepted navigation on one form at a time.
    for (const permissions of [
      ['onboarding.create', 'organization.read', 'onboarding.read'],
      ['onboarding.create', 'organization.read'],
    ]) {
      const props = await newAdmissionProps(locale, permissions);
      const href = permissions.includes('onboarding.read') ? '/admissions' : '/';
      await page.context().clearCookies();
      await page
        .context()
        .addCookies([
          { name: 'care-tenant', value: 'synthetic-tenant', url: 'http://navigation.test' },
        ]);
      await page.unrouteAll();
      await mount(page, { locale, path: '/admissions/new', props });
      const cancel = page
        .getByRole('main')
        .getByRole('link', { name: messages.Common.actions.cancel, exact: true });
      const unexpectedDialog = (dialog: import('@playwright/test').Dialog) => {
        void dialog.dismiss();
        throw new Error('Clean Cancel unexpectedly requested confirmation');
      };
      page.on('dialog', unexpectedDialog);
      await cancel.click();
      await expect(page).toHaveURL(`http://navigation.test${href}`);
      page.off('dialog', unexpectedDialog);
      expect(await page.evaluate(() => window.navigationHarness.newClientSubmissions)).toBe(0);
      await page.unrouteAll();
      await mount(page, { locale, path: '/admissions/new', props });
      const field = page.locator('input[name=firstName]');
      await field.fill('Synthetic unsaved draft');
      const rejectedDialog = page.waitForEvent('dialog');
      const rejectedClick = cancel.click();
      const rejection = await rejectedDialog;
      expect(rejection.type()).toBe('confirm');
      expect(rejection.message()).toBe(messages.Common.formValidation.unsavedChanges);
      await rejection.dismiss();
      await rejectedClick;
      await expect(page).toHaveURL('http://navigation.test/admissions/new');
      await expect(field).toHaveValue('Synthetic unsaved draft');
      expect(await page.evaluate(() => window.navigationHarness.newClientSubmissions)).toBe(0);
      const acceptedDialog = page.waitForEvent('dialog');
      await cancel.focus();
      const acceptedClick = page.keyboard.press('Enter');
      const acceptance = await acceptedDialog;
      expect(acceptance.type()).toBe('confirm');
      expect(acceptance.message()).toBe(messages.Common.formValidation.unsavedChanges);
      await acceptance.accept();
      await acceptedClick;
      await expect(page).toHaveURL(`http://navigation.test${href}`);
      await expect(page.getByRole('main').locator('form')).toHaveCount(0);
      expect(
        await page.evaluate(() => ({
          submissions: window.navigationHarness.newClientSubmissions,
          refreshes: window.navigationHarness.newClientRefreshes,
        })),
      ).toEqual({ submissions: 0, refreshes: 0 });
      expect(
        (await page.context().cookies()).find((cookie) => cookie.name === 'care-tenant')?.value,
      ).toBe('synthetic-tenant');
    }
    for (const permissions of [
      ['onboarding.read', 'organization.read'],
      ['onboarding.create', 'onboarding.read'],
      ['onboarding.create'],
      ['organization.read'],
      ['onboarding.read'],
      [],
      ['billing.read'],
    ]) {
      const denied = await newAdmissionProps(locale, permissions);
      expect(denied.newAdmission).toEqual({
        deniedHtml: `<p role="alert" class="rounded-md border bg-card p-5">${messages.Onboarding.noAccess}</p>`,
        redirects: [],
        calls: [],
        formCount: 0,
        headerCount: 0,
        cancelCount: 0,
        actionExposed: false,
      });
    }
    // oxlint-enable no-await-in-loop
  });
}
