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
  billingNavigation?: boolean;
  administrationNavigation?: boolean;
  newClient?: boolean;
  newAdmission?: boolean;
  admissionList?: boolean;
  pathname?: string;
  settings?: 'claims' | 'reminders' | 'billing';
  populated?: boolean;
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
const fixtureRedirects: string[] = [];
mock.module('next/navigation', () => ({
  useRouter: () => {
    throw new Error('Client forms are outside the fixture');
  },
  usePathname: () => scenario.pathname ?? '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: (destination: string) => {
    if (scenario.newClient || scenario.newAdmission) {
      fixtureRedirects.push(destination);
      throw new Error('New Client fixture redirect');
    }
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
      if (
        scenario.settings ||
        scenario.billingNavigation ||
        scenario.administrationNavigation ||
        scenario.newClient ||
        scenario.newAdmission ||
        scenario.admissionList
      )
        calls.push({ path, options });
      if (scenario.settings && scenario.apiError && path !== '/api/v1/me/tenants')
        return { error: { code: 'FORBIDDEN' } };
      const id = '11111111-1111-4111-8111-111111111111';
      return {
        data:
          path === '/api/v1/me/tenants'
            ? [{ id: 'synthetic-tenant', name: 'Synthetic Office' }]
            : path === '/api/v1/billing/settings'
              ? {
                  items: scenario.populated
                    ? [
                        {
                          organizationId: id,
                          organizationName: 'Synthetic organization',
                          legalName: 'Synthetic legal name',
                          organizationAddress: 'Synthetic address',
                          profile: {
                            version: 3,
                            taxNumber: 'synthetic-tax',
                            paymentTermsDays: 14,
                            taxTreatment: 'taxable',
                            requiredInvoiceFormat: 'pdf',
                          },
                        },
                      ]
                    : [],
                }
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
  // Render selected elements returned by the real server page. Inspect form trees
  // without mounting their interactive components.
  const { PageHeader, ErrorNotice, SuccessNotice } =
    await import('../src/components/page-patterns');
  const { default: Page } =
    scenario.settings === 'claims'
      ? await import('../src/app/(office)/billing/claims/settings/page')
      : scenario.settings === 'reminders'
        ? await import('../src/app/(office)/operations/reminder-settings/page')
        : await import('../src/app/(office)/billing/settings/page');
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
  const statusHtml = elements
    .filter((element) => element.type === SuccessNotice)
    .map((element) => renderToStaticMarkup(element))
    .join('');
  const note =
    scenario.settings === 'billing'
      ? elements.find(
          (element) =>
            element.type === 'p' &&
            Children.toArray(element.props.children as ReactNode)[0] ===
              (scenario.locale === 'en' ? en : de).Billing.organizationAddressNote,
        )
      : undefined;
  const noteHtml = note ? renderToStaticMarkup(note) : '';
  const alertsHtml = alerts.map((alert) => renderToStaticMarkup(alert)).join('');
  landingHtml = headerHtml + alertsHtml;
  let billingReport;
  if (scenario.settings === 'billing') {
    const { BillingNavigation } = await import('../src/app/(office)/billing/billing-nav');
    const { RHFActionForm } = await import('../src/components/rhf-action-form');
    const { saveBillingProfileAction } = await import('../src/app/(office)/billing/actions');
    const forms = elements.filter((element) => element.type === RHFActionForm);
    const organizationHtml = elements
      .filter(
        (element) =>
          element.type === 'h2' ||
          (element.type === 'p' &&
            [
              en.Billing.noOrganizations,
              de.Billing.noOrganizations,
              en.Billing.noSettingsPermission,
              de.Billing.noSettingsPermission,
            ].includes(element.props.children as string)),
      )
      .map((element) => renderToStaticMarkup(element))
      .join('');
    billingReport = {
      noteHtml,
      statusHtml,
      organizationHtml,
      forms: forms.map((form) => ({
        saveAction: form.props.action === saveBillingProfileAction,
        tree: JSON.parse(
          JSON.stringify(form, (key, value) => {
            if (key === '_owner' || key === '_store') return undefined;
            return typeof value === 'function'
              ? value.name
              : typeof value === 'symbol'
                ? String(value)
                : value;
          }),
        ),
      })),
    };
    landingHtml =
      headerHtml +
      renderToStaticMarkup(
        await BillingNavigation({
          permissions: scenario.permissions.map((permission) => ({ permission })) as Parameters<
            typeof BillingNavigation
          >[0]['permissions'],
        }),
      ) +
      alertsHtml +
      statusHtml +
      noteHtml +
      organizationHtml;
  }
  settingsReport = {
    headerHtml,
    alertsHtml,
    calls,
    employeeCalls,
    forms: elements.filter((element) => element.type === 'form').length,
    sections: elements.filter((element) => element.type === 'section').length,
    deniedHtml: header ? null : renderToStaticMarkup(page),
    ...(billingReport ? { billing: billingReport } : {}),
  };
}
let billingNavigation;
if (scenario.billingNavigation) {
  const { BillingNavigation } = await import('../src/app/(office)/billing/billing-nav');
  calls.length = 0;
  const navigation = await BillingNavigation({
    permissions: scenario.permissions.map((permission) => ({ permission })) as Parameters<
      typeof BillingNavigation
    >[0]['permissions'],
  });
  const { BillingNavigationLinks } = await import('../src/app/(office)/billing/billing-nav-links');
  const renderer = navigation.props.children;
  const links = renderer.props.links;

  billingNavigation = {
    links,
    label: navigation.props['aria-label'],
    className: navigation.props.className,
    html: renderToStaticMarkup(navigation),
    calls,
    clientPropsKeys: Object.keys(renderer.props),
    clientTypeIsReal: renderer.type === BillingNavigationLinks,
  };
}
let administrationNavigation;
if (scenario.administrationNavigation) {
  const { default: AdministrationLayout } =
    await import('../src/app/(office)/administration/layout');
  const child = createElement('p', { 'data-fixture-child': 'true' }, 'Synthetic child');
  calls.length = 0;
  const administrationLayout = await AdministrationLayout({ children: child });
  const navigation = administrationLayout.props.children[0];
  const { AdministrationNavigationLinks } =
    await import('../src/app/(office)/administration/administration-nav-links');
  const renderer = navigation.props.children;
  const groups = renderer.props.groups;

  administrationNavigation = {
    groups,
    label: navigation.props['aria-label'],
    className: navigation.props.className,
    html: renderToStaticMarkup(navigation),
    layoutHtml: renderToStaticMarkup(administrationLayout),
    layoutClassName: administrationLayout.props.className,
    childrenPreserved: administrationLayout.props.children[1] === child,
    calls,
    clientPropsKeys: Object.keys(renderer.props),
    clientTypeIsReal: renderer.type === AdministrationNavigationLinks,
  };
}
let newClient;
if (scenario.newClient) {
  const { default: NewClientPage } = await import('../src/app/(office)/clients/new/page');
  const { PageHeader } = await import('../src/components/page-patterns');
  const { RHFActionForm } = await import('../src/components/rhf-action-form');
  const { createClientAction } = await import('../src/app/(office)/clients/actions');
  const { Button } = await import('@care/ui/components/button');
  calls.length = 0;
  fixtureRedirects.length = 0;
  try {
    const page = await NewClientPage({ searchParams: Promise.resolve(scenario.query ?? {}) });
    const elements: ReactElement<Record<string, unknown>>[] = [];
    function visitClient(node: ReactNode) {
      Children.forEach(node, (element) => {
        if (!isValidElement<Record<string, unknown>>(element)) return;
        elements.push(element);
        visitClient(element.props.children as ReactNode);
      });
    }
    visitClient(page);
    const header = elements.find((element) => element.type === PageHeader)!;
    const form = elements.find((element) => element.type === RHFActionForm)!;
    const cancel = elements.find(
      (element) => element.type === Button && element.props.asChild === true,
    )!;
    const cancelLink = cancel.props.children as ReactElement<{ href: string; children: string }>;
    const actions = Children.toArray(form.props.children as ReactNode).at(-1) as ReactElement;
    const firstName = elements.find((element) => element.props.name === 'firstName')!;
    newClient = {
      redirect: null,
      headerHtml: renderToStaticMarkup(header),
      cancelHtml: renderToStaticMarkup(cancel),
      actionsHtml: renderToStaticMarkup(actions),
      cancelHref: cancelLink.props.href,
      cancelLabel: cancelLink.props.children,
      cancelProps: { asChild: cancel.props.asChild, variant: cancel.props.variant },
      errorHtml: elements
        .filter((element) => element.props.role === 'alert')
        .map((element) => renderToStaticMarkup(element))
        .join(''),
      rootClassName: page.props.className,
      formClassName: form.props.className,
      errorMessage: form.props.errorMessage,
      warnOnUnsavedChanges: form.props.warnOnUnsavedChanges,
      createActionMatches: form.props.action === createClientAction,
      firstNameProps: firstName.props,
      formTree: JSON.parse(
        JSON.stringify(form, (key, value) => {
          if (key === '_owner' || key === '_store') return undefined;
          return typeof value === 'function'
            ? value.name
            : typeof value === 'symbol'
              ? String(value)
              : value;
        }),
      ),
      formCount: elements.filter((element) => element.type === RHFActionForm).length,
      submitCount: elements.filter(
        (element) => element.type === Button && element.props.type === 'submit',
      ).length,
      calls,
    };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'New Client fixture redirect') throw error;
    newClient = { redirect: fixtureRedirects[0], calls, formCount: 0 };
  }
}
let newAdmission;
if (scenario.newAdmission) {
  const { default: NewAdmissionPage } = await import('../src/app/(office)/admissions/new/page');
  const { PageHeader } = await import('../src/components/page-patterns');
  const { RHFActionForm } = await import('../src/components/rhf-action-form');
  const { createAdmissionCaseAction } = await import('../src/app/(office)/admissions/actions');
  const { Button } = await import('@care/ui/components/button');
  calls.length = 0;
  fixtureRedirects.length = 0;
  {
    const page = await NewAdmissionPage({ searchParams: Promise.resolve(scenario.query ?? {}) });
    const elements: ReactElement<Record<string, unknown>>[] = [];
    function visitAdmission(node: ReactNode) {
      Children.forEach(node, (element) => {
        if (!isValidElement<Record<string, unknown>>(element)) return;
        elements.push(element);
        visitAdmission(element.props.children as ReactNode);
      });
    }
    visitAdmission(page);
    const header = elements.find((element) => element.type === PageHeader);
    if (!header) {
      newAdmission = {
        deniedHtml: renderToStaticMarkup(page),
        redirects: [...fixtureRedirects],
        calls,
        formCount: elements.filter((element) => element.type === RHFActionForm).length,
        headerCount: 0,
        cancelCount: elements.filter((element) => element.type === Button).length,
        actionExposed: elements.some(
          (element) => element.props.action === createAdmissionCaseAction,
        ),
      };
    } else {
      const form = elements.find((element) => element.type === RHFActionForm)!;
      const cancel = elements.find(
        (element) => element.type === Button && element.props.asChild === true,
      )!;
      const cancelLink = cancel.props.children as ReactElement<{ href: string; children: string }>;
      const actions = Children.toArray(form.props.children as ReactNode).at(-1) as ReactElement;
      const firstName = elements.find((element) => element.props.name === 'firstName')!;
      newAdmission = {
        deniedHtml: null,
        redirects: [...fixtureRedirects],
        headerHtml: renderToStaticMarkup(header),
        cancelHtml: renderToStaticMarkup(cancel),
        actionsHtml: renderToStaticMarkup(actions),
        cancelHref: cancelLink.props.href,
        cancelLabel: cancelLink.props.children,
        cancelProps: { asChild: cancel.props.asChild, variant: cancel.props.variant },
        errorHtml: elements
          .filter((element) => element.props.role === 'alert')
          .map((element) => renderToStaticMarkup(element))
          .join(''),
        rootClassName: page.props.className,
        formClassName: form.props.className,
        errorMessage: form.props.errorMessage,
        warnOnUnsavedChanges: form.props.warnOnUnsavedChanges,
        createActionMatches: form.props.action === createAdmissionCaseAction,
        firstNameHtml: renderToStaticMarkup(firstName),
        firstNameTree: (firstName.type as (props: Record<string, unknown>) => ReactElement)(
          firstName.props,
        ),
        firstNameProps: firstName.props,
        formTree: JSON.parse(
          JSON.stringify(form, (key, value) => {
            if (key === '_owner' || key === '_store') return undefined;
            return typeof value === 'function'
              ? value.name
              : typeof value === 'symbol'
                ? String(value)
                : value;
          }),
        ),
        formCount: elements.filter((element) => element.type === RHFActionForm).length,
        submitCount: elements.filter(
          (element) => element.type === Button && element.props.type === 'submit',
        ).length,
        calls,
      };
    }
  }
}
let admissionListDeniedHtml;
if (scenario.admissionList) {
  const { default: AdmissionsPage } = await import('../src/app/(office)/admissions/page');
  admissionListDeniedHtml = renderToStaticMarkup(
    await AdmissionsPage({ searchParams: Promise.resolve({}) }),
  );
}

console.log(
  JSON.stringify({
    ...props,
    ...(landingHtml ? { landingHtml } : {}),
    ...(settingsReport ? { settingsReport } : {}),
    ...(billingNavigation ? { billingNavigation } : {}),
    ...(administrationNavigation ? { administrationNavigation } : {}),
    ...(newClient ? { newClient } : {}),
    ...(newAdmission ? { newAdmission } : {}),
    ...(admissionListDeniedHtml ? { admissionListDeniedHtml } : {}),
  }),
);
