import { Checkbox as ShadcnCheckbox } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button, StatusBadge } from '@care/ui';
import { permissionLabelKeys, roleLabelKey } from '@app/web/i18n/access';
import { errorMessageKey } from '@app/web/i18n/errors';
import { statusLabelKey } from '@app/web/i18n/status';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import {
  activateMemberAction,
  deactivateMemberAction,
  replaceMemberRolesAction,
  replaceMemberScopesAction,
  revokeMemberAction,
} from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function MemberDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const get = api.GET;
  const [memberResult, rolesResult, organizationsResult, facilitiesResult, teamsResult] =
    await Promise.all([
      get('/api/v1/admin/members/{id}', {
        params: { path: { id }, header: await getTenantHeader() },
      }),
      get('/api/v1/admin/roles', { params: { header: await getTenantHeader() } }),
      get('/api/v1/organizations', { params: { header: await getTenantHeader() } }),
      get('/api/v1/facilities', { params: { header: await getTenantHeader() } }),
      get('/api/v1/teams', { params: { header: await getTenantHeader() } }),
    ]);
  if (memberResult.response.status === 404) notFound();
  if (!memberResult.data) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        {t('Users.loadFailed')}
      </p>
    );
  }
  const member = memberResult.data;
  const roles = rolesResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const teams = teamsResult.data ?? [];
  const assignedRoleIds = new Set(member.roles.map((role) => role.id));
  const assignedScopes = new Set(
    member.scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`),
  );
  const tenantScope = member.scopes.some((scope) => scope.scopeType === 'tenant');

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/users">{t('Users.title')}</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {member.displayName || member.email || member.userId}
          </h1>
          <StatusBadge status={member.status} label={t(statusLabelKey(member.status))} />
        </div>
        <p className="text-slate-700">
          {member.email || t('Users.noVerifiedEmail')} · {t('Users.userId', { id: member.userId })}
        </p>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('Users.accessUpdated')}
        </p>
      ) : null}
      {rolesResult.error ||
      organizationsResult.error ||
      facilitiesResult.error ||
      teamsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Users.targetsLoadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="lifecycle-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
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
            <p className="text-sm text-slate-600">{t('Users.revokedCannotReactivate')}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="roles-title" className="grid gap-4 rounded-lg border bg-white p-5">
        <div>
          <h2 id="roles-title" className="text-xl font-semibold">
            {t('Users.roles')}
          </h2>
          <p className="text-sm text-slate-600">{t('Users.roleHelp')}</p>
        </div>
        <RHFActionForm action={replaceMemberRolesAction} className="grid gap-4">
          <input type="hidden" name="membershipId" value={member.id} />
          <fieldset className="grid gap-4">
            <legend className="sr-only">{t('Users.availableRoles')}</legend>
            {roles.map((role) => (
              <label key={role.id} className="grid gap-1 rounded-md border p-3">
                <span className="flex items-center gap-2 font-medium">
                  <ShadcnCheckbox
                    name="roleId"
                    value={role.id}
                    defaultChecked={assignedRoleIds.has(role.id)}
                  />
                  {t(roleLabelKey(role.name))}
                </span>
                <span className="text-sm text-slate-600">
                  {t('Users.permissions')}:{' '}
                  {role.permissions
                    .map((permission) => {
                      const keys = permissionLabelKeys(permission);
                      return t('Users.permissionLabel', {
                        resource: t(keys.resource),
                        action: t(keys.action),
                      });
                    })
                    .join(', ') || t('Users.noPermissions')}
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={member.status === 'revoked'}>
            {t('Users.saveRoles')}
          </Button>
        </RHFActionForm>
      </section>

      <section aria-labelledby="scopes-title" className="grid gap-4 rounded-lg border bg-white p-5">
        <div>
          <h2 id="scopes-title" className="text-xl font-semibold">
            {t('Users.scopesTitle')}
          </h2>
          <p className="text-sm text-slate-600">{t('Users.scopeHelp')}</p>
        </div>
        <RHFActionForm action={replaceMemberScopesAction} className="grid gap-4">
          <input type="hidden" name="membershipId" value={member.id} />
          <fieldset className="grid gap-3">
            <legend className="font-medium">{t('Users.scope')}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scopeMode" value="tenant" defaultChecked={tenantScope} />
              {t('Users.entireTenant')}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scopeMode" value="scoped" defaultChecked={!tenantScope} />
              {t('Users.selectedScopes')}
            </label>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="font-medium">{t('Teams.title')}</legend>
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-2">
                <ShadcnCheckbox
                  name="scope"
                  value={`team:${team.id}`}
                  defaultChecked={assignedScopes.has(`team:${team.id}`)}
                />
                {team.name} — {team.organizationName}
              </label>
            ))}
            {teams.length === 0 ? (
              <p className="text-sm text-slate-600">{t('Users.noVisibleTeams')}</p>
            ) : null}
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="font-medium">{t('Organizations.title')}</legend>
            {organizations.map((organization) => (
              <label key={organization.id} className="flex items-center gap-2">
                <ShadcnCheckbox
                  name="scope"
                  value={`organization:${organization.id}`}
                  defaultChecked={assignedScopes.has(`organization:${organization.id}`)}
                />
                {organization.name}
              </label>
            ))}
            {organizations.length === 0 ? (
              <p className="text-sm text-slate-600">{t('Users.noVisibleOrganizations')}</p>
            ) : null}
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="font-medium">{t('Facilities.title')}</legend>
            {facilities.map((facility) => (
              <label key={facility.id} className="flex items-center gap-2">
                <ShadcnCheckbox
                  name="scope"
                  value={`facility:${facility.id}`}
                  defaultChecked={assignedScopes.has(`facility:${facility.id}`)}
                />
                {facility.name} — {facility.organizationName}
              </label>
            ))}
            {facilities.length === 0 ? (
              <p className="text-sm text-slate-600">{t('Users.noVisibleFacilities')}</p>
            ) : null}
          </fieldset>
          <Button type="submit" disabled={member.status === 'revoked'}>
            {t('Users.saveScopes')}
          </Button>
        </RHFActionForm>
      </section>

      <section
        aria-labelledby="effective-title"
        className="grid gap-2 rounded-lg border bg-white p-5"
      >
        <h2 id="effective-title" className="text-xl font-semibold">
          {t('Users.effectivePermissions')}
        </h2>
        <p className="text-sm text-slate-700">
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
