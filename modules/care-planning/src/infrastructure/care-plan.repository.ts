import { and, count, desc, eq, inArray, ilike, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { clientRecords } from '@care/clients';
import { facilities } from '@care/organizations';
import {
  carePlanAssessments,
  carePlanEvaluationGoals,
  carePlanEvaluations,
  carePlanGoalNeeds,
  carePlanGoals,
  carePlanMeasureGoals,
  carePlanMeasureNeeds,
  carePlanMeasures,
  carePlanNeeds,
  carePlanResources,
  carePlanRevisions,
  carePlanRiskResponseMeasures,
  carePlanRiskResponseNeeds,
  carePlanRiskResponses,
  carePlanSourceReferences,
  carePlans,
} from '../schema';
import type {
  CareGoalInput,
  CareMeasureInput,
  CareNeedInput,
  CarePlan,
  CarePlanAssessment,
  CarePlanAssessmentInput,
  CarePlanDetail,
  CarePlanEvaluation,
  CarePlanPage,
  CareResourceInput,
  CarePlanRevision,
  CarePlanRevisionDetail,
  CareRiskResponseInput,
  CarePlanSourceReferenceInput,
  CarePlanWorklistQuery,
  CareResource,
  CareRiskResponse,
  CareGoal,
  CareMeasure,
  CareNeed,
} from '../domain/care-plan';
import { copyForwardRevisionContent } from '../domain/care-plan';
import { employeeRecords } from '@care/employees';

export interface CarePlanWorklistScope {
  tenantWide: boolean;
  organizationIds: string[];
  facilityIds: string[];
}

export class CarePlanRepository {
  async plan(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
    lock = false,
  ): Promise<CarePlan | null> {
    const query = transaction
      .select()
      .from(carePlans)
      .where(and(eq(carePlans.tenantId, tenantId), eq(carePlans.id, planId)))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row
      ? {
          ...mapPlan(row),
          createdByEmployeeName: await this.employeeName(
            transaction,
            tenantId,
            row.createdByEmployeeId,
          ),
        }
      : null;
  }

  async insertPlan(transaction: DatabaseTransaction, plan: CarePlan): Promise<void> {
    await transaction.insert(carePlans).values({
      id: plan.id,
      tenantId: plan.tenantId,
      clientId: plan.clientId,
      organizationId: plan.organizationId,
      facilityId: plan.facilityId,
      status: plan.status,
      validFrom: plan.validFrom,
      validUntil: plan.validUntil,
      version: plan.version,
      createdByEmployeeId: plan.createdByEmployeeId,
      endedByEmployeeId: plan.endedByEmployeeId,
      endedAt: plan.endedAt,
      endedReason: plan.endedReason,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  }

  async insertInitialRevision(
    transaction: DatabaseTransaction,
    revision: CarePlanRevision,
    now: Date,
  ): Promise<void> {
    await transaction.insert(carePlanRevisions).values(revisionRow(revision));
    await transaction.insert(carePlanAssessments).values({
      tenantId: revision.tenantId,
      revisionId: revision.id,
      ...emptyAssessment(),
      updatedAt: now,
    });
  }

  async nextRevisionNumber(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
  ): Promise<number> {
    const [latest] = await transaction
      .select({ revisionNumber: carePlanRevisions.revisionNumber })
      .from(carePlanRevisions)
      .where(and(eq(carePlanRevisions.tenantId, tenantId), eq(carePlanRevisions.planId, planId)))
      .orderBy(desc(carePlanRevisions.revisionNumber))
      .limit(1);
    return (latest?.revisionNumber ?? 0) + 1;
  }

  async currentForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    organizationId: string,
    facilityId: string,
  ): Promise<CarePlanDetail | null> {
    const [row] = await transaction
      .select({ id: carePlans.id })
      .from(carePlans)
      .where(
        and(
          eq(carePlans.tenantId, tenantId),
          eq(carePlans.clientId, clientId),
          eq(carePlans.organizationId, organizationId),
          eq(carePlans.facilityId, facilityId),
          inArray(carePlans.status, ['active', 'under_review']),
        ),
      )
      .limit(1);
    return row ? this.detail(transaction, tenantId, row.id) : null;
  }

  async detail(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
  ): Promise<CarePlanDetail | null> {
    const plan = await this.plan(transaction, tenantId, planId);
    if (!plan) return null;
    const revisions = await transaction
      .select()
      .from(carePlanRevisions)
      .where(and(eq(carePlanRevisions.tenantId, tenantId), eq(carePlanRevisions.planId, planId)))
      .orderBy(desc(carePlanRevisions.revisionNumber));
    const active = revisions.find((revision) => revision.status === 'active');
    const draft = revisions.find((revision) => revision.status === 'draft');
    const activeRevision = active
      ? await this.revisionDetail(transaction, tenantId, planId, active.id)
      : null;
    const draftRevision = draft
      ? await this.revisionDetail(transaction, tenantId, planId, draft.id)
      : null;
    const latestEvaluation = await this.latestEvaluation(transaction, tenantId, planId);
    return {
      plan,
      activeRevision,
      draftRevision,
      latestEvaluation,
      nextEvaluationDue: latestEvaluation?.nextEvaluationDue ?? null,
    };
  }

  async revisionDetail(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
    revisionId: string,
  ): Promise<CarePlanRevisionDetail | null> {
    const [row] = await transaction
      .select()
      .from(carePlanRevisions)
      .where(
        and(
          eq(carePlanRevisions.tenantId, tenantId),
          eq(carePlanRevisions.planId, planId),
          eq(carePlanRevisions.id, revisionId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const [assessmentRow] = await transaction
      .select()
      .from(carePlanAssessments)
      .where(
        and(
          eq(carePlanAssessments.tenantId, tenantId),
          eq(carePlanAssessments.revisionId, revisionId),
        ),
      )
      .limit(1);
    if (!assessmentRow) throw new Error('Care plan revision is missing its assessment');
    const needs = await transaction
      .select()
      .from(carePlanNeeds)
      .where(and(eq(carePlanNeeds.tenantId, tenantId), eq(carePlanNeeds.revisionId, revisionId)));
    const resources = await transaction
      .select()
      .from(carePlanResources)
      .where(
        and(eq(carePlanResources.tenantId, tenantId), eq(carePlanResources.revisionId, revisionId)),
      );
    const riskRows = await transaction
      .select()
      .from(carePlanRiskResponses)
      .where(
        and(
          eq(carePlanRiskResponses.tenantId, tenantId),
          eq(carePlanRiskResponses.revisionId, revisionId),
        ),
      );
    const sourceRows = await transaction
      .select()
      .from(carePlanSourceReferences)
      .where(
        and(
          eq(carePlanSourceReferences.tenantId, tenantId),
          eq(carePlanSourceReferences.revisionId, revisionId),
        ),
      );
    const goalRows = await transaction
      .select()
      .from(carePlanGoals)
      .where(and(eq(carePlanGoals.tenantId, tenantId), eq(carePlanGoals.revisionId, revisionId)));
    const measureRows = await transaction
      .select()
      .from(carePlanMeasures)
      .where(
        and(eq(carePlanMeasures.tenantId, tenantId), eq(carePlanMeasures.revisionId, revisionId)),
      );
    const goalNeedRows = await transaction
      .select()
      .from(carePlanGoalNeeds)
      .where(
        and(eq(carePlanGoalNeeds.tenantId, tenantId), eq(carePlanGoalNeeds.revisionId, revisionId)),
      );
    const measureNeedRows = await transaction
      .select()
      .from(carePlanMeasureNeeds)
      .where(
        and(
          eq(carePlanMeasureNeeds.tenantId, tenantId),
          eq(carePlanMeasureNeeds.revisionId, revisionId),
        ),
      );
    const measureGoalRows = await transaction
      .select()
      .from(carePlanMeasureGoals)
      .where(
        and(
          eq(carePlanMeasureGoals.tenantId, tenantId),
          eq(carePlanMeasureGoals.revisionId, revisionId),
        ),
      );
    const riskNeedRows = await transaction
      .select()
      .from(carePlanRiskResponseNeeds)
      .where(
        and(
          eq(carePlanRiskResponseNeeds.tenantId, tenantId),
          eq(carePlanRiskResponseNeeds.revisionId, revisionId),
        ),
      );
    const riskMeasureRows = await transaction
      .select()
      .from(carePlanRiskResponseMeasures)
      .where(
        and(
          eq(carePlanRiskResponseMeasures.tenantId, tenantId),
          eq(carePlanRiskResponseMeasures.revisionId, revisionId),
        ),
      );
    const authorName = await this.employeeName(transaction, tenantId, row.authorEmployeeId);
    const activatedByName = row.activatedByEmployeeId
      ? await this.employeeName(transaction, tenantId, row.activatedByEmployeeId)
      : null;
    return {
      revision: {
        ...mapRevision(row),
        authorEmployeeName: authorName,
        activatedByEmployeeName: activatedByName,
      },
      assessment: mapAssessment(assessmentRow),
      sourceReferences: sourceRows.map((source) => ({
        id: source.clinicalRecordId,
        clinicalRecordId: source.clinicalRecordId,
        recordKind: source.recordKind as CarePlanSourceReferenceInput['recordKind'],
        rationale: source.rationale,
        createdAt: source.createdAt,
      })),
      needs: needs.map(mapNeed),
      resources: resources.map(mapResource),
      riskResponses: riskRows.map((risk) => ({
        id: risk.id,
        revisionId: risk.revisionId,
        clinicalRecordId: risk.clinicalRecordId,
        status: risk.status as CareRiskResponse['status'],
        plannedResponse: risk.plannedResponse,
        needIds: riskNeedRows
          .filter((link) => link.riskResponseId === risk.id)
          .map((link) => link.needId)
          .sort(),
        measureIds: riskMeasureRows
          .filter((link) => link.riskResponseId === risk.id)
          .map((link) => link.measureId)
          .sort(),
        createdAt: risk.createdAt,
        updatedAt: risk.updatedAt,
      })),
      goals: goalRows.map((goal) => ({
        ...mapGoal(goal),
        needIds: goalNeedRows
          .filter((link) => link.goalId === goal.id)
          .map((link) => link.needId)
          .sort(),
      })),
      measures: measureRows.map((measure) => ({
        ...mapMeasure(measure),
        needIds: measureNeedRows
          .filter((link) => link.measureId === measure.id)
          .map((link) => link.needId)
          .sort(),
        goalIds: measureGoalRows
          .filter((link) => link.measureId === measure.id)
          .map((link) => link.goalId)
          .sort(),
      })),
    };
  }

  async history(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
  ): Promise<CarePlanRevisionDetail[]> {
    const revisions = await transaction
      .select({ id: carePlanRevisions.id })
      .from(carePlanRevisions)
      .where(and(eq(carePlanRevisions.tenantId, tenantId), eq(carePlanRevisions.planId, planId)))
      .orderBy(desc(carePlanRevisions.revisionNumber));
    const details: (CarePlanRevisionDetail | null)[] = [];
    // A transaction owns one PostgreSQL connection, so revision reads must stay sequential.
    // oxlint-disable no-await-in-loop
    for (const revision of revisions) {
      details.push(await this.revisionDetail(transaction, tenantId, planId, revision.id));
    }
    // oxlint-enable no-await-in-loop
    return details.filter((detail): detail is CarePlanRevisionDetail => detail !== null);
  }

  async evaluationHistory(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
  ): Promise<CarePlanEvaluation[]> {
    const rows = await transaction
      .select()
      .from(carePlanEvaluations)
      .where(
        and(eq(carePlanEvaluations.tenantId, tenantId), eq(carePlanEvaluations.planId, planId)),
      )
      .orderBy(desc(carePlanEvaluations.evaluatedAt), desc(carePlanEvaluations.id));
    const evaluations: CarePlanEvaluation[] = [];
    // A transaction owns one PostgreSQL connection, so evaluation reads must stay sequential.
    // oxlint-disable no-await-in-loop
    for (const row of rows) evaluations.push(await this.evaluation(transaction, tenantId, row));
    // oxlint-enable no-await-in-loop
    return evaluations;
  }

  async search(
    transaction: DatabaseTransaction,
    tenantId: string,
    query: CarePlanWorklistQuery,
    planScope: CarePlanWorklistScope,
    clientScope: CarePlanWorklistScope,
  ): Promise<CarePlanPage> {
    const { page = 1, pageSize = 25 } = query;
    const today = new Date().toISOString().slice(0, 10);
    const latestEvaluation = transaction
      .selectDistinctOn([carePlanEvaluations.tenantId, carePlanEvaluations.planId], {
        tenantId: carePlanEvaluations.tenantId,
        planId: carePlanEvaluations.planId,
        evaluatedAt: carePlanEvaluations.evaluatedAt,
        result: carePlanEvaluations.result,
        nextEvaluationDue: carePlanEvaluations.nextEvaluationDue,
      })
      .from(carePlanEvaluations)
      .orderBy(
        carePlanEvaluations.tenantId,
        carePlanEvaluations.planId,
        desc(carePlanEvaluations.evaluatedAt),
        desc(carePlanEvaluations.id),
      )
      .as('latest_care_plan_evaluation');
    const where = and(
      eq(carePlans.tenantId, tenantId),
      scopeWhere(planScope),
      scopeWhere(clientScope),
      query.status ? eq(carePlans.status, query.status) : undefined,
      query.clientId ? eq(carePlans.clientId, query.clientId) : undefined,
      query.clientQuery
        ? or(
            ilike(
              sql`${clientRecords.firstName} || ' ' || ${clientRecords.lastName}`,
              containsPattern(query.clientQuery),
            ),
            ilike(clientRecords.firstName, containsPattern(query.clientQuery)),
            ilike(clientRecords.lastName, containsPattern(query.clientQuery)),
            ilike(clientRecords.preferredName, containsPattern(query.clientQuery)),
          )
        : undefined,
      query.facilityId ? eq(carePlans.facilityId, query.facilityId) : undefined,
      query.evaluationOverdue === true
        ? and(
            isNotNull(latestEvaluation.nextEvaluationDue),
            lt(latestEvaluation.nextEvaluationDue, today),
          )
        : undefined,
      query.evaluationDueBefore
        ? and(
            isNotNull(latestEvaluation.nextEvaluationDue),
            lte(latestEvaluation.nextEvaluationDue, query.evaluationDueBefore),
          )
        : undefined,
    );
    const [countRow] = await transaction
      .select({ total: count() })
      .from(carePlans)
      .innerJoin(
        clientRecords,
        and(
          eq(clientRecords.tenantId, carePlans.tenantId),
          eq(clientRecords.id, carePlans.clientId),
        ),
      )
      .leftJoin(
        latestEvaluation,
        and(
          eq(latestEvaluation.tenantId, carePlans.tenantId),
          eq(latestEvaluation.planId, carePlans.id),
        ),
      )
      .where(where);
    const rows = await transaction
      .select({
        plan: carePlans,
        clientFirstName: clientRecords.firstName,
        clientLastName: clientRecords.lastName,
        clientPreferredName: clientRecords.preferredName,
        facilityName: facilities.name,
        creatorFirstName: employeeRecords.firstName,
        creatorLastName: employeeRecords.lastName,
        creatorPreferredName: employeeRecords.preferredName,
        evaluationAt: latestEvaluation.evaluatedAt,
        evaluationResult: latestEvaluation.result,
        nextEvaluationDue: latestEvaluation.nextEvaluationDue,
      })
      .from(carePlans)
      .innerJoin(
        clientRecords,
        and(
          eq(clientRecords.tenantId, carePlans.tenantId),
          eq(clientRecords.id, carePlans.clientId),
        ),
      )
      .innerJoin(
        facilities,
        and(
          eq(facilities.tenantId, carePlans.tenantId),
          eq(facilities.organizationId, carePlans.organizationId),
          eq(facilities.id, carePlans.facilityId),
        ),
      )
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, carePlans.tenantId),
          eq(employeeRecords.id, carePlans.createdByEmployeeId),
        ),
      )
      .leftJoin(
        latestEvaluation,
        and(
          eq(latestEvaluation.tenantId, carePlans.tenantId),
          eq(latestEvaluation.planId, carePlans.id),
        ),
      )
      .where(where)
      .orderBy(desc(carePlans.createdAt), desc(carePlans.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      items: rows.map(
        ({
          plan,
          clientFirstName,
          clientLastName,
          clientPreferredName,
          facilityName,
          creatorFirstName,
          creatorLastName,
          creatorPreferredName,
          evaluationAt,
          evaluationResult,
          nextEvaluationDue,
        }) => ({
          ...mapPlan(plan),
          clientDisplayName: displayName(clientFirstName, clientLastName, clientPreferredName),
          facilityName,
          createdByEmployeeId: plan.createdByEmployeeId,
          createdByEmployeeName: displayName(
            creatorFirstName,
            creatorLastName,
            creatorPreferredName,
          ),
          latestEvaluation:
            evaluationAt && evaluationResult
              ? {
                  evaluatedAt: evaluationAt,
                  result: evaluationResult as CarePlanEvaluation['result'],
                  nextEvaluationDue,
                }
              : null,
        }),
      ),
      page,
      pageSize,
      total: Number(countRow?.total ?? 0),
    };
  }

  async updatePlan(
    transaction: DatabaseTransaction,
    plan: CarePlan,
    expectedVersion: number,
  ): Promise<boolean> {
    const updated = await transaction
      .update(carePlans)
      .set({
        status: plan.status,
        version: plan.version,
        updatedAt: plan.updatedAt,
        endedByEmployeeId: plan.endedByEmployeeId,
        endedAt: plan.endedAt,
        endedReason: plan.endedReason,
      })
      .where(
        and(
          eq(carePlans.tenantId, plan.tenantId),
          eq(carePlans.id, plan.id),
          eq(carePlans.version, expectedVersion),
        ),
      )
      .returning({ id: carePlans.id });
    return updated.length > 0;
  }

  async activateRevision(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
    revisionId: string,
    employeeId: string,
    at: Date,
  ): Promise<void> {
    await transaction
      .update(carePlanRevisions)
      .set({ status: 'historical', supersededAt: at })
      .where(
        and(
          eq(carePlanRevisions.tenantId, tenantId),
          eq(carePlanRevisions.planId, planId),
          eq(carePlanRevisions.status, 'active'),
        ),
      );
    await transaction
      .update(carePlanRevisions)
      .set({ status: 'active', activatedByEmployeeId: employeeId, activatedAt: at })
      .where(
        and(
          eq(carePlanRevisions.tenantId, tenantId),
          eq(carePlanRevisions.planId, planId),
          eq(carePlanRevisions.id, revisionId),
          eq(carePlanRevisions.status, 'draft'),
        ),
      );
  }

  async endActiveRevision(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
    at: Date,
  ): Promise<void> {
    await transaction
      .update(carePlanRevisions)
      .set({ status: 'historical', supersededAt: at })
      .where(
        and(
          eq(carePlanRevisions.tenantId, tenantId),
          eq(carePlanRevisions.planId, planId),
          eq(carePlanRevisions.status, 'active'),
        ),
      );
  }

  async createRevision(
    transaction: DatabaseTransaction,
    plan: CarePlan,
    revision: CarePlanRevision,
    source: CarePlanRevisionDetail,
    now: Date,
  ): Promise<void> {
    const content = copyForwardRevisionContent(source, revision.id);
    await transaction.insert(carePlanRevisions).values(revisionRow(revision));
    await transaction.insert(carePlanAssessments).values({
      tenantId: plan.tenantId,
      revisionId: revision.id,
      ...assessmentValues(content.assessment),
      updatedAt: now,
    });
    if (content.needs.length)
      await transaction.insert(carePlanNeeds).values(
        content.needs.map((item) => ({
          ...needRow(plan.tenantId, revision.id, item.id, item, now),
          createdAt: item.createdAt,
        })),
      );
    if (content.resources.length)
      await transaction.insert(carePlanResources).values(
        content.resources.map((item) => ({
          ...resourceRow(plan.tenantId, revision.id, item.id, item, now),
          createdAt: item.createdAt,
        })),
      );
    if (content.riskResponses.length) {
      await transaction.insert(carePlanRiskResponses).values(
        content.riskResponses.map((item) => ({
          tenantId: plan.tenantId,
          revisionId: revision.id,
          clientId: plan.clientId,
          id: item.id,
          clinicalRecordId: item.clinicalRecordId,
          recordKind: 'risk_assessment' as const,
          status: item.status,
          plannedResponse: item.plannedResponse,
          createdAt: item.createdAt,
          updatedAt: now,
        })),
      );
    }
    if (content.sourceReferences.length)
      await transaction.insert(carePlanSourceReferences).values(
        content.sourceReferences.map((item) => ({
          tenantId: plan.tenantId,
          revisionId: revision.id,
          planId: plan.id,
          clientId: plan.clientId,
          clinicalRecordId: item.clinicalRecordId,
          recordKind: item.recordKind,
          rationale: item.rationale,
          createdAt: item.createdAt,
        })),
      );
    if (content.goals.length)
      await transaction.insert(carePlanGoals).values(
        content.goals.map((item) => ({
          ...goalRow(plan.tenantId, revision.id, item.id, item, now),
          createdAt: item.createdAt,
        })),
      );
    if (content.measures.length)
      await transaction.insert(carePlanMeasures).values(
        content.measures.map((item) => ({
          ...measureRow(plan.tenantId, revision.id, item.id, item, now),
          createdAt: item.createdAt,
        })),
      );
    const goalNeeds = content.goals.flatMap((goal) =>
      goal.needIds.map((needId) => ({
        tenantId: plan.tenantId,
        revisionId: revision.id,
        goalId: goal.id,
        needId,
      })),
    );
    const measureNeeds = content.measures.flatMap((measure) =>
      measure.needIds.map((needId) => ({
        tenantId: plan.tenantId,
        revisionId: revision.id,
        measureId: measure.id,
        needId,
      })),
    );
    const measureGoals = content.measures.flatMap((measure) =>
      measure.goalIds.map((goalId) => ({
        tenantId: plan.tenantId,
        revisionId: revision.id,
        measureId: measure.id,
        goalId,
      })),
    );
    const riskNeeds = content.riskResponses.flatMap((risk) =>
      risk.needIds.map((needId) => ({
        tenantId: plan.tenantId,
        revisionId: revision.id,
        riskResponseId: risk.id,
        needId,
      })),
    );
    const riskMeasures = content.riskResponses.flatMap((risk) =>
      risk.measureIds.map((measureId) => ({
        tenantId: plan.tenantId,
        revisionId: revision.id,
        riskResponseId: risk.id,
        measureId,
      })),
    );
    if (goalNeeds.length) await transaction.insert(carePlanGoalNeeds).values(goalNeeds);
    if (measureNeeds.length) await transaction.insert(carePlanMeasureNeeds).values(measureNeeds);
    if (measureGoals.length) await transaction.insert(carePlanMeasureGoals).values(measureGoals);
    if (riskNeeds.length) await transaction.insert(carePlanRiskResponseNeeds).values(riskNeeds);
    if (riskMeasures.length)
      await transaction.insert(carePlanRiskResponseMeasures).values(riskMeasures);
  }

  async saveAssessment(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    input: CarePlanAssessmentInput,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(carePlanAssessments)
      .set({
        clientConcerns: input.clientConcerns ?? null,
        clientWishes: input.clientWishes ?? null,
        clientGoals: input.clientGoals ?? null,
        clientHabits: input.clientHabits ?? null,
        clientPreferences: input.clientPreferences ?? null,
        clientPriorities: input.clientPriorities ?? null,
        professionalObservedNeeds: input.professionalObservedNeeds ?? null,
        professionalResources: input.professionalResources ?? null,
        professionalLimitations: input.professionalLimitations ?? null,
        professionalRisks: input.professionalRisks ?? null,
        professionalRationale: input.professionalRationale ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(carePlanAssessments.tenantId, tenantId),
          eq(carePlanAssessments.revisionId, revisionId),
        ),
      );
  }

  async saveNeed(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
    input: CareNeedInput,
    now: Date,
    create: boolean,
  ): Promise<void> {
    const row = needRow(tenantId, revisionId, id, input, now);
    if (create) await transaction.insert(carePlanNeeds).values(row);
    else
      await transaction
        .update(carePlanNeeds)
        .set({
          category: row.category,
          title: row.title,
          description: row.description,
          source: row.source,
          priority: row.priority,
          status: row.status,
          updatedAt: now,
        })
        .where(
          and(
            eq(carePlanNeeds.tenantId, tenantId),
            eq(carePlanNeeds.revisionId, revisionId),
            eq(carePlanNeeds.id, id),
          ),
        );
  }

  async removeNeed(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
  ): Promise<boolean> {
    return (
      (
        await transaction
          .delete(carePlanNeeds)
          .where(
            and(
              eq(carePlanNeeds.tenantId, tenantId),
              eq(carePlanNeeds.revisionId, revisionId),
              eq(carePlanNeeds.id, id),
            ),
          )
          .returning({ id: carePlanNeeds.id })
      ).length > 0
    );
  }

  async saveResource(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
    input: CareResourceInput,
    now: Date,
    create: boolean,
  ): Promise<void> {
    const row = resourceRow(tenantId, revisionId, id, input, now);
    if (create) await transaction.insert(carePlanResources).values(row);
    else
      await transaction
        .update(carePlanResources)
        .set({
          category: row.category,
          description: row.description,
          status: row.status,
          updatedAt: now,
        })
        .where(
          and(
            eq(carePlanResources.tenantId, tenantId),
            eq(carePlanResources.revisionId, revisionId),
            eq(carePlanResources.id, id),
          ),
        );
  }

  async removeResource(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
  ): Promise<boolean> {
    return (
      (
        await transaction
          .delete(carePlanResources)
          .where(
            and(
              eq(carePlanResources.tenantId, tenantId),
              eq(carePlanResources.revisionId, revisionId),
              eq(carePlanResources.id, id),
            ),
          )
          .returning({ id: carePlanResources.id })
      ).length > 0
    );
  }

  async saveRiskResponse(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    revisionId: string,
    id: string,
    input: CareRiskResponseInput,
    now: Date,
    create: boolean,
  ): Promise<void> {
    const values = {
      tenantId,
      revisionId,
      clientId,
      id,
      clinicalRecordId: input.clinicalRecordId,
      recordKind: 'risk_assessment' as const,
      status: input.status,
      plannedResponse: input.plannedResponse,
      updatedAt: now,
    };
    if (create)
      await transaction.insert(carePlanRiskResponses).values({ ...values, createdAt: now });
    else
      await transaction
        .update(carePlanRiskResponses)
        .set({
          clinicalRecordId: input.clinicalRecordId,
          status: input.status,
          plannedResponse: input.plannedResponse,
          updatedAt: now,
        })
        .where(
          and(
            eq(carePlanRiskResponses.tenantId, tenantId),
            eq(carePlanRiskResponses.revisionId, revisionId),
            eq(carePlanRiskResponses.id, id),
          ),
        );
    await transaction
      .delete(carePlanRiskResponseNeeds)
      .where(
        and(
          eq(carePlanRiskResponseNeeds.tenantId, tenantId),
          eq(carePlanRiskResponseNeeds.revisionId, revisionId),
          eq(carePlanRiskResponseNeeds.riskResponseId, id),
        ),
      );
    await transaction
      .delete(carePlanRiskResponseMeasures)
      .where(
        and(
          eq(carePlanRiskResponseMeasures.tenantId, tenantId),
          eq(carePlanRiskResponseMeasures.revisionId, revisionId),
          eq(carePlanRiskResponseMeasures.riskResponseId, id),
        ),
      );
    if (input.needIds.length)
      await transaction
        .insert(carePlanRiskResponseNeeds)
        .values(
          input.needIds.map((needId) => ({ tenantId, revisionId, riskResponseId: id, needId })),
        );
    if (input.measureIds.length)
      await transaction.insert(carePlanRiskResponseMeasures).values(
        input.measureIds.map((measureId) => ({
          tenantId,
          revisionId,
          riskResponseId: id,
          measureId,
        })),
      );
  }

  async removeRiskResponse(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
  ): Promise<boolean> {
    await transaction
      .delete(carePlanRiskResponseNeeds)
      .where(
        and(
          eq(carePlanRiskResponseNeeds.tenantId, tenantId),
          eq(carePlanRiskResponseNeeds.revisionId, revisionId),
          eq(carePlanRiskResponseNeeds.riskResponseId, id),
        ),
      );
    await transaction
      .delete(carePlanRiskResponseMeasures)
      .where(
        and(
          eq(carePlanRiskResponseMeasures.tenantId, tenantId),
          eq(carePlanRiskResponseMeasures.revisionId, revisionId),
          eq(carePlanRiskResponseMeasures.riskResponseId, id),
        ),
      );
    return (
      (
        await transaction
          .delete(carePlanRiskResponses)
          .where(
            and(
              eq(carePlanRiskResponses.tenantId, tenantId),
              eq(carePlanRiskResponses.revisionId, revisionId),
              eq(carePlanRiskResponses.id, id),
            ),
          )
          .returning({ id: carePlanRiskResponses.id })
      ).length > 0
    );
  }

  async addSourceReference(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
    clientId: string,
    revisionId: string,
    input: CarePlanSourceReferenceInput,
    now: Date,
  ): Promise<void> {
    await transaction.insert(carePlanSourceReferences).values({
      tenantId,
      revisionId,
      planId,
      clientId,
      clinicalRecordId: input.clinicalRecordId,
      recordKind: input.recordKind,
      rationale: input.rationale ?? null,
      createdAt: now,
    });
  }

  async removeSourceReference(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    clinicalRecordId: string,
  ): Promise<boolean> {
    return (
      (
        await transaction
          .delete(carePlanSourceReferences)
          .where(
            and(
              eq(carePlanSourceReferences.tenantId, tenantId),
              eq(carePlanSourceReferences.revisionId, revisionId),
              eq(carePlanSourceReferences.clinicalRecordId, clinicalRecordId),
            ),
          )
          .returning({ id: carePlanSourceReferences.clinicalRecordId })
      ).length > 0
    );
  }

  async saveGoal(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
    input: CareGoalInput,
    now: Date,
    create: boolean,
  ): Promise<void> {
    const row = goalRow(tenantId, revisionId, id, input, now);
    if (create) await transaction.insert(carePlanGoals).values(row);
    else
      await transaction
        .update(carePlanGoals)
        .set({
          title: row.title,
          description: row.description,
          targetDate: row.targetDate,
          status: row.status,
          priority: row.priority,
          updatedAt: now,
        })
        .where(
          and(
            eq(carePlanGoals.tenantId, tenantId),
            eq(carePlanGoals.revisionId, revisionId),
            eq(carePlanGoals.id, id),
          ),
        );
    await transaction
      .delete(carePlanGoalNeeds)
      .where(
        and(
          eq(carePlanGoalNeeds.tenantId, tenantId),
          eq(carePlanGoalNeeds.revisionId, revisionId),
          eq(carePlanGoalNeeds.goalId, id),
        ),
      );
    if (input.needIds.length)
      await transaction
        .insert(carePlanGoalNeeds)
        .values(input.needIds.map((needId) => ({ tenantId, revisionId, goalId: id, needId })));
  }

  async removeGoal(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
  ): Promise<boolean> {
    await transaction
      .delete(carePlanGoalNeeds)
      .where(
        and(
          eq(carePlanGoalNeeds.tenantId, tenantId),
          eq(carePlanGoalNeeds.revisionId, revisionId),
          eq(carePlanGoalNeeds.goalId, id),
        ),
      );
    return (
      (
        await transaction
          .delete(carePlanGoals)
          .where(
            and(
              eq(carePlanGoals.tenantId, tenantId),
              eq(carePlanGoals.revisionId, revisionId),
              eq(carePlanGoals.id, id),
            ),
          )
          .returning({ id: carePlanGoals.id })
      ).length > 0
    );
  }

  async saveMeasure(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
    input: CareMeasureInput,
    now: Date,
    create: boolean,
  ): Promise<void> {
    const row = measureRow(tenantId, revisionId, id, input, now);
    if (create) await transaction.insert(carePlanMeasures).values(row);
    else
      await transaction
        .update(carePlanMeasures)
        .set({
          title: row.title,
          instruction: row.instruction,
          category: row.category,
          serviceDefinitionId: row.serviceDefinitionId,
          frequencyText: row.frequencyText,
          responsibleRole: row.responsibleRole,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
          status: row.status,
          updatedAt: now,
        })
        .where(
          and(
            eq(carePlanMeasures.tenantId, tenantId),
            eq(carePlanMeasures.revisionId, revisionId),
            eq(carePlanMeasures.id, id),
          ),
        );
    await transaction
      .delete(carePlanMeasureNeeds)
      .where(
        and(
          eq(carePlanMeasureNeeds.tenantId, tenantId),
          eq(carePlanMeasureNeeds.revisionId, revisionId),
          eq(carePlanMeasureNeeds.measureId, id),
        ),
      );
    await transaction
      .delete(carePlanMeasureGoals)
      .where(
        and(
          eq(carePlanMeasureGoals.tenantId, tenantId),
          eq(carePlanMeasureGoals.revisionId, revisionId),
          eq(carePlanMeasureGoals.measureId, id),
        ),
      );
    if (input.needIds.length)
      await transaction
        .insert(carePlanMeasureNeeds)
        .values(input.needIds.map((needId) => ({ tenantId, revisionId, measureId: id, needId })));
    if (input.goalIds.length)
      await transaction
        .insert(carePlanMeasureGoals)
        .values(input.goalIds.map((goalId) => ({ tenantId, revisionId, measureId: id, goalId })));
  }

  async removeMeasure(
    transaction: DatabaseTransaction,
    tenantId: string,
    revisionId: string,
    id: string,
  ): Promise<boolean> {
    await transaction
      .delete(carePlanMeasureNeeds)
      .where(
        and(
          eq(carePlanMeasureNeeds.tenantId, tenantId),
          eq(carePlanMeasureNeeds.revisionId, revisionId),
          eq(carePlanMeasureNeeds.measureId, id),
        ),
      );
    await transaction
      .delete(carePlanMeasureGoals)
      .where(
        and(
          eq(carePlanMeasureGoals.tenantId, tenantId),
          eq(carePlanMeasureGoals.revisionId, revisionId),
          eq(carePlanMeasureGoals.measureId, id),
        ),
      );
    await transaction
      .delete(carePlanRiskResponseMeasures)
      .where(
        and(
          eq(carePlanRiskResponseMeasures.tenantId, tenantId),
          eq(carePlanRiskResponseMeasures.revisionId, revisionId),
          eq(carePlanRiskResponseMeasures.measureId, id),
        ),
      );
    return (
      (
        await transaction
          .delete(carePlanMeasures)
          .where(
            and(
              eq(carePlanMeasures.tenantId, tenantId),
              eq(carePlanMeasures.revisionId, revisionId),
              eq(carePlanMeasures.id, id),
            ),
          )
          .returning({ id: carePlanMeasures.id })
      ).length > 0
    );
  }

  async addEvaluation(
    transaction: DatabaseTransaction,
    input: CarePlanEvaluation,
    clientId: string,
  ): Promise<void> {
    await transaction.insert(carePlanEvaluations).values({
      id: input.id,
      tenantId: input.tenantId,
      planId: input.planId,
      revisionId: input.revisionId,
      clientId,
      evaluatedByEmployeeId: input.evaluatedByEmployeeId,
      evaluatedAt: input.evaluatedAt,
      result: input.result,
      planChange: input.planChange,
      summary: input.summary,
      nextEvaluationDue: input.nextEvaluationDue,
    });
    if (input.goals.length)
      await transaction.insert(carePlanEvaluationGoals).values(
        input.goals.map((goal) => ({
          tenantId: input.tenantId,
          evaluationId: input.id,
          revisionId: input.revisionId,
          goalId: goal.goalId,
          outcome: goal.outcome,
          note: goal.note,
        })),
      );
  }

  async latestEvaluation(
    transaction: DatabaseTransaction,
    tenantId: string,
    planId: string,
  ): Promise<CarePlanEvaluation | null> {
    const [row] = await transaction
      .select()
      .from(carePlanEvaluations)
      .where(
        and(eq(carePlanEvaluations.tenantId, tenantId), eq(carePlanEvaluations.planId, planId)),
      )
      .orderBy(desc(carePlanEvaluations.evaluatedAt), desc(carePlanEvaluations.id))
      .limit(1);
    return row ? this.evaluation(transaction, tenantId, row) : null;
  }

  async evaluation(
    transaction: DatabaseTransaction,
    tenantId: string,
    row: typeof carePlanEvaluations.$inferSelect,
  ): Promise<CarePlanEvaluation> {
    const goals = await transaction
      .select()
      .from(carePlanEvaluationGoals)
      .where(
        and(
          eq(carePlanEvaluationGoals.tenantId, tenantId),
          eq(carePlanEvaluationGoals.evaluationId, row.id),
        ),
      );
    return {
      id: row.id,
      tenantId: row.tenantId,
      planId: row.planId,
      revisionId: row.revisionId,
      evaluatedByEmployeeId: row.evaluatedByEmployeeId,
      evaluatedByEmployeeName: await this.employeeName(
        transaction,
        tenantId,
        row.evaluatedByEmployeeId,
      ),
      evaluatedAt: row.evaluatedAt,
      result: row.result as CarePlanEvaluation['result'],
      planChange: row.planChange as CarePlanEvaluation['planChange'],
      summary: row.summary,
      nextEvaluationDue: row.nextEvaluationDue,
      goals: goals.map((goal) => ({
        goalId: goal.goalId,
        outcome: goal.outcome as CarePlanEvaluation['goals'][number]['outcome'],
        note: goal.note,
      })),
    };
  }

  async employeeName(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<string | null> {
    const [employee] = await transaction
      .select({
        firstName: employeeRecords.firstName,
        lastName: employeeRecords.lastName,
        preferredName: employeeRecords.preferredName,
      })
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.id, employeeId)))
      .limit(1);
    return employee
      ? displayName(employee.firstName, employee.lastName, employee.preferredName)
      : null;
  }
}

function mapPlan(row: typeof carePlans.$inferSelect): CarePlan {
  return {
    ...row,
    status: row.status as CarePlan['status'],
    createdByEmployeeName: null,
  };
}

function mapRevision(row: typeof carePlanRevisions.$inferSelect): CarePlanRevision {
  return {
    ...row,
    status: row.status as CarePlanRevision['status'],
    authorEmployeeName: null,
    activatedByEmployeeName: null,
  };
}

function mapAssessment(row: typeof carePlanAssessments.$inferSelect): CarePlanAssessment {
  return { ...row };
}

function mapNeed(row: typeof carePlanNeeds.$inferSelect): CareNeed {
  return {
    ...row,
    category: row.category as CareNeed['category'],
    source: row.source as CareNeed['source'],
    priority: row.priority as CareNeed['priority'],
    status: row.status as CareNeed['status'],
  };
}

function mapResource(row: typeof carePlanResources.$inferSelect): CareResource {
  return {
    ...row,
    category: row.category as CareResource['category'],
    status: row.status as CareResource['status'],
  };
}

function mapGoal(row: typeof carePlanGoals.$inferSelect): CareGoal {
  return {
    ...row,
    status: row.status as CareGoal['status'],
    priority: row.priority as CareGoal['priority'],
    needIds: [],
  };
}

function mapMeasure(row: typeof carePlanMeasures.$inferSelect): CareMeasure {
  return {
    ...row,
    category: row.category as CareMeasure['category'],
    status: row.status as CareMeasure['status'],
    needIds: [],
    goalIds: [],
  };
}

function revisionRow(revision: CarePlanRevision) {
  return {
    id: revision.id,
    tenantId: revision.tenantId,
    planId: revision.planId,
    clientId: revision.clientId,
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    authorEmployeeId: revision.authorEmployeeId,
    reason: revision.reason,
    effectiveFrom: revision.effectiveFrom,
    createdAt: revision.createdAt,
    activatedByEmployeeId: revision.activatedByEmployeeId,
    activatedAt: revision.activatedAt,
    supersededAt: revision.supersededAt,
  };
}

function emptyAssessment() {
  return {
    clientConcerns: null,
    clientWishes: null,
    clientGoals: null,
    clientHabits: null,
    clientPreferences: null,
    clientPriorities: null,
    professionalObservedNeeds: null,
    professionalResources: null,
    professionalLimitations: null,
    professionalRisks: null,
    professionalRationale: null,
  };
}

function assessmentValues(assessment: CarePlanAssessment) {
  return {
    clientConcerns: assessment.clientConcerns,
    clientWishes: assessment.clientWishes,
    clientGoals: assessment.clientGoals,
    clientHabits: assessment.clientHabits,
    clientPreferences: assessment.clientPreferences,
    clientPriorities: assessment.clientPriorities,
    professionalObservedNeeds: assessment.professionalObservedNeeds,
    professionalResources: assessment.professionalResources,
    professionalLimitations: assessment.professionalLimitations,
    professionalRisks: assessment.professionalRisks,
    professionalRationale: assessment.professionalRationale,
  };
}

function needRow(
  tenantId: string,
  revisionId: string,
  id: string,
  input: CareNeedInput | CareNeed,
  now: Date,
) {
  return {
    tenantId,
    revisionId,
    id,
    category: input.category,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    source: input.source,
    priority: input.priority,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };
}

function resourceRow(
  tenantId: string,
  revisionId: string,
  id: string,
  input: CareResourceInput | CareResource,
  now: Date,
) {
  return {
    tenantId,
    revisionId,
    id,
    category: input.category,
    description: input.description.trim(),
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };
}

function goalRow(
  tenantId: string,
  revisionId: string,
  id: string,
  input: CareGoalInput | CareGoal,
  now: Date,
) {
  return {
    tenantId,
    revisionId,
    id,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    targetDate: input.targetDate ?? null,
    status: input.status,
    priority: input.priority,
    createdAt: now,
    updatedAt: now,
  };
}

function measureRow(
  tenantId: string,
  revisionId: string,
  id: string,
  input: CareMeasureInput | CareMeasure,
  now: Date,
) {
  return {
    tenantId,
    revisionId,
    id,
    title: input.title.trim(),
    instruction: input.instruction.trim(),
    category: input.category,
    serviceDefinitionId: input.serviceDefinitionId ?? null,
    frequencyText: input.frequencyText?.trim() || null,
    responsibleRole: input.responsibleRole?.trim() || null,
    validFrom: input.validFrom,
    validUntil: input.validUntil ?? null,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };
}

function scopeWhere(scope: CarePlanWorklistScope) {
  if (scope.tenantWide) return undefined;
  const conditions = [
    ...(scope.organizationIds.length
      ? [inArray(carePlans.organizationId, scope.organizationIds)]
      : []),
    ...(scope.facilityIds.length ? [inArray(carePlans.facilityId, scope.facilityIds)] : []),
  ];
  return conditions.length ? or(...conditions) : sql`false`;
}

function displayName(firstName: string, lastName: string, preferredName: string | null): string {
  return `${preferredName?.trim() || firstName} ${lastName}`;
}

function containsPattern(value: string): string {
  const escaped = value
    .trim()
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
  return `%${escaped}%`;
}
