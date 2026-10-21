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
