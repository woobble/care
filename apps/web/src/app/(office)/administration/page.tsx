import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { PageHeader } from '@app/web/components/page-patterns';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { searchStructurePage } from '@app/web/lib/structure-search';
import type { components } from '@care/api-client';

export default async function AdministrationPage() {
  const t = await getTranslations('AdministrationOverview');
  const api = await getApiClient();
  const [tenantHeader, permissions] = await Promise.all([
    getTenantHeader(),
    getPermissionGrants(api),
  ]);
  const canReadMembers = hasPermission(permissions, 'tenant.members.read');
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const tenantApi = await getApiClient(false);
  const [{ data: tenants }, activeMembers, pendingInvitations, organizations, facilities] =
    await Promise.all([
      tenantApi.GET('/api/v1/me/tenants'),
      canReadMembers
        ? api.GET('/api/v1/admin/members', {
            params: { query: { status: 'active', page: 1, pageSize: 1 }, header: tenantHeader },
          })
        : Promise.resolve({ data: undefined }),
      canReadMembers
        ? api.GET('/api/v1/admin/invitations', {
            params: { query: { status: 'pending', page: 1, pageSize: 1 }, header: tenantHeader },
          })
        : Promise.resolve({ data: undefined }),
      canReadOrganizations
        ? searchStructurePage<components['schemas']['OrganizationResponseDto']>('organizations', {
            page: 1,
            pageSize: 1,
            status: 'active',
          })
        : Promise.resolve(undefined),
      canReadFacilities
        ? searchStructurePage<components['schemas']['FacilityResponseDto']>('facilities', {
            page: 1,
            pageSize: 1,
            status: 'active',
          })
        : Promise.resolve(undefined),
    ]);
  const tenant = tenants?.find((item) => item.id === tenantHeader['X-Tenant-Id']);
  const links = [
    {
      href: '/administration/users',
      label: t('users'),
      description: t('usersDescription'),
      permission: 'tenant.members.read',
    },
    {
      href: '/administration/organizations',
      label: t('organizations'),
      description: t('organizationsDescription'),
      permission: 'organization.read',
    },
    {
      href: '/administration/facilities',
      label: t('facilities'),
      description: t('facilitiesDescription'),
      permission: 'facility.read',
    },
    {
      href: '/administration/teams',
      label: t('teams'),
      description: t('teamsDescription'),
      permission: 'team.read',
    },
    {
      href: '/administration/qualifications',
      label: t('employees'),
      description: t('employeesDescription'),
      permission: 'employee.read',
    },
    {
      href: '/administration/document-templates',
      label: t('documentTemplates'),
      description: t('documentTemplatesDescription'),
      permission: 'documents.templates.manage',
    },
    {
      href: '/billing/settings',
      label: t('billingSettings'),
      description: t('billingSettingsDescription'),
      permission: 'billing.settings.manage',
    },
    {
      href: '/billing/claims/settings',
      label: t('claimsSettings'),
      description: t('claimsSettingsDescription'),
      permission: 'claims.settings.manage',
    },
    {
      href: '/operations/reminder-settings',
      label: t('reminderSettings'),
      description: t('reminderSettingsDescription'),
      permission: 'operations.reminder_settings.manage',
    },
  ] as const;

  return (
    <div className="grid gap-8">
      <PageHeader title={t('title')} description={t('description')} />

      <section aria-labelledby="tenant-context-title" className="grid gap-4">
        <h2 id="tenant-context-title" className="text-xl font-semibold">
          {t('tenantContext')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t('currentTenant')}
            value={tenant?.name ?? t('unavailable')}
            detail={t('tenantContextDescription')}
          />
          {canReadOrganizations ? (
            <MetricCard
              label={t('activeOrganizations')}
              value={countLabel(
                organizations?.failed ? undefined : organizations?.total,
                t('unavailable'),
              )}
              detail={organizations?.failed ? t('loadFailed') : t('activeOnly')}
            />
          ) : null}
          {canReadFacilities ? (
            <MetricCard
              label={t('activeFacilities')}
              value={countLabel(
                facilities?.failed ? undefined : facilities?.total,
                t('unavailable'),
              )}
              detail={facilities?.failed ? t('loadFailed') : t('activeOnly')}
            />
          ) : null}
          {canReadMembers ? (
            <MetricCard
              label={t('activeMemberships')}
              value={countLabel(activeMembers.data?.total, t('unavailable'))}
              detail={activeMembers.data?.total === undefined ? t('loadFailed') : t('activeOnly')}
            />
          ) : null}
          {canReadMembers ? (
            <MetricCard
              label={t('pendingInvitations')}
              value={countLabel(pendingInvitations.data?.total, t('unavailable'))}
              detail={
                pendingInvitations.data?.total === undefined
                  ? t('loadFailed')
                  : t('attentionNeeded')
              }
              href="/administration/users#invitations-title"
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="admin-entrypoints-title" className="grid gap-4">
        <h2 id="admin-entrypoints-title" className="text-xl font-semibold">
          {t('entryPoints')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {links
            .filter((item) => hasPermission(permissions, item.permission))
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="grid min-h-28 content-start gap-1 rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
              >
                <span className="font-semibold text-primary">{item.label}</span>
                <span className="text-sm text-muted-foreground">{item.description}</span>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  href,
}: Readonly<{ label: string; value: string; detail: string; href?: string }>) {
  const content = (
    <div className="grid min-h-28 content-between gap-3 rounded-lg border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="grid gap-1">
        <strong className="text-2xl font-semibold">{value}</strong>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="rounded-lg transition-colors hover:bg-accent">
      {content}
    </Link>
  ) : (
    content
  );
}

function countLabel(value: number | undefined, unavailableLabel: string) {
  return value === undefined ? unavailableLabel : new Intl.NumberFormat().format(value);
}
