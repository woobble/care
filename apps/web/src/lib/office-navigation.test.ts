import { expect, test } from 'bun:test';

import { getActiveOfficeNavigationItem } from './office-navigation';

const items = [
  { id: 'overview', href: '/operations' },
  { id: 'operations', href: '/operations/worklist' },
  { id: 'planning', href: '/planning' },
  { id: 'clients', href: '/clients' },
  { id: 'employees', href: '/employees' },
  { id: 'billing', href: '/billing' },
  { id: 'claims', href: '/billing/claims' },
];
const groups = [{ items }];

test('preserves existing exact, nested, Operations and longest-href selection', () => {
  const cases = [
    ['/operations', 'overview'],
    ['/operations/', 'operations'],
    ['/operations/tasks/id', 'operations'],
    ['/operations/worklist', 'operations'],
    ['/planning', 'planning'],
    ['/planning/nested', 'planning'],
    ['/clients', 'clients'],
    ['/clients/id/benefits', 'clients'],
    ['/employees/id', 'employees'],
    ['/billing/receivables', 'billing'],
    ['/billing/claims', 'claims'],
    ['/billing/claims/id', 'claims'],
  ];
  for (const [pathname, id] of cases)
    expect(getActiveOfficeNavigationItem(groups, pathname!)?.id).toBe(id);
  expect(
    getActiveOfficeNavigationItem([{ items: [...items].reverse() }], '/billing/claims/id')?.id,
  ).toBe('claims');
});

test('does not claim lookalike/unmatched paths and never creates items', () => {
  for (const pathname of [
    '/planning-other',
    '/operations-other',
    '/clients-other',
    '/care/today',
    '/unmatched',
    '/visits',
  ])
    expect(getActiveOfficeNavigationItem(groups, pathname)).toBeUndefined();
  expect(getActiveOfficeNavigationItem([], '/planning')).toBeUndefined();
  expect(
    getActiveOfficeNavigationItem(
      [{ items: items.filter((item) => item.id !== 'planning') }],
      '/planning',
    ),
  ).toBeUndefined();
});

test('claims exactly one visit detail segment for visible Planning, independent of query/fragment', () => {
  for (const pathname of [
    '/visits/synthetic-id',
    '/visits/12345678-1234-4234-8234-123456789abc',
    '/visits/synthetic-id/',
    '/visits/synthetic-id?returnTo=%2Fplanning%3Fdate%3D2026-10-21',
    '/visits/synthetic-id#execution',
  ]) {
    expect(getActiveOfficeNavigationItem(groups, pathname)).toBe(
      items.find((item) => item.id === 'planning')!,
    );
  }
  for (const pathname of [
    '/visits',
    '/visits/',
    '/visits//',
    '/visits/id/edit',
    '/visits/id/extra/',
    '/visits-other/id',
    '/visitsSomething/id',
    '/care/visits/id',
  ])
    expect(getActiveOfficeNavigationItem(groups, pathname)).toBeUndefined();
});

test('record-scoped visit paths retain their existing record owner', () => {
  expect(getActiveOfficeNavigationItem(groups, '/clients/id/visits')?.id).toBe('clients');
});

test('never exposes Planning when it is absent, and keeps input ordering intact', () => {
  const visible = items.filter((item) => item.id !== 'planning');
  const original = structuredClone(visible);
  expect(getActiveOfficeNavigationItem([{ items: visible }], '/visits/id')).toBeUndefined();
  expect(visible).toEqual(original);
  expect(getActiveOfficeNavigationItem([], '/visits/id')).toBeUndefined();
  expect(getActiveOfficeNavigationItem(groups, '/billing/claims/id')).toBe(items[6]);
  expect(groups[0]!.items).toEqual(items);
});

const administration = { id: 'administration', href: '/administration', label: 'Visible parent' };
const settingsPaths = [
  '/billing/settings',
  '/billing/claims/settings',
  '/operations/reminder-settings',
];

test('exact settings fallback returns the original visible Administration item without mutating frozen groups', () => {
  const visible = Object.freeze([
    Object.freeze({
      items: Object.freeze([Object.freeze({ id: 'clients', href: '/clients', label: 'Clients' })]),
    }),
    Object.freeze({ items: Object.freeze([Object.freeze(administration)]) }),
  ]);
  const before = structuredClone(visible);
  for (const path of settingsPaths) {
    for (const suffix of ['', '/', '?q=synthetic', '#settings', '/?q=synthetic#settings']) {
      const result = getActiveOfficeNavigationItem(visible, path + suffix);
      expect(result).toBe(administration);
      expect(result?.label).toBe(administration.label);
      expect(result?.href).toBe('/administration');
    }
    expect(getActiveOfficeNavigationItem([{ items: [items[3]!] }], path)).toBeUndefined();
    expect(getActiveOfficeNavigationItem([], path)).toBeUndefined();
    expect(getActiveOfficeNavigationItem([{ items: [] }], path)).toBeUndefined();
  }
  expect(visible).toEqual(before);
  expect(getActiveOfficeNavigationItem([{ items: [administration] }], '/administration')).toBe(
    administration,
  );
  expect(
    getActiveOfficeNavigationItem([{ items: [administration] }], '/administration/users'),
  ).toBe(administration);
});

test('settings fallback never overrides existing owners, including parent precedence and generic negative-path matches', () => {
  const all = [{ items: [...items, administration] }];
  for (const [path, owner] of [
    ['/billing/settings', 'billing'],
    ['/billing/claims/settings', 'claims'],
    ['/operations/reminder-settings', 'operations'],
    ['/operations', 'overview'],
    ['/operations/tasks/id', 'operations'],
    ['/billing/claims/id', 'claims'],
    ['/visits/id', 'planning'],
    ['/clients/id/visits', 'clients'],
  ]) {
    expect(getActiveOfficeNavigationItem(all, path!)!).toBe(
      items.find((item) => item.id === owner)!,
    );
  }
  const parent = [{ items: [administration, items[5]!] }];
  expect(getActiveOfficeNavigationItem(parent, '/billing/claims/settings')).toBe(items[5]!);
  for (const path of settingsPaths) {
    for (const suffix of ['/', '?q=synthetic', '#settings', '/other', '//', '-extra']) {
      const owner = path.startsWith('/operations')
        ? items[1]!
        : path.startsWith('/billing/claims')
          ? items[6]!
          : items[5]!;
      expect(getActiveOfficeNavigationItem(all, path + suffix)).toBe(owner);
    }
  }
  expect(
    getActiveOfficeNavigationItem(
      [{ items: [...items, administration].reverse() }],
      '/billing/claims/settings',
    ),
  ).toBe(items[6]!);
});

test('Administration fallback rejects descendants, double slashes, case variants and unrelated routes', () => {
  const adminOnly = [{ items: [administration] }];
  for (const path of settingsPaths) {
    for (const suffix of ['/other', '/other/', '//', '//?q=synthetic', '-extra', 'Extra']) {
      expect(getActiveOfficeNavigationItem(adminOnly, path + suffix)).toBeUndefined();
    }
    expect(getActiveOfficeNavigationItem(adminOnly, path.toUpperCase())).toBeUndefined();
    expect(
      getActiveOfficeNavigationItem(adminOnly, path.replace('settings', 'Settings')),
    ).toBeUndefined();
  }
  for (const path of [
    '/billing',
    '/billing/claims',
    '/operations',
    '/operations/tasks/id',
    '/unmatched',
    '/care/today',
    '/visits',
    '/visits/id',
    '/visits/id/edit',
  ]) {
    expect(getActiveOfficeNavigationItem(adminOnly, path)).toBeUndefined();
  }
});
