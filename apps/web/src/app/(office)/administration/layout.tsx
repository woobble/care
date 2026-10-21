import { getTranslations } from 'next-intl/server';

import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';

import { AdministrationNavigationLinks } from './administration-nav-links';

export default async function AdministrationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const t = await getTranslations('Navigation');
  const api = await getApiClient();
  const permissions = await getPermissionGrants(api);
  const groups = [
    {
      key: 'administrationAccess',
      links: [
        { key: 'users', href: '/administration/users', permission: 'tenant.members.read' },
        {
          key: 'invitations',
          href: '/administration/users#invitations-title',
          permission: 'tenant.members.read',
        },
        { key: 'audit', href: '/administration/audit', permission: 'audit.read' },
      ],
    },
    {
      key: 'administrationOrganization',
      links: [
        {
          key: 'organizations',
          href: '/administration/organizations',
          permission: 'organization.read',
        },
        { key: 'facilities', href: '/administration/facilities', permission: 'facility.read' },
        { key: 'teams', href: '/administration/teams', permission: 'team.read' },
        {
          key: 'qualifications',
          href: '/administration/qualifications',
          permission: 'employee.read',
        },
      ],
    },
    {
      key: 'administrationConfiguration',
      links: [
        {
          key: 'documentTemplates',
          href: '/administration/document-templates',
          permission: 'documents.templates.manage',
        },
        {
          key: 'billingSettings',
          href: '/billing/settings',
          permission: 'billing.settings.manage',
        },
        {
          key: 'claimsSettings',
          href: '/billing/claims/settings',
          permission: 'claims.settings.manage',
        },
        {
          key: 'reminderSettings',
          href: '/operations/reminder-settings',
          permission: 'operations.reminder_settings.manage',
        },
      ],
    },
  ] as const;
  const navigationGroups = groups
    .map((group, index) => ({
      key: group.key,
      label: t(group.key),
      links: [
        ...(index === 0 ? [{ href: '/administration', label: t('overview') }] : []),
        ...group.links
          .filter((link) => hasPermission(permissions, link.permission))
          .map((link) => ({ href: link.href, label: t(link.key) })),
      ],
    }))
    .filter((group) => group.links.length);
  return (
    <div className="grid gap-6">
      <nav
        aria-label={t('administration')}
        className="grid gap-3 border-b border-border pb-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        <AdministrationNavigationLinks groups={navigationGroups} />
      </nav>
      {children}
    </div>
  );
}
