import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import de from '../messages/de.json';
import en from '../messages/en.json';
import { getActiveOfficeNavigationItem } from '../src/lib/office-navigation';
import type { NavigationFixtureProps } from '../e2e/support/office-navigation-app';

const grants = [
  'operations.read',
  'schedule.read',
  'client.read',
  'employee.read',
  'billing.read',
  'claims.read',
];
async function layout(locale: 'en' | 'de', permissions: string[], landing = false) {
  const child = Bun.spawn(
    [
      Bun.which('bun')!,
      resolve(import.meta.dir, 'office-navigation.fixture.ts'),
      JSON.stringify({ locale, permissions, landing }),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(errors);
  return JSON.parse(output) as NavigationFixtureProps;
}
for (const locale of ['en', 'de'] as const) {
  test(`real Office layout filters Scheduling permission before localized active-item selection (${locale})`, async () => {
    const messages = locale === 'en' ? en : de;
    const [allowed, hidden, reordered] = await Promise.all([
      layout(locale, grants),
      layout(
        locale,
        grants.filter((grant) => grant !== 'schedule.read'),
      ),
      layout(locale, [...grants].reverse()),
    ]);
    expect(allowed.groups.map((group) => group.id)).toEqual([
      'workspace',
      'servicesFinance',
      'management',
    ]);
    expect(allowed.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      'overview',
      'operations',
      'planning',
      'clients',
      'employees',
      'billing',
      'claims',
      'administration',
    ]);
    expect(reordered.groups).toEqual(allowed.groups);
    expect(hidden.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      'overview',
      'operations',
      'clients',
      'employees',
      'billing',
      'claims',
      'administration',
    ]);
    expect(getActiveOfficeNavigationItem(allowed.groups, '/visits/id')?.label).toBe(
      messages.Navigation.planning,
    );
    expect(getActiveOfficeNavigationItem(hidden.groups, '/visits/id')).toBeUndefined();
    expect(hidden.labels.overview).toBe(messages.Navigation.overview);
    expect(getActiveOfficeNavigationItem(allowed.groups, '/billing/claims/id')?.label).toBe(
      messages.Navigation.claims,
    );
  });
}

const settings = [
  ['billing.settings.manage', '/billing/settings'],
  ['claims.settings.manage', '/billing/claims/settings'],
  ['operations.reminder_settings.manage', '/operations/reminder-settings'],
] as const;
const existingAdministration = [
  ['tenant.members.read', '/administration/users'],
  ['organization.read', '/administration/organizations'],
  ['facility.read', '/administration/facilities'],
  ['team.read', '/administration/teams'],
  ['employee.read', '/administration/qualifications'],
  ['documents.templates.manage', '/administration/document-templates'],
  ['audit.read', null],
] as const;
function entryPoints(html: string) {
  const section = html.match(
    /<section aria-labelledby="admin-entrypoints-title"[\s\S]*?<\/section>/,
  )?.[0];
  if (!section) throw new Error('Administration entry-points section missing');
  return [...section.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}
for (const locale of ['en', 'de'] as const) {
  const messages = locale === 'en' ? en : de;
  const admin = {
    id: 'administration',
    label: messages.Navigation.administration,
    href: '/administration',
  };
  test(`settings capabilities reveal only the existing Administration item and individually filtered entry points (${locale})`, async () => {
    await Promise.all(
      Array.from({ length: 8 }, async (_, mask) => {
        const permitted = settings.filter((_setting, index) => mask & (1 << index));
        const permissions = permitted.map(([permission]) => permission);
        const result = await layout(locale, permissions, true);
        expect(result.groups).toEqual(
          mask ? [{ id: 'management', label: messages.Navigation.management, items: [admin] }] : [],
        );
        expect(entryPoints(result.landingHtml!)).toEqual(permitted.map(([, href]) => href));
        const hrefs = [...result.landingHtml!.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
        expect(
          hrefs.every(
            (href) =>
              href === '/administration' || permitted.some(([, allowed]) => allowed === href),
          ),
        ).toBe(true);
        expect(getActiveOfficeNavigationItem(result.groups, '/administration')).toEqual(
          mask ? admin : undefined,
        );
      }),
    );
  });

  test(`all existing Administration gates including audit remain intact; unrelated grants stay hidden (${locale})`, async () => {
    await Promise.all(
      existingAdministration.map(async ([permission, href]) => {
        const result = await layout(locale, [permission], true);
        const items = result.groups.flatMap((group) => group.items);
        expect(items.map((item) => item.id)).toEqual(
          permission === 'employee.read' ? ['employees', 'administration'] : ['administration'],
        );
        expect(items.filter((item) => item.id === 'administration')).toEqual([admin]);
        expect(result.groups.find((group) => group.id === 'management')?.items).toEqual([admin]);
        expect(entryPoints(result.landingHtml!)).toEqual(href ? [href] : []);
        if (permission === 'audit.read')
          expect(result.landingHtml).toContain('href="/administration/audit"');
      }),
    );
    await Promise.all(
      ['client.read', 'billing.read', 'claims.read', 'operations.read', 'schedule.read'].map(
        async (permission) => {
          const result = await layout(locale, [permission], true);
          expect(
            result.groups
              .flatMap((group) => group.items)
              .some((item) => item.id === 'administration'),
          ).toBe(false);
          expect(entryPoints(result.landingHtml!)).toEqual([]);
        },
      ),
    );
  });

  test(`mixed, reordered and repeated grants preserve hierarchy and produce one Administration entry (${locale})`, async () => {
    const permissions = [
      ...grants,
      ...existingAdministration.map(([permission]) => permission),
      ...settings.map(([permission]) => permission),
    ];
    const [baseline, reordered, repeated] = await Promise.all([
      layout(locale, permissions, true),
      layout(locale, [...permissions].reverse(), true),
      layout(locale, [...permissions, ...permissions], true),
    ]);
    expect(reordered).toEqual(baseline);
    expect(repeated).toEqual(baseline);
    expect(baseline.groups.map((group) => group.id)).toEqual([
      'workspace',
      'servicesFinance',
      'management',
    ]);
    expect(baseline.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      'overview',
      'operations',
      'planning',
      'clients',
      'employees',
      'billing',
      'claims',
      'administration',
    ]);
    expect(entryPoints(baseline.landingHtml!)).toEqual([
      ...existingAdministration.filter(([, href]) => href).map(([, href]) => href),
      ...settings.map(([, href]) => href),
    ]);
    expect(
      baseline.groups
        .flatMap((group) => group.items)
        .filter((item) => item.id === 'administration'),
    ).toEqual([admin]);
  });
}

// The fixture executes the real settings pages and renders their real PageHeader.
type SettingsReport = {
  headerHtml: string;
  alertsHtml: string;
  calls: Array<{ path: string; options: unknown }>;
  employeeCalls: string[][];
  forms: number;
  sections: number;
  deniedHtml: string | null;
  billing?: {
    noteHtml: string;
    statusHtml: string;
    organizationHtml: string;
    forms: Array<{ saveAction: boolean; tree: unknown }>;
  };
};
async function settingsPage(
  locale: 'en' | 'de',
  settingsPageKind: 'claims' | 'reminders' | 'billing',
  permissions: string[],
  query: Record<string, string> = {},
  apiError = false,
  populated = false,
) {
  const child = Bun.spawn(
    [
      Bun.which('bun')!,
      resolve(import.meta.dir, 'office-navigation.fixture.ts'),
      JSON.stringify({
        locale,
        settings: settingsPageKind,
        permissions,
        query,
        apiError,
        populated,
      }),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(errors);
  return (JSON.parse(output) as { settingsReport: SettingsReport }).settingsReport;
}
const organizationId = '11111111-1111-4111-8111-111111111111';
for (const locale of ['en', 'de'] as const) {
  const messages = locale === 'en' ? en : de;
  test(`actual Claims settings header, alerts and data gates across permission combinations (${locale})`, async () => {
    const cases = [
      {
        grants: ['claims.read', 'claims.settings.manage'],
        href: '/billing/claims',
        label: messages.Billing.claims,
        read: true,
        manage: true,
      },
      {
        grants: ['claims.read'],
        href: '/billing/claims',
        label: messages.Billing.claims,
        read: true,
        manage: false,
      },
      {
        grants: ['claims.settings.manage'],
        href: '/administration',
        label: messages.Navigation.administration,
        read: false,
        manage: true,
      },
      { grants: [], href: null, label: messages.Billing.claims, read: false, manage: false },
      {
        grants: ['client.read'],
        href: null,
        label: messages.Billing.claims,
        read: false,
        manage: false,
      },
    ];
    await Promise.all(
      cases.map(async (scenario) => {
        const result = await settingsPage(locale, 'claims', scenario.grants, { organizationId });
        expect([...result.headerHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(
          scenario.href ? [scenario.href] : [],
        );
        expect(result.headerHtml).toContain(
          scenario.href ? `>${scenario.label}</a>` : `>${scenario.label}</p>`,
        );
        expect(result.headerHtml).not.toMatch(/tabindex|role=|<button/);
        expect(result.alertsHtml.includes(messages.Billing.noClaimsPermission)).toBe(
          !scenario.read,
        );
        expect(result.alertsHtml.includes(messages.Billing.noClaimsSettingsPermission)).toBe(
          !scenario.manage,
        );
        expect((result.alertsHtml.match(/role="alert"/g) ?? []).length).toBe(
          Number(!scenario.read) + Number(!scenario.manage),
        );
        expect(result.calls.map((call) => call.path)).toEqual(
          scenario.read
            ? [
                '/api/v1/organizations/{id}',
                '/api/v1/billing/payers',
                '/api/v1/billing/payer-directory/profiles',
              ]
            : [],
        );
        for (const call of result.calls)
          expect(call.options).toMatchObject({
            params: { header: { 'X-Tenant-Id': 'synthetic-tenant' } },
          });
        expect(result.sections).toBe(scenario.read ? 1 : 0);
        expect(result.forms).toBe(scenario.read ? 2 : 1);
        const repeated = await settingsPage(
          locale,
          'claims',
          [...scenario.grants].reverse().concat(scenario.grants),
          { organizationId },
        );
        expect(repeated).toEqual(result);
        const empty = await settingsPage(locale, 'claims', scenario.grants);
        expect(empty.calls).toEqual([]);
        expect(empty.sections).toBe(0);
      }),
    );
    const failed = await settingsPage(
      locale,
      'claims',
      ['claims.read', 'claims.settings.manage'],
      { organizationId },
      true,
    );
    expect(failed.calls.map((call) => call.path)).toEqual(['/api/v1/organizations/{id}']);
    expect(failed.sections).toBe(0);
    expect(failed.alertsHtml).toContain('role="alert"');
  });

  test(`actual Reminder settings header and unchanged early denial/data access (${locale})`, async () => {
    await Promise.all(
      [
        ['operations.read', 'operations.reminder_settings.manage'],
        ['operations.reminder_settings.manage'],
        ['operations.read'],
        [],
        ['client.read'],
      ].map(async (permissionSet) => {
        const result = await settingsPage(locale, 'reminders', permissionSet, { organizationId });
        const allowed = permissionSet.includes('operations.reminder_settings.manage');
        if (allowed) {
          const href = permissionSet.includes('operations.read')
            ? '/operations'
            : '/administration';
          const label = permissionSet.includes('operations.read')
            ? messages.Operations.dashboardTitle
            : messages.Navigation.administration;
          expect(
            [...result.headerHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
          ).toEqual([href]);
          expect(result.headerHtml).toContain(`>${label}</a>`);
          expect(result.headerHtml).toContain('data-variant="secondary"');
          expect(result.headerHtml).not.toContain('<button');
          expect(result.calls).toEqual([
            {
              path: '/api/v1/operations/reminder-settings',
              options: {
                params: {
                  query: { organizationId },
                  header: { 'X-Tenant-Id': 'synthetic-tenant' },
                },
              },
            },
          ]);
          expect(result.employeeCalls).toEqual([[]]);
          expect(result.forms).toBe(1);
          expect(result.deniedHtml).toBeNull();
        } else {
          expect(result.deniedHtml).toBe(
            `<p role="alert" class="rounded-md border bg-card p-5">${messages.Operations.noAccess}</p>`,
          );
          expect(result.headerHtml).toBe('');
          expect(result.calls).toEqual([]);
          expect(result.employeeCalls).toEqual([]);
          expect(result.forms).toBe(0);
          expect(result.sections).toBe(0);
        }
        expect(
          await settingsPage(
            locale,
            'reminders',
            [...permissionSet].reverse().concat(permissionSet),
            {
              organizationId,
            },
          ),
        ).toEqual(result);
        const empty = await settingsPage(locale, 'reminders', permissionSet);
        expect(empty.calls).toEqual([]);
      }),
    );
    const failed = await settingsPage(
      locale,
      'reminders',
      ['operations.reminder_settings.manage'],
      { organizationId },
      true,
    );
    expect(failed.alertsHtml).toContain(messages.Operations.loadFailed);
    expect(failed.forms).toBe(1);
  });
}

for (const locale of ['en', 'de'] as const) {
  const messages = locale === 'en' ? en : de;
  test(`actual Billing settings organization note uses organization read independently of billing management (${locale})`, async () => {
    const cases = [
      { permissions: ['billing.settings.manage', 'organization.read'], read: true, manage: true },
      { permissions: ['billing.settings.manage'], read: false, manage: true },
      { permissions: ['organization.read'], read: true, manage: false },
      { permissions: [], read: false, manage: false },
      { permissions: ['client.read'], read: false, manage: false },
      {
        permissions: [
          'billing.settings.manage',
          'organization.read',
          'organization.read',
          'billing.settings.manage',
        ],
        read: true,
        manage: true,
      },
      {
        permissions: ['client.read', 'organization.read', 'claims.read', 'billing.settings.manage'],
        read: true,
        manage: true,
      },
    ];
    await Promise.all(
      cases.map(async (scenario) => {
        const results = await Promise.all([
          settingsPage(locale, 'billing', scenario.permissions),
          settingsPage(locale, 'billing', scenario.permissions, { updated: 'saved' }, false, true),
          settingsPage(locale, 'billing', scenario.permissions, {}, true, true),
          settingsPage(
            locale,
            'billing',
            scenario.permissions,
            { error: 'FORBIDDEN' },
            false,
            true,
          ),
        ]);
        const expectedNote = `<p class="rounded-md border border-primary/20 bg-accent p-3 text-sm text-primary">${messages.Billing.organizationAddressNote} ${scenario.read ? `<a class="font-medium underline" href="/administration/organizations">${messages.Billing.manageOrganizations}</a>` : messages.Billing.manageOrganizations}</p>`;
        for (const result of results) {
          expect(result.billing!.noteHtml).toBe(expectedNote);
          expect(result.calls).toEqual([
            {
              path: '/api/v1/billing/settings',
              options: { params: { header: { 'X-Tenant-Id': 'synthetic-tenant' } } },
            },
          ]);
          expect(result.employeeCalls).toEqual([]);
          expect(result.headerHtml).toContain(messages.Billing.settings);
          expect(result.billing!.noteHtml).not.toMatch(/tabindex|role=|<button/);
          if (!scenario.read)
            expect(result.billing!.noteHtml).not.toMatch(/<a|underline|font-medium|cursor/);
        }
        const [empty, populated, failed, queryError] = results;
        expect(empty!.billing!.organizationHtml).toContain(messages.Billing.noOrganizations);
        expect(empty!.billing!.forms).toEqual([]);
        expect(empty!.sections).toBe(0);
        expect(empty!.billing!.statusHtml).toBe('');
        expect(populated!.billing!.organizationHtml).toContain('Synthetic organization');
        expect(populated!.sections).toBe(1);
        expect(populated!.billing!.forms).toHaveLength(scenario.manage ? 1 : 0);
        expect(
          populated!.billing!.organizationHtml.includes(messages.Billing.noSettingsPermission),
        ).toBe(!scenario.manage);
        if (scenario.manage) {
          expect(populated!.billing!.forms[0]!.saveAction).toBe(true);
          expect(populated!.billing!.forms[0]!.tree).toMatchObject({
            props: {
              children: expect.arrayContaining([
                expect.objectContaining({
                  type: 'input',
                  props: { type: 'hidden', name: 'organizationId', value: organizationId },
                }),
                expect.objectContaining({
                  type: 'input',
                  props: { type: 'hidden', name: 'expectedVersion', value: 3 },
                }),
                expect.objectContaining({
                  type: 'Field',
                  props: expect.objectContaining({
                    name: 'taxNumber',
                    defaultValue: 'synthetic-tax',
                  }),
                }),
              ]),
            },
          });
        }
        expect(populated!.billing!.statusHtml).toContain(messages.Billing.billingProfileSaved);
        expect(populated!.billing!.statusHtml).toContain('role="status"');
        expect(populated!.alertsHtml).toBe('');
        expect(failed!.alertsHtml).toContain('role="alert"');
        expect(failed!.billing!.organizationHtml).toContain(messages.Billing.noOrganizations);
        expect(failed!.billing!.forms).toEqual([]);
        expect(failed!.sections).toBe(0);
        expect(queryError!.alertsHtml).toBe(failed!.alertsHtml);
        expect(queryError!.billing!.forms).toEqual(populated!.billing!.forms);
        const reordered = await settingsPage(
          locale,
          'billing',
          [...scenario.permissions].reverse(),
          { updated: 'saved' },
          false,
          true,
        );
        expect(reordered).toEqual(populated!);
      }),
    );
  });
}

for (const locale of ['en', 'de'] as const) {
  const labels = (locale === 'en' ? en : de).Navigation;
  test(`actual Office layout supplies unchanged visible items for settings fallback and normal owners (${locale})`, async () => {
    const routes = [
      {
        manage: 'billing.settings.manage',
        read: 'billing.read',
        path: '/billing/settings',
        owner: 'billing',
      },
      {
        manage: 'claims.settings.manage',
        read: 'claims.read',
        path: '/billing/claims/settings',
        owner: 'claims',
      },
      {
        manage: 'operations.reminder_settings.manage',
        read: 'operations.read',
        path: '/operations/reminder-settings',
        owner: 'operations',
      },
    ];
    await Promise.all(
      routes.map(async (route) => {
        const only = await layout(locale, [route.manage]);
        expect(only.groups).toEqual([
          {
            id: 'management',
            label: labels.management,
            items: [
              { id: 'administration', label: labels.administration, href: '/administration' },
            ],
          },
        ]);
        const original = structuredClone(only.groups);
        const admin = only.groups[0]!.items[0]!;
        for (const suffix of ['', '/', '?returnTo=%2Funrelated', '#settings'])
          expect(getActiveOfficeNavigationItem(only.groups, route.path + suffix)).toBe(admin);
        expect(only.groups).toEqual(original);
        const allowed = await layout(locale, [route.manage, route.read]);
        expect(allowed.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual(
          route.owner === 'operations'
            ? ['overview', 'operations', 'administration']
            : [route.owner, 'administration'],
        );
        expect(getActiveOfficeNavigationItem(allowed.groups, route.path)).toBe(
          allowed.groups.flatMap((group) => group.items).find((item) => item.id === route.owner)!,
        );
        expect(await layout(locale, [route.manage, route.manage])).toEqual(only);
        expect(await layout(locale, [route.read, route.manage])).toEqual(allowed);
      }),
    );
    const parent = await layout(locale, ['billing.read', 'claims.settings.manage']);
    expect(parent.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      'billing',
      'administration',
    ]);
    expect(getActiveOfficeNavigationItem(parent.groups, '/billing/claims/settings')).toBe(
      parent.groups[0]!.items[0]!,
    );
    const mixedPermissions = [
      'client.read',
      ...routes.flatMap((route) => [route.manage, route.read]),
    ];
    const [mixed, reordered, repeated] = await Promise.all([
      layout(locale, mixedPermissions),
      layout(locale, [...mixedPermissions].reverse()),
      layout(locale, [...mixedPermissions, ...mixedPermissions]),
    ]);
    expect(mixed.groups.map((group) => group.id)).toEqual([
      'workspace',
      'servicesFinance',
      'management',
    ]);
    expect(mixed.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      'overview',
      'operations',
      'clients',
      'billing',
      'claims',
      'administration',
    ]);
    expect(reordered).toEqual(mixed);
    expect(repeated).toEqual(mixed);
    for (const route of routes)
      expect(getActiveOfficeNavigationItem(mixed.groups, route.path)).toBe(
        mixed.groups.flatMap((group) => group.items).find((item) => item.id === route.owner)!,
      );
    const unrelated = await layout(locale, ['client.read']);
    const none = await layout(locale, []);
    expect(unrelated.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      'clients',
    ]);
    expect(none.groups).toEqual([]);
    for (const route of routes) {
      expect(getActiveOfficeNavigationItem(unrelated.groups, route.path)).toBeUndefined();
      expect(getActiveOfficeNavigationItem(none.groups, route.path)).toBeUndefined();
    }
  });
}
