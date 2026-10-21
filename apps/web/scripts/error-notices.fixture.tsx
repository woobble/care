import { mock } from 'bun:test';
import { createTranslator } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import de from '../messages/de.json';
import en from '../messages/en.json';

export type NoticeScenario = {
  route: 'employees' | 'operations';
  locale: 'en' | 'de';
  queryError?: string;
  loadError?: boolean;
  organizationError?: boolean;
  denied?: boolean;
  completed?: boolean;
  truncated?: boolean;
};
const scenario = JSON.parse(process.argv[2]!) as NoticeScenario;
const messages = scenario.locale === 'en' ? en : de;
const requests: unknown[] = [];
mock.module('next-intl/server', () => ({
  getLocale: async () => scenario.locale,
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: scenario.locale,
      messages,
      ...(namespace ? { namespace: namespace as never } : {}),
    }),
}));
mock.module('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
mock.module('@app/web/lib/api', () => ({
  getApiClient: async () => ({
    GET: async (path: string, options: unknown) => {
      requests.push([path, options]);
      return scenario.loadError
        ? { error: { code: 'TEST_LOAD_FAILED' } }
        : {
            data: {
              items: [],
              total: 0,
              page: 1,
              pageSize: 20,
              truncated: scenario.truncated ?? false,
            },
          };
    },
  }),
  getTenantHeader: async () => ({ 'X-Tenant-Id': 'synthetic-tenant' }),
  getPermissionGrants: async () => [],
  hasPermission: (_grants: unknown, permission: string) =>
    !(scenario.denied && permission === 'operations.read'),
  hasClientPermission: () => true,
}));
mock.module('@app/web/lib/organization-lookup', () => ({
  getOrganizationsByIds: async () => ({ items: [], failed: scenario.organizationError ?? false }),
}));
mock.module('@app/web/components/async-entity-combobox', () => ({
  AsyncEntityCombobox: ({ name, label }: { name: string; label: string }) => (
    <label className="grid gap-1 text-sm">
      {label}
      <input name={name} className="h-10 rounded-md border px-3" />
    </label>
  ),
}));
mock.module('@app/web/components/data-pagination', () => ({
  DataPagination: () => <div data-fixture="pagination" />,
}));
mock.module('@app/web/components/filter-disclosure', () => ({
  FilterDisclosure: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
mock.module('@app/web/app/(office)/operations/actions', () => ({
  acknowledgeExceptionAction: async () => {},
  snoozeExceptionAction: async () => {},
  transitionTaskAction: async () => {},
}));

const route =
  scenario.route === 'employees'
    ? (await import('../src/app/(office)/employees/page')).default
    : (await import('../src/app/(office)/operations/worklist/page')).default;
const html = renderToStaticMarkup(
  await route({
    searchParams: Promise.resolve({
      ...(scenario.queryError ? { error: scenario.queryError } : {}),
      ...(scenario.completed ? { updated: 'completed' } : {}),
    }),
  }),
);
console.log(JSON.stringify({ html, requests }));
