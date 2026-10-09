import { describe, expect, test } from 'bun:test';
import {
  deriveQualificationStatus,
  evaluateWorkforceReadiness,
  InvalidWorkforceComplianceInputError,
  type QualificationFacts,
  type WorkforceReadinessInput,
} from './workforce-compliance';

const thresholds = { criticalDays: 7, warningDays: 30 };
const activeEmployee = {
  employeeId: 'employee-1',
  status: 'active' as const,
  requiresEmployeeLink: true,
  employeeLinked: true,
};

function qualification(
  id: string,
  qualificationId: string,
  validFrom: string | null,
  validUntil: string | null,
  assignmentStatus: 'active' | 'revoked' = 'active',
): QualificationFacts {
  return { id, qualificationId, validFrom, validUntil, assignmentStatus };
}

function activePolicy(
  requirementMode: 'ANY' | 'ALL',
  requiredQualificationIds: readonly string[],
): Extract<WorkforceReadinessInput['policy'], { status: 'active' }> {
  return {
    status: 'active',
    operationKey: 'care_plan.activate',
    policyId: 'policy-1',
    policyVersion: 2,
    requirementMode,
    requirementCount: requiredQualificationIds.length,
    requiredQualificationIds,
    qualificationDefinitionStatuses: requiredQualificationIds.map((qualificationId) => ({
      qualificationId,
      status: 'active' as const,
    })),
  };
}

function readinessInput(overrides: Partial<WorkforceReadinessInput> = {}): WorkforceReadinessInput {
  return {
    employee: activeEmployee,
    policy: activePolicy('ALL', ['nurse']),
    qualifications: [qualification('assignment-1', 'nurse', null, null)],
    horizon: { from: '2026-01-01', through: '2026-01-31' },
    thresholds,
    ...overrides,
  };
}

describe('qualification compliance status', () => {
  test('validUntil is inclusive and open-ended assignments remain valid', () => {
    expect(
      deriveQualificationStatus(
        qualification('a1', 'nurse', '2026-01-01', '2026-01-31'),
        '2026-01-31',
        thresholds,
      ),
    ).toBe('expiring_soon');
    expect(
      deriveQualificationStatus(
        qualification('a2', 'nurse', '2026-01-01', null),
        '2026-01-31',
        thresholds,
      ),
    ).toBe('valid');
  });

  test('reports future and expired assignments at the exact calendar boundary', () => {
    expect(
      deriveQualificationStatus(
        qualification('a1', 'nurse', '2026-01-02', null),
        '2026-01-01',
        thresholds,
      ),
    ).toBe('not_yet_valid');
    expect(
      deriveQualificationStatus(
        qualification('a2', 'nurse', null, '2025-12-31'),
        '2026-01-01',
        thresholds,
      ),
    ).toBe('expired');
  });

  test('revocation wins over validity dates', () => {
    expect(
      deriveQualificationStatus(
        qualification('a1', 'nurse', '2026-02-01', '2026-02-28', 'revoked'),
        '2026-01-01',
        thresholds,
      ),
    ).toBe('revoked');
  });

  test('requires positive thresholds with critical no greater than warning', () => {
    expect(() =>
      deriveQualificationStatus(qualification('a1', 'nurse', null, null), '2026-01-01', {
        criticalDays: 0,
        warningDays: 30,
      }),
    ).toThrow(InvalidWorkforceComplianceInputError);
    expect(() =>
      deriveQualificationStatus(qualification('a1', 'nurse', null, null), '2026-01-01', {
        criticalDays: 31,
        warningDays: 30,
      }),
    ).toThrow(InvalidWorkforceComplianceInputError);
    expect(() =>
      deriveQualificationStatus(qualification('a1', 'nurse', null, null), '2026-01-01', {
        criticalDays: 7,
        warningDays: 366,
      }),
    ).toThrow(InvalidWorkforceComplianceInputError);
  });

  test('rejects invalid ISO calendar dates and reversed validity ranges', () => {
    expect(() =>
      deriveQualificationStatus(qualification('a1', 'nurse', null, null), '2026-02-30', thresholds),
    ).toThrow(InvalidWorkforceComplianceInputError);
    expect(() =>
      deriveQualificationStatus(
        qualification('a2', 'nurse', '2026-02-02', '2026-02-01'),
        '2026-01-01',
        thresholds,
      ),
    ).toThrow(InvalidWorkforceComplianceInputError);
  });
});

describe('workforce policy readiness', () => {
  test('ANY policy stays ready when credentials bridge without a calendar-day gap', () => {
    const result = evaluateWorkforceReadiness(
      readinessInput({
        policy: activePolicy('ANY', ['nurse-a', 'nurse-b']),
        qualifications: [
          qualification('a1', 'nurse-a', '2026-01-01', '2026-01-05'),
          qualification('b1', 'nurse-b', '2026-01-06', '2026-02-15'),
        ],
        horizon: { from: '2026-01-01', through: '2026-01-31' },
      }),
    );

    expect(result).toMatchObject({ readiness: 'ready', projectedEligibilityEnd: '2026-02-15' });
    expect(
      result.findings.some((finding) => finding.code === 'COMPETENCY_ELIGIBILITY_EXPIRING'),
    ).toBe(false);
  });

  test('ALL policy becomes at risk when one required qualification expires', () => {
    const result = evaluateWorkforceReadiness(
      readinessInput({
        policy: activePolicy('ALL', ['nurse', 'first-aid']),
        qualifications: [
          qualification('a1', 'nurse', null, '2026-02-28'),
          qualification('a2', 'first-aid', null, '2026-01-03'),
        ],
        horizon: { from: '2026-01-01', through: '2026-01-10' },
      }),
    );

    expect(result).toMatchObject({ readiness: 'at_risk', projectedEligibilityEnd: '2026-01-03' });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'COMPETENCY_ELIGIBILITY_EXPIRING',
        severity: 'critical',
        blocking: false,
        effectiveDate: '2026-01-04',
        qualificationIds: ['first-aid'],
        assignmentIds: ['a2'],
      }),
    );
  });

  test('finds a one-day gap even when a requirement becomes valid again later', () => {
    const result = evaluateWorkforceReadiness(
      readinessInput({
        policy: activePolicy('ANY', ['nurse-a', 'nurse-b']),
        qualifications: [
          qualification('a1', 'nurse-a', null, '2026-01-05'),
          qualification('b1', 'nurse-b', '2026-01-07', '2026-02-15'),
        ],
        horizon: { from: '2026-01-01', through: '2026-01-10' },
      }),
    );

    expect(result).toMatchObject({ readiness: 'at_risk', projectedEligibilityEnd: '2026-01-05' });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'COMPETENCY_ELIGIBILITY_EXPIRING',
        effectiveDate: '2026-01-06',
        qualificationIds: ['nurse-a', 'nurse-b'],
      }),
    );
  });

  test('reports missing and inactive mandatory policies as critical blockers', () => {
    const missing = evaluateWorkforceReadiness(
      readinessInput({
        policy: { status: 'missing', operationKey: 'care_plan.activate' },
      }),
    );
    const inactive = evaluateWorkforceReadiness(
      readinessInput({
        policy: { status: 'inactive', operationKey: 'care_plan.activate', policyId: 'policy-1' },
      }),
    );

    expect(missing).toMatchObject({ readiness: null, projectedEligibilityEnd: null });
    expect(missing.findings).toContainEqual(
      expect.objectContaining({
        code: 'COMPETENCY_POLICY_MISSING',
        severity: 'critical',
        blocking: true,
        effectiveDate: '2026-01-01',
        policyId: null,
      }),
    );
    expect(inactive.findings).toContainEqual(
      expect.objectContaining({
        code: 'COMPETENCY_POLICY_INACTIVE',
        severity: 'critical',
        blocking: true,
        policyId: 'policy-1',
      }),
    );
    expect(inactive.readiness).toBeNull();
  });

  test('inactive employees and required missing links block readiness', () => {
    const inactive = evaluateWorkforceReadiness(
      readinessInput({ employee: { ...activeEmployee, status: 'inactive' } }),
    );
    const unlinked = evaluateWorkforceReadiness(
      readinessInput({ employee: { ...activeEmployee, employeeLinked: false } }),
    );
    const linkNotRequired = evaluateWorkforceReadiness(
      readinessInput({
        employee: { ...activeEmployee, requiresEmployeeLink: false, employeeLinked: false },
      }),
    );

    expect(inactive).toMatchObject({ readiness: 'not_ready', projectedEligibilityEnd: null });
    expect(inactive.findings.map((finding) => finding.code)).toContain('EMPLOYEE_INACTIVE');
    expect(unlinked).toMatchObject({ readiness: 'not_ready', projectedEligibilityEnd: null });
    expect(unlinked.findings.map((finding) => finding.code)).toContain('EMPLOYEE_LINK_MISSING');
    expect(linkNotRequired.readiness).toBe('ready');
  });

  test('returns the continuous eligibility end beyond the requested horizon', () => {
    const result = evaluateWorkforceReadiness(
      readinessInput({
        qualifications: [qualification('a1', 'nurse', null, '2026-04-30')],
        horizon: { from: '2026-01-01', through: '2026-02-28' },
      }),
    );

    expect(result.readiness).toBe('ready');
    expect(result.projectedEligibilityEnd).toBe('2026-04-30');
  });

  test('uses null projected end for open-ended continuous coverage', () => {
    const result = evaluateWorkforceReadiness(readinessInput());

    expect(result).toMatchObject({ readiness: 'ready', projectedEligibilityEnd: null });
  });

  test('reports an active policy with no requirements as configuration failure', () => {
    const result = evaluateWorkforceReadiness(readinessInput({ policy: activePolicy('ALL', []) }));

    expect(result.readiness).toBeNull();
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'COMPETENCY_POLICY_INVALID',
        severity: 'critical',
        blocking: true,
      }),
    );
  });

  test('marks a policy-wide eligibility loss critical within criticalDays and warning otherwise', () => {
    const critical = evaluateWorkforceReadiness(
      readinessInput({
        qualifications: [qualification('a1', 'nurse', null, '2026-01-07')],
      }),
    );
    const warning = evaluateWorkforceReadiness(
      readinessInput({
        qualifications: [qualification('a1', 'nurse', null, '2026-01-15')],
      }),
    );

    expect(critical.findings).toContainEqual(
      expect.objectContaining({ code: 'COMPETENCY_ELIGIBILITY_EXPIRING', severity: 'critical' }),
    );
    expect(warning.findings).toContainEqual(
      expect.objectContaining({ code: 'COMPETENCY_ELIGIBILITY_EXPIRING', severity: 'warning' }),
    );
  });

  test('reports invalid active policy facts for empty, mismatched, or unavailable requirements', () => {
    const empty = evaluateWorkforceReadiness(readinessInput({ policy: activePolicy('ALL', []) }));
    const mismatched = evaluateWorkforceReadiness(
      readinessInput({
        policy: { ...activePolicy('ALL', ['nurse']), requirementCount: 2 },
      }),
    );
    const inactiveDefinition = evaluateWorkforceReadiness(
      readinessInput({
        policy: {
          ...activePolicy('ALL', ['nurse']),
          qualificationDefinitionStatuses: [{ qualificationId: 'nurse', status: 'inactive' }],
        },
      }),
    );
    const missingDefinition = evaluateWorkforceReadiness(
      readinessInput({
        policy: {
          ...activePolicy('ALL', ['nurse']),
          qualificationDefinitionStatuses: [{ qualificationId: 'nurse', status: 'missing' }],
        },
      }),
    );
    const explicitInvalid = evaluateWorkforceReadiness(
      readinessInput({
        policy: {
          status: 'invalid',
          operationKey: 'care_plan.activate',
          policyId: 'policy-1',
          policyVersion: 2,
          reason: 'qualification_definition_unavailable',
          qualificationIds: ['nurse'],
        },
      }),
    );

    for (const result of [
      empty,
      mismatched,
      inactiveDefinition,
      missingDefinition,
      explicitInvalid,
    ]) {
      expect(result.readiness).toBeNull();
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          code: 'COMPETENCY_POLICY_INVALID',
          severity: 'critical',
          blocking: true,
        }),
      );
    }
  });
});
