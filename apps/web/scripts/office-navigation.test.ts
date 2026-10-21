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
async function layout(locale: 'en' | 'de', permissions: string[]) {
  const child = Bun.spawn(
    [
      Bun.which('bun')!,
      resolve(import.meta.dir, 'office-navigation.fixture.ts'),
      JSON.stringify({ locale, permissions }),
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
