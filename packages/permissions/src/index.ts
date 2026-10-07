export const PERMISSIONS = [
  'tenant.members.read',
  'tenant.members.manage',
  'tenant.roles.read',
  'tenant.roles.assign',
  'client.read',
  'client.create',
  'client.update',
  'client.archive',
  'service.read',
  'service.create',
  'service.update',
  'service.archive',
  'service.manage_categories',
  'service.manage_availability',
  'service_agreement.read',
  'service_agreement.create',
  'service_agreement.update',
  'service_agreement.activate',
  'service_agreement.suspend',
  'service_agreement.end',
  'service_agreement.manage_services',
  'schedule.read',
  'schedule.create',
  'schedule.update',
  'schedule.cancel',
  'schedule.confirm',
  'schedule.assign',
  'schedule.generate',
  'visit_execution.read',
  'visit_execution.start',
  'visit_execution.record_services',
  'visit_execution.complete',
  'visit_execution.correct',
  'care_documentation.read',
  'care_documentation.create',
  'care_documentation.update',
  'care_documentation.finalize',
  'care_documentation.amend',
  'care_documentation.review',
  'service_evidence.read',
  'service_evidence.prepare',
  'acknowledgement.read',
  'acknowledgement.capture',
  'acknowledgement.revoke',
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.archive',
  'employee.assign_facility',
  'employee.assign_team',
  'employee.link_user',
  'employee.manage_qualifications',
  'employee.manage_skills',
  'employee.manage_employment',
  'employee.manage',
  'organization.read',
  'organization.create',
  'organization.update',
  'organization.activate',
  'organization.archive',
  'organization.manage',
  'facility.read',
  'facility.create',
  'facility.update',
  'facility.activate',
  'facility.archive',
  'team.read',
  'team.manage',
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
  facilityIds?: readonly string[];
  teamId?: string;
  teamIds?: readonly string[];
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
      permissionMatches(grant.permission, request.action) &&
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
      return (
        grant.scopeId === resource.facilityId ||
        resource.facilityIds?.includes(grant.scopeId) === true
      );
    case 'team':
      return (
        grant.scopeId === resource.teamId || resource.teamIds?.includes(grant.scopeId) === true
      );
    case 'assigned_clients':
      return (
        grant.scopeId === userId &&
        resource.clientId !== undefined &&
        resource.assignedUserIds?.includes(userId) === true
      );
  }
}

function permissionMatches(granted: Permission, requested: Permission): boolean {
  if (granted === requested) return true;
  if (granted === 'employee.manage') return requested.startsWith('employee.');
  if (granted === 'organization.manage') {
    return (
      requested.startsWith('organization.') ||
      requested.startsWith('facility.') ||
      requested.startsWith('team.')
    );
  }
  return false;
}

export class AuthorizationDeniedError extends Error {
  readonly code = 'INSUFFICIENT_PERMISSION';

  constructor(readonly action: Permission) {
    super('The requested action is not allowed');
    this.name = 'AuthorizationDeniedError';
  }
}
