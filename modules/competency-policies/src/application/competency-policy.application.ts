import { and, asc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import {
  employeeQualifications,
  employeeRecords,
  qualificationDefinitions,
  type EmployeeQualificationPolicyGuard,
} from '@care/employees';
import { createDomainEvent } from '@care/events';
import type { OutboxWriter } from '@care/platform';
import {
  assertCan,
  COMPETENCY_OPERATIONS,
  type AuthorizationPrincipal,
  type CompetencyDenialCode,
  type CompetencyOperation,
  type CompetencyPolicyEvaluationRequest,
  type CompetencyPolicyEvaluationResult,
  type CompetencyPolicyEvaluator,
} from '@care/permissions';
import { evaluateRequirements, qualificationIsValidAt } from '../domain/competency-policy';
import {
  professionalCompetencyPolicies,
  professionalCompetencyPolicyRequirements,
  professionalCompetencyPolicyVersions,
} from '../schema';
import {
  CompetencyPolicyRepository,
  type CompetencyPolicySnapshot,
} from '../infrastructure/competency-policy.repository';

export interface CompetencyPolicyAuditContext {
  ip?: string;
  userAgent?: string;
}

export interface ConfigureCompetencyPolicyInput {
  expectedVersion: number;
  name: string;
  description: string | null;
  requirementMode: 'ANY' | 'ALL';
  qualificationDefinitionIds: readonly string[];
}

export interface CompetencyPolicyOperationView {
  operationKey: CompetencyOperation;
  policyId: string | null;
  latestVersion: number;
  activeVersion: number | null;
  versions: CompetencyPolicySnapshot['versions'];
}

export interface CompetencyPolicyAdminView {
  operations: CompetencyPolicyOperationView[];
  qualificationDefinitions: Array<{ id: string; code: string | null; name: string }>;
}

export class CompetencyPolicyNotFoundError extends Error {
  readonly code = 'COMPETENCY_POLICY_NOT_FOUND';

  constructor() {
    super('Competency policy was not found');
    this.name = 'CompetencyPolicyNotFoundError';
  }
}

export class CompetencyPolicyVersionConflictError extends Error {
  readonly code = 'COMPETENCY_POLICY_VERSION_CONFLICT';

  constructor() {
    super('Competency policy changed; reload the current version and retry');
    this.name = 'CompetencyPolicyVersionConflictError';
  }
}

export class InvalidCompetencyPolicyConfigurationError extends Error {
  readonly code = 'INVALID_COMPETENCY_POLICY_CONFIGURATION';

  constructor() {
    super('Competency policy configuration is invalid');
    this.name = 'InvalidCompetencyPolicyConfigurationError';
  }
}

export class CompetencyQualificationInUseError extends Error {
  readonly code = 'QUALIFICATION_REQUIRED_BY_ACTIVE_COMPETENCY_POLICY';

  constructor() {
    super('Qualification is required by an active competency policy');
    this.name = 'CompetencyQualificationInUseError';
  }
}

export class ProfessionalCompetencyPolicyApplicationService
  implements CompetencyPolicyEvaluator<DatabaseTransaction>, EmployeeQualificationPolicyGuard
{
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository = new CompetencyPolicyRepository(),
  ) {}

  async list(principal: AuthorizationPrincipal): Promise<CompetencyPolicyAdminView> {
    this.authorize(principal, 'competency_policy.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const policies = await this.repository.list(transaction, principal.tenantId);
      const activeQualifications = await transaction
        .select({
          id: qualificationDefinitions.id,
          code: qualificationDefinitions.code,
          name: qualificationDefinitions.name,
        })
        .from(qualificationDefinitions)
        .where(
          and(
            eq(qualificationDefinitions.tenantId, principal.tenantId),
            eq(qualificationDefinitions.status, 'active'),
          ),
        )
        .orderBy(asc(qualificationDefinitions.name));
      const byOperation = new Map(policies.map((policy) => [policy.operationKey, policy]));

      return {
        operations: COMPETENCY_OPERATIONS.map((operationKey) => {
          const policy = byOperation.get(operationKey);
          return {
            operationKey,
            policyId: policy?.id ?? null,
            latestVersion: policy?.latestVersion ?? 0,
            activeVersion:
              policy?.versions.find((version) => version.status === 'active')?.version ?? null,
            versions: policy?.versions ?? [],
          };
        }),
        qualificationDefinitions: activeQualifications,
      };
    });
  }

  async configureDraft(
    principal: AuthorizationPrincipal,
    operationKey: CompetencyOperation,
    input: ConfigureCompetencyPolicyInput,
    request: RequestContext,
    auditContext: CompetencyPolicyAuditContext,
  ): Promise<CompetencyPolicyAdminView> {
    this.authorize(principal, 'competency_policy.manage');
    validateConfiguration(input);

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const qualificationIds = [...input.qualificationDefinitionIds].sort();
      const definitions = await transaction
        .select({ id: qualificationDefinitions.id, status: qualificationDefinitions.status })
        .from(qualificationDefinitions)
        .where(
          and(
            eq(qualificationDefinitions.tenantId, principal.tenantId),
            inArray(qualificationDefinitions.id, qualificationIds),
          ),
        )
        .orderBy(asc(qualificationDefinitions.id))
        .for('share');
      if (
        definitions.length !== qualificationIds.length ||
        definitions.some((definition) => definition.status !== 'active')
      ) {
        throw new InvalidCompetencyPolicyConfigurationError();
      }

      let policy = await this.repository.policy(
        transaction,
        principal.tenantId,
        operationKey,
        true,
      );
      const created = policy === null;
      if (!policy) {
        const id = uuidv7();
        const [inserted] = await transaction
          .insert(professionalCompetencyPolicies)
          .values({
            id,
            tenantId: principal.tenantId,
            operationKey,
            latestVersion: 0,
          })
          .onConflictDoNothing({
            target: [
              professionalCompetencyPolicies.tenantId,
              professionalCompetencyPolicies.operationKey,
            ],
          })
          .returning({
            id: professionalCompetencyPolicies.id,
            operationKey: professionalCompetencyPolicies.operationKey,
            latestVersion: professionalCompetencyPolicies.latestVersion,
          });
        if (!inserted) throw new CompetencyPolicyVersionConflictError();
        policy = inserted;
      }
      if (policy.latestVersion !== input.expectedVersion) {
        throw new CompetencyPolicyVersionConflictError();
      }

      const now = new Date();
      const versionNumber = policy.latestVersion + 1;
      const versionId = uuidv7();
      await transaction
        .update(professionalCompetencyPolicies)
        .set({ latestVersion: versionNumber, updatedAt: now })
        .where(
          and(
            eq(professionalCompetencyPolicies.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicies.id, policy.id),
          ),
        );
      await transaction.insert(professionalCompetencyPolicyVersions).values({
        id: versionId,
        tenantId: principal.tenantId,
        policyId: policy.id,
        operationKey,
        version: versionNumber,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        requirementMode: input.requirementMode,
        status: 'draft',
        createdBy: principal.userId,
        createdAt: now,
      });
      await transaction.insert(professionalCompetencyPolicyRequirements).values(
        qualificationIds.map((qualificationDefinitionId) => ({
          id: uuidv7(),
          tenantId: principal.tenantId,
          policyVersionId: versionId,
          qualificationDefinitionId,
        })),
      );

      const event = createDomainEvent({
        type: created ? 'competency_policy.created' : 'competency_policy.updated',
        tenantId: principal.tenantId,
        aggregateType: 'competency_policy',
        aggregateId: policy.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: { policyId: policy.id, operationKey, version: versionNumber },
      });
      await this.recordPolicyEvent(transaction, principal, request, auditContext, event, {
        operationKey,
        policyId: policy.id,
        policyVersion: versionNumber,
      });
      return this.readAdminView(transaction, principal.tenantId);
    });
  }

  async activate(
    principal: AuthorizationPrincipal,
    operationKey: CompetencyOperation,
    versionNumber: number,
    request: RequestContext,
    auditContext: CompetencyPolicyAuditContext,
  ): Promise<CompetencyPolicyAdminView> {
    this.authorize(principal, 'competency_policy.manage');
    if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
      throw new InvalidCompetencyPolicyConfigurationError();
    }

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const currentPolicy = await this.repository.policy(
        transaction,
        principal.tenantId,
        operationKey,
      );
      if (!currentPolicy) throw new CompetencyPolicyNotFoundError();
      const draft = await this.repository.version(
        transaction,
        principal.tenantId,
        currentPolicy.id,
        versionNumber,
      );
      if (!draft || draft.status !== 'draft' || currentPolicy.latestVersion !== versionNumber) {
        throw new CompetencyPolicyVersionConflictError();
      }

      const requirements = await this.repository.requirements(
        transaction,
        principal.tenantId,
        draft.id,
      );
      if (requirements.length === 0 || requirements.length !== draft.requirementCount) {
        throw new InvalidCompetencyPolicyConfigurationError();
      }
      const qualificationIds = requirements
        .map((requirement) => requirement.qualificationDefinitionId)
        .sort();
      const definitions = await transaction
        .select({ id: qualificationDefinitions.id, status: qualificationDefinitions.status })
        .from(qualificationDefinitions)
        .where(
          and(
            eq(qualificationDefinitions.tenantId, principal.tenantId),
            inArray(qualificationDefinitions.id, qualificationIds),
          ),
        )
        .orderBy(asc(qualificationDefinitions.id))
        .for('share');
      if (
        definitions.length !== qualificationIds.length ||
        definitions.some((definition) => definition.status !== 'active')
      ) {
        throw new InvalidCompetencyPolicyConfigurationError();
      }

      const policy = await this.repository.policy(
        transaction,
        principal.tenantId,
        operationKey,
        true,
      );
      if (!policy || policy.latestVersion !== versionNumber) {
        throw new CompetencyPolicyVersionConflictError();
      }
      const lockedDraft = await this.repository.version(
        transaction,
        principal.tenantId,
        policy.id,
        versionNumber,
        'update',
      );
      if (!lockedDraft || lockedDraft.status !== 'draft') {
        throw new CompetencyPolicyVersionConflictError();
      }

      const now = new Date();
      const [active] = await transaction
        .select({ id: professionalCompetencyPolicyVersions.id })
        .from(professionalCompetencyPolicyVersions)
        .where(
          and(
            eq(professionalCompetencyPolicyVersions.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicyVersions.operationKey, operationKey),
            eq(professionalCompetencyPolicyVersions.status, 'active'),
          ),
        )
        .for('update')
        .limit(1);
      if (active) {
        await transaction
          .update(professionalCompetencyPolicyVersions)
          .set({ status: 'inactive', deactivatedAt: now })
          .where(
            and(
              eq(professionalCompetencyPolicyVersions.tenantId, principal.tenantId),
              eq(professionalCompetencyPolicyVersions.id, active.id),
            ),
          );
      }
      await transaction
        .update(professionalCompetencyPolicyVersions)
        .set({ status: 'active', activatedAt: now })
        .where(
          and(
            eq(professionalCompetencyPolicyVersions.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicyVersions.id, lockedDraft.id),
          ),
        );
      await transaction
        .update(professionalCompetencyPolicies)
        .set({ updatedAt: now })
        .where(
          and(
            eq(professionalCompetencyPolicies.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicies.id, policy.id),
          ),
        );

      const event = createDomainEvent({
        type: 'competency_policy.activated',
        tenantId: principal.tenantId,
        aggregateType: 'competency_policy',
        aggregateId: policy.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: { policyId: policy.id, operationKey, version: versionNumber },
      });
      await this.recordPolicyEvent(transaction, principal, request, auditContext, event, {
        operationKey,
        policyId: policy.id,
        policyVersion: versionNumber,
      });
      return this.readAdminView(transaction, principal.tenantId);
    });
  }

  async deactivate(
    principal: AuthorizationPrincipal,
    operationKey: CompetencyOperation,
    request: RequestContext,
    auditContext: CompetencyPolicyAuditContext,
  ): Promise<CompetencyPolicyAdminView> {
    this.authorize(principal, 'competency_policy.manage');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const policy = await this.repository.policy(
        transaction,
        principal.tenantId,
        operationKey,
        true,
      );
      if (!policy) throw new CompetencyPolicyNotFoundError();
      const [active] = await transaction
        .select({
          id: professionalCompetencyPolicyVersions.id,
          version: professionalCompetencyPolicyVersions.version,
        })
        .from(professionalCompetencyPolicyVersions)
        .where(
          and(
            eq(professionalCompetencyPolicyVersions.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicyVersions.policyId, policy.id),
            eq(professionalCompetencyPolicyVersions.status, 'active'),
          ),
        )
        .for('update')
        .limit(1);
      if (!active) throw new CompetencyPolicyVersionConflictError();

      const now = new Date();
      await transaction
        .update(professionalCompetencyPolicyVersions)
        .set({ status: 'inactive', deactivatedAt: now })
        .where(
          and(
            eq(professionalCompetencyPolicyVersions.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicyVersions.id, active.id),
          ),
        );
      await transaction
        .update(professionalCompetencyPolicies)
        .set({ updatedAt: now })
        .where(
          and(
            eq(professionalCompetencyPolicies.tenantId, principal.tenantId),
            eq(professionalCompetencyPolicies.id, policy.id),
          ),
        );

      const event = createDomainEvent({
        type: 'competency_policy.deactivated',
        tenantId: principal.tenantId,
        aggregateType: 'competency_policy',
        aggregateId: policy.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: { policyId: policy.id, operationKey, version: active.version },
      });
      await this.recordPolicyEvent(transaction, principal, request, auditContext, event, {
        operationKey,
        policyId: policy.id,
        policyVersion: active.version,
      });
      return this.readAdminView(transaction, principal.tenantId);
    });
  }

  async evaluate(
    transaction: DatabaseTransaction,
    request: CompetencyPolicyEvaluationRequest,
  ): Promise<CompetencyPolicyEvaluationResult> {
    const version = await this.repository.activeVersion(
      transaction,
      request.tenantId,
      request.operation,
    );
    if (!version) {
      const policy = await this.repository.policy(transaction, request.tenantId, request.operation);
      return denied(policy ? 'COMPETENCY_POLICY_INACTIVE' : 'COMPETENCY_POLICY_NOT_CONFIGURED');
    }

    const requirements = await this.repository.requirements(
      transaction,
      request.tenantId,
      version.id,
    );
    const requiredIds = requirements.map((requirement) => requirement.qualificationDefinitionId);
    if (requiredIds.length === 0 || requiredIds.length !== version.requirementCount) {
      return denied('COMPETENCY_POLICY_INVALID', version);
    }

    const definitions = await transaction
      .select({ id: qualificationDefinitions.id, status: qualificationDefinitions.status })
      .from(qualificationDefinitions)
      .where(
        and(
          eq(qualificationDefinitions.tenantId, request.tenantId),
          inArray(qualificationDefinitions.id, requiredIds),
        ),
      )
      .orderBy(asc(qualificationDefinitions.id))
      .for('share');
    if (
      definitions.length !== requiredIds.length ||
      definitions.some((definition) => definition.status !== 'active')
    ) {
      return denied('COMPETENCY_POLICY_INVALID', version);
    }

    const [employee] = await transaction
      .select({ id: employeeRecords.id, status: employeeRecords.status })
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, request.tenantId),
          eq(employeeRecords.userId, request.userId),
        ),
      )
      .for('share')
      .limit(1);
    if (!employee) return denied('COMPETENCY_EMPLOYEE_LINK_REQUIRED', version);
    if (employee.status !== 'active') return denied('COMPETENCY_EMPLOYEE_INACTIVE', version);

    const assignments = await transaction
      .select({
        qualificationId: employeeQualifications.qualificationId,
        validFrom: employeeQualifications.validFrom,
        validUntil: employeeQualifications.validUntil,
        status: employeeQualifications.status,
      })
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.tenantId, request.tenantId),
          eq(employeeQualifications.employeeId, employee.id),
          inArray(employeeQualifications.qualificationId, requiredIds),
        ),
      )
      .orderBy(asc(employeeQualifications.qualificationId), asc(employeeQualifications.createdAt))
      .for('share');
    const effectiveAt = request.effectiveAt ?? new Date();
    if (Number.isNaN(effectiveAt.getTime())) return denied('COMPETENCY_POLICY_INVALID', version);
    const effectiveDate = effectiveAt.toISOString().slice(0, 10);
    const validIds = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.status === 'active' &&
            qualificationIsValidAt(assignment.validFrom, assignment.validUntil, effectiveDate),
        )
        .map((assignment) => assignment.qualificationId),
    );
    const result = evaluateRequirements(version.requirementMode, requiredIds, validIds);
    if (!result.allowed) {
      const hasExpired = assignments.some(
        (assignment) =>
          assignment.status === 'active' &&
          ((assignment.validFrom !== null && assignment.validFrom > effectiveDate) ||
            (assignment.validUntil !== null && assignment.validUntil < effectiveDate)),
      );
      const hasAnyActive = assignments.some((assignment) => assignment.status === 'active');
      const reasonCode =
        result.matchedQualificationIds.length > 0
          ? 'COMPETENCY_REQUIREMENTS_NOT_MET'
          : hasExpired
            ? 'COMPETENCY_QUALIFICATION_EXPIRED'
            : hasAnyActive
              ? 'COMPETENCY_REQUIREMENTS_NOT_MET'
              : 'COMPETENCY_QUALIFICATION_MISSING';
      return denied(reasonCode, version);
    }

    return {
      allowed: true,
      policyId: version.policyId,
      policyVersion: version.version,
      employeeId: employee.id,
      matchedQualificationIds: result.matchedQualificationIds,
      evaluatedAt: effectiveAt,
    };
  }

  async isQualificationUsedByActivePolicy(
    transaction: DatabaseTransaction,
    tenantId: string,
    qualificationDefinitionId: string,
  ): Promise<boolean> {
    const [reference] = await transaction
      .select({ id: professionalCompetencyPolicyRequirements.id })
      .from(professionalCompetencyPolicyRequirements)
      .innerJoin(
        professionalCompetencyPolicyVersions,
        and(
          eq(
            professionalCompetencyPolicyVersions.tenantId,
            professionalCompetencyPolicyRequirements.tenantId,
          ),
          eq(
            professionalCompetencyPolicyVersions.id,
            professionalCompetencyPolicyRequirements.policyVersionId,
          ),
          eq(professionalCompetencyPolicyVersions.status, 'active'),
        ),
      )
      .where(
        and(
          eq(professionalCompetencyPolicyRequirements.tenantId, tenantId),
          eq(
            professionalCompetencyPolicyRequirements.qualificationDefinitionId,
            qualificationDefinitionId,
          ),
        ),
      )
      .limit(1);
    return reference !== undefined;
  }

  private authorize(
    principal: AuthorizationPrincipal,
    action: 'competency_policy.read' | 'competency_policy.manage',
  ) {
    assertCan(principal, { action, resource: { tenantId: principal.tenantId } });
  }

  private async readAdminView(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<CompetencyPolicyAdminView> {
    const policies = await this.repository.list(transaction, tenantId);
    const activeQualifications = await transaction
      .select({
        id: qualificationDefinitions.id,
        code: qualificationDefinitions.code,
        name: qualificationDefinitions.name,
      })
      .from(qualificationDefinitions)
      .where(
        and(
          eq(qualificationDefinitions.tenantId, tenantId),
          eq(qualificationDefinitions.status, 'active'),
        ),
      )
      .orderBy(asc(qualificationDefinitions.name));
    const byOperation = new Map(policies.map((policy) => [policy.operationKey, policy]));
    return {
      operations: COMPETENCY_OPERATIONS.map((operationKey) => {
        const policy = byOperation.get(operationKey);
        return {
          operationKey,
          policyId: policy?.id ?? null,
          latestVersion: policy?.latestVersion ?? 0,
          activeVersion:
            policy?.versions.find((version) => version.status === 'active')?.version ?? null,
          versions: policy?.versions ?? [],
        };
      }),
      qualificationDefinitions: activeQualifications,
    };
  }

  private async recordPolicyEvent(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: CompetencyPolicyAuditContext,
    event: ReturnType<typeof createDomainEvent>,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: event.type,
      resourceType: 'competency_policy',
      resourceId: event.aggregateId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }
}

function denied(
  reasonCode: CompetencyDenialCode,
  policy?: { policyId: string; version: number },
): CompetencyPolicyEvaluationResult {
  return {
    allowed: false,
    reasonCode,
    ...(policy ? { policyId: policy.policyId, policyVersion: policy.version } : {}),
  };
}

function validateConfiguration(input: ConfigureCompetencyPolicyInput): void {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.name.trim().length < 1 ||
    input.name.trim().length > 160 ||
    (input.description?.length ?? 0) > 1000 ||
    (input.requirementMode !== 'ANY' && input.requirementMode !== 'ALL') ||
    input.qualificationDefinitionIds.length === 0 ||
    input.qualificationDefinitionIds.length > 100 ||
    new Set(input.qualificationDefinitionIds).size !== input.qualificationDefinitionIds.length
  ) {
    throw new InvalidCompetencyPolicyConfigurationError();
  }
}
