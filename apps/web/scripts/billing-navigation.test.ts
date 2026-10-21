import { expect, test } from 'bun:test';

import { getActiveBillingNavigationIndex } from '../src/app/(office)/billing/billing-nav-links';

const links = [
  { href: '/billing', label: 'Overview' },
  { href: '/billing#worklist', label: 'Worklist' },
  { href: '/billing/invoices', label: 'Invoices' },
  { href: '/billing/receivables', label: 'Receivables' },
  { href: '/billing/payments', label: 'Payments' },
  { href: '/billing/claims', label: 'Claims' },
  { href: '/billing/claims/settings', label: 'Claims settings' },
  { href: '/billing/settings', label: 'Billing settings' },
];

test('Billing client selection uses exact Overview, excludes fragments and preserves each visible route owner', () => {
  for (const [path, href] of [
    ['/billing', '/billing'],
    ['/billing/', '/billing'],
    ['/billing#worklist', '/billing'],
    ['/billing?from=synthetic#worklist', '/billing'],
    ['/billing/invoices', '/billing/invoices'],
    ['/billing/invoices/id', '/billing/invoices'],
    ['/billing/receivables', '/billing/receivables'],
    ['/billing/receivables/id', '/billing/receivables'],
    ['/billing/payments', '/billing/payments'],
    ['/billing/payments/id', '/billing/payments'],
    ['/billing/claims', '/billing/claims'],
    ['/billing/claims/id', '/billing/claims'],
    ['/billing/claims/settings', '/billing/claims/settings'],
    ['/billing/claims/settings/child', '/billing/claims/settings'],
    ['/billing/settings', '/billing/settings'],
    ['/billing/settings/', '/billing/settings'],
  ]) {
    const index = getActiveBillingNavigationIndex(links, path!);
    expect(links[index]?.href).toBe(href);
    expect(index).not.toBe(1);
    expect(links.filter((_link, candidate) => candidate === index)).toHaveLength(1);
  }
  expect(getActiveBillingNavigationIndex([links[1]!], '/billing#worklist')).toBe(-1);
});

test('Billing client specificity is order-independent, respects hidden destinations and never mutates links', () => {
  const frozen = Object.freeze(links.map((link) => Object.freeze({ ...link })));
  const original = structuredClone(frozen);
  const path = '/billing/claims/settings';
  expect(frozen[getActiveBillingNavigationIndex(frozen, path)]).toBe(frozen[6]!);
  const reversed = [...frozen].reverse();
  expect(reversed[getActiveBillingNavigationIndex(reversed, path)]).toBe(frozen[6]!);
  const parentOnly = frozen.filter((link) => link.href !== '/billing/claims/settings');
  expect(parentOnly[getActiveBillingNavigationIndex(parentOnly, path)]).toBe(frozen[5]!);
  expect(getActiveBillingNavigationIndex([frozen[0]!], path)).toBe(-1);
  expect(getActiveBillingNavigationIndex([], path)).toBe(-1);
  expect(frozen).toEqual(original);
  const tie = [frozen[5]!, { ...frozen[5]!, label: 'Second equal candidate' }];
  expect(getActiveBillingNavigationIndex(tie, path)).toBe(0);
  expect(getActiveBillingNavigationIndex([frozen[5]!, frozen[5]!], path)).toBe(0);
});

test('Billing client rejects lookalikes, unrelated routes and hidden roots', () => {
  for (const path of [
    '/billing-other',
    '/billings',
    '/administration',
    '/operations',
    '/unmatched',
    '/BILLING',
    '/billing/Claims',
    '/billing/invoices-extra',
    '/billing/claims-extra',
    '/billing/settings-extra',
    '/billing/unknown',
  ]) {
    expect(getActiveBillingNavigationIndex(links, path)).toBe(-1);
  }
  for (const link of links.filter((candidate) => !candidate.href.includes('#'))) {
    expect(
      getActiveBillingNavigationIndex(
        links.filter((candidate) => candidate !== link && candidate.href !== '/billing/claims'),
        link.href,
      ),
    ).toBe(-1);
  }
});
