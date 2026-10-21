import { mock } from 'bun:test';
import { createTranslator } from 'next-intl';
import type { ReactElement } from 'react';

import de from '../messages/de.json';
import en from '../messages/en.json';

const scenario = JSON.parse(process.argv[2]!) as {
  locale: 'en' | 'de';
  permissions: string[];
  collapsed?: boolean;
};
mock.module('next-intl/server', () => ({
  getLocale: async () => scenario.locale,
  getTranslations: async () =>
    createTranslator({
      locale: scenario.locale,
      messages: scenario.locale === 'en' ? en : de,
      namespace: 'Navigation',
    }),
}));
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'care-tenant'
        ? { value: 'synthetic-tenant' }
        : name === 'care-office-sidebar'
          ? { value: scenario.collapsed === false ? 'expanded' : 'collapsed' }
          : undefined,
  }),
}));
mock.module('next/navigation', () => ({
  redirect: () => {
    throw new Error('Unexpected fixture redirect');
  },
}));
mock.module('@app/web/lib/api', () => ({
  getApiClient: async () => ({
    GET: async () => ({ data: [{ id: 'synthetic-tenant', name: 'Synthetic Office' }] }),
  }),
  getAuthSession: async () => ({
    user: { name: 'Synthetic user', email: 'synthetic@example.test' },
  }),
  getPermissionGrants: async () => scenario.permissions.map((permission) => ({ permission })),
  hasPermission: (grants: Array<{ permission: string }>, permission: string) =>
    grants.some((grant) => grant.permission === permission),
}));
mock.module('@app/web/app/actions/auth', () => ({ signOutAction: async () => {} }));
mock.module('@app/web/components/office-shell', () => ({ OfficeShell: () => null }));
mock.module('@app/web/components/sign-out-menu-item', () => ({ SignOutMenuItem: () => null }));

const { default: OfficeLayout } = await import('../src/app/(office)/layout');
const layout = OfficeLayout({ children: null, modal: null });
const workspace = layout.props.children as ReactElement<{ children: null; modal: null }>;
const render = workspace.type as (
  props: typeof workspace.props,
) => Promise<ReactElement<Record<string, unknown>>>;
const shell = await render(workspace.props);
const { children: _children, signOut: _signOut, ...props } = shell.props;
console.log(JSON.stringify(props));
