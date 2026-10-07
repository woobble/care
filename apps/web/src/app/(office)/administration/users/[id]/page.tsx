import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import {
  activateMemberAction,
  deactivateMemberAction,
  replaceMemberRolesAction,
  replaceMemberScopesAction,
  revokeMemberAction,
} from '../../actions';
import { ConfirmSubmitButton } from '../../confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function MemberDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
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
        Member details could not be loaded ({memberResult.error?.code}).
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
          <Link href="/administration/users">Users &amp; Access</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {member.displayName || member.email || member.userId}
          </h1>
          <StatusBadge status={member.status} />
        </div>
        <p className="text-slate-700">
          {member.email || 'No verified email'} · User {member.userId}
        </p>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Update failed ({query.error}).
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          Member access updated.
        </p>
      ) : null}
      {rolesResult.error ||
      organizationsResult.error ||
      facilitiesResult.error ||
      teamsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Roles or scope targets could not be loaded (
          {rolesResult.error?.code ||
            organizationsResult.error?.code ||
            facilitiesResult.error?.code ||
            teamsResult.error?.code}
          ).
        </p>
      ) : null}

      <section
        aria-labelledby="lifecycle-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="lifecycle-title" className="text-xl font-semibold">
          Membership lifecycle
        </h2>
        <div className="flex flex-wrap gap-3">
          {member.status === 'pending' || member.status === 'inactive' ? (
            <form action={activateMemberAction}>
              <input type="hidden" name="membershipId" value={member.id} />
              <Button type="submit">Activate membership</Button>
            </form>
          ) : null}
          {member.status === 'active' ? (
            <form action={deactivateMemberAction}>
              <input type="hidden" name="membershipId" value={member.id} />
              <Button type="submit" variant="secondary">
                Deactivate membership
              </Button>
            </form>
          ) : null}
          {member.status !== 'revoked' ? (
            <form action={revokeMemberAction}>
              <input type="hidden" name="membershipId" value={member.id} />
              <ConfirmSubmitButton confirmation="Revoking tenant access is permanent. Continue?">
                Revoke access
              </ConfirmSubmitButton>
            </form>
          ) : (
            <p className="text-sm text-slate-600">Revoked memberships cannot be reactivated.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="roles-title" className="grid gap-4 rounded-lg border bg-white p-5">
        <div>
          <h2 id="roles-title" className="text-xl font-semibold">
            Roles
          </h2>
          <p className="text-sm text-slate-600">
            Selecting a role grants every permission shown for that role at the assigned scopes.
          </p>
        </div>
        <form action={replaceMemberRolesAction} className="grid gap-4">
          <input type="hidden" name="membershipId" value={member.id} />
          <fieldset className="grid gap-4">
            <legend className="sr-only">Available system roles</legend>
            {roles.map((role) => (
              <label key={role.id} className="grid gap-1 rounded-md border p-3">
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    name="roleId"
                    value={role.id}
                    defaultChecked={assignedRoleIds.has(role.id)}
                  />
                  {role.name}
                </span>
                <span className="text-sm text-slate-600">
                  Permissions: {role.permissions.join(', ') || 'none'}
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={member.status === 'revoked'}>
            Save roles
          </Button>
        </form>
      </section>

      <section aria-labelledby="scopes-title" className="grid gap-4 rounded-lg border bg-white p-5">
        <div>
          <h2 id="scopes-title" className="text-xl font-semibold">
            Access scopes
          </h2>
          <p className="text-sm text-slate-600">
            A tenant scope cannot be combined with organization, facility, or team scopes.
          </p>
        </div>
        <form action={replaceMemberScopesAction} className="grid gap-4">
          <input type="hidden" name="membershipId" value={member.id} />
          <fieldset className="grid gap-3">
            <legend className="font-medium">Scope</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scopeMode" value="tenant" defaultChecked={tenantScope} />
              Entire tenant
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scopeMode" value="scoped" defaultChecked={!tenantScope} />
              Selected organizations, facilities, and teams
            </label>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="font-medium">Teams</legend>
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="scope"
                  value={`team:${team.id}`}
                  defaultChecked={assignedScopes.has(`team:${team.id}`)}
                />
                {team.name} — {team.organizationName}
              </label>
            ))}
            {teams.length === 0 ? (
              <p className="text-sm text-slate-600">No visible teams.</p>
            ) : null}
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="font-medium">Organizations</legend>
            {organizations.map((organization) => (
              <label key={organization.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="scope"
                  value={`organization:${organization.id}`}
                  defaultChecked={assignedScopes.has(`organization:${organization.id}`)}
                />
                {organization.name}
              </label>
            ))}
            {organizations.length === 0 ? (
              <p className="text-sm text-slate-600">No visible organizations.</p>
            ) : null}
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="font-medium">Facilities</legend>
            {facilities.map((facility) => (
              <label key={facility.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="scope"
                  value={`facility:${facility.id}`}
                  defaultChecked={assignedScopes.has(`facility:${facility.id}`)}
                />
                {facility.name} — {facility.organizationName}
              </label>
            ))}
            {facilities.length === 0 ? (
              <p className="text-sm text-slate-600">No visible facilities.</p>
            ) : null}
          </fieldset>
          <Button type="submit" disabled={member.status === 'revoked'}>
            Save scopes
          </Button>
        </form>
      </section>

      <section
        aria-labelledby="effective-title"
        className="grid gap-2 rounded-lg border bg-white p-5"
      >
        <h2 id="effective-title" className="text-xl font-semibold">
          Effective permissions
        </h2>
        <p className="text-sm text-slate-700">
          {member.permissions.join(', ') || 'No permissions assigned.'}
        </p>
      </section>
    </div>
  );
}
