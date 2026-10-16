import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';

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
  return (
    <div className="grid gap-6">
      <nav
        aria-label={t('administration')}
        className="grid gap-3 border-b border-border pb-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        <section className="grid content-start gap-1">
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('administrationAccess')}
          </h2>
          <NavLink href="/administration" label={t('overview')} />
          {groups[0].links
            .filter((link) => hasPermission(permissions, link.permission))
            .map((link) => (
              <NavLink key={link.key} href={link.href} label={t(link.key)} />
            ))}
        </section>
        {groups.slice(1).map((group) => {
          const links = group.links.filter((link) => hasPermission(permissions, link.permission));
          if (!links.length) return null;
          return (
            <section key={group.key} className="grid content-start gap-1">
              <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(group.key)}
              </h2>
              {links.map((link) => (
                <NavLink key={link.key} href={link.href} label={t(link.key)} />
              ))}
            </section>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

function NavLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <Link
      className="min-h-10 rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      href={href}
    >
      {label}
    </Link>
  );
}
