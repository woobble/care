import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';

export default async function AdministrationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const t = await getTranslations('Navigation');
  const api = await getApiClient();
  const permissions = await getPermissionGrants(api);
  const links = [
    { key: 'users', href: '/administration/users', permission: 'tenant.members.read' },
    {
      key: 'organizations',
      href: '/administration/organizations',
      permission: 'organization.read',
    },
    { key: 'facilities', href: '/administration/facilities', permission: 'facility.read' },
    { key: 'teams', href: '/administration/teams', permission: 'team.read' },
    { key: 'qualifications', href: '/administration/qualifications', permission: 'employee.read' },
    {
      key: 'documentTemplates',
      href: '/administration/document-templates',
      permission: 'documents.templates.manage',
    },
    { key: 'audit', href: '/administration/audit', permission: 'audit.read' },
  ] as const;
  return (
    <div className="grid gap-6">
      <nav
        aria-label={t('administration')}
        className="flex max-w-full flex-wrap gap-1 border-b border-border pb-3 text-sm"
      >
        {links
          .filter((link) => hasPermission(permissions, link.permission))
          .map((link) => (
            <Link
              key={link.key}
              className="min-h-10 rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              href={link.href}
            >
              {t(link.key)}
            </Link>
          ))}
      </nav>
      {children}
    </div>
  );
}
