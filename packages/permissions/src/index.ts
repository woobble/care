export const PERMISSIONS = [
  'tenant.members.read',
  'tenant.members.manage',
  'tenant.roles.read',
  'tenant.roles.assign',
  'client.read',
  'client.create',
  'client.update',
  'client.archive',
  'employee.read',
  'employee.manage',
  'organization.read',
  'organization.manage',
  'facility.read',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type ScopeType = 'assigned_clients' | 'team' | 'facility' | 'organization' | 'tenant';

export interface PermissionGrant {
  permission: Permission;
  scopeType: ScopeType;
  scopeId: string;
}

export interface AuthorizationPrincipal {
  userId: string;
  tenantId: string;
  roles?: readonly string[];
  grants: readonly PermissionGrant[];
}

export interface ResourceContext {
  tenantId: string;
  clientId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  assignedUserIds?: readonly string[];
}

export interface AuthorizationRequest {
  action: Permission;
  resource: ResourceContext;
}

export function can(principal: AuthorizationPrincipal, request: AuthorizationRequest): boolean {
  if (principal.tenantId !== request.resource.tenantId) return false;

  return principal.grants.some(
    (grant) =>
      grant.permission === request.action &&
      scopeMatches(grant, request.resource, principal.userId),
  );
}

export function canGrantPermissions(
  principal: AuthorizationPrincipal,
  permissions: readonly Permission[],
  resource: ResourceContext,
): boolean {
  return (
    can(principal, { action: 'tenant.roles.assign', resource }) &&
    permissions.every((permission) => can(principal, { action: permission, resource }))
  );
}

export function assertCan(principal: AuthorizationPrincipal, request: AuthorizationRequest): void {
  if (!can(principal, request)) throw new AuthorizationDeniedError(request.action);
}

function scopeMatches(grant: PermissionGrant, resource: ResourceContext, userId: string): boolean {
  switch (grant.scopeType) {
    case 'tenant':
      return grant.scopeId === resource.tenantId;
    case 'organization':
      return grant.scopeId === resource.organizationId;
    case 'facility':
      return grant.scopeId === resource.facilityId;
    case 'team':
      return grant.scopeId === resource.teamId;
    case 'assigned_clients':
      return (
        grant.scopeId === userId &&
        resource.clientId !== undefined &&
        resource.assignedUserIds?.includes(userId) === true
      );
  }
}

export class AuthorizationDeniedError extends Error {
  readonly code = 'INSUFFICIENT_PERMISSION';

  constructor(readonly action: Permission) {
    super('The requested action is not allowed');
    this.name = 'AuthorizationDeniedError';
  }
}
