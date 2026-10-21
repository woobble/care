import { mock } from 'bun:test';
import { createTranslator } from 'next-intl';
import {
  Children,
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import de from '../messages/de.json';
import en from '../messages/en.json';

const scenario = JSON.parse(process.argv[2]!) as {
  locale: 'en' | 'de';
  permissions: string[];
  collapsed?: boolean;
  landing?: boolean;
  settings?: 'claims' | 'reminders';
  query?: Record<string, string>;
  apiError?: boolean;
};
mock.module('next-intl/server', () => ({
  getLocale: async () => scenario.locale,
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: scenario.locale,
      messages: scenario.locale === 'en' ? en : de,
      namespace: namespace as never,
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
  useRouter: () => {
    throw new Error('Client forms are outside the fixture');
  },
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {
    throw new Error('Unexpected fixture redirect');
  },
}));
const calls: Array<{ path: string; options: unknown }> = [];
const employeeCalls: string[][] = [];
mock.module('@app/web/lib/employee-lookup', () => ({
  getEmployeesByIds: async (ids: string[]) => {
    employeeCalls.push(ids);
    return { items: [], failed: false };
  },
}));
mock.module('@app/web/lib/api', () => ({
  getApiClient: async () => ({
    GET: async (path: string, options: unknown) => {
      if (scenario.settings) calls.push({ path, options });
      if (scenario.settings && scenario.apiError && path !== '/api/v1/me/tenants')
        return { error: { code: 'FORBIDDEN' } };
      const id = '11111111-1111-4111-8111-111111111111';
      return {
        data:
          path === '/api/v1/me/tenants'
            ? [{ id: 'synthetic-tenant', name: 'Synthetic Office' }]
            : path === '/api/v1/organizations/{id}'
              ? { id, name: 'Synthetic organization' }
              : path === '/api/v1/billing/payers'
                ? {
                    items: [{ id: 'synthetic-payer', name: 'Synthetic payer', status: 'active' }],
                    page: 1,
                    pageSize: 20,
                    totalItems: 1,
                  }
                : path === '/api/v1/billing/payer-directory/profiles'
                  ? []
                  : path === '/api/v1/operations/reminder-settings'
                    ? {
                        organizations: [{ id, name: 'Synthetic organization', policies: [] }],
                      }
                    : { items: [], total: 0 },
      };
    },
  }),
  getTenantHeader: async () => ({ 'X-Tenant-Id': 'synthetic-tenant' }),
  getAuthSession: async () => ({
    user: { name: 'Synthetic user', email: 'synthetic@example.test' },
  }),
  getPermissionGrants: async () => scenario.permissions.map((permission) => ({ permission })),
  hasPermission: (grants: Array<{ permission: string }>, permission: string) =>
    grants.some((grant) => grant.permission === permission),
}));
mock.module('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children),
}));
mock.module('@app/web/lib/structure-search', () => ({
  searchStructurePage: async () => ({ items: [], total: 0, failed: false }),
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
let landingHtml: string | undefined;
if (scenario.landing) {
  const { default: AdministrationPage } = await import('../src/app/(office)/administration/page');
  const { default: AdministrationLayout } =
    await import('../src/app/(office)/administration/layout');
  landingHtml = renderToStaticMarkup(
    await AdministrationLayout({ children: await AdministrationPage() }),
  );
}
let settingsReport;
if (scenario.settings) {
  // Execute the real server page, then render its actual header/alerts. Async secondary
  // navigation and interactive forms stay outside this focused presentation fixture.
  const { PageHeader, ErrorNotice } = await import('../src/components/page-patterns');
  const { default: Page } =
    scenario.settings === 'claims'
      ? await import('../src/app/(office)/billing/claims/settings/page')
      : await import('../src/app/(office)/operations/reminder-settings/page');
  calls.length = 0;
  const page = await Page({ searchParams: Promise.resolve(scenario.query ?? {}) });
  const elements: ReactElement<Record<string, unknown>>[] = [];
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      elements.push(child);
      visit(child.props.children as ReactNode);
    });
  }
  visit(page);
  const header = elements.find((element) => element.type === PageHeader);
  const alerts = elements.filter(
    (element) => element.type === ErrorNotice || element.props.role === 'alert',
  );
  const headerHtml = header ? renderToStaticMarkup(header) : '';
  const alertsHtml = alerts.map((alert) => renderToStaticMarkup(alert)).join('');
  landingHtml = headerHtml + alertsHtml;
  settingsReport = {
    headerHtml,
    alertsHtml,
    calls,
    employeeCalls,
    forms: elements.filter((element) => element.type === 'form').length,
    sections: elements.filter((element) => element.type === 'section').length,
    deniedHtml: header ? null : renderToStaticMarkup(page),
  };
}
console.log(
  JSON.stringify({
    ...props,
    ...(landingHtml ? { landingHtml } : {}),
    ...(settingsReport ? { settingsReport } : {}),
  }),
);
