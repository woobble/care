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
