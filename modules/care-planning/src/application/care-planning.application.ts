import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService, ClientSnapshot } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent, type DomainEvent } from '@care/events';
import { employeeRecords } from '@care/employees';
import {
  authorizeProfessionalOperation,
  assertCan,
  AuthorizationDeniedError,
  can,
  type CompetencyOperation,
  type CompetencyAuthorizationMetadata,
  type CompetencyPolicyEvaluationResult,
  type CompetencyPolicyEvaluator,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { VisitExecutionApplicationService } from '@care/visit-execution';
import {
  assertExpectedCarePlanVersion,
  CarePlanVersionConflictError,
  diffCarePlanRevisions,
  InvalidCarePlanError,
  transitionCarePlanStatus,
  validateCareGoal,
  validateCareMeasure,
  validateCareNeed,
  validateCarePlanAssessment,
  validateCarePlanEvaluation,
  validateCarePlanSourceReference,
  validateCareResource,
  validateCareRiskResponse,
  validateCreateCarePlan,
  validateCreateCarePlanRevision,
  validateActivationCompleteness,
  type CareGoalInput,
  type CareMeasureInput,
  type CareNeedInput,
  type CarePlan,
  type CarePlanAssessmentInput,
  type CarePlanDetail,
  type CarePlanEvaluation,
  type CarePlanEvaluationInput,
  type CarePlanHistory,
  type CarePlanListQuery,
  type CarePlanPage,
  type CarePlanRevisionDiff,
  type CarePlanRevisionDetail,
  type CareRiskResponseInput,
  type CarePlanSourceReferenceInput,
  type CarePlanVisitView,
  type CarePlanWorklistQuery,
  type CareResourceInput,
  type CreateCarePlanInput,
  type CreateCarePlanRevisionInput,
  type EndCarePlanInput,
  type VersionedCarePlanInput,
} from '../domain/care-plan';
import {
  CarePlanRepository,
  type CarePlanWorklistScope,
} from '../infrastructure/care-plan.repository';

type AuditContext = { ip?: string; userAgent?: string };
type DraftItemType =
  | 'assessment'
  | 'need'
  | 'resource'
  | 'risk_response'
  | 'source_reference'
  | 'goal'
  | 'measure';
type DraftItemOperation = 'added' | 'updated' | 'removed';
type CarePlanAction = Extract<Permission, `care_plan.${string}`>;

export interface CarePlanEligibilityView {
  operation: CompetencyOperation;
  permissionAllowed: boolean;
  competency: CompetencyPolicyEvaluationResult | null;
}

/** Care Plan activation and evaluation require permission, scope, and an active competency policy. */
export class CarePlanningApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: ClientApplicationService,
    private readonly visitExecution: Pick<VisitExecutionApplicationService, 'get'>,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly competencyPolicies: CompetencyPolicyEvaluator<DatabaseTransaction>,
    private readonly repository = new CarePlanRepository(),
  ) {}

  async create(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: CreateCarePlanInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    validateCreateCarePlan(input);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(
        transaction,
        principal,
        clientId,
        true,
      );
      if (client.status !== 'active') throw new CarePlanClientInactiveError();
      const resource = clientResource(client);
      assertCan(principal, { action: 'care_plan.create', resource });
      const provider = providerForClient(client);
      if (!provider) throw new CarePlanProviderContextRequiredError();
      const existing = await this.repository.currentForClient(
        transaction,
        principal.tenantId,
        clientId,
        provider.organizationId,
        provider.facilityId,
      );
      if (existing) throw new CarePlanCurrentPlanExistsError();
      const employeeId = await this.activeEmployeeForUser(transaction, principal);
      const plan: CarePlan = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        clientId,
        organizationId: provider.organizationId,
        facilityId: provider.facilityId,
        status: 'draft',
        validFrom: input.validFrom,
        validUntil: input.validUntil ?? null,
        version: 1,
        createdByEmployeeId: employeeId,
        createdByEmployeeName: null,
        endedByEmployeeId: null,
        endedAt: null,
        endedReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const revision = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        planId: plan.id,
        clientId,
        revisionNumber: 1,
        status: 'draft' as const,
        authorEmployeeId: employeeId,
        authorEmployeeName: null,
        reason: null,
        effectiveFrom: input.validFrom,
        createdAt: now,
        activatedByEmployeeId: null,
        activatedByEmployeeName: null,
        activatedAt: null,
        supersededAt: null,
      };
      await this.repository.insertPlan(transaction, plan);
      await this.repository.insertInitialRevision(transaction, revision, now);
      const event = createDomainEvent({
        type: 'care_plan.created',
        tenantId: principal.tenantId,
        aggregateType: 'care_plan',
        aggregateId: plan.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: { planId: plan.id, clientId, revisionId: revision.id },
      });
      await this.recordLifecycle(transaction, principal, request, auditContext, event, {
        planId: plan.id,
        clientId,
        revisionId: revision.id,
      });
      return (await this.repository.detail(transaction, principal.tenantId, plan.id))!;
    });
  }

  async get(principal: AuthorizationPrincipal, planId: string): Promise<CarePlanDetail> {
    this.denyCaregiver(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(transaction, principal, planId, 'care_plan.read');
      return (await this.repository.detail(transaction, principal.tenantId, plan.id))!;
    });
  }

  async getActiveForClient(
    principal: AuthorizationPrincipal,
    clientId: string,
  ): Promise<CarePlanDetail | null> {
    this.denyCaregiver(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(transaction, principal, clientId);
      assertCan(principal, { action: 'care_plan.read', resource: clientResource(client) });
      const provider = providerForClient(client);
      if (!provider) return null;
      return this.repository.currentForClient(
        transaction,
        principal.tenantId,
        clientId,
        provider.organizationId,
        provider.facilityId,
      );
    });
  }

  async previewAuthorization(
    principal: AuthorizationPrincipal,
    planId: string,
    operation: CompetencyOperation,
  ): Promise<CarePlanEligibilityView> {
    this.denyCaregiver(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(transaction, principal, planId, 'care_plan.read');
      const resource = professionalResource(plan);
      const permissionAllowed = can(principal, { action: operation, resource });
      if (!permissionAllowed) return { operation, permissionAllowed, competency: null };
      const competency = await this.competencyPolicies.evaluate(transaction, {
        tenantId: principal.tenantId,
        userId: principal.userId,
        operation,
        resource: { type: resource.type, id: resource.id },
        effectiveAt: new Date(),
      });
      return { operation, permissionAllowed, competency };
    });
  }

  async getActiveForVisit(
    principal: AuthorizationPrincipal,
    visitId: string,
  ): Promise<CarePlanVisitView | null> {
    const visit = await this.visitExecution.get(principal, visitId);
    if (visit.visit.status === 'cancelled') throw new CarePlanVisitNotFoundError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(
        transaction,
        principal,
        visit.visit.clientId,
      );
      const provider = providerForClient(client);
      if (!provider) return null;
      const resource = {
        ...clientResource(client),
        ...(principal.roles?.includes('Caregiver') ? { assignedUserIds: [principal.userId] } : {}),
      };
      assertCan(principal, { action: 'care_plan.read', resource });
      const detail = await this.repository.currentForClient(
        transaction,
        principal.tenantId,
        client.id,
        provider.organizationId,
        provider.facilityId,
      );
      if (!detail?.activeRevision) return null;
      const today = new Date().toISOString().slice(0, 10);
      if (
        today < detail.plan.validFrom ||
        (detail.plan.validUntil && today > detail.plan.validUntil)
      ) {
        return null;
      }
      return {
        planId: detail.plan.id,
        clientId: detail.plan.clientId,
        status: detail.plan.status as 'active' | 'under_review',
        validFrom: detail.plan.validFrom,
        validUntil: detail.plan.validUntil,
        measures: detail.activeRevision.measures
          .filter(
            (measure) =>
              measure.status === 'active' &&
              measure.validFrom <= today &&
              (measure.validUntil === null || measure.validUntil >= today),
          )
          .map((measure) => ({
            id: measure.id,
            title: measure.title,
            instruction: measure.instruction,
            category: measure.category,
            frequencyText: measure.frequencyText,
            responsibleRole: measure.responsibleRole,
          })),
      };
    });
  }

  async listForClient(
    principal: AuthorizationPrincipal,
    clientId: string,
    query: Pick<CarePlanListQuery, 'status' | 'page' | 'pageSize'> = {},
  ): Promise<CarePlanPage> {
    return this.search(principal, { ...query, clientId });
  }

  async search(
    principal: AuthorizationPrincipal,
    query: CarePlanWorklistQuery = {},
  ): Promise<CarePlanPage> {
    this.denyCaregiver(principal);
    validateWorklistQuery(query);
    const planScope = scopeFor(principal, 'care_plan.read');
    const clientScope = scopeFor(principal, 'client.read');
    if (!hasScope(planScope)) throw new AuthorizationDeniedError('care_plan.read');
    if (!hasScope(clientScope)) throw new AuthorizationDeniedError('client.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.repository.search(transaction, principal.tenantId, query, planScope, clientScope),
    );
  }

  async getHistory(principal: AuthorizationPrincipal, planId: string): Promise<CarePlanHistory> {
    this.denyCaregiver(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(
        transaction,
        principal,
        planId,
        'care_plan.review_history',
      );
      assertCan(principal, { action: 'care_plan.read', resource: planResource(plan) });
      const revisions = await this.repository.history(transaction, principal.tenantId, plan.id);
      const evaluations = await this.repository.evaluationHistory(
        transaction,
        principal.tenantId,
        plan.id,
      );
      return { revisions, evaluations };
    });
  }

  async diffRevisions(
    principal: AuthorizationPrincipal,
    planId: string,
    fromRevisionId: string,
    toRevisionId: string,
  ): Promise<CarePlanRevisionDiff> {
    this.denyCaregiver(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(
        transaction,
        principal,
        planId,
        'care_plan.review_history',
      );
      assertCan(principal, { action: 'care_plan.read', resource: planResource(plan) });
      const from = await this.repository.revisionDetail(
        transaction,
        principal.tenantId,
        plan.id,
        fromRevisionId,
      );
      const to = await this.repository.revisionDetail(
        transaction,
        principal.tenantId,
        plan.id,
        toRevisionId,
      );
      if (!from || !to) throw new CarePlanRevisionNotFoundError();
      return diffCarePlanRevisions(from, to);
    });
  }

  async createRevision(
    principal: AuthorizationPrincipal,
    planId: string,
    input: CreateCarePlanRevisionInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    validateCreateCarePlanRevision(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(
        transaction,
        principal,
        planId,
        'care_plan.update',
        true,
      );
      assertExpectedCarePlanVersion(plan.version, input.expectedVersion);
      this.requireNotEnded(plan);
      if (plan.status === 'draft') throw new CarePlanActiveRevisionRequiredError();
      if (
        input.effectiveFrom < plan.validFrom ||
        (plan.validUntil && input.effectiveFrom > plan.validUntil)
      ) {
        throw new InvalidCarePlanError();
      }
      const detail = await this.repository.detail(transaction, principal.tenantId, plan.id);
      if (!detail?.activeRevision) throw new CarePlanActiveRevisionRequiredError();
      if (detail.draftRevision) throw new CarePlanDraftAlreadyExistsError();
      const employeeId = await this.activeEmployeeForUser(transaction, principal);
      const now = new Date();
      const revision = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        planId,
        clientId: plan.clientId,
        revisionNumber: await this.repository.nextRevisionNumber(
          transaction,
          principal.tenantId,
          planId,
        ),
        status: 'draft' as const,
        authorEmployeeId: employeeId,
        authorEmployeeName: null,
        reason: input.reason.trim(),
        effectiveFrom: input.effectiveFrom,
        createdAt: now,
        activatedByEmployeeId: null,
        activatedByEmployeeName: null,
        activatedAt: null,
        supersededAt: null,
      };
      await this.repository.createRevision(transaction, plan, revision, detail.activeRevision, now);
      await this.advancePlanVersion(transaction, plan, input.expectedVersion, now);
      const event = createDomainEvent({
        type: 'care_plan.revision_created',
        tenantId: principal.tenantId,
        aggregateType: 'care_plan',
        aggregateId: planId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: {
          planId,
          clientId: plan.clientId,
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
        },
      });
      await this.recordLifecycle(transaction, principal, request, auditContext, event, {
        planId,
        clientId: plan.clientId,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
      });
      return (await this.repository.detail(transaction, principal.tenantId, planId))!;
    });
  }

  async updateAssessment(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CarePlanAssessmentInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...assessment } = input;
    validateCarePlanAssessment(assessment);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'assessment',
      revisionId,
      'updated',
      request,
      auditContext,
      async (transaction, plan, _revision, _employeeId, now) => {
        await this.repository.saveAssessment(
          transaction,
          principal.tenantId,
          revisionId,
          assessment,
          now,
        );
      },
    );
  }

  async addNeed(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CareNeedInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...need } = input;
    validateCareNeed(need);
    const itemId = uuidv7();
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'need',
      itemId,
      'added',
      request,
      auditContext,
      async (transaction, plan, _revision, _employeeId, now) => {
        await this.repository.saveNeed(
          transaction,
          principal.tenantId,
          revisionId,
          itemId,
          need,
          now,
          true,
        );
      },
    );
  }

  async updateNeed(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    needId: string,
    input: VersionedCarePlanInput<CareNeedInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...need } = input;
    validateCareNeed(need);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'need',
      needId,
      'updated',
      request,
      auditContext,
      async (transaction, _plan, revision, _employeeId, now) => {
        requireItem(revision.needs.some((item) => item.id === needId));
        await this.repository.saveNeed(
          transaction,
          principal.tenantId,
          revisionId,
          needId,
          need,
          now,
          false,
        );
      },
    );
  }

  async removeNeed(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    needId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'need',
      needId,
      'removed',
      request,
      auditContext,
      async (transaction, _plan, revision) => {
        requireItem(revision.needs.some((item) => item.id === needId));
        if (
          revision.goals.some((item) => item.needIds.includes(needId)) ||
          revision.measures.some((item) => item.needIds.includes(needId)) ||
          revision.riskResponses.some((item) => item.needIds.includes(needId))
        )
          throw new CarePlanRelationshipConflictError();
        if (
          !(await this.repository.removeNeed(transaction, principal.tenantId, revisionId, needId))
        ) {
          throw new CarePlanItemNotFoundError();
        }
      },
    );
  }

  async addResource(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CareResourceInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...resource } = input;
    validateCareResource(resource);
    const itemId = uuidv7();
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'resource',
      itemId,
      'added',
      request,
      auditContext,
      async (transaction, _plan, _revision, _employeeId, now) => {
        await this.repository.saveResource(
          transaction,
          principal.tenantId,
          revisionId,
          itemId,
          resource,
          now,
          true,
        );
      },
    );
  }

  async updateResource(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    resourceId: string,
    input: VersionedCarePlanInput<CareResourceInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...resource } = input;
    validateCareResource(resource);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'resource',
      resourceId,
      'updated',
      request,
      auditContext,
      async (transaction, _plan, revision, _employeeId, now) => {
        requireItem(revision.resources.some((item) => item.id === resourceId));
        await this.repository.saveResource(
          transaction,
          principal.tenantId,
          revisionId,
          resourceId,
          resource,
          now,
          false,
        );
      },
    );
  }

  async removeResource(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    resourceId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'resource',
      resourceId,
      'removed',
      request,
      auditContext,
      async (transaction, _plan, revision) => {
        requireItem(revision.resources.some((item) => item.id === resourceId));
        if (
          !(await this.repository.removeResource(
            transaction,
            principal.tenantId,
            revisionId,
            resourceId,
          ))
        )
          throw new CarePlanItemNotFoundError();
      },
    );
  }

  async addRiskResponse(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CareRiskResponseInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...risk } = input;
    validateCareRiskResponse(risk);
    const itemId = uuidv7();
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'risk_response',
      itemId,
      'added',
      request,
      auditContext,
      async (transaction, plan, revision, _employeeId, now) => {
        this.assertRiskLinks(revision, risk);
        if (revision.riskResponses.some((item) => item.clinicalRecordId === risk.clinicalRecordId))
          throw new CarePlanItemConflictError();
        await this.repository.saveRiskResponse(
          transaction,
          principal.tenantId,
          plan.clientId,
          revisionId,
          itemId,
          risk,
          now,
          true,
        );
      },
    );
  }

  async updateRiskResponse(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    riskResponseId: string,
    input: VersionedCarePlanInput<CareRiskResponseInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...risk } = input;
    validateCareRiskResponse(risk);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'risk_response',
      riskResponseId,
      'updated',
      request,
      auditContext,
      async (transaction, plan, revision, _employeeId, now) => {
        requireItem(revision.riskResponses.some((item) => item.id === riskResponseId));
        this.assertRiskLinks(revision, risk);
        if (
          revision.riskResponses.some(
            (item) => item.id !== riskResponseId && item.clinicalRecordId === risk.clinicalRecordId,
          )
        )
          throw new CarePlanItemConflictError();
        await this.repository.saveRiskResponse(
          transaction,
          principal.tenantId,
          plan.clientId,
          revisionId,
          riskResponseId,
          risk,
          now,
          false,
        );
      },
    );
  }

  async removeRiskResponse(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    riskResponseId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'risk_response',
      riskResponseId,
      'removed',
      request,
      auditContext,
      async (transaction, _plan, revision) => {
        requireItem(revision.riskResponses.some((item) => item.id === riskResponseId));
        if (
          !(await this.repository.removeRiskResponse(
            transaction,
            principal.tenantId,
            revisionId,
            riskResponseId,
          ))
        )
          throw new CarePlanItemNotFoundError();
      },
    );
  }

  async addSourceReference(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CarePlanSourceReferenceInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...source } = input;
    validateCarePlanSourceReference(source);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'source_reference',
      source.clinicalRecordId,
      'added',
      request,
      auditContext,
      async (transaction, plan, revision, _employeeId, now) => {
        if (
          revision.sourceReferences.some(
            (item) => item.clinicalRecordId === source.clinicalRecordId,
          )
        )
          throw new CarePlanItemConflictError();
        await this.repository.addSourceReference(
          transaction,
          principal.tenantId,
          plan.id,
          plan.clientId,
          revisionId,
          source,
          now,
        );
      },
    );
  }

  async removeSourceReference(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    clinicalRecordId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'source_reference',
      clinicalRecordId,
      'removed',
      request,
      auditContext,
      async (transaction, _plan, revision) => {
        requireItem(
          revision.sourceReferences.some((item) => item.clinicalRecordId === clinicalRecordId),
        );
        if (
          !(await this.repository.removeSourceReference(
            transaction,
            principal.tenantId,
            revisionId,
            clinicalRecordId,
          ))
        )
          throw new CarePlanItemNotFoundError();
      },
    );
  }

  async addGoal(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CareGoalInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...goal } = input;
    validateCareGoal(goal);
    const itemId = uuidv7();
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'goal',
      itemId,
      'added',
      request,
      auditContext,
      async (transaction, _plan, revision, _employeeId, now) => {
        this.assertReferences(revision, goal.needIds, []);
        await this.repository.saveGoal(
          transaction,
          principal.tenantId,
          revisionId,
          itemId,
          goal,
          now,
          true,
        );
      },
    );
  }

  async updateGoal(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    goalId: string,
    input: VersionedCarePlanInput<CareGoalInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...goal } = input;
    validateCareGoal(goal);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'goal',
      goalId,
      'updated',
      request,
      auditContext,
      async (transaction, _plan, revision, _employeeId, now) => {
        requireItem(revision.goals.some((item) => item.id === goalId));
        this.assertReferences(revision, goal.needIds, []);
        await this.repository.saveGoal(
          transaction,
          principal.tenantId,
          revisionId,
          goalId,
          goal,
          now,
          false,
        );
      },
    );
  }

  async removeGoal(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    goalId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'goal',
      goalId,
      'removed',
      request,
      auditContext,
      async (transaction, _plan, revision) => {
        requireItem(revision.goals.some((item) => item.id === goalId));
        if (revision.measures.some((item) => item.goalIds.includes(goalId)))
          throw new CarePlanRelationshipConflictError();
        if (
          !(await this.repository.removeGoal(transaction, principal.tenantId, revisionId, goalId))
        )
          throw new CarePlanItemNotFoundError();
      },
    );
  }

  async addMeasure(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: VersionedCarePlanInput<CareMeasureInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...measure } = input;
    validateCareMeasure(measure);
    const itemId = uuidv7();
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'measure',
      itemId,
      'added',
      request,
      auditContext,
      async (transaction, plan, revision, _employeeId, now) => {
        this.assertMeasureValidity(plan, measure);
        this.assertReferences(revision, measure.needIds, measure.goalIds);
        await this.repository.saveMeasure(
          transaction,
          principal.tenantId,
          revisionId,
          itemId,
          measure,
          now,
          true,
        );
      },
    );
  }

  async updateMeasure(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    measureId: string,
    input: VersionedCarePlanInput<CareMeasureInput>,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    const { expectedVersion, ...measure } = input;
    validateCareMeasure(measure);
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'measure',
      measureId,
      'updated',
      request,
      auditContext,
      async (transaction, plan, revision, _employeeId, now) => {
        requireItem(revision.measures.some((item) => item.id === measureId));
        this.assertMeasureValidity(plan, measure);
        this.assertReferences(revision, measure.needIds, measure.goalIds);
        await this.repository.saveMeasure(
          transaction,
          principal.tenantId,
          revisionId,
          measureId,
          measure,
          now,
          false,
        );
      },
    );
  }

  async removeMeasure(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    measureId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    return this.mutateDraft(
      principal,
      planId,
      revisionId,
      expectedVersion,
      'measure',
      measureId,
      'removed',
      request,
      auditContext,
      async (transaction, _plan, revision) => {
        requireItem(revision.measures.some((item) => item.id === measureId));
        if (revision.riskResponses.some((item) => item.measureIds.includes(measureId)))
          throw new CarePlanRelationshipConflictError();
        if (
          !(await this.repository.removeMeasure(
            transaction,
            principal.tenantId,
            revisionId,
            measureId,
          ))
        )
          throw new CarePlanItemNotFoundError();
      },
    );
  }

  async activateRevision(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    input: { expectedVersion: number },
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const plan = await this.authorizedPlan(
            transaction,
            principal,
            planId,
            'care_plan.activate',
            true,
          );
          assertExpectedCarePlanVersion(plan.version, input.expectedVersion);
          this.requireNotEnded(plan);
          const revision = await this.repository.revisionDetail(
            transaction,
            principal.tenantId,
            planId,
            revisionId,
          );
          if (!revision) throw new CarePlanRevisionNotFoundError();
          if (revision.revision.status !== 'draft') throw new CarePlanDraftRequiredError();
          if (
            revision.revision.effectiveFrom < plan.validFrom ||
            (plan.validUntil && revision.revision.effectiveFrom > plan.validUntil)
          ) {
            throw new InvalidCarePlanError();
          }
          validateActivationCompleteness({
            assessment: revision.assessment,
            needs: revision.needs.filter((item) => item.status === 'active'),
            resources: revision.resources.filter((item) => item.status !== 'unavailable'),
            measures: revision.measures,
            effectiveDate: revision.revision.effectiveFrom,
          });
          const now = new Date();
          const authorization = await authorizeProfessionalOperation(
            transaction,
            principal,
            {
              permission: 'care_plan.activate',
              operation: 'care_plan.activate',
              resource: professionalResource(plan),
              effectiveAt: now,
            },
            this.competencyPolicies,
          );
          const nextStatus = transitionCarePlanStatus(plan.status, 'active');
          const professionalAuthorization = authorizationEvent(authorization, 'care_plan.activate');
          await this.repository.activateRevision(
            transaction,
            principal.tenantId,
            planId,
            revisionId,
            authorization.employeeId,
            now,
          );
          await this.advancePlanVersion(
            transaction,
            { ...plan, status: nextStatus },
            input.expectedVersion,
            now,
          );
          const event = createDomainEvent({
            type: 'care_plan.revision_activated',
            tenantId: principal.tenantId,
            aggregateType: 'care_plan',
            aggregateId: planId,
            actor: { type: 'user', id: principal.userId },
            correlationId: request.correlationId,
            occurredAt: now.toISOString(),
            payload: {
              planId,
              clientId: plan.clientId,
              revisionId,
              revisionNumber: revision.revision.revisionNumber,
              professionalAuthorization,
            },
          });
          await this.recordLifecycle(transaction, principal, request, auditContext, event, {
            planId,
            clientId: plan.clientId,
            revisionId,
            revisionNumber: revision.revision.revisionNumber,
            professionalAuthorization,
          });
          return (await this.repository.detail(transaction, principal.tenantId, planId))!;
        },
      );
    } catch (error) {
      if (isUniqueViolation(error, 'care_plans_one_current_per_client_uq')) {
        throw new CarePlanCurrentPlanExistsError();
      }
      throw error;
    }
  }

  async evaluate(
    principal: AuthorizationPrincipal,
    planId: string,
    input: CarePlanEvaluationInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    validateCarePlanEvaluation(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(
        transaction,
        principal,
        planId,
        'care_plan.evaluate',
        true,
      );
      assertExpectedCarePlanVersion(plan.version, input.expectedVersion);
      this.requireNotEnded(plan);
      if (plan.status === 'draft') throw new CarePlanActiveRevisionRequiredError();
      const revision = await this.repository.revisionDetail(
        transaction,
        principal.tenantId,
        planId,
        input.revisionId,
      );
      if (!revision) throw new CarePlanRevisionNotFoundError();
      if (revision.revision.status !== 'active') throw new CarePlanActiveRevisionRequiredError();
      this.assertEvaluationGoals(revision, input);
      const authorization = await authorizeProfessionalOperation(
        transaction,
        principal,
        {
          permission: 'care_plan.evaluate',
          operation: 'care_plan.evaluate',
          resource: professionalResource(plan),
          effectiveAt: new Date(),
        },
        this.competencyPolicies,
      );
      const now = authorization.evaluatedAt;
      const professionalAuthorization = authorizationEvent(authorization, 'care_plan.evaluate');
      const evaluation: CarePlanEvaluation = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        planId,
        revisionId: input.revisionId,
        evaluatedByEmployeeId: authorization.employeeId,
        evaluatedByEmployeeName: null,
        evaluatedAt: now,
        result: input.result,
        planChange: input.planChange,
        summary: input.summary.trim(),
        nextEvaluationDue: input.nextEvaluationDue ?? null,
        goals: input.goals.map((goal) => ({ ...goal, note: goal.note?.trim() || null })),
      };
      await this.repository.addEvaluation(transaction, evaluation, plan.clientId);
      const nextStatus =
        input.planChange === 'revision_required'
          ? transitionCarePlanStatus(plan.status, 'under_review')
          : plan.status === 'under_review'
            ? transitionCarePlanStatus(plan.status, 'active')
            : plan.status;
      await this.advancePlanVersion(
        transaction,
        { ...plan, status: nextStatus },
        input.expectedVersion,
        now,
      );
      const event = createDomainEvent({
        type: 'care_plan.evaluated',
        tenantId: principal.tenantId,
        aggregateType: 'care_plan',
        aggregateId: planId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: {
          planId,
          clientId: plan.clientId,
          evaluationId: evaluation.id,
          revisionId: evaluation.revisionId,
          result: evaluation.result,
          professionalAuthorization,
        },
      });
      await this.recordLifecycle(transaction, principal, request, auditContext, event, {
        planId,
        clientId: plan.clientId,
        evaluationId: evaluation.id,
        revisionId: evaluation.revisionId,
        result: evaluation.result,
        planChange: evaluation.planChange,
        professionalAuthorization,
      });
      return (await this.repository.detail(transaction, principal.tenantId, planId))!;
    });
  }

  async end(
    principal: AuthorizationPrincipal,
    planId: string,
    input: EndCarePlanInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<CarePlanDetail> {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.reason.trim().length < 1 ||
      input.reason.trim().length > 1000
    ) {
      throw new InvalidCarePlanError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(transaction, principal, planId, 'care_plan.end', true);
      assertExpectedCarePlanVersion(plan.version, input.expectedVersion);
      this.requireNotEnded(plan);
      const nextStatus = transitionCarePlanStatus(plan.status, 'ended');
      const employeeId = await this.activeEmployeeForUser(transaction, principal);
      const now = new Date();
      await this.repository.endActiveRevision(transaction, principal.tenantId, planId, now);
      const ended = {
        ...plan,
        status: nextStatus,
        endedByEmployeeId: employeeId,
        endedAt: now,
        endedReason: input.reason.trim(),
      };
      await this.advancePlanVersion(transaction, ended, input.expectedVersion, now);
      const event = createDomainEvent({
        type: 'care_plan.ended',
        tenantId: principal.tenantId,
        aggregateType: 'care_plan',
        aggregateId: planId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        occurredAt: now.toISOString(),
        payload: { planId, clientId: plan.clientId },
      });
      await this.recordLifecycle(transaction, principal, request, auditContext, event, {
        planId,
        clientId: plan.clientId,
      });
      return (await this.repository.detail(transaction, principal.tenantId, planId))!;
    });
  }

  private async mutateDraft(
    principal: AuthorizationPrincipal,
    planId: string,
    revisionId: string,
    expectedVersion: number,
    itemType: DraftItemType,
    itemId: string,
    operation: DraftItemOperation,
    request: RequestContext,
    auditContext: AuditContext,
    mutate: (
      transaction: DatabaseTransaction,
      plan: CarePlan,
      revision: CarePlanRevisionDetail,
      employeeId: string,
      now: Date,
    ) => Promise<void>,
  ): Promise<CarePlanDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const plan = await this.authorizedPlan(
        transaction,
        principal,
        planId,
        'care_plan.update',
        true,
      );
      assertExpectedCarePlanVersion(plan.version, expectedVersion);
      this.requireNotEnded(plan);
      const revision = await this.repository.revisionDetail(
        transaction,
        principal.tenantId,
        planId,
        revisionId,
      );
      if (!revision) throw new CarePlanRevisionNotFoundError();
      if (revision.revision.status !== 'draft') throw new CarePlanDraftRequiredError();
      const employeeId = await this.activeEmployeeForUser(transaction, principal);
      const now = new Date();
      await mutate(transaction, plan, revision, employeeId, now);
      await this.advancePlanVersion(transaction, plan, expectedVersion, now);
      await this.recordDraftMutation(transaction, principal, request, auditContext, {
        plan,
        revisionId,
        itemType,
        itemId,
        operation,
        version: plan.version + 1,
        now,
      });
      return (await this.repository.detail(transaction, principal.tenantId, planId))!;
    });
  }

  private async authorizedPlan(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    planId: string,
    action: CarePlanAction,
    lock = false,
  ): Promise<CarePlan> {
    const plan = await this.repository.plan(transaction, principal.tenantId, planId, lock);
    if (!plan) throw new CarePlanNotFoundError();
    await this.clients.getForServiceAgreement(transaction, principal, plan.clientId);
    assertCan(principal, { action, resource: planResource(plan) });
    return plan;
  }

  private async activeEmployeeForUser(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
  ): Promise<string> {
    const [employee] = await transaction
      .select({ id: employeeRecords.id })
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, principal.tenantId),
          eq(employeeRecords.userId, principal.userId),
          eq(employeeRecords.status, 'active'),
        ),
      )
      .limit(1);
    if (!employee) throw new CarePlanEmployeeRequiredError();
    return employee.id;
  }

  private async advancePlanVersion(
    transaction: DatabaseTransaction,
    plan: CarePlan,
    expectedVersion: number,
    now: Date,
  ): Promise<void> {
    const updated = await this.repository.updatePlan(
      transaction,
      { ...plan, version: expectedVersion + 1, updatedAt: now },
      expectedVersion,
    );
    if (!updated) throw new CarePlanVersionConflictError();
  }

  private async recordLifecycle(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    event: DomainEvent,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: event.type,
      resourceType: 'care_plan',
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

  private async recordDraftMutation(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: {
      plan: CarePlan;
      revisionId: string;
      itemType: DraftItemType;
      itemId: string;
      operation: DraftItemOperation;
      version: number;
      now: Date;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: uuidv7(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: `care_plan.${input.itemType}_${input.operation}`,
      resourceType: 'care_plan',
      resourceId: input.plan.id,
      timestamp: input.now,
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: {
        planId: input.plan.id,
        clientId: input.plan.clientId,
        revisionId: input.revisionId,
        itemType: input.itemType,
        itemId: input.itemId,
        version: input.version,
      },
    });
  }

  private requireNotEnded(plan: CarePlan): void {
    if (plan.status === 'ended') throw new CarePlanAlreadyEndedError();
  }

  private assertReferences(
    revision: CarePlanRevisionDetail,
    needIds: readonly string[],
    goalIds: readonly string[],
  ): void {
    const needs = new Set(revision.needs.map((item) => item.id));
    const goals = new Set(revision.goals.map((item) => item.id));
    if (needIds.some((id) => !needs.has(id)) || goalIds.some((id) => !goals.has(id))) {
      throw new CarePlanRelationshipInvalidError();
    }
  }

  private assertRiskLinks(revision: CarePlanRevisionDetail, input: CareRiskResponseInput): void {
    this.assertReferences(revision, input.needIds, []);
    const measures = new Set(revision.measures.map((item) => item.id));
    if (input.measureIds.some((id) => !measures.has(id)))
      throw new CarePlanRelationshipInvalidError();
  }

  private assertMeasureValidity(plan: CarePlan, measure: CareMeasureInput): void {
    if (
      measure.validFrom < plan.validFrom ||
      (plan.validUntil !== null &&
        (measure.validUntil == null || measure.validUntil > plan.validUntil))
    )
      throw new InvalidCarePlanError();
  }

  private assertEvaluationGoals(
    revision: CarePlanRevisionDetail,
    input: CarePlanEvaluationInput,
  ): void {
    const goalIds = new Set(revision.goals.map((goal) => goal.id));
    if (input.goals.some((outcome) => !goalIds.has(outcome.goalId))) {
      throw new CarePlanGoalNotFoundError();
    }
  }

  private denyCaregiver(principal: AuthorizationPrincipal): void {
    if (principal.roles?.includes('Caregiver')) {
      throw new AuthorizationDeniedError('care_plan.read');
    }
  }
}

function clientResource(client: ClientSnapshot): ResourceContext {
  return {
    tenantId: client.tenantId,
    clientId: client.id,
    ...(client.organizationId ? { organizationId: client.organizationId } : {}),
    ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}),
  };
}

function planResource(plan: CarePlan): ResourceContext {
  return {
    tenantId: plan.tenantId,
    clientId: plan.clientId,
    organizationId: plan.organizationId,
    facilityId: plan.facilityId,
  };
}

function professionalResource(plan: CarePlan): ResourceContext & { type: 'care_plan'; id: string } {
  return { ...planResource(plan), type: 'care_plan', id: plan.id };
}

function authorizationEvent(
  authorization: CompetencyAuthorizationMetadata,
  operationKey: CompetencyOperation,
) {
  return {
    operationKey,
    policyId: authorization.policyId,
    policyVersion: authorization.policyVersion,
    employeeId: authorization.employeeId,
    matchedQualificationIds: [...authorization.matchedQualificationIds],
    evaluatedAt: authorization.evaluatedAt.toISOString(),
  };
}

function providerForClient(
  client: ClientSnapshot,
): { organizationId: string; facilityId: string } | null {
  if (!client.organizationId || !client.primaryFacilityId) return null;
  return { organizationId: client.organizationId, facilityId: client.primaryFacilityId };
}

function scopeFor(
  principal: AuthorizationPrincipal,
  permission: Extract<Permission, 'care_plan.read' | 'client.read'>,
): CarePlanWorklistScope {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  return {
    tenantWide: grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ],
    facilityIds: [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ],
  };
}

function hasScope(scope: CarePlanWorklistScope): boolean {
  return scope.tenantWide || scope.organizationIds.length > 0 || scope.facilityIds.length > 0;
}

function validateWorklistQuery(query: CarePlanWorklistQuery): void {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (query.status !== undefined &&
      !['draft', 'active', 'under_review', 'ended'].includes(query.status)) ||
    (query.clientId !== undefined && !isUuid(query.clientId)) ||
    (query.clientQuery !== undefined &&
      (query.clientQuery.trim().length < 1 || query.clientQuery.trim().length > 120)) ||
    (query.facilityId !== undefined && !isUuid(query.facilityId)) ||
    (query.evaluationDueBefore !== undefined && !isDate(query.evaluationDueBefore)) ||
    (query.evaluationOverdue !== undefined && typeof query.evaluationOverdue !== 'boolean')
  )
    throw new CarePlanInvalidQueryError();
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireItem(exists: boolean): void {
  if (!exists) throw new CarePlanItemNotFoundError();
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === constraint;
}

export class CarePlanNotFoundError extends Error {
  readonly code = 'CARE_PLAN_NOT_FOUND';
  constructor() {
    super('The care plan was not found');
    this.name = 'CarePlanNotFoundError';
  }
}
export class CarePlanRevisionNotFoundError extends Error {
  readonly code = 'CARE_PLAN_REVISION_NOT_FOUND';
  constructor() {
    super('The care plan revision was not found');
    this.name = 'CarePlanRevisionNotFoundError';
  }
}
export class CarePlanItemNotFoundError extends Error {
  readonly code = 'CARE_PLAN_ITEM_NOT_FOUND';
  constructor() {
    super('The care plan item was not found');
    this.name = 'CarePlanItemNotFoundError';
  }
}
export class CarePlanCurrentPlanExistsError extends Error {
  readonly code = 'CARE_PLAN_CURRENT_EXISTS';
  constructor() {
    super('A current care plan already exists for this provider context');
    this.name = 'CarePlanCurrentPlanExistsError';
  }
}
export class CarePlanDraftAlreadyExistsError extends Error {
  readonly code = 'CARE_PLAN_DRAFT_EXISTS';
  constructor() {
    super('A draft revision already exists');
    this.name = 'CarePlanDraftAlreadyExistsError';
  }
}
export class CarePlanDraftRequiredError extends Error {
  readonly code = 'CARE_PLAN_DRAFT_REQUIRED';
  constructor() {
    super('The care plan revision is not a draft');
    this.name = 'CarePlanDraftRequiredError';
  }
}
export class CarePlanActiveRevisionRequiredError extends Error {
  readonly code = 'CARE_PLAN_ACTIVE_REVISION_REQUIRED';
  constructor() {
    super('The care plan has no active revision');
    this.name = 'CarePlanActiveRevisionRequiredError';
  }
}
export class CarePlanAlreadyEndedError extends Error {
  readonly code = 'CARE_PLAN_ENDED';
  constructor() {
    super('The care plan has ended');
    this.name = 'CarePlanAlreadyEndedError';
  }
}
export class CarePlanEmployeeRequiredError extends Error {
  readonly code = 'CARE_PLAN_EMPLOYEE_REQUIRED';
  constructor() {
    super('An active employee link is required');
    this.name = 'CarePlanEmployeeRequiredError';
  }
}
export class CarePlanProviderContextRequiredError extends Error {
  readonly code = 'CARE_PLAN_PROVIDER_CONTEXT_REQUIRED';
  constructor() {
    super('The client has no provider context');
    this.name = 'CarePlanProviderContextRequiredError';
  }
}
export class CarePlanClientInactiveError extends Error {
  readonly code = 'CARE_PLAN_CLIENT_INACTIVE';
  constructor() {
    super('The client is not active');
    this.name = 'CarePlanClientInactiveError';
  }
}
export class CarePlanItemConflictError extends Error {
  readonly code = 'CARE_PLAN_ITEM_CONFLICT';
  constructor() {
    super('The care plan item conflicts with an existing item');
    this.name = 'CarePlanItemConflictError';
  }
}
export class CarePlanRelationshipConflictError extends Error {
  readonly code = 'CARE_PLAN_RELATIONSHIP_CONFLICT';
  constructor() {
    super('Remove the care plan relationships before removing this item');
    this.name = 'CarePlanRelationshipConflictError';
  }
}
export class CarePlanRelationshipInvalidError extends Error {
  readonly code = 'CARE_PLAN_RELATIONSHIP_INVALID';
  constructor() {
    super('A linked care plan item does not exist in this revision');
    this.name = 'CarePlanRelationshipInvalidError';
  }
}
export class CarePlanGoalNotFoundError extends Error {
  readonly code = 'CARE_PLAN_GOAL_NOT_FOUND';
  constructor() {
    super('An evaluated goal was not found in this revision');
    this.name = 'CarePlanGoalNotFoundError';
  }
}
export class CarePlanInvalidQueryError extends Error {
  readonly code = 'CARE_PLAN_QUERY_INVALID';
  constructor() {
    super('The care plan query is invalid');
    this.name = 'CarePlanInvalidQueryError';
  }
}
export class CarePlanVisitNotFoundError extends Error {
  readonly code = 'CARE_PLAN_VISIT_NOT_FOUND';
  constructor() {
    super('The care plan visit was not found');
    this.name = 'CarePlanVisitNotFoundError';
  }
}
