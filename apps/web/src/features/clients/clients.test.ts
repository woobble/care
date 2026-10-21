/* oxlint-disable no-await-in-loop -- Cases share request and locale fixtures and must run sequentially. */
import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';

import de from '../../../messages/de.json';
import en from '../../../messages/en.json';

const events: unknown[] = [];
let apiError = false;
let apiErrorCode = 'INVALID_REQUEST';
let authError = false;
let locale: 'en' | 'de' = 'en';
const allowed = new Set<string>();
const tenant = { 'X-Tenant-Id': 'tenant-a' };
const id = '12345678-1234-4234-8234-123456789abc';
const redirectSignal = (path: string) => new Error(`NEXT_REDIRECT:${path}`);
mock.module('next/navigation', () => ({
  redirect: (path: string) => {
    events.push(['redirect', path]);
    throw redirectSignal(path);
  },
}));
mock.module('next/cache', () => ({
  revalidatePath: (path: string) => events.push(['revalidate', path]),
}));
mock.module('@app/web/lib/api', () => ({
  getApiClient: async () => {
    events.push('authenticate');
    if (authError) throw redirectSignal('/');
    return {
      POST: async (path: string, options: unknown) => {
        events.push(['post', path, options]);
        return { data: { id }, error: undefined };
      },
      PATCH: async (path: string, options: unknown) => {
        events.push(['patch', path, options]);
        return {
          error: apiError
            ? { code: apiErrorCode, detail: 'private backend information' }
            : undefined,
        };
      },
      GET: async (path: string, options: unknown) => {
        events.push(['get', path, options]);
        return {
          data: path.endsWith('/summary')
            ? { openFollowUps: [], recentInteractions: [] }
            : path.endsWith('/addresses') ||
                path.endsWith('/contacts') ||
                path.endsWith('/pflegegrade')
              ? []
              : { items: [] },
        };
      },
    };
  },
  getTenantHeader: async () => tenant,
  hasClientPermission: (
    _grants: unknown,
    permission: string,
    tenantId: string,
    organizationId: string,
    facilityId: string | null,
  ) => {
    expect(tenantId).toBe('tenant-a');
    expect(organizationId).toBe('organization-a');
    expect([null, 'facility-a']).toContain(facilityId);
    return allowed.has(permission);
  },
}));
mock.module('next-intl/server', () => ({
  getLocale: async () => locale,
  getTranslations: async () => (key: string) => {
    let value: unknown = locale === 'en' ? en : de;
    for (const part of key.split('.')) value = (value as Record<string, unknown>)[part];
    expect(typeof value).toBe('string');
    return value as string;
  },
}));
// Leave the feature's server composition intact; avoid running RHF browser hooks in unit tests.
mock.module('@app/web/components/rhf-action-form', () => ({ RHFActionForm: () => null }));
mock.module('@app/web/lib/organization-lookup', () => ({
  getOrganizationsByIds: async (ids: string[]) => {
    events.push(['organizations', ids]);
    return { items: [] };
  },
}));
mock.module('@app/web/lib/facility-lookup', () => ({
  getFacilitiesByIds: async (ids: string[]) => {
    events.push(['facilities', ids]);
    return { items: [] };
  },
}));

const { updateClientAction } = await import('./actions/update-client');
const { createClientAction, updateClientAction: routeUpdateClientAction } =
  await import('../../app/(office)/clients/actions');
const { ClientPersonalDataForm } = await import('./components/client-personal-data-form');
const { ClientProfileOverview } = await import('./components/client-profile-overview');
const { ClientProfileSectionNav } = await import('./components/client-profile-section-nav');
const { TextField, SelectField } = await import('./components/client-form-fields');

type NodeProps = { children?: ReactNode; [key: string]: unknown };
function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function data(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    id,
    firstName: ' Ada ',
    lastName: ' Lovelace ',
    ...values,
  }))
    result.set(key, value);
  return result;
}
const client = {
  id,
  firstName: 'Ada',
  lastName: 'Lovelace',
  preferredName: null,
  dateOfBirth: '1815-12-10',
  dateOfDeath: null,
  gender: 'female',
  salutation: 'ms',
  email: 'ada@example.test',
  phone: null,
  mobile: '+49123',
  organizationId: 'organization-a',
  primaryFacilityId: 'facility-a',
  status: 'active',
} as Parameters<typeof ClientPersonalDataForm>[0]['client'];

beforeEach(() => {
  events.length = 0;
  apiError = false;
  apiErrorCode = 'INVALID_REQUEST';
  authError = false;
  locale = 'en';
  allowed.clear();
});

test('updates trimmed payload with tenant context, then revalidates both routes before redirect', async () => {
  await expect(
    updateClientAction(
      data({
        preferredName: ' Countess ',
        dateOfBirth: '1815-12-10',
        dateOfDeath: ' not-a-date ',
        gender: ' diverse ',
        salutation: ' mx ',
        email: ' a@b.test ',
        phone: ' 123 ',
        mobile: ' 456 ',
      }),
    ),
  ).rejects.toThrow(`NEXT_REDIRECT:/clients/${id}`);
  expect(events).toEqual([
    'authenticate',
    [
      'patch',
      '/api/v1/clients/{id}',
      {
        params: { path: { id }, header: tenant },
        body: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          preferredName: 'Countess',
          dateOfBirth: '1815-12-10',
          dateOfDeath: 'not-a-date',
          gender: 'diverse',
          salutation: 'mx',
          email: 'a@b.test',
          phone: '123',
          mobile: '456',
        },
      },
    ],
    ['revalidate', '/clients'],
    ['revalidate', `/clients/${id}`],
    ['redirect', `/clients/${id}`],
  ]);
});

test('missing, empty, whitespace and file optional values retain existing null semantics', async () => {
  for (const value of [undefined, '', '  ']) {
    const form = data(
      value === undefined
        ? {}
        : {
            preferredName: value,
            dateOfBirth: value,
            dateOfDeath: value,
            gender: value,
            salutation: value,
            email: value,
            phone: value,
            mobile: value,
          },
    );
    form.set('phone', new File(['123'], 'phone.txt'));
    await expect(updateClientAction(form)).rejects.toThrow('NEXT_REDIRECT');
    const patch = [...events]
      .reverse()
      .find((event) => Array.isArray(event) && event[0] === 'patch') as [
      string,
      string,
      { body: unknown },
    ];
    expect(patch[2].body).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      preferredName: null,
      dateOfBirth: null,
      dateOfDeath: null,
      gender: null,
      salutation: null,
      email: null,
      phone: null,
      mobile: null,
    });
  }
});

test('invalid IDs redirect before API access; missing or blank names return typed field failures', async () => {
  for (const invalid of ['', 'invalid', '12345678-1234-0234-8234-123456789abc']) {
    await expect(updateClientAction(data({ id: invalid }))).rejects.toThrow(
      'NEXT_REDIRECT:/clients?error=INVALID_REQUEST',
    );
  }
  expect(events).not.toContain('authenticate');
  events.length = 0;
  for (const field of ['firstName', 'lastName']) {
    for (const value of ['', '  '])
      expect(await updateClientAction(data({ [field]: value }))).toEqual({
        ok: false,
        fieldErrors: { [field]: ['required'] },
      });
    const form = data();
    form.delete(field);
    expect(await updateClientAction(form)).toEqual({
      ok: false,
      fieldErrors: { [field]: ['required'] },
    });
  }
  expect(events).toEqual([]);
});

test('API failures return safe form errors without revalidation; authentication redirects propagate', async () => {
  apiError = true;
  expect(await updateClientAction(data({ gender: 'unknown', salutation: 'unknown' }))).toEqual({
    ok: false,
    formError: 'actionFailed',
  });
  expect(events).toHaveLength(2);
  events.length = 0;
  authError = true;
  await expect(updateClientAction(data())).rejects.toThrow('NEXT_REDIRECT:/');
  expect(events).toEqual(['authenticate']);
});

test('personal data controls retain names, defaults, choices, labels and RHF behavior in both locales', async () => {
  for (const language of ['en', 'de'] as const) {
    locale = language;
    const tree = elements(await ClientPersonalDataForm({ client }));
    const form = tree.find((node) => node.props.action === updateClientAction)!;
    expect(form.props.warnOnUnsavedChanges).toBe(true);
    expect(form.props.structuredErrors).toBe(true);
    expect(form.props.errorMessage).toBe((language === 'en' ? en : de).Clients.detail.saveFailed);
    const fields = tree.filter((node) => node.type === TextField || node.type === SelectField);
    expect(fields.map((node) => node.props.name)).toEqual([
      'firstName',
      'lastName',
      'preferredName',
      'dateOfBirth',
      'dateOfDeath',
      'gender',
      'salutation',
      'email',
      'phone',
      'mobile',
    ]);
    for (const field of fields) {
      const name = field.props.name as keyof typeof client;
      expect(field.props.id).toBe(`edit-${name}`);
      expect(field.props.defaultValue ?? field.props.value).toBe(client[name] ?? '');
      expect(Boolean(field.props.required)).toBe(['firstName', 'lastName'].includes(name));
      const rendered = elements((field.type as (props: never) => ReactNode)(field.props as never));
      expect(rendered.some((node) => node.props.htmlFor === field.props.id)).toBe(true);
      expect(
        rendered.some(
          (node) => node.props.name === name && node.props.defaultValue === (client[name] ?? ''),
        ),
      ).toBe(true);
    }
    expect(
      fields
        .filter((node) => node.type === SelectField)
        .map((node) => elements(node.props.children).map((option) => option.props.value)),
    ).toEqual([
      ['', 'female', 'male', 'diverse'],
      ['', 'mr', 'ms', 'mx', 'other'],
    ]);
    expect(
      tree.some(
        (node) => node.type === 'input' && node.props.name === 'id' && node.props.value === id,
      ),
    ).toBe(true);
  }
});

test('overview keeps separate Suspense cards and permission-gated requests/resources', async () => {
  for (const permitted of [false, true]) {
    events.length = 0;
    if (permitted)
      for (const permission of [
        'organization.read',
        'facility.read',
        'service_agreement.read',
        'schedule.read',
        'communications.read',
        'client.read',
        'benefits.read',
        'billing.read',
        'documents.read',
        'operations.read',
      ])
        allowed.add(permission);
    const tree = elements(
      ClientProfileOverview({
        client,
        permissions: [],
        title: 'Overview',
        loadingLabel: 'Loading',
      }),
    );
    const cards = tree.filter(
      (node) =>
        typeof node.type === 'function' &&
        ['ClientContactOverview', 'ClientWorkOverview'].includes(node.type.name),
    );
    expect(cards).toHaveLength(2);
    const output: ReactElement<NodeProps>[] = [];
    for (const card of cards)
      output.push(
        ...elements(await (card.type as (props: never) => Promise<ReactNode>)(card.props as never)),
      );
    const requests = events.filter((event) => Array.isArray(event) && event[0] === 'get') as [
      string,
      string,
      { params: { header: unknown } },
    ][];
    expect(requests).toHaveLength(permitted ? 6 : 3);
    for (const request of requests) expect(request[2].params.header).toEqual(tenant);
    expect(events).toContainEqual(['organizations', permitted ? ['organization-a'] : []]);
    expect(events).toContainEqual(['facilities', permitted ? ['facility-a'] : []]);
    const hrefs = output.map((node) => node.props.href).filter(Boolean);
    expect(hrefs.some((href) => String(href).includes('/benefits'))).toBe(permitted);
    expect(hrefs.some((href) => String(href).includes('/invoices'))).toBe(permitted);
  }
});

test('section navigation preserves children/anchors and scrolls focused descendants only', () => {
  const children = createElement('a', { href: '#personal-information' }, 'Personal data');
  const nav = ClientProfileSectionNav({
    ariaLabel: 'Sections',
    className: 'overflow-x-auto',
    children,
  });
  expect(nav.props['aria-label']).toBe('Sections');
  expect(nav.props.children).toBe(children);
  const calls: unknown[] = [];
  class ElementStub {
    scrollIntoView(options: unknown) {
      calls.push(options);
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementStub });
  try {
    const target = new ElementStub();
    nav.props.onFocusCapture({ target, currentTarget: { contains: () => true } } as never);
    nav.props.onFocusCapture({ target, currentTarget: { contains: () => false } } as never);
    nav.props.onFocusCapture({ target: {}, currentTarget: { contains: () => true } } as never);
    expect(calls).toEqual([{ block: 'nearest', inline: 'nearest' }]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'HTMLElement', original);
    else Reflect.deleteProperty(globalThis, 'HTMLElement');
  }
});

test('feature boundaries and route permission/anchor composition stay explicit', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  expect(source('./actions/update-client.ts').startsWith("'use server';")).toBe(true);
  expect(source('./components/client-profile-section-nav.tsx').startsWith("'use client';")).toBe(
    true,
  );
  for (const file of [
    'client-personal-data-form',
    'client-profile-overview',
    'client-form-fields',
  ]) {
    const text = source(`./components/${file}.tsx`);
    expect(text).not.toContain("'use client'");
    expect(text).not.toContain('@app/web/app/');
  }
  const route = source('../../app/(office)/clients/[id]/page.tsx');
  expect(route).toMatch(/\{canUpdateClient \? \(?\s*<ClientPersonalDataForm client=\{client\} \/>/);
  expect(route).toContain('href="#personal-information"');
  expect(route).toContain('id="personal-information"');
  expect(source('../../app/(office)/clients/actions.ts')).toContain(
    "import { updateClientAction as updateClient } from '@app/web/features/clients/actions/update-client'",
  );
});

test('creation retains omitted optional values while route update clears them', async () => {
  const form = data({
    organizationId: id,
    primaryFacilityId: id,
    gender: 'unknown',
    salutation: '',
  });
  await expect(createClientAction(form)).rejects.toThrow(`NEXT_REDIRECT:/clients/${id}`);
  expect(events).toEqual([
    'authenticate',
    [
      'post',
      '/api/v1/clients',
      {
        params: { header: tenant },
        body: { firstName: 'Ada', lastName: 'Lovelace', organizationId: id, primaryFacilityId: id },
      },
    ],
    ['revalidate', '/clients'],
    ['redirect', `/clients/${id}`],
  ]);
  events.length = 0;
  await expect(routeUpdateClientAction(form)).rejects.toThrow(`NEXT_REDIRECT:/clients/${id}`);
  expect(events).toContainEqual(['revalidate', `/clients/${id}`]);
  const patch = events[1] as [string, string, { body: Record<string, unknown> }];
  expect(patch[2].body.preferredName).toBeNull();
  expect(patch[2].body.gender).toBeNull();
});

test('creation field helpers preserve autocomplete, constraints and the empty select default', () => {
  const text = elements(
    TextField({
      id: 'addressCountryCode',
      name: 'addressCountryCode',
      label: 'Country',
      defaultValue: 'DE',
      maxLength: 2,
      autoComplete: 'country',
    }),
  );
  const control = text.find((node) => node.props.name === 'addressCountryCode')!;
  expect(control.props.defaultValue).toBe('DE');
  expect(control.props.maxLength).toBe(2);
  expect(control.props.autoComplete).toBe('country');
  const select = elements(
    SelectField({ id: 'gender', name: 'gender', label: 'Gender', children: null }),
  );
  expect(select.find((node) => node.props.name === 'gender')!.props.defaultValue).toBe('');
});

test('legacy wrapper converts field/API failures to false and never exposes structured results', async () => {
  expect(await routeUpdateClientAction(data({ firstName: '' }))).toBe(false);
  expect(events).toEqual([]);
  apiError = true;
  expect(await routeUpdateClientAction(data())).toBe(false);
  expect(events).toHaveLength(2);
  events.length = 0;
  await expect(routeUpdateClientAction(data({ id: 'invalid' }))).rejects.toThrow(
    'NEXT_REDIRECT:/clients?error=INVALID_REQUEST',
  );
});

test('structured failures are serializable and reveal no backend details', async () => {
  const fieldFailure = await updateClientAction(data({ firstName: '', lastName: '' }));
  expect(JSON.parse(JSON.stringify(fieldFailure))).toEqual({
    ok: false,
    fieldErrors: { firstName: ['required'], lastName: ['required'] },
  });
  apiError = true;
  const apiFailure = await updateClientAction(data());
  expect(JSON.stringify(apiFailure)).toBe('{"ok":false,"formError":"actionFailed"}');
});

test('authorization and tenant rejections remain failures and never revalidate', async () => {
  apiError = true;
  for (const code of [
    'INSUFFICIENT_PERMISSION',
    'TENANT_MEMBERSHIP_REQUIRED',
    'UNEXPECTED_BACKEND_ERROR',
  ]) {
    events.length = 0;
    apiErrorCode = code;
    expect(await updateClientAction(data({ tenantId: 'forged-tenant' }))).toEqual({
      ok: false,
      formError: 'actionFailed',
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toBe('authenticate');
    const patch = events[1] as [string, string, { params: { header: unknown } }];
    expect(patch[2].params.header).toEqual(tenant);
  }
});
