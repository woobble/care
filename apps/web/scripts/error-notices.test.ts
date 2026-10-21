import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import de from '../messages/de.json';
import en from '../messages/en.json';
import type { NoticeScenario } from './error-notices.fixture';

type RenderedRoute = { html: string; requests: Array<[string, { params: { header: unknown } }]> };
async function render(scenario: NoticeScenario): Promise<RenderedRoute> {
  const process = Bun.spawn(
    [
      Bun.which('bun')!,
      resolve(import.meta.dir, 'error-notices.fixture.tsx'),
      JSON.stringify(scenario),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, output, errors] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) throw new Error(errors);
  return JSON.parse(output) as RenderedRoute;
}
function alerts(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/p>/g)].map(
    (match) => match[1]!,
  );
}

for (const locale of ['en', 'de'] as const) {
  const messages = locale === 'en' ? en : de;
  test(`Employee route renders independent query/load notices in the same order (${locale})`, async () => {
    const cases = [
      { queryError: undefined, loadError: false, expected: [] },
      { queryError: 'TEST_ERROR', loadError: false, expected: [messages.Errors.generic] },
      { queryError: undefined, loadError: true, expected: [messages.Employees.loadFailed] },
      {
        queryError: 'TEST_ERROR',
        loadError: true,
        expected: [messages.Errors.generic, messages.Employees.loadFailed],
      },
    ];
    await Promise.all(
      cases.map(async ({ queryError, loadError, expected }) => {
        const { html, requests } = await render({
          route: 'employees',
          locale,
          loadError,
          ...(queryError ? { queryError } : {}),
        });
        expect(alerts(html)).toEqual(expected);
        expect(requests).toEqual([
          [
            '/api/v1/employees',
            {
              params: {
                query: { page: 1, pageSize: 20, sortBy: 'lastName', sortOrder: 'asc' },
                header: { 'X-Tenant-Id': 'synthetic-tenant' },
              },
            },
          ],
        ]);
        expect(html.indexOf('<header')).toBeLessThan(html.indexOf('employee-filter-title'));
        for (const message of expected)
          expect(html.indexOf(message)).toBeLessThan(html.indexOf('employee-filter-title'));
        expect(html).toContain('href="/employees/new"');
        expect(html).toContain('name="q"');
        expect((html.match(/p-3 text-destructive/g) ?? []).length).toBe(expected.length);
      }),
    );
  });

  test(`Operations route preserves specific query errors and the combined load predicate (${locale})`, async () => {
    const cases = [
      { expected: [] },
      { queryError: 'INSUFFICIENT_PERMISSION', expected: [messages.Errors.insufficientPermission] },
      { queryError: 'UNKNOWN_CODE', expected: [messages.Errors.generic] },
      { loadError: true, expected: [messages.Operations.loadFailed] },
      { organizationError: true, expected: [messages.Operations.loadFailed] },
      { loadError: true, organizationError: true, expected: [messages.Operations.loadFailed] },
      {
        queryError: 'INSUFFICIENT_PERMISSION',
        loadError: true,
        expected: [messages.Errors.insufficientPermission, messages.Operations.loadFailed],
      },
      {
        queryError: 'INSUFFICIENT_PERMISSION',
        organizationError: true,
        expected: [messages.Errors.insufficientPermission, messages.Operations.loadFailed],
      },
    ];
    await Promise.all(
      cases.map(async ({ expected, ...options }) => {
        const { html, requests } = await render({ route: 'operations', locale, ...options });
        expect(alerts(html)).toEqual(expected);
        expect(requests).toEqual([
          [
            '/api/v1/operations/work-queue',
            {
              params: {
                query: { page: 1, pageSize: 20, itemType: 'all', sort: 'priority' },
                header: { 'X-Tenant-Id': 'synthetic-tenant' },
              },
            },
          ],
        ]);
        expect(html).toContain('href="/operations"');
        for (const message of expected)
          expect(html.indexOf(message)).toBeGreaterThan(html.indexOf('</header>'));
      }),
    );
  });

  test(`Operations permission denial, success and truncation retain their separate semantics (${locale})`, async () => {
    const denied = await render({
      route: 'operations',
      locale,
      denied: true,
      queryError: 'INSUFFICIENT_PERMISSION',
      loadError: true,
      completed: true,
      truncated: true,
    });
    expect(denied.html).toBe(
      `<p role="alert" class="rounded-md border bg-card p-5">${messages.Operations.noAccess}</p>`,
    );
    expect(denied.requests).toEqual([]);
    const success = await render({ route: 'operations', locale, completed: true, truncated: true });
    expect(alerts(success.html)).toEqual([]);
    expect(success.html.match(/role="status"/g)).toHaveLength(2);
    expect(success.html).toContain(messages.Operations.taskQuickCompleted);
    expect(success.html).toContain(messages.Operations.truncated);
  });
}
