import { describe, expect, test } from 'bun:test';
import {
  authorizeProfessionalOperation,
  AuthorizationDeniedError,
  can,
  canGrantPermissions,
  type AuthorizationPrincipal,
  type CompetencyPolicyEvaluator,
  type CompetencyPolicyEvaluationRequest,
  type CompetencyPolicyEvaluationResult,
} from './index';

const professionalResource = {
  tenantId: 'tenant-1',
  organizationId: 'organization-1',
  facilityId: 'facility-1',
  type: 'care_plan',
  id: 'plan-1',
};

const professionalPrincipal: AuthorizationPrincipal = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  grants: [{ permission: 'care_plan.activate', scopeType: 'facility', scopeId: 'facility-1' }],
};

function evaluatorReturning(
  result: CompetencyPolicyEvaluationResult,
  onEvaluate: (request: CompetencyPolicyEvaluationRequest) => void = () => {},
): CompetencyPolicyEvaluator<object> {
  return {
    evaluate: async (_context, request) => {
      onEvaluate(request);
      return result;
    },
  };
}

describe('can', () => {
  const principal: AuthorizationPrincipal = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    grants: [
      { permission: 'client.read', scopeType: 'tenant', scopeId: 'tenant-1' },
      { permission: 'client.update', scopeType: 'facility', scopeId: 'facility-1' },
      { permission: 'client.read', scopeType: 'assigned_clients', scopeId: 'user-1' },
    ],
  };

  test('requires membership tenant and permission', () => {
    expect(can(principal, { action: 'client.read', resource: { tenantId: 'tenant-1' } })).toBe(
      true,
    );
    expect(can(principal, { action: 'client.archive', resource: { tenantId: 'tenant-1' } })).toBe(
      false,
    );
    expect(can(principal, { action: 'client.read', resource: { tenantId: 'tenant-2' } })).toBe(
      false,
    );
  });

  test('evaluates facility and assigned-client scopes', () => {
    expect(
      can(principal, {
        action: 'client.update',
        resource: { tenantId: 'tenant-1', facilityId: 'facility-1' },
      }),
    ).toBe(true);
    const assignedOnly: AuthorizationPrincipal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      grants: [{ permission: 'client.read', scopeType: 'assigned_clients', scopeId: 'user-1' }],
    };
    expect(
      can(assignedOnly, {
        action: 'client.read',
        resource: { tenantId: 'tenant-1', clientId: 'client-1', assignedUserIds: ['user-1'] },
      }),
    ).toBe(true);
    expect(
      can(assignedOnly, {
        action: 'client.read',
        resource: { tenantId: 'tenant-1', clientId: 'client-1', assignedUserIds: ['user-2'] },
      }),
    ).toBe(false);
  });

  test('evaluates organization and facility resources against matching scope ids', () => {
    const scoped: AuthorizationPrincipal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      grants: [
        { permission: 'organization.read', scopeType: 'organization', scopeId: 'org-1' },
        { permission: 'facility.read', scopeType: 'facility', scopeId: 'facility-1' },
      ],
    };

    expect(
      can(scoped, {
        action: 'organization.read',
        resource: { tenantId: 'tenant-1', organizationId: 'org-1' },
      }),
    ).toBe(true);
    expect(
      can(scoped, {
        action: 'organization.read',
        resource: { tenantId: 'tenant-1', organizationId: 'org-2' },
      }),
    ).toBe(false);
    expect(
      can(scoped, {
        action: 'facility.read',
        resource: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          facilityId: 'facility-1',
        },
      }),
    ).toBe(true);
  });

  test('matches employee facility and team assignment collections', () => {
    const scoped: AuthorizationPrincipal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      grants: [
        { permission: 'employee.read', scopeType: 'facility', scopeId: 'facility-2' },
        { permission: 'employee.read', scopeType: 'team', scopeId: 'team-3' },
      ],
    };

    expect(
      can(scoped, {
        action: 'employee.read',
        resource: {
          tenantId: 'tenant-1',
          organizationId: 'organization-1',
          facilityIds: ['facility-1', 'facility-2'],
          teamIds: ['team-3'],
        },
      }),
    ).toBe(true);
  });

  test('keeps legacy broad management grants compatible', () => {
    const administrator: AuthorizationPrincipal = {
      userId: 'admin',
      tenantId: 'tenant-1',
      grants: [
        { permission: 'employee.manage', scopeType: 'tenant', scopeId: 'tenant-1' },
        { permission: 'organization.manage', scopeType: 'tenant', scopeId: 'tenant-1' },
      ],
    };
    const resource = { tenantId: 'tenant-1', organizationId: 'organization-1' };

    expect(can(administrator, { action: 'employee.assign_team', resource })).toBe(true);
    expect(can(administrator, { action: 'team.manage', resource })).toBe(true);
  });

  test('requires explicit role assignment and prevents permission escalation', () => {
    const administrator: AuthorizationPrincipal = {
      userId: 'admin',
      tenantId: 'tenant-1',
      grants: [
        { permission: 'tenant.roles.assign', scopeType: 'tenant', scopeId: 'tenant-1' },
        { permission: 'tenant.members.manage', scopeType: 'tenant', scopeId: 'tenant-1' },
        { permission: 'client.read', scopeType: 'tenant', scopeId: 'tenant-1' },
      ],
    };
    const office: AuthorizationPrincipal = {
      userId: 'office',
      tenantId: 'tenant-1',
      grants: [{ permission: 'client.read', scopeType: 'tenant', scopeId: 'tenant-1' }],
    };
    const tenant = { tenantId: 'tenant-1' };

    expect(canGrantPermissions(administrator, ['client.read'], tenant)).toBe(true);
    expect(canGrantPermissions(administrator, ['tenant.members.manage'], tenant)).toBe(true);
    expect(canGrantPermissions(office, ['client.read'], tenant)).toBe(false);
    expect(canGrantPermissions(administrator, ['client.read'], { tenantId: 'tenant-2' })).toBe(
      false,
    );
  });
});

describe('authorizeProfessionalOperation', () => {
  test('does not evaluate competency when permission or resource scope is denied', async () => {
    let evaluations = 0;
    const evaluator = evaluatorReturning(
      {
        allowed: true,
        policyId: 'policy-1',
        policyVersion: 3,
        employeeId: 'employee-1',
        matchedQualificationIds: ['qualification-1'],
        evaluatedAt: new Date('2026-10-08T10:00:00.000Z'),
      },
      () => {
        evaluations += 1;
      },
    );

    await expect(
      authorizeProfessionalOperation(
        {},
        professionalPrincipal,
        {
          permission: 'care_plan.evaluate',
          operation: 'care_plan.evaluate',
          resource: professionalResource,
        },
        evaluator,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      authorizeProfessionalOperation(
        {},
        professionalPrincipal,
        {
          permission: 'care_plan.activate',
          operation: 'care_plan.activate',
          resource: { ...professionalResource, facilityId: 'facility-2' },
        },
        evaluator,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    expect(evaluations).toBe(0);
  });

  test('returns competency metadata after permission and scope are allowed', async () => {
    const evaluatedAt = new Date('2026-10-08T10:00:00.000Z');
    const metadata = {
      policyId: 'policy-1',
      policyVersion: 3,
      employeeId: 'employee-1',
      matchedQualificationIds: ['qualification-1', 'qualification-2'],
      evaluatedAt,
    };
    let evaluatedRequest: CompetencyPolicyEvaluationRequest | undefined;
    const context = {};

    const result = await authorizeProfessionalOperation(
      context,
      professionalPrincipal,
      {
        permission: 'care_plan.activate',
        operation: 'care_plan.activate',
        resource: professionalResource,
        effectiveAt: evaluatedAt,
      },
      evaluatorReturning({ allowed: true, ...metadata }, (request) => {
        evaluatedRequest = request;
      }),
    );

    expect(result).toEqual(metadata);
    expect(evaluatedRequest).toEqual({
      tenantId: professionalPrincipal.tenantId,
      userId: professionalPrincipal.userId,
      operation: 'care_plan.activate',
      resource: { type: 'care_plan', id: 'plan-1' },
      effectiveAt: evaluatedAt,
    });
  });

  test('propagates competency denial reason in a stable authorization error', async () => {
    const evaluator = evaluatorReturning({
      allowed: false,
      reasonCode: 'COMPETENCY_POLICY_NOT_CONFIGURED',
    });

    await expect(
      authorizeProfessionalOperation(
        {},
        professionalPrincipal,
        {
          permission: 'care_plan.activate',
          operation: 'care_plan.activate',
          resource: professionalResource,
        },
        evaluator,
      ),
    ).rejects.toMatchObject({
      name: 'ProfessionalCompetencyDeniedError',
      code: 'COMPETENCY_POLICY_NOT_CONFIGURED',
      reasonCode: 'COMPETENCY_POLICY_NOT_CONFIGURED',
    });
  });

  test('does not let an Administrator permission bypass a missing qualification', async () => {
    const administrator: AuthorizationPrincipal = {
      userId: 'admin-1',
      tenantId: 'tenant-1',
      roles: ['Administrator'],
      grants: [{ permission: 'care_plan.activate', scopeType: 'tenant', scopeId: 'tenant-1' }],
    };

    await expect(
      authorizeProfessionalOperation(
        {},
        administrator,
        {
          permission: 'care_plan.activate',
          operation: 'care_plan.activate',
          resource: professionalResource,
        },
        evaluatorReturning({
          allowed: false,
          reasonCode: 'COMPETENCY_QUALIFICATION_MISSING',
        }),
      ),
    ).rejects.toMatchObject({
      name: 'ProfessionalCompetencyDeniedError',
      code: 'COMPETENCY_QUALIFICATION_MISSING',
    });
  });

  test('does not let a qualified Caregiver bypass an activation permission', async () => {
    const caregiver: AuthorizationPrincipal = {
      userId: 'caregiver-1',
      tenantId: 'tenant-1',
      roles: ['Caregiver'],
      grants: [{ permission: 'care_plan.read', scopeType: 'tenant', scopeId: 'tenant-1' }],
    };
    let evaluations = 0;

    await expect(
      authorizeProfessionalOperation(
        {},
        caregiver,
        {
          permission: 'care_plan.activate',
          operation: 'care_plan.activate',
          resource: professionalResource,
        },
        evaluatorReturning(
          {
            allowed: true,
            policyId: 'policy-1',
            policyVersion: 1,
            employeeId: 'employee-1',
            matchedQualificationIds: ['qualification-1'],
            evaluatedAt: new Date('2026-10-08T10:00:00.000Z'),
          },
          () => {
            evaluations += 1;
          },
        ),
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(evaluations).toBe(0);
  });
});
