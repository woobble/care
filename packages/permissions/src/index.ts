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
  'clinical_documentation.read',
  'clinical_documentation.create',
  'clinical_documentation.update',
  'clinical_documentation.review',
  'clinical_documentation.amend',
  'care_plan.read',
  'care_plan.create',
  'care_plan.update',
  'care_plan.activate',
  'care_plan.evaluate',
  'care_plan.end',
  'care_plan.review_history',
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
  'competency_policy.read',
  'competency_policy.manage',
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

export const COMPETENCY_OPERATIONS = ['care_plan.activate', 'care_plan.evaluate'] as const;
export type CompetencyOperation = (typeof COMPETENCY_OPERATIONS)[number];

export const COMPETENCY_DENIAL_CODES = [
  'COMPETENCY_POLICY_NOT_CONFIGURED',
  'COMPETENCY_POLICY_INACTIVE',
  'COMPETENCY_POLICY_INVALID',
  'COMPETENCY_EMPLOYEE_LINK_REQUIRED',
  'COMPETENCY_EMPLOYEE_INACTIVE',
  'COMPETENCY_QUALIFICATION_MISSING',
  'COMPETENCY_QUALIFICATION_EXPIRED',
  'COMPETENCY_REQUIREMENTS_NOT_MET',
  'COMPETENCY_POLICY_CHANGED',
] as const;
export type CompetencyDenialCode = (typeof COMPETENCY_DENIAL_CODES)[number];

export interface CompetencyResource {
  type: string;
  id: string;
}

export interface CompetencyPolicyEvaluationRequest {
  tenantId: string;
  userId: string;
  operation: CompetencyOperation;
  resource?: CompetencyResource;
  effectiveAt?: Date;
}

export interface CompetencyAuthorizationMetadata {
  policyId: string;
  policyVersion: number;
  employeeId: string;
  matchedQualificationIds: readonly string[];
  evaluatedAt: Date;
}

export type CompetencyPolicyEvaluationResult =
  | ({ allowed: true } & CompetencyAuthorizationMetadata)
  | {
      allowed: false;
      reasonCode: CompetencyDenialCode;
      policyId?: string;
      policyVersion?: number;
    };

export interface CompetencyPolicyEvaluator<TContext> {
  evaluate(
    context: TContext,
    request: CompetencyPolicyEvaluationRequest,
  ): Promise<CompetencyPolicyEvaluationResult>;
}

export interface ProfessionalOperationAuthorizationRequest {
  permission: Permission;
  operation: CompetencyOperation;
  resource: ResourceContext & CompetencyResource;
  effectiveAt?: Date;
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

export async function authorizeProfessionalOperation<TContext>(
  context: TContext,
  principal: AuthorizationPrincipal,
  request: ProfessionalOperationAuthorizationRequest,
  evaluator: CompetencyPolicyEvaluator<TContext>,
): Promise<CompetencyAuthorizationMetadata> {
  assertCan(principal, { action: request.permission, resource: request.resource });

  const result = await evaluator.evaluate(context, {
    tenantId: principal.tenantId,
    userId: principal.userId,
    operation: request.operation,
    resource: { type: request.resource.type, id: request.resource.id },
    ...(request.effectiveAt ? { effectiveAt: request.effectiveAt } : {}),
  });
  if (!result.allowed) {
    throw new ProfessionalCompetencyDeniedError(
      result.reasonCode,
      result.policyId,
      result.policyVersion,
    );
  }

  return {
    policyId: result.policyId,
    policyVersion: result.policyVersion,
    employeeId: result.employeeId,
    matchedQualificationIds: result.matchedQualificationIds,
    evaluatedAt: result.evaluatedAt,
  };
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

export class ProfessionalCompetencyDeniedError extends Error {
  readonly code: CompetencyDenialCode;

  constructor(
    readonly reasonCode: CompetencyDenialCode,
    readonly policyId?: string,
    readonly policyVersion?: number,
  ) {
    super('The professional competency requirements are not satisfied');
    this.name = 'ProfessionalCompetencyDeniedError';
    this.code = reasonCode;
  }
}
