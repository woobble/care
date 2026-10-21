import { expect, test } from 'bun:test';

import { getActiveAdministrationNavigationItem } from '../src/app/(office)/administration/administration-nav-links';

const groups = [
  {
    key: 'access',
    label: 'Access',
    links: [
      { href: '/administration', label: 'Overview' },
      { href: '/administration/users', label: 'Users' },
      { href: '/administration/users#invitations-title', label: 'Invitations' },
      { href: '/administration/audit', label: 'Audit' },
    ],
  },
  {
    key: 'organization',
    label: 'Organization',
    links: [
      { href: '/administration/organizations', label: 'Organizations' },
      { href: '/administration/facilities', label: 'Facilities' },
      { href: '/administration/teams', label: 'Teams' },
      { href: '/administration/qualifications', label: 'Qualifications' },
    ],
  },
  {
    key: 'configuration',
    label: 'Configuration',
    links: [
      { href: '/administration/document-templates', label: 'Templates' },
      { href: '/billing/settings', label: 'Billing settings' },
      { href: '/billing/claims/settings', label: 'Claims settings' },
      { href: '/operations/reminder-settings', label: 'Reminder settings' },
    ],
  },
];

test('Administration page ownership is precise across groups, queries and fragment jumps', () => {
  for (const [path, href] of [
    ['/administration', '/administration'],
    ['/administration/', '/administration'],
    ['/administration?view=synthetic', '/administration'],
    ['/administration/users', '/administration/users'],
    ['/administration/users/id', '/administration/users'],
    ['/administration/users#invitations-title', '/administration/users'],
    ['/administration/users?status=active#invitations-title', '/administration/users'],
    ['/administration/organizations', '/administration/organizations'],
    ['/administration/organizations/id', '/administration/organizations'],
    ['/administration/facilities/id', '/administration/facilities'],
    ['/administration/teams/id', '/administration/teams'],
    ['/administration/qualifications', '/administration/qualifications'],
    ['/administration/audit', '/administration/audit'],
    ['/administration/document-templates', '/administration/document-templates'],
  ]) {
    const selected = getActiveAdministrationNavigationItem(groups, path!);
    expect(selected).toBeDefined();
    expect(groups[selected!.groupIndex]!.links[selected!.linkIndex]!.href).toBe(href);
    expect(
      groups.flatMap((group, groupIndex) =>
        group.links.filter(
          (_link, linkIndex) =>
            selected?.groupIndex === groupIndex && selected.linkIndex === linkIndex,
        ),
      ),
    ).toHaveLength(1);
  }
  expect(
    getActiveAdministrationNavigationItem(
      [{ key: 'fragment', label: '', links: [groups[0]!.links[2]!] }],
      '/administration/users#invitations-title',
    ),
  ).toBeUndefined();
});

test('Administration selection uses longest visible href, stable index ties and frozen nonmutating input', () => {
  const frozen = Object.freeze(
    groups.map((group) =>
      Object.freeze({
        ...group,
        links: Object.freeze(group.links.map((link) => Object.freeze({ ...link }))),
      }),
    ),
  );
  const before = structuredClone(frozen);
  expect(getActiveAdministrationNavigationItem(frozen, '/administration/users/id')).toEqual({
    groupIndex: 0,
    linkIndex: 1,
  });
  expect(frozen).toEqual(before);
  const child = {
    key: 'child',
    label: '',
    links: [{ href: '/administration/users/special', label: 'Specific user page' }],
  };
  expect(
    getActiveAdministrationNavigationItem([...frozen, child], '/administration/users/special/id'),
  ).toEqual({ groupIndex: 3, linkIndex: 0 });
  expect(
    getActiveAdministrationNavigationItem([child, ...frozen], '/administration/users/special/id'),
  ).toEqual({ groupIndex: 0, linkIndex: 0 });
  const duplicate = { key: 'duplicate', label: '', links: [groups[0]!.links[1]!] };
  expect(
    getActiveAdministrationNavigationItem([duplicate, duplicate], '/administration/users/id'),
  ).toEqual({ groupIndex: 0, linkIndex: 0 });
  expect(
    getActiveAdministrationNavigationItem(
      [{ ...duplicate, links: [...duplicate.links, ...duplicate.links] }],
      '/administration/users',
    ),
  ).toEqual({ groupIndex: 0, linkIndex: 0 });
});

test('Administration never reconstructs hidden links and rejects lookalikes and unknown descendants', () => {
  for (const path of [
    '/administration-other',
    '/administrations',
    '/Administration',
    '/administration/Users',
    '/administration/users-extra',
    '/administration/organizations-extra',
    '/administration/unknown',
    '/unmatched',
  ]) {
    expect(getActiveAdministrationNavigationItem(groups, path)).toBeUndefined();
  }
  const overview = [{ ...groups[0]!, links: [groups[0]!.links[0]!] }];
  expect(getActiveAdministrationNavigationItem(overview, '/administration/users')).toBeUndefined();
  expect(getActiveAdministrationNavigationItem([], '/administration')).toBeUndefined();
  expect(
    getActiveAdministrationNavigationItem(
      [{ key: 'empty', label: '', links: [] }],
      '/administration',
    ),
  ).toBeUndefined();
  // Retained cross-route links do not imply the layout is mounted on these pages.
  expect(getActiveAdministrationNavigationItem(groups, '/billing/settings')).toEqual({
    groupIndex: 2,
    linkIndex: 1,
  });
});
