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
