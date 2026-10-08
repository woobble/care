import type {
  CarePlanDetail,
  CarePlanEvaluation,
  CarePlanHistory,
  CarePlanListItem,
  CarePlanRevisionDetail,
  CarePlanRevisionDiff,
  CarePlanVisitView,
} from '@care/care-planning';

export function carePlanDetailResponse(detail: CarePlanDetail) {
  return {
    plan: {
      id: detail.plan.id,
      tenantId: detail.plan.tenantId,
      clientId: detail.plan.clientId,
      organizationId: detail.plan.organizationId,
      facilityId: detail.plan.facilityId,
      status: detail.plan.status,
      validFrom: detail.plan.validFrom,
      validUntil: detail.plan.validUntil,
      version: detail.plan.version,
      createdByEmployeeId: detail.plan.createdByEmployeeId,
      createdByEmployeeName: detail.plan.createdByEmployeeName,
      endedByEmployeeId: detail.plan.endedByEmployeeId,
      endedAt: detail.plan.endedAt?.toISOString() ?? null,
      endedReason: detail.plan.endedReason,
      createdAt: detail.plan.createdAt.toISOString(),
      updatedAt: detail.plan.updatedAt.toISOString(),
    },
    activeRevision: detail.activeRevision
      ? carePlanRevisionDetailResponse(detail.activeRevision)
      : null,
    draftRevision: detail.draftRevision
      ? carePlanRevisionDetailResponse(detail.draftRevision)
      : null,
    latestEvaluation: detail.latestEvaluation
      ? carePlanEvaluationResponse(detail.latestEvaluation)
      : null,
    nextEvaluationDue: detail.nextEvaluationDue,
  };
}

export function carePlanRevisionDetailResponse(detail: CarePlanRevisionDetail) {
  return {
    revision: {
      id: detail.revision.id,
      tenantId: detail.revision.tenantId,
      planId: detail.revision.planId,
      clientId: detail.revision.clientId,
      revisionNumber: detail.revision.revisionNumber,
      status: detail.revision.status,
      authorEmployeeId: detail.revision.authorEmployeeId,
      authorEmployeeName: detail.revision.authorEmployeeName,
      reason: detail.revision.reason,
      effectiveFrom: detail.revision.effectiveFrom,
      createdAt: detail.revision.createdAt.toISOString(),
      activatedByEmployeeId: detail.revision.activatedByEmployeeId,
      activatedByEmployeeName: detail.revision.activatedByEmployeeName,
      activatedAt: detail.revision.activatedAt?.toISOString() ?? null,
      supersededAt: detail.revision.supersededAt?.toISOString() ?? null,
    },
    assessment: {
      ...detail.assessment,
      updatedAt: detail.assessment.updatedAt.toISOString(),
    },
    sourceReferences: detail.sourceReferences.map((reference) => ({
      ...reference,
      createdAt: reference.createdAt.toISOString(),
    })),
    needs: detail.needs.map((need) => ({
      ...need,
      createdAt: need.createdAt.toISOString(),
      updatedAt: need.updatedAt.toISOString(),
    })),
    resources: detail.resources.map((resource) => ({
      ...resource,
      createdAt: resource.createdAt.toISOString(),
      updatedAt: resource.updatedAt.toISOString(),
    })),
    riskResponses: detail.riskResponses.map((response) => ({
      ...response,
      createdAt: response.createdAt.toISOString(),
      updatedAt: response.updatedAt.toISOString(),
    })),
    goals: detail.goals.map((goal) => ({
      ...goal,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    })),
    measures: detail.measures.map((measure) => ({
      ...measure,
      createdAt: measure.createdAt.toISOString(),
      updatedAt: measure.updatedAt.toISOString(),
    })),
  };
}

export function carePlanEvaluationResponse(evaluation: CarePlanEvaluation) {
  return { ...evaluation, evaluatedAt: evaluation.evaluatedAt.toISOString() };
}

export function carePlanHistoryResponse(history: CarePlanHistory) {
  return {
    revisions: history.revisions.map(carePlanRevisionDetailResponse),
    evaluations: history.evaluations.map(carePlanEvaluationResponse),
  };
}

export function carePlanListResponse(input: {
  items: CarePlanListItem[];
  page: number;
  pageSize: number;
  total: number;
}) {
  return {
    items: input.items.map((item) => ({
      id: item.id,
      clientId: item.clientId,
      clientDisplayName: item.clientDisplayName,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
      facilityName: item.facilityName,
      status: item.status,
      validFrom: item.validFrom,
      validUntil: item.validUntil,
      version: item.version,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      latestEvaluation: item.latestEvaluation
        ? {
            evaluatedAt: item.latestEvaluation.evaluatedAt.toISOString(),
            result: item.latestEvaluation.result,
            nextEvaluationDue: item.latestEvaluation.nextEvaluationDue,
          }
        : null,
    })),
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
  };
}

export function carePlanRevisionDiffResponse(diff: CarePlanRevisionDiff) {
  return diff;
}

export function carePlanVisitResponse(view: CarePlanVisitView) {
  return {
    planId: view.planId,
    clientId: view.clientId,
    status: view.status,
    validFrom: view.validFrom,
    validUntil: view.validUntil,
    measures: view.measures.map((measure) => ({
      id: measure.id,
      title: measure.title,
      instruction: measure.instruction,
      category: measure.category,
      frequencyText: measure.frequencyText,
      responsibleRole: measure.responsibleRole,
    })),
  };
}
