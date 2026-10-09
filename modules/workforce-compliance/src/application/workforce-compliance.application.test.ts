import { describe, expect, test } from 'bun:test';
import type { AuditRecord, AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { DomainEvent } from '@care/events';
import type { EmployeeVisibilityGrant, EmployeeStatus } from '@care/employees';
import type { AuthorizationPrincipal, PermissionGrant } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  WorkforceComplianceAccessDeniedError,
  WorkforceComplianceApplicationService,
  WorkforceComplianceSettingsVersionConflictError,
} from './workforce-compliance.application';
import type {
  WorkforceComplianceEmployeeRecord,
  WorkforceComplianceQualificationRecord,
  WorkforceComplianceSettingsSnapshot,
} from '../infrastructure/workforce-compliance.repository';
import { WorkforceComplianceRepository } from '../infrastructure/workforce-compliance.repository';

const tenantId = 'tenant-1';
const userId = 'user-1';
const organizationId = 'organization-1';
const facilityId = 'facility-1';
const qualificationId = 'qualification-1';
const requestContext: RequestContext = {
  requestId: 'request-1',
  correlationId: 'correlation-1',
};

describe('workforce compliance application service', () => {
  test('shows policy coverage and as-of metadata when the caller can see no employees', async () => {
    const { service } = createService({
      listPolicyFacts: async () => activePolicyFacts(),
    });

    const result = await service.policy(
      principal(grant('workforce_compliance.read', 'facility', facilityId)),
      'care_plan.activate',
      { asOf: '2026-01-10', horizonDays: 31 },
    );

    expect(result).toMatchObject({
      operationKey: 'care_plan.activate',
      policy: {
        status: 'active',
        policyId: 'policy-activate',
        policyVersion: 1,
        requirementCount: 1,
      },
      readiness: { ready: 0, atRisk: 0, notReady: 0 },
      asOf: '2026-01-10',
      horizonDays: 31,
    });
  });

  test('keeps top-level policy metadata independent of employee timezone ordering', async () => {
    const employee = employeeRecord('employee-west-coast');
    const { service } = createService({
      pageVisibleEmployees: async () => ({ items: [employee], total: 1 }),
      listPolicyFacts: async () => policyFactsWithTimezoneRotation(),
      listQualificationFacts: async () => [
        qualificationRecord('assignment-1', { employeeId: employee.employeeId }),
      ],
      facilityTimezones: async () => new Map([[employee.employeeId, 'America/Los_Angeles']]),
    });

    const result = await service.summary(
      principal(grant('workforce_compliance.read', 'tenant', tenantId)),
      { asOf: '2026-01-10', horizonDays: 30 },
    );

    expect(result.employeeCount).toBe(1);
    expect(result.operations[0]?.policy.policyVersion).toBe(1);
    expect(result.operations[0]?.readiness).toEqual({ ready: 0, atRisk: 0, notReady: 1 });
  });

  test('aggregates visible employees in bounded pages and passes the caller scope to each page', async () => {
    const visibleEmployees = Array.from({ length: 251 }, (_, index) =>
      employeeRecord(`visible-${index + 1}`),
    );
    const pageCalls: {
      grants: readonly EmployeeVisibilityGrant[];
      page: number;
      pageSize: number;
    }[] = [];
    const readGrant = grant('workforce_compliance.read', 'facility', facilityId);
    const { service } = createService({
      pageVisibleEmployees: async (
        _transaction: DatabaseTransaction,
        _tenant: string,
        grants: readonly EmployeeVisibilityGrant[],
        filters: { page?: number; pageSize?: number },
      ) => {
        const page = filters.page ?? 1;
        const pageSize = filters.pageSize ?? 25;
        pageCalls.push({ grants, page, pageSize });
        const start = (page - 1) * pageSize;
        return {
          items: visibleEmployees.slice(start, start + pageSize),
          total: visibleEmployees.length,
        };
      },
    });

    const result = await service.summary(principal(readGrant), {
      asOf: '2026-01-10',
      horizonDays: 30,
    });

    expect(result.employeeCount).toBe(251);
    expect(result.employeesWithMissingRequirements).toBe(0);
    expect(result.operations[0]?.readiness).toEqual({ ready: 0, atRisk: 0, notReady: 0 });
    expect(result.operations[0]?.findingCounts.COMPETENCY_POLICY_MISSING).toBe(251);
    expect(pageCalls.map(({ page, pageSize }) => [page, pageSize])).toEqual([
      [1, 250],
      [2, 250],
    ]);
    expect(pageCalls.every(({ grants }) => grants.length === 1 && grants[0] === readGrant)).toBe(
      true,
    );
  });

  test('counts distinct employees with unmet requirements separately from policy configuration findings', async () => {
    const employees = [employeeRecord('employee-1'), employeeRecord('employee-2')];
    const { service } = createService({
      pageVisibleEmployees: async () => ({ items: employees, total: employees.length }),
      listPolicyFacts: async () => activePolicyFacts(),
      listQualificationFacts: async () => [],
    });

    const result = await service.summary(
      principal(grant('workforce_compliance.read', 'tenant', tenantId)),
      { asOf: '2026-01-10' },
    );

    expect(result.employeesWithMissingRequirements).toBe(2);
    expect(result.operations[0]?.findingCounts.COMPETENCY_REQUIREMENT_UNMET).toBe(2);
    expect(result.operations[1]?.findingCounts.COMPETENCY_POLICY_MISSING).toBe(2);
  });

  test('requires read_details for employee findings and qualification impact results', async () => {
    const readOnly = principal(grant('workforce_compliance.read', 'tenant', tenantId));
    const { service: deniedService } = createService();

    await expect(deniedService.employee(readOnly, 'employee-1')).rejects.toBeInstanceOf(
      WorkforceComplianceAccessDeniedError,
    );
    await expect(
      deniedService.qualificationImpact(readOnly, qualificationId),
    ).rejects.toBeInstanceOf(WorkforceComplianceAccessDeniedError);

    const employee = employeeRecord('employee-1');
    const detailGrant = grant('workforce_compliance.read_details', 'organization', organizationId);
    const detailGrantCalls: (readonly EmployeeVisibilityGrant[])[] = [];
    const { service } = createService({
      findVisibleEmployee: async (
        _transaction: DatabaseTransaction,
        _tenant: string,
        _employeeId: string,
        grants: readonly EmployeeVisibilityGrant[],
      ) => {
        detailGrantCalls.push(grants);
        return employee;
      },
      pageVisibleEmployees: async (
        _transaction: DatabaseTransaction,
        _tenant: string,
        grants: readonly EmployeeVisibilityGrant[],
      ) => {
        detailGrantCalls.push(grants);
        return { items: [employee], total: 1 };
      },
      listPolicyFacts: async () => activePolicyFacts(),
      listQualificationFacts: async () => [qualificationRecord('assignment-1')],
      facilityTimezones: async () => new Map([[employee.employeeId, 'Europe/Berlin']]),
    });
    const detailPrincipal = principal(detailGrant);

    const detail = await service.employee(detailPrincipal, employee.employeeId, {
      asOf: '2026-01-10',
    });
    const impact = await service.qualificationImpact(detailPrincipal, qualificationId, {
      asOf: '2026-01-10',
      operationKey: 'care_plan.activate',
    });

    expect(detail.employeeId).toBe(employee.employeeId);
    expect(detail.qualifications[0]?.qualificationId).toBe(qualificationId);
    expect(impact.items).toHaveLength(1);
    expect(impact.items[0]?.employeeId).toBe(employee.employeeId);
    expect(impact.items[0]?.readiness).toBe('not_ready');
    expect(impact.items[0]?.affectedOperations[0]?.readiness).toBe('not_ready');
    expect(detailGrantCalls).toHaveLength(2);
    expect(
      detailGrantCalls.every((grants) => grants.length === 1 && grants[0] === detailGrant),
    ).toBe(true);
  });

  test('uses assignment creation, revocation, and policy rotation dates for historical detail', async () => {
    const employee = employeeRecord('employee-history');
    const beforeCutoff = qualificationRecord('assignment-before-cutoff', {
      employeeId: employee.employeeId,
      validFrom: '2026-01-11',
      revokedAt: new Date('2026-01-15T12:00:00.000Z'),
    });
    const afterCutoff = qualificationRecord('assignment-after-cutoff', {
      employeeId: employee.employeeId,
      createdAt: new Date('2026-01-11T00:00:00.000Z'),
    });
    const { service } = createService({
      findVisibleEmployee: async () => employee,
      listPolicyFacts: async () => policyFactsWithRotation(),
      listQualificationFacts: async () => [beforeCutoff, afterCutoff],
      facilityTimezones: async () => new Map([[employee.employeeId, 'Europe/Berlin']]),
    });

    const detail = await service.employee(
      principal(grant('workforce_compliance.read_details', 'organization', organizationId)),
      employee.employeeId,
      { asOf: '2026-01-10' },
    );

    expect(detail.qualifications.map((row) => row.assignmentId)).toEqual([
      'assignment-before-cutoff',
    ]);
    expect(detail.qualifications[0]).toMatchObject({
      assignmentStatus: 'active',
      complianceStatus: 'not_yet_valid',
      asOf: '2026-01-10',
    });
    expect(
      detail.operations
        .find((operation) => operation.operationKey === 'care_plan.activate')
        ?.findings.find((finding) => finding.code === 'COMPETENCY_POLICY_INVALID'),
    ).toMatchObject({ policyVersion: 1 });
    expect(detail.historyLimitations).toContain(
      'Qualification-definition lifecycle status is evaluated from current records; past archive changes are not retained.',
    );
    expect(detail.historyLimitations).toContain(
      'Historical dates use current tenant thresholds and the current organization, facility, and tenant reporting timezones; previous settings and timezone changes are not retained.',
    );
    expect(detail.historyLimitations).toContain(
      'A draft policy impact preview is not available; current projections use only the active policy version.',
    );
  });

  test('checks settings versions and writes audit and outbox metadata only for changes', async () => {
    const current: WorkforceComplianceSettingsSnapshot = {
      criticalDays: 30,
      warningDays: 90,
      reportingTimezone: 'Europe/Berlin',
      version: 2,
    };
    const saved: WorkforceComplianceSettingsSnapshot = {
      ...current,
      criticalDays: 20,
      version: 3,
    };
    let saveCalls = 0;
    const { service, auditRecords, events } = createService({
      lockTenantSettings: async () => true,
      findSettings: async () => current,
      saveSettings: async () => {
        saveCalls += 1;
        return saved;
      },
    });
    const manager = principal(grant('workforce_compliance.manage_settings', 'tenant', tenantId));

    await expect(
      service.updateSettings(manager, { expectedVersion: 1, criticalDays: 20 }, requestContext),
    ).rejects.toBeInstanceOf(WorkforceComplianceSettingsVersionConflictError);
    await expect(
      service.updateSettings(manager, { expectedVersion: 2 }, requestContext),
    ).resolves.toMatchObject({ version: 2, criticalDays: 30 });
    expect(saveCalls).toBe(0);
    expect(auditRecords).toHaveLength(0);
    expect(events).toHaveLength(0);

    await expect(
      service.updateSettings(manager, { expectedVersion: 2, criticalDays: 20 }, requestContext, {
        ip: '192.0.2.1',
        userAgent: 'workforce-compliance-test',
      }),
    ).resolves.toMatchObject({ version: 3, criticalDays: 20 });

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0]).toMatchObject({
      action: 'workforce_compliance.settings_updated',
      resourceType: 'workforce_compliance_settings',
      resourceId: tenantId,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ip: '192.0.2.1',
      userAgent: 'workforce-compliance-test',
      metadata: { tenantId, settingsVersion: 3, changedFields: ['criticalDays'] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'workforce_compliance.settings_updated',
      tenantId,
      payload: { settingsVersion: 3, changedFields: ['criticalDays'] },
    });
  });
});

function createService(overrides: Record<string, unknown> = {}) {
  const auditRecords: AuditRecord[] = [];
  const events: DomainEvent[] = [];
  const transaction = {} as DatabaseTransaction;
  const unitOfWork: UnitOfWork = {
    async transaction<T>(
      _options: { tenantId?: string },
      operation: (tx: DatabaseTransaction) => Promise<T>,
    ) {
      return operation(transaction);
    },
  };
  const audit: AuditWriter = {
    async append(_transaction, record) {
      auditRecords.push(record);
    },
  };
  const outbox: OutboxWriter = {
    async enqueue(_transaction, event) {
      events.push(event);
    },
  };
  const repository = {
    findSettings: async () => null,
    lockTenantSettings: async () => true,
    saveSettings: async () => {
      throw new Error('Unexpected settings write');
    },
    pageVisibleEmployees: async () => ({ items: [], total: 0 }),
    findVisibleEmployee: async () => null,
    listQualificationFacts: async () => [],
    facilityTimezones: async () => new Map<string, string | null>(),
    listPolicyFacts: async () => ({ policies: [], versions: [], requirements: [] }),
    ...overrides,
  } as unknown as WorkforceComplianceRepository;
  return {
    service: new WorkforceComplianceApplicationService(unitOfWork, audit, outbox, repository),
    auditRecords,
    events,
  };
}

function principal(...grants: PermissionGrant[]): AuthorizationPrincipal {
  return { tenantId, userId, grants };
}

function grant(
  permission: PermissionGrant['permission'],
  scopeType: PermissionGrant['scopeType'],
  scopeId: string,
): PermissionGrant {
  return { permission, scopeType, scopeId };
}

function employeeRecord(employeeId: string): WorkforceComplianceEmployeeRecord {
  return {
    employeeId,
    organizationId,
    organizationName: 'Test Organization',
    organizationTimezone: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    status: 'active' satisfies EmployeeStatus,
    employeeLinked: true,
  };
}

function qualificationRecord(
  assignmentId: string,
  overrides: Partial<WorkforceComplianceQualificationRecord> = {},
): WorkforceComplianceQualificationRecord {
  return {
    assignmentId,
    employeeId: 'employee-1',
    employeeFirstName: 'Ada',
    employeeLastName: 'Lovelace',
    employeeStatus: 'active',
    organizationId,
    organizationName: 'Test Organization',
    organizationTimezone: null,
    qualificationId,
    qualificationName: 'Registered Nurse',
    qualificationCode: 'RN',
    qualificationDefinitionStatus: 'active',
    assignmentStatus: 'active',
    validFrom: null,
    validUntil: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

function activePolicyFacts(): Awaited<
  ReturnType<WorkforceComplianceRepository['listPolicyFacts']>
> {
  return {
    policies: [
      {
        id: 'policy-activate',
        operationKey: 'care_plan.activate',
        latestVersion: 1,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ],
    versions: [
      {
        id: 'policy-version-activate-1',
        policyId: 'policy-activate',
        operationKey: 'care_plan.activate',
        version: 1,
        requirementMode: 'ALL',
        requirementCount: 1,
        status: 'active',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        activatedAt: new Date('2025-01-01T00:00:00.000Z'),
        deactivatedAt: null,
      },
    ],
    requirements: [
      {
        policyVersionId: 'policy-version-activate-1',
        qualificationId,
        qualificationName: 'Registered Nurse',
        qualificationCode: 'RN',
        qualificationDefinitionStatus: 'active',
      },
    ],
  };
}

function policyFactsWithRotation(): Awaited<
  ReturnType<WorkforceComplianceRepository['listPolicyFacts']>
> {
  const facts = activePolicyFacts();
  return {
    policies: facts.policies.map((policy) => ({ ...policy, latestVersion: 2 })),
    versions: [
      ...facts.versions.map((version) => ({
        ...version,
        deactivatedAt: new Date('2026-01-20T00:00:00.000Z'),
      })),
      {
        id: 'policy-version-activate-2',
        policyId: 'policy-activate',
        operationKey: 'care_plan.activate',
        version: 2,
        requirementMode: 'ALL',
        requirementCount: 1,
        status: 'active',
        createdAt: new Date('2026-01-20T00:00:00.000Z'),
        activatedAt: new Date('2026-01-20T00:00:00.000Z'),
        deactivatedAt: null,
      },
    ],
    requirements: [
      ...facts.requirements.map((requirement) => ({
        ...requirement,
        qualificationDefinitionStatus: 'archived' as const,
      })),
      {
        policyVersionId: 'policy-version-activate-2',
        qualificationId: 'qualification-2',
        qualificationName: 'New qualification',
        qualificationCode: 'NEW',
        qualificationDefinitionStatus: 'active',
      },
    ],
  };
}

function policyFactsWithTimezoneRotation(): Awaited<
  ReturnType<WorkforceComplianceRepository['listPolicyFacts']>
> {
  const facts = activePolicyFacts();
  const activation = new Date('2026-01-10T23:30:00.000Z');
  return {
    policies: facts.policies.map((policy) => ({ ...policy, latestVersion: 2 })),
    versions: [
      ...facts.versions.map((version) => ({ ...version, deactivatedAt: activation })),
      {
        id: 'policy-version-activate-2',
        policyId: 'policy-activate',
        operationKey: 'care_plan.activate',
        version: 2,
        requirementMode: 'ALL',
        requirementCount: 1,
        status: 'active',
        createdAt: activation,
        activatedAt: activation,
        deactivatedAt: null,
      },
    ],
    requirements: [
      ...facts.requirements,
      {
        policyVersionId: 'policy-version-activate-2',
        qualificationId: 'qualification-2',
        qualificationName: 'West coast qualification',
        qualificationCode: 'WC',
        qualificationDefinitionStatus: 'active',
      },
    ],
  };
}
