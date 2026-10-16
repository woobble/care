import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { signOutAction } from '@app/web/app/actions/auth';
import { OfficeShell, type OfficeNavigationGroup } from '@app/web/components/office-shell';
import { PageLoadingSkeleton } from '@app/web/components/page-loading-skeleton';
import { SignOutMenuItem } from '@app/web/components/sign-out-menu-item';
import { getApiClient, getAuthSession, getPermissionGrants, hasPermission } from '@app/web/lib/api';

export default function OfficeLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <OfficeWorkspaceLayout modal={modal}>{children}</OfficeWorkspaceLayout>
    </Suspense>
  );
}

async function OfficeWorkspaceLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  const [api, cookieStore, t, locale, session] = await Promise.all([
    getApiClient(false),
    cookies(),
    getTranslations('Navigation'),
    getLocale(),
    getAuthSession(),
  ]);
  const get = api.GET;
  const { data: tenants, error } = await get('/api/v1/me/tenants');
  const tenantId = cookieStore.get('care-tenant')?.value;
  if (error || !tenantId || !tenants?.some((tenant) => tenant.id === tenantId)) redirect('/');
  const permissions = await getPermissionGrants(await getApiClient());
  const navigationLabels = {
    workspace: t('workspace'),
    servicesFinance: t('servicesFinance'),
    management: t('management'),
    overview: t('overview'),
    operations: t('operations'),
    planning: t('planning'),
    clientRecords: t('clientRecords'),
    admissions: t('admissions'),
    employees: t('employees'),
    services: t('services'),
    benefits: t('benefits'),
    billing: t('billing'),
    claims: t('claims'),
    documentation: t('documentation'),
    serviceEvidence: t('serviceEvidence'),
    documents: t('documents'),
    communications: t('communications'),
    administration: t('administration'),
  };
  const definitions = [
    {
      id: 'workspace',
      key: 'workspace',
      items: [
        { id: 'overview', key: 'overview', href: '/operations', permission: 'operations.read' },
        {
          id: 'operations',
          key: 'operations',
          href: '/operations/worklist',
          permission: 'operations.read',
        },
        { id: 'planning', key: 'planning', href: '/planning', permission: 'schedule.read' },
        { id: 'clients', key: 'clientRecords', href: '/clients', permission: 'client.read' },
        { id: 'admissions', key: 'admissions', href: '/admissions', permission: 'onboarding.read' },
        { id: 'employees', key: 'employees', href: '/employees', permission: 'employee.read' },
      ],
    },
    {
      id: 'servicesFinance',
      key: 'servicesFinance',
      items: [
        { id: 'services', key: 'services', href: '/services', permission: 'service.read' },
        { id: 'benefits', key: 'benefits', href: '/benefits', permission: 'benefits.read' },
        { id: 'billing', key: 'billing', href: '/billing', permission: 'billing.read' },
        { id: 'claims', key: 'claims', href: '/billing/claims', permission: 'claims.read' },
        {
          id: 'documentation',
          key: 'documentation',
          href: '/documentation',
          permission: 'care_documentation.review',
        },
        {
          id: 'serviceEvidence',
          key: 'serviceEvidence',
          href: '/service-evidence',
          permission: 'service_evidence.read',
        },
      ],
    },
    {
      id: 'management',
      key: 'management',
      items: [
        {
          id: 'documents',
          key: 'documents',
          href: '/documents',
          permission: 'documents.read',
        },
        {
          id: 'communications',
          key: 'communications',
          href: '/communications',
          permission: 'communications.read',
        },
        {
          id: 'administration',
          key: 'administration',
          href: '/administration/users',
          permission: 'tenant.members.read',
        },
      ],
    },
  ] as const;
  const tenantName = tenants.find((tenant) => tenant.id === tenantId)?.name ?? t('office');
  const initialCollapsed = cookieStore.get('care-office-sidebar')?.value !== 'expanded';
  const administrationLinks = [
    { permission: 'tenant.members.read', href: '/administration/users' },
    { permission: 'organization.read', href: '/administration/organizations' },
    { permission: 'facility.read', href: '/administration/facilities' },
    { permission: 'team.read', href: '/administration/teams' },
    { permission: 'employee.read', href: '/administration/qualifications' },
    { permission: 'documents.templates.manage', href: '/administration/document-templates' },
    { permission: 'audit.read', href: '/administration/audit' },
  ];
  const canReadAdministration = administrationLinks.some(({ permission }) =>
    permissions.some((grant) => grant.permission === permission),
  );
  const administrationHref =
    administrationLinks.find(({ permission }) =>
      permissions.some((grant) => grant.permission === permission),
    )?.href ?? '/administration/users';
  const groups: OfficeNavigationGroup[] = definitions
    .map((group) => ({
      id: group.id,
      label: navigationLabels[group.key],
      items: group.items
        .filter((item) =>
          item.id === 'administration'
            ? canReadAdministration
            : hasPermission(permissions, item.permission),
        )
        .map((item) => ({
          id: item.id,
          label: navigationLabels[item.key],
          href: item.id === 'administration' ? administrationHref : item.href,
        })),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <OfficeShell
      groups={groups}
      tenantName={tenantName}
      profileName={session?.user.name}
      email={session?.user.email}
      locale={locale}
      initialCollapsed={initialCollapsed}
      signOut={<SignOutMenuItem action={signOutAction} label={t('signOut')} />}
      labels={{
        main: t('main'),
        brand: t('brand'),
        overview: t('overview'),
        openMenu: t('openMenu'),
        closeMenu: t('closeMenu'),
        collapse: t('collapseSidebar'),
        expand: t('expandSidebar'),
        account: t('account'),
        changeTenant: t('changeTenant'),
      }}
    >
      {children}
      {modal}
    </OfficeShell>
  );
}
