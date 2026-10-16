import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  activateMemberAction,
  deactivateMemberAction,
  replaceMemberRolesAction,
  revokeMemberAction,
} from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import { MemberScopesForm } from '@app/web/app/(office)/administration/member-scopes-form';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { permissionLabelKeys, roleDescriptionKey, roleLabelKey } from '@app/web/i18n/access';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { StatusBadge } from '@care/ui/components/status-badge';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function MemberDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [memberResult, rolesResult] = await Promise.all([
    api.GET('/api/v1/admin/members/{id}', { params: { path: { id }, header } }),
    api.GET('/api/v1/admin/roles', { params: { header } }),
  ]);
  if (memberResult.response?.status === 404) notFound();
  if (!memberResult.data) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
      >
        {t('Users.loadFailed')}
      </p>
    );
  }
  const member = memberResult.data as components['schemas']['TenantMemberDto'];
  const roles = (rolesResult.data ?? []) as components['schemas']['TenantRoleDto'][];
  const permissions = await getPermissionGrants(api);
  const canReadEmployees = hasPermission(permissions, 'employee.read');
  const employeeResult = canReadEmployees
    ? await api.GET('/api/v1/employees', {
        params: { query: { userId: member.userId, page: 1, pageSize: 1 }, header },
      })
    : undefined;
  const linkedEmployee = employeeResult?.data?.items[0];
  const scopesOfType = (scopeType: 'organization' | 'facility' | 'team') =>
    member.scopes
      .filter((scope) => scope.scopeType === scopeType)
      .map((scope) => ({
        id: scope.scopeId,
        label: scope.name ?? t('Resources.unavailableScope'),
      }));
  const assignedRoleIds = new Set(member.roles.map((role) => role.id));
  const tenantScope = member.scopes.some((scope) => scope.scopeType === 'tenant');

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href="/administration/users">{t('Users.title')}</Link>}
        title={member.displayName || member.email || t('Resources.unavailableUser')}
        description={member.email || t('Users.noVerifiedEmail')}
        meta={<StatusBadge status={member.status} label={t(statusLabelKey(member.status))} />}
      />

      <section
        aria-labelledby="identity-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="identity-title" className="text-xl font-semibold">
          {t('Users.identityAndEmployee')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('Users.identityBoundary')}</p>
        <p className="text-sm">
          {t('Users.invitationStatus')}:{' '}
          {member.invitation
            ? `${t(statusLabelKey(member.invitation.status))} · ${t('Users.expires')} ${formatDate(member.invitation.expiresAt, locale)}`
            : t('Users.noInvitationRecord')}
        </p>
        {canReadEmployees ? (
          employeeResult?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t('Users.employeeLinkUnavailable')}
            </p>
          ) : linkedEmployee ? (
            <p className="text-sm">
              {t('Users.linkedEmployee')}:{' '}
              <Link className="text-primary underline" href={`/employees/${linkedEmployee.id}`}>
                {`${linkedEmployee.firstName} ${linkedEmployee.lastName}`.trim()}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Users.noLinkedEmployee')}</p>
          )
        ) : null}
      </section>

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('Users.accessUpdated')}
        </p>
      ) : null}
      {rolesResult.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('Users.targetsLoadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="lifecycle-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="lifecycle-title" className="text-xl font-semibold">
          {t('Users.membershipLifecycle')}
        </h2>
        <div className="flex flex-wrap gap-3">
          {member.status === 'pending' || member.status === 'inactive' ? (
            <form action={activateMemberAction}>
              <input type="hidden" name="membershipId" value={member.id} />
              <Button type="submit">{t('Users.activateMembership')}</Button>
            </form>
          ) : null}
          {member.status === 'active' ? (
            <form action={deactivateMemberAction}>
              <input type="hidden" name="membershipId" value={member.id} />
              <Button type="submit" variant="secondary">
                {t('Users.deactivateMembership')}
              </Button>
            </form>
          ) : null}
          {member.status !== 'revoked' ? (
            <form action={revokeMemberAction}>
              <input type="hidden" name="membershipId" value={member.id} />
              <ConfirmSubmitButton confirmation={t('Users.revokeConfirmation')}>
                {t('Users.revokeAccess')}
              </ConfirmSubmitButton>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Users.revokedCannotReactivate')}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="roles-title" className="grid gap-4 rounded-lg border bg-card p-5">
        <div>
          <h2 id="roles-title" className="text-xl font-semibold">
            {t('Users.roles')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Users.roleHelp')}</p>
        </div>
        <RHFActionForm action={replaceMemberRolesAction} className="grid gap-4">
          <input type="hidden" name="membershipId" value={member.id} />
          <fieldset className="grid gap-4">
            <legend className="sr-only">{t('Users.availableRoles')}</legend>
            {roles.map((role) => {
              const permissionGroups = new Map<string, Set<string>>();
              for (const permission of role.permissions) {
                const keys = permissionLabelKeys(permission);
                const resource = t(keys.resource);
                const action = t(keys.action);
                const actions = permissionGroups.get(resource) ?? new Set<string>();
                actions.add(action);
                permissionGroups.set(resource, actions);
              }
              const roleInputId = `member-role-${role.id}`;

              return (
                <div key={role.id} className="grid gap-2 rounded-md border p-3">
                  <label
                    htmlFor={roleInputId}
                    className="flex min-h-8 items-center gap-2 font-medium"
                  >
                    <ShadcnCheckbox
                      id={roleInputId}
                      name="roleId"
                      value={role.id}
                      defaultChecked={assignedRoleIds.has(role.id)}
                    />
                    {t(roleLabelKey(role.name))}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {t(roleDescriptionKey(role.name))}
                  </p>
                  {permissionGroups.size ? (
                    <details className="rounded-md border px-3 py-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t('Users.permissions')} ({role.permissions.length})
                      </summary>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                        {Array.from(permissionGroups, ([resource, actions]) => (
                          <li key={resource} className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{resource}:</span>{' '}
                            {Array.from(actions).join(', ')}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('Users.noPermissions')}</p>
                  )}
                </div>
              );
            })}
          </fieldset>
          <ConfirmSubmitButton
            confirmation={t('Users.roleChangeConfirmation')}
            variant="default"
            disabled={member.status === 'revoked'}
          >
            {t('Users.saveRoles')}
          </ConfirmSubmitButton>
        </RHFActionForm>
      </section>

      <section aria-labelledby="scopes-title" className="grid gap-4 rounded-lg border bg-card p-5">
        <div>
          <h2 id="scopes-title" className="text-xl font-semibold">
            {t('Users.scopesTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Users.scopeHelp')}</p>
        </div>
        <MemberScopesForm
          membershipId={member.id}
          tenantScope={tenantScope}
          teams={scopesOfType('team')}
          organizations={scopesOfType('organization')}
          facilities={scopesOfType('facility')}
          disabled={member.status === 'revoked'}
          labels={{
            scope: t('Users.scope'),
            entireTenant: t('Users.entireTenant'),
            selectedScopes: t('Users.selectedScopes'),
            teams: t('Teams.title'),
            organizations: t('Organizations.title'),
            facilities: t('Facilities.title'),
            noVisibleTeams: t('Users.noVisibleTeams'),
            noVisibleOrganizations: t('Users.noVisibleOrganizations'),
            noVisibleFacilities: t('Users.noVisibleFacilities'),
            saving: t('Common.formValidation.saving'),
            accessUpdated: t('Users.accessUpdated'),
            scopeConflict: t('Users.scopeConflict'),
            requestFailed: t('Users.requestFailed'),
            saveScopes: t('Users.saveScopes'),
            scopeChangeConfirmation: t('Users.scopeChangeConfirmation'),
          }}
        />
      </section>

      <section
        aria-labelledby="effective-title"
        className="grid gap-2 rounded-lg border bg-card p-5"
      >
        <h2 id="effective-title" className="text-xl font-semibold">
          {t('Users.effectivePermissions')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('Users.assignedPermissionsHelp')}</p>
        <p className="text-sm text-muted-foreground">
          {member.permissions.length
            ? member.permissions
                .map((permission) => {
                  const keys = permissionLabelKeys(permission);
                  return t('Users.permissionLabel', {
                    resource: t(keys.resource),
                    action: t(keys.action),
                  });
                })
                .join(', ')
            : t('Users.noPermissions')}
        </p>
      </section>
    </div>
  );
}
