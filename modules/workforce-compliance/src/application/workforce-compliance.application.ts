import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { AuthorizationPrincipal, CompetencyOperation } from '@care/permissions';
import { COMPETENCY_OPERATIONS } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { EmployeeVisibilityGrant, EmployeeStatus } from '@care/employees';
import { isSupportedTimeZone } from '@care/organizations';
import {
  deriveQualificationStatus,
  evaluateWorkforceReadiness,
} from '../domain/workforce-compliance';
import type {
  IsoCalendarDate,
  QualificationComplianceStatus,
  QualificationFacts,
  QualificationStatusThresholds,
  WorkforceComplianceFinding,
  WorkforceComplianceFindingCode,
  WorkforcePolicyFacts,
  WorkforceReadiness,
  WorkforceReadinessResult,
} from '../domain/workforce-compliance';
import {
  DEFAULT_WORKFORCE_COMPLIANCE_SETTINGS,
  WorkforceComplianceRepository,
} from '../infrastructure/workforce-compliance.repository';
import type {
  WorkforceComplianceEmployeeRecord,
  WorkforceComplianceQualificationRecord,
  WorkforceComplianceSettingsSnapshot,
} from '../infrastructure/workforce-compliance.repository';

export const WORKFORCE_COMPLIANCE_HISTORY_LIMITATIONS = [
  'Employee status and employee links are evaluated from current records; their historical changes are not retained.',
  'Qualification validFrom/validUntil use current stored values; edits to those dates are not retained as history.',
  'Qualification-definition lifecycle status is evaluated from current records; past archive changes are not retained.',
  'Historical dates use current tenant thresholds and the current organization, facility, and tenant reporting timezones; previous settings and timezone changes are not retained.',
  'A draft policy impact preview is not available; current projections use only the active policy version.',
] as const;

export interface WorkforceComplianceReadQuery {
  asOf?: string;
  horizonDays?: number;
}

export interface WorkforceComplianceEmployeeQuery extends WorkforceComplianceReadQuery {
  page?: number;
  pageSize?: number;
  text?: string;
  status?: EmployeeStatus;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  sortBy?: 'lastName' | 'firstName';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkforceComplianceQualificationQuery extends WorkforceComplianceReadQuery {
  page?: number;
  pageSize?: number;
  text?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  qualificationId?: string;
  status?: QualificationComplianceStatus;
  assignmentStatus?: 'active' | 'revoked';
  expiresBefore?: string;
  expiresWithinDays?: number;
  sortBy?: 'priority' | 'qualificationName' | 'employeeName' | 'validUntil' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkforceComplianceImpactQuery extends WorkforceComplianceReadQuery {
  page?: number;
  pageSize?: number;
  operationKey?: CompetencyOperation;
}

export interface WorkforceCompliancePage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkforceComplianceOperationCoverage {
  operationKey: CompetencyOperation;
  readiness: { ready: number; atRisk: number; notReady: number };
  findingCounts: Partial<Record<WorkforceComplianceFindingCode, number>>;
}

export interface WorkforceCompliancePolicyRequirement {
  qualificationId: string;
  name: string | null;
  code: string | null;
  status: 'active' | 'inactive' | 'missing';
  missingEmployeeCount: number;
  expiringEmployeeCount: number;
}

export interface WorkforceCompliancePolicySummary {
  status: 'missing' | 'inactive' | 'invalid' | 'active';
  policyId: string | null;
  policyVersion: number | null;
  requirementMode: 'ANY' | 'ALL' | null;
  requirementCount: number;
  requirements: WorkforceCompliancePolicyRequirement[];
}

export interface WorkforceCompliancePolicyDetail extends WorkforceComplianceOperationCoverage {
  policy: WorkforceCompliancePolicySummary;
  asOf: IsoCalendarDate | null;
  horizonDays: number;
}

export interface WorkforceComplianceOperationSummary {
  operationKey: CompetencyOperation;
  readiness: WorkforceReadiness | null;
  projectedEligibilityEnd: IsoCalendarDate | null;
  findingCodes: WorkforceComplianceFindingCode[];
}

export interface WorkforceComplianceOperationDetail extends WorkforceComplianceOperationSummary {
  findings: WorkforceComplianceFinding[];
}

export interface WorkforceComplianceEmployeeRow {
  employeeId: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
  status: EmployeeStatus;
  asOf: IsoCalendarDate;
  operations: WorkforceComplianceOperationSummary[];
  findingCodes: WorkforceComplianceFindingCode[];
}

export interface WorkforceComplianceQualificationRow {
  assignmentId: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  employeeStatus: EmployeeStatus;
  organizationId: string | null;
  organizationName: string | null;
  qualificationId: string;
  qualificationName: string;
  qualificationCode: string | null;
  assignmentStatus: 'active' | 'revoked';
  complianceStatus: QualificationComplianceStatus;
  validFrom: IsoCalendarDate | null;
  validUntil: IsoCalendarDate | null;
  createdAt: Date;
  revokedAt: Date | null;
  asOf: IsoCalendarDate;
}

export interface WorkforceComplianceEmployeeDetail extends WorkforceComplianceEmployeeRow {
  operations: WorkforceComplianceOperationDetail[];
  qualifications: WorkforceComplianceQualificationRow[];
  historyLimitations: readonly string[];
}

export interface WorkforceComplianceSummary {
  asOf: IsoCalendarDate | null;
  horizonDays: number;
  employeeCount: number;
  employeesWithMissingRequirements: number;
  expiredQualifications: number;
  expiringQualifications: number;
  operations: WorkforceCompliancePolicyDetail[];
  historyLimitations: readonly string[];
}

export interface WorkforceCompliancePolicyImpact {
  asOf: IsoCalendarDate | null;
  horizonDays: number;
  operations: WorkforceCompliancePolicyDetail[];
}

export interface WorkforceComplianceAffectedOperation {
  operationKey: CompetencyOperation;
  readiness: WorkforceReadiness | null;
  projectedEligibilityEnd: IsoCalendarDate | null;
  findingCodes: WorkforceComplianceFindingCode[];
}

export interface WorkforceComplianceAffectedEmployee {
  employeeId: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
  status: EmployeeStatus;
  readiness: WorkforceReadiness | null;
  affectedOperations: WorkforceComplianceAffectedOperation[];
}

export interface WorkforceComplianceSettings {
  criticalDays: number;
  warningDays: number;
  reportingTimezone: string;
  version: number;
}

export interface WorkforceComplianceSettingsUpdate {
  expectedVersion: number;
  criticalDays?: number;
  warningDays?: number;
  reportingTimezone?: string;
}

export interface WorkforceComplianceRequestMetadata {
  ip?: string;
  userAgent?: string;
}

interface NormalizedPage {
  page: number;
  pageSize: number;
}

interface ReadContext {
  explicitAsOf: IsoCalendarDate | null;
  horizonDays: number;
  settings: WorkforceComplianceSettings;
}

interface EvaluationSnapshot {
  employee: WorkforceComplianceEmployeeRecord;
  asOf: IsoCalendarDate;
  timezone: string;
  cutoff: Date;
  cutoffExclusive: boolean;
  qualifications: WorkforceComplianceQualificationRow[];
  policies: Map<CompetencyOperation, WorkforcePolicyFacts>;
  readiness: Map<CompetencyOperation, WorkforceReadinessResult>;
}

interface OperationAggregate {
  readiness: { ready: number; atRisk: number; notReady: number };
  findingCounts: Partial<Record<WorkforceComplianceFindingCode, number>>;
  missingEmployeesByQualification: Map<string, number>;
  expiringEmployeesByQualification: Map<string, number>;
}

export class WorkforceComplianceApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository: WorkforceComplianceRepository = new WorkforceComplianceRepository(),
  ) {}

  async summary(
    principal: AuthorizationPrincipal,
    query: WorkforceComplianceReadQuery = {},
  ): Promise<WorkforceComplianceSummary> {
    const grants = this.requireReadGrants(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const policyRecords = await this.repository.listPolicyFacts(transaction, principal.tenantId);
      const aggregates = createOperationAggregates();
      const employeesWithMissingRequirements = new Set<string>();
      let expiredQualifications = 0;
      let expiringQualifications = 0;
      const employeeCount = await this.forEachVisibleEmployeeBatch(
        transaction,
        principal.tenantId,
        grants,
        async (employees) => {
          const snapshots = await this.evaluateEmployees(
            transaction,
            principal.tenantId,
            grants,
            employees,
            context,
            undefined,
            policyRecords,
          );
          accumulateOperationAggregates(aggregates, snapshots);
          for (const snapshot of snapshots) {
            if (
              [...snapshot.readiness.values()].some((result) =>
                result.findings.some((finding) => finding.code === 'COMPETENCY_REQUIREMENT_UNMET'),
              )
            ) {
              employeesWithMissingRequirements.add(snapshot.employee.employeeId);
            }
            for (const qualification of snapshot.qualifications) {
              if (qualification.complianceStatus === 'expired') expiredQualifications += 1;
              if (qualification.complianceStatus === 'expiring_soon') expiringQualifications += 1;
            }
          }
        },
      );
      const fallbackPolicies = this.fallbackPolicySummaries(policyRecords, context);
      const operations = COMPETENCY_OPERATIONS.map((operationKey) =>
        aggregatePolicyDetail(operationKey, aggregates, fallbackPolicies, context),
      );
      return {
        asOf: context.explicitAsOf,
        horizonDays: context.horizonDays,
        employeeCount,
        employeesWithMissingRequirements: employeesWithMissingRequirements.size,
        expiredQualifications,
        expiringQualifications,
        operations,
        historyLimitations: WORKFORCE_COMPLIANCE_HISTORY_LIMITATIONS,
      };
    });
  }

  async employees(
    principal: AuthorizationPrincipal,
    query: WorkforceComplianceEmployeeQuery = {},
  ): Promise<WorkforceCompliancePage<WorkforceComplianceEmployeeRow>> {
    const grants = this.requireReadGrants(principal);
    const page = validatePage(query.page, query.pageSize);
    const normalized = validateEmployeeQuery(query);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const result = await this.repository.pageVisibleEmployees(
        transaction,
        principal.tenantId,
        grants,
        { ...normalized, ...page },
      );
      const snapshots = await this.evaluateEmployees(
        transaction,
        principal.tenantId,
        grants,
        result.items,
        context,
        query.facilityId,
      );
      return {
        items: snapshots.map((snapshot) => this.employeeRow(snapshot)),
        ...page,
        total: result.total,
      };
    });
  }

  async qualifications(
    principal: AuthorizationPrincipal,
    query: WorkforceComplianceQualificationQuery = {},
  ): Promise<WorkforceCompliancePage<WorkforceComplianceQualificationRow>> {
    const grants = this.requireReadGrants(principal);
    const page = validatePage(query.page, query.pageSize);
    const normalized = validateQualificationQuery(query);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const result = await this.repository.pageQualificationWorklist(
        transaction,
        principal.tenantId,
        grants,
        {
          ...normalized,
          ...(context.explicitAsOf ? { asOf: context.explicitAsOf } : {}),
          criticalDays: context.settings.criticalDays,
          warningDays: context.settings.warningDays,
          reportingTimezone: context.settings.reportingTimezone,
          ...page,
        },
      );
      return {
        items: result.items.map((row) => ({
          assignmentId: row.assignmentId,
          employeeId: row.employeeId,
          employeeFirstName: row.employeeFirstName,
          employeeLastName: row.employeeLastName,
          employeeStatus: row.employeeStatus,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          qualificationId: row.qualificationId,
          qualificationName: row.qualificationName,
          qualificationCode: row.qualificationCode,
          assignmentStatus: row.assignmentStatus,
          complianceStatus: row.complianceStatus,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
          createdAt: row.createdAt,
          revokedAt: row.revokedAt,
          asOf: row.asOf,
        })),
        ...page,
        total: result.total,
      };
    });
  }

  async employee(
    principal: AuthorizationPrincipal,
    employeeId: string,
    query: WorkforceComplianceReadQuery = {},
  ): Promise<WorkforceComplianceEmployeeDetail> {
    const grants = this.requireDetailGrants(principal);
    validateIdentifier(employeeId);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const employee = await this.repository.findVisibleEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        grants,
      );
      if (!employee) throw new WorkforceComplianceEmployeeNotFoundError();
      const snapshot = (
        await this.evaluateEmployees(transaction, principal.tenantId, grants, [employee], context)
      )[0]!;
      return {
        ...this.employeeRow(snapshot),
        operations: this.employeeOperationDetails(snapshot),
        qualifications: snapshot.qualifications,
        historyLimitations: WORKFORCE_COMPLIANCE_HISTORY_LIMITATIONS,
      };
    });
  }

  async policy(
    principal: AuthorizationPrincipal,
    operationKey: CompetencyOperation,
    query: WorkforceComplianceReadQuery = {},
  ): Promise<WorkforceCompliancePolicyDetail> {
    this.validateOperation(operationKey);
    const grants = this.requireReadGrants(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const policyRecords = await this.repository.listPolicyFacts(transaction, principal.tenantId);
      const aggregates = createOperationAggregates();
      await this.forEachVisibleEmployeeBatch(
        transaction,
        principal.tenantId,
        grants,
        async (employees) => {
          const snapshots = await this.evaluateEmployees(
            transaction,
            principal.tenantId,
            grants,
            employees,
            context,
            undefined,
            policyRecords,
          );
          accumulateOperationAggregates(aggregates, snapshots);
        },
      );
      return aggregatePolicyDetail(
        operationKey,
        aggregates,
        this.fallbackPolicySummaries(policyRecords, context),
        context,
      );
    });
  }

  async policyImpact(
    principal: AuthorizationPrincipal,
    query: WorkforceComplianceReadQuery = {},
  ): Promise<WorkforceCompliancePolicyImpact> {
    const grants = this.requireReadGrants(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const policyRecords = await this.repository.listPolicyFacts(transaction, principal.tenantId);
      const aggregates = createOperationAggregates();
      await this.forEachVisibleEmployeeBatch(
        transaction,
        principal.tenantId,
        grants,
        async (employees) => {
          const snapshots = await this.evaluateEmployees(
            transaction,
            principal.tenantId,
            grants,
            employees,
            context,
            undefined,
            policyRecords,
          );
          accumulateOperationAggregates(aggregates, snapshots);
        },
      );
      const fallbackPolicies = this.fallbackPolicySummaries(policyRecords, context);
      return {
        asOf: context.explicitAsOf,
        horizonDays: context.horizonDays,
        operations: COMPETENCY_OPERATIONS.map((operationKey) =>
          aggregatePolicyDetail(operationKey, aggregates, fallbackPolicies, context),
        ),
      };
    });
  }

  async qualificationImpact(
    principal: AuthorizationPrincipal,
    qualificationDefinitionId: string,
    query: WorkforceComplianceImpactQuery = {},
  ): Promise<WorkforceCompliancePage<WorkforceComplianceAffectedEmployee>> {
    const grants = this.requireDetailGrants(principal);
    validateIdentifier(qualificationDefinitionId);
    const page = validatePage(query.page, query.pageSize);
    if (query.operationKey !== undefined) this.validateOperation(query.operationKey);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.readContext(transaction, principal.tenantId, query);
      const operations = query.operationKey ? [query.operationKey] : COMPETENCY_OPERATIONS;
      const policyRecords = await this.repository.listPolicyFacts(transaction, principal.tenantId);
      const firstIndex = (page.page - 1) * page.pageSize;
      const lastIndex = page.page * page.pageSize;
      const items: WorkforceComplianceAffectedEmployee[] = [];
      let total = 0;
      await this.forEachVisibleEmployeeBatch(
        transaction,
        principal.tenantId,
        grants,
        async (employees) => {
          const snapshots = await this.evaluateEmployees(
            transaction,
            principal.tenantId,
            grants,
            employees,
            context,
            undefined,
            policyRecords,
          );
          for (const snapshot of snapshots) {
            const affected = this.affectedEmployee(
              snapshot,
              operations,
              qualificationDefinitionId,
              context,
            );
            if (!affected) continue;
            if (total >= firstIndex && total < lastIndex) items.push(affected);
            total += 1;
          }
        },
      );
      return { items, ...page, total };
    });
  }

  private affectedEmployee(
    snapshot: EvaluationSnapshot,
    operations: readonly CompetencyOperation[],
    qualificationDefinitionId: string,
    context: ReadContext,
  ): WorkforceComplianceAffectedEmployee | null {
    const affectedOperations: WorkforceComplianceAffectedOperation[] = [];
    for (const operationKey of operations) {
      const policy = snapshot.policies.get(operationKey);
      if (
        policy?.status !== 'active' ||
        !policy.requiredQualificationIds.includes(qualificationDefinitionId)
      ) {
        continue;
      }
      const complete = snapshot.readiness.get(operationKey);
      if (!complete) continue;
      const withoutQualification = evaluateWorkforceReadiness({
        employee: {
          employeeId: snapshot.employee.employeeId,
          status: snapshot.employee.status,
          requiresEmployeeLink: true,
          employeeLinked: snapshot.employee.employeeLinked,
        },
        policy,
        qualifications: this.qualificationFactsWithout(
          snapshot.qualifications,
          qualificationDefinitionId,
          snapshot,
        ),
        horizon: this.horizon(snapshot.asOf, context.horizonDays),
        thresholds: this.thresholds(context.settings),
      });
      const missingTarget = complete.findings.some(
        (finding) =>
          finding.code === 'COMPETENCY_REQUIREMENT_UNMET' &&
          finding.qualificationIds.includes(qualificationDefinitionId),
      );
      const changed =
        complete.readiness !== withoutQualification.readiness ||
        complete.projectedEligibilityEnd !== withoutQualification.projectedEligibilityEnd ||
        missingTarget;
      if (changed) {
        affectedOperations.push({
          operationKey,
          readiness: withoutQualification.readiness,
          projectedEligibilityEnd: withoutQualification.projectedEligibilityEnd,
          findingCodes: [...new Set(withoutQualification.findings.map((finding) => finding.code))],
        });
      }
    }
    if (affectedOperations.length === 0) return null;
    const row = this.employeeRow(snapshot);
    return {
      employeeId: row.employeeId,
      firstName: row.firstName,
      lastName: row.lastName,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      status: row.status,
      readiness: overallReadiness(affectedOperations.map((operation) => operation.readiness)),
      affectedOperations,
    };
  }

  async getSettings(principal: AuthorizationPrincipal): Promise<WorkforceComplianceSettings> {
    this.requireReadGrants(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const settings = await this.repository.findSettings(transaction, principal.tenantId);
      return publicSettings(settings);
    });
  }

  async updateSettings(
    principal: AuthorizationPrincipal,
    input: WorkforceComplianceSettingsUpdate,
    context: RequestContext,
    request: WorkforceComplianceRequestMetadata = {},
  ): Promise<WorkforceComplianceSettings> {
    this.requireManageSettings(principal);
    validateSettingsUpdate(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      if (!(await this.repository.lockTenantSettings(transaction, principal.tenantId))) {
        throw new WorkforceComplianceSettingsNotFoundError();
      }
      const currentRecord = await this.repository.findSettings(
        transaction,
        principal.tenantId,
        true,
      );
      const current = currentRecord
        ? publicSettings(currentRecord)
        : {
            ...DEFAULT_WORKFORCE_COMPLIANCE_SETTINGS,
            version: 0,
          };
      if (input.expectedVersion !== current.version) {
        throw new WorkforceComplianceSettingsVersionConflictError(
          input.expectedVersion,
          current.version,
        );
      }
      const next = {
        criticalDays: input.criticalDays ?? current.criticalDays,
        warningDays: input.warningDays ?? current.warningDays,
        reportingTimezone: input.reportingTimezone?.trim() ?? current.reportingTimezone,
      };
      validateSettingsValues(next);
      const changedFields = (['criticalDays', 'warningDays', 'reportingTimezone'] as const).filter(
        (field) => next[field] !== current[field],
      );
      if (changedFields.length === 0) return current;

      const now = new Date();
      const saved = await this.repository.saveSettings(
        transaction,
        principal.tenantId,
        { ...next, version: current.version + 1 },
        now,
      );
      const event = createDomainEvent({
        id: uuidv7(),
        type: 'workforce_compliance.settings_updated',
        tenantId: principal.tenantId,
        aggregateType: 'workforce_compliance',
        aggregateId: principal.tenantId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        occurredAt: now.toISOString(),
        payload: { settingsVersion: saved.version, changedFields: [...changedFields] },
      });
      await this.audit.append(transaction, {
        id: event.id,
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: event.type,
        resourceType: 'workforce_compliance_settings',
        resourceId: principal.tenantId,
        timestamp: new Date(event.occurredAt),
        requestId: context.requestId,
        correlationId: context.correlationId,
        ...(request.ip ? { ip: request.ip } : {}),
        ...(request.userAgent ? { userAgent: request.userAgent } : {}),
        metadata: {
          tenantId: principal.tenantId,
          settingsVersion: saved.version,
          changedFields: [...changedFields],
        },
      });
      await this.outbox.enqueue(transaction, event);
      return publicSettings(saved);
    });
  }

  private requireReadGrants(principal: AuthorizationPrincipal): EmployeeVisibilityGrant[] {
    return this.requireGrants(principal, 'workforce_compliance.read');
  }

  private requireDetailGrants(principal: AuthorizationPrincipal): EmployeeVisibilityGrant[] {
    return this.requireGrants(principal, 'workforce_compliance.read_details');
  }

  private requireManageSettings(principal: AuthorizationPrincipal): void {
    const allowed = principal.grants.some(
      (grant) =>
        grant.permission === 'workforce_compliance.manage_settings' &&
        grant.scopeType === 'tenant' &&
        grant.scopeId === principal.tenantId,
    );
    if (!allowed) throw new WorkforceComplianceAccessDeniedError();
  }

  private requireGrants(
    principal: AuthorizationPrincipal,
    permission: 'workforce_compliance.read' | 'workforce_compliance.read_details',
  ): EmployeeVisibilityGrant[] {
    const grants = principal.grants.filter((grant) => grant.permission === permission);
    if (grants.length === 0) throw new WorkforceComplianceAccessDeniedError();
    return grants;
  }

  private async readContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    query: WorkforceComplianceReadQuery,
  ): Promise<ReadContext> {
    const settingsRecord = await this.repository.findSettings(transaction, tenantId);
    const settings = publicSettings(settingsRecord);
    const explicitAsOf = validateAsOf(query.asOf);
    if (query.horizonDays !== undefined && !isHorizon(query.horizonDays)) {
      throw new InvalidWorkforceComplianceQueryError();
    }
    return {
      explicitAsOf,
      horizonDays: query.horizonDays ?? settings.warningDays,
      settings,
    };
  }

  private async evaluateEmployees(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
    employees: readonly WorkforceComplianceEmployeeRecord[],
    context: ReadContext,
    requestedFacilityId?: string,
    knownPolicyRecords?: Awaited<ReturnType<WorkforceComplianceRepository['listPolicyFacts']>>,
  ): Promise<EvaluationSnapshot[]> {
    if (employees.length === 0) return [];
    const employeeIds = employees.map((employee) => employee.employeeId);
    const policyRecords =
      knownPolicyRecords ?? (await this.repository.listPolicyFacts(transaction, tenantId));
    const qualificationRecords = await this.repository.listQualificationFacts(
      transaction,
      tenantId,
      employeeIds,
      grants,
    );
    const facilityTimezones = await this.repository.facilityTimezones(
      transaction,
      tenantId,
      employeeIds,
      grants,
      requestedFacilityId,
    );
    const qualificationsByEmployee = new Map<string, WorkforceComplianceQualificationRecord[]>();
    for (const qualification of qualificationRecords) {
      const rows = qualificationsByEmployee.get(qualification.employeeId) ?? [];
      rows.push(qualification);
      qualificationsByEmployee.set(qualification.employeeId, rows);
    }
    const now = new Date();
    return employees.map((employee) => {
      const timezone = this.resolveTimezone(
        facilityTimezones.get(employee.employeeId),
        employee.organizationTimezone,
        context.settings.reportingTimezone,
      );
      const asOf = context.explicitAsOf ?? localDate(now, timezone);
      const cutoffExclusive = context.explicitAsOf !== null;
      const cutoff = this.asOfCutoff(asOf, timezone, cutoffExclusive, now);
      const policyMap = this.policyFactsAt(policyRecords, cutoff, cutoffExclusive);
      const sourceQualifications = qualificationsByEmployee.get(employee.employeeId) ?? [];
      const qualificationRows = sourceQualifications.flatMap((row) => {
        const fact = this.qualificationAt(
          row,
          asOf,
          cutoff,
          cutoffExclusive,
          timezone,
          context.settings,
        );
        return fact ? [fact] : [];
      });
      const snapshotBase = { employee, asOf, timezone, cutoff, cutoffExclusive };
      const domainQualifications = qualificationRows.map((qualification) => ({
        ...qualificationFact(qualification),
        validUntil: projectedValidUntilFor(qualification, asOf, cutoff, cutoffExclusive, timezone),
      }));
      const readiness = new Map<CompetencyOperation, WorkforceReadinessResult>();
      for (const operationKey of COMPETENCY_OPERATIONS) {
        const policy = policyMap.get(operationKey)!.facts;
        readiness.set(
          operationKey,
          evaluateWorkforceReadiness({
            employee: {
              employeeId: employee.employeeId,
              status: employee.status,
              requiresEmployeeLink: true,
              employeeLinked: employee.employeeLinked,
            },
            policy,
            qualifications: domainQualifications,
            horizon: this.horizon(asOf, context.horizonDays),
            thresholds: this.thresholds(context.settings),
          }),
        );
      }
      return {
        ...snapshotBase,
        qualifications: qualificationRows,
        policies: new Map(
          [...policyMap].map(([operationKey, value]) => [operationKey, value.facts]),
        ),
        readiness,
      };
    });
  }

  private async forEachVisibleEmployeeBatch(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
    visit: (employees: WorkforceComplianceEmployeeRecord[]) => Promise<void>,
  ): Promise<number> {
    const pageSize = 250;
    const visitPage = async (page: number, total?: number): Promise<number> => {
      const result = await this.repository.pageVisibleEmployees(transaction, tenantId, grants, {
        page,
        pageSize,
        sortBy: 'lastName',
        sortOrder: 'asc',
      });
      const visibleTotal = total ?? result.total;
      if (result.items.length === 0) return visibleTotal;
      await visit(result.items);
      if (page * pageSize >= visibleTotal) return visibleTotal;
      return visitPage(page + 1, visibleTotal);
    };
    return visitPage(1);
  }

  private policyFactsAt(
    records: Awaited<ReturnType<WorkforceComplianceRepository['listPolicyFacts']>>,
    cutoff: Date,
    cutoffExclusive: boolean,
  ): Map<
    CompetencyOperation,
    { facts: WorkforcePolicyFacts; summary: WorkforceCompliancePolicySummary }
  > {
    const result = new Map<
      CompetencyOperation,
      { facts: WorkforcePolicyFacts; summary: WorkforceCompliancePolicySummary }
    >();
    for (const operationKey of COMPETENCY_OPERATIONS) {
      const policy = records.policies.find((row) => row.operationKey === operationKey);
      if (!policy || !occurredByCutoff(policy.createdAt, cutoff, cutoffExclusive)) {
        result.set(operationKey, {
          facts: { status: 'missing', operationKey },
          summary: emptyPolicySummary('missing', null),
        });
        continue;
      }
      const activeVersion = records.versions
        .filter(
          (version) =>
            version.policyId === policy.id &&
            version.operationKey === operationKey &&
            version.activatedAt !== null &&
            occurredByCutoff(version.activatedAt, cutoff, cutoffExclusive) &&
            (version.deactivatedAt === null ||
              !occurredByCutoff(version.deactivatedAt, cutoff, cutoffExclusive)),
        )
        .sort(
          (left, right) =>
            right.activatedAt!.getTime() - left.activatedAt!.getTime() ||
            right.version - left.version,
        )[0];
      if (!activeVersion) {
        result.set(operationKey, {
          facts: { status: 'inactive', operationKey, policyId: policy.id },
          summary: emptyPolicySummary('inactive', policy.id),
        });
        continue;
      }
      const requirementRecords = records.requirements.filter(
        (requirement) => requirement.policyVersionId === activeVersion.id,
      );
      const requirements = requirementRecords.map((requirement) => ({
        qualificationId: requirement.qualificationId,
        name: requirement.qualificationName,
        code: requirement.qualificationCode,
        status:
          requirement.qualificationDefinitionStatus === 'active'
            ? ('active' as const)
            : requirement.qualificationDefinitionStatus === 'archived'
              ? ('inactive' as const)
              : ('missing' as const),
        missingEmployeeCount: 0,
        expiringEmployeeCount: 0,
      }));
      const statuses = requirements.map((requirement) => ({
        qualificationId: requirement.qualificationId,
        status: requirement.status,
      }));
      const invalid =
        activeVersion.requirementCount < 1 ||
        activeVersion.requirementCount !== requirements.length ||
        requirements.length === 0 ||
        requirements.some((requirement) => requirement.status !== 'active');
      const facts: WorkforcePolicyFacts = {
        status: 'active',
        operationKey,
        policyId: policy.id,
        policyVersion: activeVersion.version,
        requirementMode: activeVersion.requirementMode,
        requirementCount: activeVersion.requirementCount,
        requiredQualificationIds: requirements.map((requirement) => requirement.qualificationId),
        qualificationDefinitionStatuses: statuses,
      };
      result.set(operationKey, {
        facts,
        summary: {
          status: invalid ? 'invalid' : 'active',
          policyId: policy.id,
          policyVersion: activeVersion.version,
          requirementMode: activeVersion.requirementMode,
          requirementCount: activeVersion.requirementCount,
          requirements,
        },
      });
    }
    return result;
  }

  private qualificationAt(
    row: WorkforceComplianceQualificationRecord,
    asOf: IsoCalendarDate,
    cutoff: Date,
    cutoffExclusive: boolean,
    timezone: string,
    settings: WorkforceComplianceSettings,
  ): WorkforceComplianceQualificationRow | null {
    if (!occurredByCutoff(row.createdAt, cutoff, cutoffExclusive)) return null;
    const assignmentStatus =
      row.revokedAt !== null && occurredByCutoff(row.revokedAt, cutoff, cutoffExclusive)
        ? 'revoked'
        : 'active';
    return {
      assignmentId: row.assignmentId,
      employeeId: row.employeeId,
      employeeFirstName: row.employeeFirstName,
      employeeLastName: row.employeeLastName,
      employeeStatus: row.employeeStatus,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      qualificationId: row.qualificationId,
      qualificationName: row.qualificationName,
      qualificationCode: row.qualificationCode,
      assignmentStatus,
      complianceStatus: deriveQualificationStatus(
        {
          id: row.assignmentId,
          qualificationId: row.qualificationId,
          assignmentStatus,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
        },
        asOf,
        this.thresholds(settings),
      ),
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      asOf,
    };
  }

  private qualificationFactsWithout(
    qualifications: readonly WorkforceComplianceQualificationRow[],
    qualificationId: string,
    snapshot: EvaluationSnapshot,
  ): QualificationFacts[] {
    return qualifications
      .filter((qualification) => qualification.qualificationId !== qualificationId)
      .map((qualification) => ({
        id: qualification.assignmentId,
        qualificationId: qualification.qualificationId,
        assignmentStatus: qualification.assignmentStatus,
        validFrom: qualification.validFrom,
        validUntil: this.projectedValidUntil(qualification, snapshot),
      }));
  }

  private employeeRow(snapshot: EvaluationSnapshot): WorkforceComplianceEmployeeRow {
    const operations = COMPETENCY_OPERATIONS.map((operationKey) => {
      const result = snapshot.readiness.get(operationKey)!;
      return {
        operationKey,
        readiness: result.readiness,
        projectedEligibilityEnd: result.projectedEligibilityEnd,
        findingCodes: [...new Set(result.findings.map((finding) => finding.code))],
      };
    });
    return {
      employeeId: snapshot.employee.employeeId,
      firstName: snapshot.employee.firstName,
      lastName: snapshot.employee.lastName,
      organizationId: snapshot.employee.organizationId,
      organizationName: snapshot.employee.organizationName,
      status: snapshot.employee.status,
      asOf: snapshot.asOf,
      operations,
      findingCodes: [...new Set(operations.flatMap((operation) => operation.findingCodes))],
    };
  }

  private employeeOperationDetails(
    snapshot: EvaluationSnapshot,
  ): WorkforceComplianceOperationDetail[] {
    return COMPETENCY_OPERATIONS.map((operationKey) => {
      const result = snapshot.readiness.get(operationKey)!;
      return {
        operationKey,
        readiness: result.readiness,
        projectedEligibilityEnd: result.projectedEligibilityEnd,
        findingCodes: [...new Set(result.findings.map((finding) => finding.code))],
        findings: result.findings.map((finding) => ({
          ...finding,
          qualificationIds: [...finding.qualificationIds],
          assignmentIds: [...finding.assignmentIds],
        })),
      };
    });
  }

  private fallbackPolicySummaries(
    records: Awaited<ReturnType<WorkforceComplianceRepository['listPolicyFacts']>>,
    context: ReadContext,
  ): Map<CompetencyOperation, WorkforceCompliancePolicySummary> {
    const now = new Date();
    const date = context.explicitAsOf ?? localDate(now, context.settings.reportingTimezone);
    const cutoff = this.asOfCutoff(
      date,
      context.settings.reportingTimezone,
      context.explicitAsOf !== null,
      now,
    );
    return new Map(
      [...this.policyFactsAt(records, cutoff, context.explicitAsOf !== null)].map(
        ([operationKey, value]) => [operationKey, value.summary],
      ),
    );
  }

  private thresholds(settings: WorkforceComplianceSettings): QualificationStatusThresholds {
    return { criticalDays: settings.criticalDays, warningDays: settings.warningDays };
  }

  private horizon(from: IsoCalendarDate, horizonDays: number) {
    return { from, through: addDays(from, horizonDays) };
  }

  private projectedValidUntil(
    qualification: WorkforceComplianceQualificationRow,
    snapshot: EvaluationSnapshot,
  ): IsoCalendarDate | null {
    return projectedValidUntilFor(
      qualification,
      snapshot.asOf,
      snapshot.cutoff,
      snapshot.cutoffExclusive,
      snapshot.timezone,
    );
  }

  private asOfCutoff(
    asOf: IsoCalendarDate,
    timezone: string,
    explicit: boolean,
    now = new Date(),
  ): Date {
    if (!explicit) return now;
    return localMidnight(addDays(asOf, 1), timezone);
  }

  private resolveTimezone(
    facilityTimezone: string | null | undefined,
    organizationTimezone: string | null,
    tenantTimezone: string,
  ): string {
    for (const timezone of [facilityTimezone, organizationTimezone, tenantTimezone]) {
      if (timezone && isSupportedTimeZone(timezone)) return timezone;
    }
    return DEFAULT_WORKFORCE_COMPLIANCE_SETTINGS.reportingTimezone;
  }

  private validateOperation(operationKey: string): asserts operationKey is CompetencyOperation {
    if (!(COMPETENCY_OPERATIONS as readonly string[]).includes(operationKey)) {
      throw new InvalidWorkforceComplianceQueryError();
    }
  }
}

export class WorkforceComplianceAccessDeniedError extends Error {
  readonly code = 'WORKFORCE_COMPLIANCE_ACCESS_DENIED';

  constructor() {
    super('Workforce compliance access was denied');
    this.name = 'WorkforceComplianceAccessDeniedError';
  }
}

export class WorkforceComplianceEmployeeNotFoundError extends Error {
  readonly code = 'WORKFORCE_COMPLIANCE_EMPLOYEE_NOT_FOUND';

  constructor() {
    super('Employee was not found');
    this.name = 'WorkforceComplianceEmployeeNotFoundError';
  }
}

export class WorkforceComplianceSettingsNotFoundError extends Error {
  readonly code = 'WORKFORCE_COMPLIANCE_TENANT_NOT_FOUND';

  constructor() {
    super('Tenant was not found');
    this.name = 'WorkforceComplianceSettingsNotFoundError';
  }
}

export class WorkforceComplianceSettingsVersionConflictError extends Error {
  readonly code = 'WORKFORCE_COMPLIANCE_SETTINGS_VERSION_CONFLICT';

  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super('Workforce compliance settings changed since they were read');
    this.name = 'WorkforceComplianceSettingsVersionConflictError';
  }
}

export class InvalidWorkforceComplianceQueryError extends Error {
  readonly code = 'INVALID_WORKFORCE_COMPLIANCE_QUERY';

  constructor() {
    super('Workforce compliance query is invalid');
    this.name = 'InvalidWorkforceComplianceQueryError';
  }
}

export class InvalidWorkforceComplianceSettingsError extends Error {
  readonly code = 'INVALID_WORKFORCE_COMPLIANCE_SETTINGS';

  constructor() {
    super('Workforce compliance settings are invalid');
    this.name = 'InvalidWorkforceComplianceSettingsError';
  }
}

function publicSettings(
  settings: WorkforceComplianceSettingsSnapshot | null,
): WorkforceComplianceSettings {
  if (!settings) {
    return { ...DEFAULT_WORKFORCE_COMPLIANCE_SETTINGS, version: 0 };
  }
  if (!isSupportedTimeZone(settings.reportingTimezone)) {
    throw new InvalidWorkforceComplianceSettingsError();
  }
  return {
    criticalDays: settings.criticalDays,
    warningDays: settings.warningDays,
    reportingTimezone: settings.reportingTimezone,
    version: settings.version,
  };
}

function validateSettingsUpdate(input: WorkforceComplianceSettingsUpdate): void {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new InvalidWorkforceComplianceSettingsError();
  }
  if (
    (input.criticalDays !== undefined && !Number.isSafeInteger(input.criticalDays)) ||
    (input.warningDays !== undefined && !Number.isSafeInteger(input.warningDays)) ||
    (input.reportingTimezone !== undefined && typeof input.reportingTimezone !== 'string')
  ) {
    throw new InvalidWorkforceComplianceSettingsError();
  }
}

function validateSettingsValues(
  settings: Pick<WorkforceComplianceSettings, 'criticalDays' | 'warningDays' | 'reportingTimezone'>,
): void {
  if (
    !Number.isSafeInteger(settings.criticalDays) ||
    !Number.isSafeInteger(settings.warningDays) ||
    settings.criticalDays < 1 ||
    settings.warningDays < 1 ||
    settings.criticalDays > 365 ||
    settings.warningDays > 365 ||
    settings.criticalDays > settings.warningDays ||
    settings.reportingTimezone.length < 1 ||
    settings.reportingTimezone.length > 100 ||
    !isSupportedTimeZone(settings.reportingTimezone)
  ) {
    throw new InvalidWorkforceComplianceSettingsError();
  }
}

function validateAsOf(value: string | undefined): IsoCalendarDate | null {
  if (value === undefined) return null;
  if (!isCalendarDate(value)) throw new InvalidWorkforceComplianceQueryError();
  return value;
}

function isCalendarDate(value: string): value is IsoCalendarDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year! < 1) return false;
  const date = new Date(utcTimestamp(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

function isHorizon(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 365;
}

function validatePage(page?: number, pageSize?: number): NormalizedPage {
  const normalizedPage = page ?? 1;
  const normalizedPageSize = pageSize ?? 25;
  if (
    !Number.isSafeInteger(normalizedPage) ||
    normalizedPage < 1 ||
    !Number.isSafeInteger(normalizedPageSize) ||
    normalizedPageSize < 1 ||
    normalizedPageSize > 100
  ) {
    throw new InvalidWorkforceComplianceQueryError();
  }
  return { page: normalizedPage, pageSize: normalizedPageSize };
}

function validateEmployeeQuery(query: WorkforceComplianceEmployeeQuery) {
  if (
    (query.status !== undefined && !['active', 'inactive', 'archived'].includes(query.status)) ||
    (query.sortBy !== undefined && !['lastName', 'firstName'].includes(query.sortBy)) ||
    (query.sortOrder !== undefined && !['asc', 'desc'].includes(query.sortOrder))
  ) {
    throw new InvalidWorkforceComplianceQueryError();
  }
  const text = validateText(query.text);
  const organizationId = validateOptionalIdentifier(query.organizationId);
  const facilityId = validateOptionalIdentifier(query.facilityId);
  const teamId = validateOptionalIdentifier(query.teamId);
  return {
    ...(text ? { text } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(facilityId ? { facilityId } : {}),
    ...(teamId ? { teamId } : {}),
    sortBy: query.sortBy ?? 'lastName',
    sortOrder: query.sortOrder ?? 'asc',
  };
}

function validateQualificationQuery(query: WorkforceComplianceQualificationQuery) {
  if (
    (query.status !== undefined &&
      !['valid', 'expiring_soon', 'expired', 'not_yet_valid', 'revoked'].includes(query.status)) ||
    (query.assignmentStatus !== undefined &&
      !['active', 'revoked'].includes(query.assignmentStatus)) ||
    (query.sortBy !== undefined &&
      !['priority', 'qualificationName', 'employeeName', 'validUntil', 'status'].includes(
        query.sortBy,
      )) ||
    (query.sortOrder !== undefined && !['asc', 'desc'].includes(query.sortOrder))
  ) {
    throw new InvalidWorkforceComplianceQueryError();
  }
  const expiresBefore = validateAsOf(query.expiresBefore ?? undefined);
  if (query.expiresWithinDays !== undefined && !isHorizon(query.expiresWithinDays)) {
    throw new InvalidWorkforceComplianceQueryError();
  }
  const text = validateText(query.text);
  const employeeId = validateOptionalIdentifier(query.employeeId);
  const organizationId = validateOptionalIdentifier(query.organizationId);
  const facilityId = validateOptionalIdentifier(query.facilityId);
  const teamId = validateOptionalIdentifier(query.teamId);
  const qualificationId = validateOptionalIdentifier(query.qualificationId);
  return {
    ...(text ? { text } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(facilityId ? { facilityId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(qualificationId ? { qualificationId } : {}),
    ...(expiresBefore ? { expiresBefore } : {}),
    ...(query.expiresWithinDays === undefined
      ? {}
      : { expiresWithinDays: query.expiresWithinDays }),
    ...(query.status ? { status: query.status } : {}),
    ...(query.assignmentStatus ? { assignmentStatus: query.assignmentStatus } : {}),
    ...(query.sortBy ? { sortBy: query.sortBy } : {}),
    sortOrder: query.sortOrder ?? 'asc',
  };
}

function validateText(text?: string): string | undefined {
  if (text === undefined) return undefined;
  if (typeof text !== 'string' || text.length > 120) {
    throw new InvalidWorkforceComplianceQueryError();
  }
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function validateIdentifier(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
    throw new InvalidWorkforceComplianceQueryError();
  }
}

function validateOptionalIdentifier(value?: string): string | undefined {
  if (value !== undefined) validateIdentifier(value);
  return value;
}

function qualificationFact(row: WorkforceComplianceQualificationRow): QualificationFacts {
  return {
    id: row.assignmentId,
    qualificationId: row.qualificationId,
    assignmentStatus: row.assignmentStatus,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  };
}

function emptyPolicySummary(
  status: 'missing' | 'inactive',
  policyId: string | null,
): WorkforceCompliancePolicySummary {
  return {
    status,
    policyId,
    policyVersion: null,
    requirementMode: null,
    requirementCount: 0,
    requirements: [],
  };
}

function createOperationAggregates(): Map<CompetencyOperation, OperationAggregate> {
  return new Map(
    COMPETENCY_OPERATIONS.map((operationKey) => [
      operationKey,
      {
        readiness: { ready: 0, atRisk: 0, notReady: 0 },
        findingCounts: {},
        missingEmployeesByQualification: new Map(),
        expiringEmployeesByQualification: new Map(),
      },
    ]),
  );
}

function accumulateOperationAggregates(
  aggregates: Map<CompetencyOperation, OperationAggregate>,
  snapshots: readonly EvaluationSnapshot[],
): void {
  for (const snapshot of snapshots) {
    for (const operationKey of COMPETENCY_OPERATIONS) {
      const aggregate = aggregates.get(operationKey)!;
      const result = snapshot.readiness.get(operationKey);
      if (!result) continue;
      if (result.readiness !== null) {
        aggregate.readiness[readinessBucket(result.readiness)] += 1;
      }
      for (const finding of result.findings) {
        aggregate.findingCounts[finding.code] = (aggregate.findingCounts[finding.code] ?? 0) + 1;
      }
      const policy = snapshot.policies.get(operationKey);
      if (result.readiness === null || policy?.status !== 'active') continue;

      const missingQualificationIds = new Set(
        result.findings
          .filter((finding) => finding.code === 'COMPETENCY_REQUIREMENT_UNMET')
          .flatMap((finding) => finding.qualificationIds),
      );
      for (const qualificationId of missingQualificationIds) {
        incrementCount(aggregate.missingEmployeesByQualification, qualificationId);
      }

      const expiringQualificationIds = new Set(
        snapshot.qualifications
          .filter(
            (qualification) =>
              qualification.complianceStatus === 'expiring_soon' &&
              policy.requiredQualificationIds.includes(qualification.qualificationId),
          )
          .map((qualification) => qualification.qualificationId),
      );
      for (const qualificationId of expiringQualificationIds) {
        incrementCount(aggregate.expiringEmployeesByQualification, qualificationId);
      }
    }
  }
}

function aggregatePolicyDetail(
  operationKey: CompetencyOperation,
  aggregates: Map<CompetencyOperation, OperationAggregate>,
  fallbackPolicies: Map<CompetencyOperation, WorkforceCompliancePolicySummary>,
  context: ReadContext,
): WorkforceCompliancePolicyDetail {
  const aggregate = aggregates.get(operationKey)!;
  const policy = fallbackPolicies.get(operationKey) ?? emptyPolicySummary('missing', null);
  return {
    operationKey,
    policy: {
      ...policy,
      requirements: policy.requirements.map((requirement) => ({
        ...requirement,
        missingEmployeeCount:
          aggregate.missingEmployeesByQualification.get(requirement.qualificationId) ?? 0,
        expiringEmployeeCount:
          aggregate.expiringEmployeesByQualification.get(requirement.qualificationId) ?? 0,
      })),
    },
    readiness: aggregate.readiness,
    findingCounts: aggregate.findingCounts,
    asOf: context.explicitAsOf,
    horizonDays: context.horizonDays,
  };
}

function projectedValidUntilFor(
  qualification: WorkforceComplianceQualificationRow,
  asOf: IsoCalendarDate,
  cutoff: Date,
  cutoffExclusive: boolean,
  timezone: string,
): IsoCalendarDate | null {
  const revokedAt = qualification.revokedAt;
  if (!revokedAt || occurredByCutoff(revokedAt, cutoff, cutoffExclusive)) {
    return qualification.validUntil;
  }
  const revokedOn = localDate(revokedAt, timezone);
  const lastActive = revokedOn === asOf ? revokedOn : addDays(revokedOn, -1);
  return qualification.validUntil === null || lastActive < qualification.validUntil
    ? lastActive
    : qualification.validUntil;
}

function occurredByCutoff(value: Date, cutoff: Date, cutoffExclusive: boolean): boolean {
  return cutoffExclusive ? value.getTime() < cutoff.getTime() : value.getTime() <= cutoff.getTime();
}

function overallReadiness(
  values: readonly (WorkforceReadiness | null)[],
): WorkforceReadiness | null {
  const evaluated = values.filter((value): value is WorkforceReadiness => value !== null);
  if (evaluated.includes('not_ready')) return 'not_ready';
  if (evaluated.includes('at_risk')) return 'at_risk';
  return evaluated.length ? 'ready' : null;
}

function readinessBucket(readiness: WorkforceReadiness): 'ready' | 'atRisk' | 'notReady' {
  return readiness === 'ready' ? 'ready' : readiness === 'at_risk' ? 'atRisk' : 'notReady';
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function localDate(date: Date, timezone: string): IsoCalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${String(values.year).padStart(4, '0')}-${values.month}-${values.day}`;
}

function localMidnight(date: IsoCalendarDate, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const target = utcTimestamp(year!, month! - 1, day!);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = utcTimestamp(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const difference = target - represented;
    if (difference === 0) break;
    guess += difference;
  }
  return new Date(guess);
}

function addDays(date: IsoCalendarDate, amount: number): IsoCalendarDate {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(utcTimestamp(year!, month! - 1, day! + amount));
  return `${next.getUTCFullYear().toString().padStart(4, '0')}-${(next.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${next.getUTCDate().toString().padStart(2, '0')}`;
}

function utcTimestamp(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(hours, minutes, seconds, 0);
  return date.getTime();
}
