export const CARE_PLAN_STATUSES = ['draft', 'active', 'under_review', 'ended'] as const;
export type CarePlanStatus = (typeof CARE_PLAN_STATUSES)[number];

export const CARE_PLAN_REVISION_STATUSES = ['draft', 'active', 'historical'] as const;
export type CarePlanRevisionStatus = (typeof CARE_PLAN_REVISION_STATUSES)[number];

export const CARE_PLAN_NEED_CATEGORIES = [
  'personal_care',
  'mobility',
  'nutrition',
  'hydration',
  'communication',
  'cognition',
  'daily_living',
  'social_participation',
  'safety',
  'other',
] as const;
export type CarePlanNeedCategory = (typeof CARE_PLAN_NEED_CATEGORIES)[number];
export type CarePlanNeedSource =
  | 'client_report'
  | 'professional_observation'
  | 'representative_report'
  | 'clinical_record';
export type CarePlanNeedPriority = 'low' | 'normal' | 'high';
export type CarePlanNeedStatus = 'active' | 'addressed' | 'deferred';

export const CARE_PLAN_RESOURCE_CATEGORIES = [
  'self_care',
  'mobility',
  'communication',
  'cognition',
  'daily_routine',
  'social_support',
  'personal_interest',
  'other',
] as const;
export type CarePlanResourceCategory = (typeof CARE_PLAN_RESOURCE_CATEGORIES)[number];
export type CarePlanResourceStatus = 'available' | 'needs_support' | 'unavailable';

export const CARE_PLAN_GOAL_STATUSES = ['active', 'achieved', 'discontinued'] as const;
export type CarePlanGoalStatus = (typeof CARE_PLAN_GOAL_STATUSES)[number];
export type CarePlanGoalPriority = 'low' | 'normal' | 'high';

export const CARE_PLAN_MEASURE_CATEGORIES = [
  'personal_care',
  'assistance',
  'encouragement',
  'monitoring',
  'positioning',
  'communication',
  'other',
] as const;
export type CarePlanMeasureCategory = (typeof CARE_PLAN_MEASURE_CATEGORIES)[number];
export const CARE_PLAN_MEASURE_STATUSES = ['active', 'discontinued'] as const;
export type CarePlanMeasureStatus = (typeof CARE_PLAN_MEASURE_STATUSES)[number];

export const CARE_PLAN_RISK_RESPONSE_STATUSES = ['addressed', 'monitor', 'accepted'] as const;
export type CarePlanRiskResponseStatus = (typeof CARE_PLAN_RISK_RESPONSE_STATUSES)[number];

export const CARE_PLAN_EVALUATION_RESULTS = [
  'effective',
  'partially_effective',
  'not_effective',
  'changed_condition',
  'no_change',
] as const;
export type CarePlanEvaluationResult = (typeof CARE_PLAN_EVALUATION_RESULTS)[number];
export type CarePlanChangeDecision = 'none' | 'revision_required';
export type CarePlanGoalOutcomeCode =
  | 'achieved'
  | 'partially_achieved'
  | 'not_achieved'
  | 'not_applicable';

export interface CarePlan {
  id: string;
  tenantId: string;
  clientId: string;
  organizationId: string;
  facilityId: string;
  status: CarePlanStatus;
  validFrom: string;
  validUntil: string | null;
  version: number;
  createdByEmployeeId: string;
  createdByEmployeeName: string | null;
  endedByEmployeeId: string | null;
  endedAt: Date | null;
  endedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarePlanRevision {
  id: string;
  tenantId: string;
  planId: string;
  clientId: string;
  revisionNumber: number;
  status: CarePlanRevisionStatus;
  authorEmployeeId: string;
  authorEmployeeName: string | null;
  reason: string | null;
  effectiveFrom: string;
  createdAt: Date;
  activatedByEmployeeId: string | null;
  activatedByEmployeeName: string | null;
  activatedAt: Date | null;
  supersededAt: Date | null;
}

/** A planning synthesis. Clinical measurements and assessments stay in their source module. */
export interface CarePlanAssessment {
  revisionId: string;
  clientConcerns: string | null;
  clientWishes: string | null;
  clientGoals: string | null;
  clientHabits: string | null;
  clientPreferences: string | null;
  clientPriorities: string | null;
  professionalObservedNeeds: string | null;
  professionalResources: string | null;
  professionalLimitations: string | null;
  professionalRisks: string | null;
  professionalRationale: string | null;
  updatedAt: Date;
}

export interface CarePlanSourceReference {
  /** Stable across revisions; equal to clinicalRecordId. */
  id: string;
  clinicalRecordId: string;
  recordKind: 'measurement' | 'observation' | 'assessment' | 'risk_assessment';
  rationale: string | null;
  createdAt: Date;
}

export interface CareNeed {
  id: string;
  revisionId: string;
  category: CarePlanNeedCategory;
  title: string;
  description: string | null;
  source: CarePlanNeedSource;
  priority: CarePlanNeedPriority;
  status: CarePlanNeedStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CareResource {
  id: string;
  revisionId: string;
  category: CarePlanResourceCategory;
  description: string;
  status: CarePlanResourceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CareRiskResponse {
  id: string;
  revisionId: string;
  clinicalRecordId: string;
  status: CarePlanRiskResponseStatus;
  plannedResponse: string;
  needIds: string[];
  measureIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CareGoal {
  id: string;
  revisionId: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  status: CarePlanGoalStatus;
  priority: CarePlanGoalPriority;
  needIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CareMeasure {
  id: string;
  revisionId: string;
  title: string;
  instruction: string;
  category: CarePlanMeasureCategory;
  needIds: string[];
  goalIds: string[];
  serviceDefinitionId: string | null;
  frequencyText: string | null;
  responsibleRole: string | null;
  validFrom: string;
  validUntil: string | null;
  status: CarePlanMeasureStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarePlanGoalOutcome {
  goalId: string;
  outcome: CarePlanGoalOutcomeCode;
  note: string | null;
}

export interface CarePlanEvaluation {
  id: string;
  tenantId: string;
  planId: string;
  revisionId: string;
  evaluatedByEmployeeId: string;
  evaluatedByEmployeeName: string | null;
  evaluatedAt: Date;
  result: CarePlanEvaluationResult;
  planChange: CarePlanChangeDecision;
  summary: string;
  nextEvaluationDue: string | null;
  goals: CarePlanGoalOutcome[];
}

export interface CarePlanRevisionDetail {
  revision: CarePlanRevision;
  assessment: CarePlanAssessment;
  sourceReferences: CarePlanSourceReference[];
  needs: CareNeed[];
  resources: CareResource[];
  riskResponses: CareRiskResponse[];
  goals: CareGoal[];
  measures: CareMeasure[];
}

export interface CarePlanDetail {
  plan: CarePlan;
  activeRevision: CarePlanRevisionDetail | null;
  draftRevision: CarePlanRevisionDetail | null;
  latestEvaluation: CarePlanEvaluation | null;
  nextEvaluationDue: string | null;
}

export interface CarePlanHistory {
  revisions: CarePlanRevisionDetail[];
  evaluations: CarePlanEvaluation[];
}

export interface CarePlanListItem {
  id: string;
  clientId: string;
  clientDisplayName: string;
  organizationId: string;
  facilityId: string;
  facilityName: string;
  status: CarePlanStatus;
  validFrom: string;
  validUntil: string | null;
  version: number;
  createdByEmployeeId: string;
  createdByEmployeeName: string | null;
  createdAt: Date;
  updatedAt: Date;
  latestEvaluation: {
    evaluatedAt: Date;
    result: CarePlanEvaluationResult;
    nextEvaluationDue: string | null;
  } | null;
}

export interface CarePlanPage {
  items: CarePlanListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateCarePlanInput {
  validFrom: string;
  validUntil?: string | null;
}

export interface CreateCarePlanRevisionInput {
  expectedVersion: number;
  effectiveFrom: string;
  reason: string;
}

export interface CarePlanAssessmentInput {
  clientConcerns?: string | null;
  clientWishes?: string | null;
  clientGoals?: string | null;
  clientHabits?: string | null;
  clientPreferences?: string | null;
  clientPriorities?: string | null;
  professionalObservedNeeds?: string | null;
  professionalResources?: string | null;
  professionalLimitations?: string | null;
  professionalRisks?: string | null;
  professionalRationale?: string | null;
}

export interface CareNeedInput {
  category: CarePlanNeedCategory;
  title: string;
  description?: string | null;
  source: CarePlanNeedSource;
  priority: CarePlanNeedPriority;
  status: CarePlanNeedStatus;
}

export interface CareResourceInput {
  category: CarePlanResourceCategory;
  description: string;
  status: CarePlanResourceStatus;
}

export interface CareRiskResponseInput {
  clinicalRecordId: string;
  status: CarePlanRiskResponseStatus;
  plannedResponse: string;
  needIds: string[];
  measureIds: string[];
}

export interface CareGoalInput {
  title: string;
  description?: string | null;
  targetDate?: string | null;
  status: CarePlanGoalStatus;
  priority: CarePlanGoalPriority;
  needIds: string[];
}

export interface CareMeasureInput {
  title: string;
  instruction: string;
  category: CarePlanMeasureCategory;
  needIds: string[];
  goalIds: string[];
  serviceDefinitionId?: string | null;
  frequencyText?: string | null;
  responsibleRole?: string | null;
  validFrom: string;
  validUntil?: string | null;
  status: CarePlanMeasureStatus;
}

export interface CarePlanSourceReferenceInput {
  clinicalRecordId: string;
  recordKind: CarePlanSourceReference['recordKind'];
  rationale?: string | null;
}

export interface CarePlanEvaluationInput {
  expectedVersion: number;
  revisionId: string;
  result: CarePlanEvaluationResult;
  planChange: CarePlanChangeDecision;
  summary: string;
  nextEvaluationDue?: string | null;
  goals: CarePlanGoalOutcome[];
}

export interface CarePlanListQuery {
  status?: CarePlanStatus;
  clientId?: string;
  clientQuery?: string;
  facilityId?: string;
  evaluationOverdue?: boolean;
  evaluationDueBefore?: string;
  page?: number;
  pageSize?: number;
}

export type CarePlanWorklistQuery = CarePlanListQuery;

export interface CarePlanVisitMeasure {
  id: string;
  title: string;
  instruction: string;
  category: CarePlanMeasureCategory;
  frequencyText: string | null;
  responsibleRole: string | null;
}

export interface CarePlanVisitView {
  planId: string;
  clientId: string;
  status: 'active' | 'under_review';
  validFrom: string;
  validUntil: string | null;
  measures: CarePlanVisitMeasure[];
}

export type VersionedCarePlanInput<T> = T & { expectedVersion: number };

export interface EndCarePlanInput {
  expectedVersion: number;
  reason: string;
}

export interface CarePlanRevisionDiff {
  needs: { added: string[]; changed: string[]; removed: string[] };
  resources: { added: string[]; changed: string[]; removed: string[] };
  riskResponses: { added: string[]; changed: string[]; removed: string[] };
  goals: { added: string[]; changed: string[]; removed: string[] };
  measures: { added: string[]; changed: string[]; removed: string[] };
  sourceReferences: { added: string[]; changed: string[]; removed: string[] };
  assessmentChanged: boolean;
}

const ASSESSMENT_FIELDS: (keyof CarePlanAssessmentInput)[] = [
  'clientConcerns',
  'clientWishes',
  'clientGoals',
  'clientHabits',
  'clientPreferences',
  'clientPriorities',
  'professionalObservedNeeds',
  'professionalResources',
  'professionalLimitations',
  'professionalRisks',
  'professionalRationale',
];

export function validateCreateCarePlan(input: CreateCarePlanInput): void {
  requireDate(input.validFrom);
  if (input.validUntil != null) {
    requireDate(input.validUntil);
    if (input.validUntil < input.validFrom) throw new InvalidCarePlanError();
  }
}

export function validateCreateCarePlanRevision(input: CreateCarePlanRevisionInput): void {
  requireExpectedVersion(input.expectedVersion);
  requireDate(input.effectiveFrom);
  requireText(input.reason, 1, 1000);
}

export function validateCarePlanAssessment(input: CarePlanAssessmentInput): void {
  for (const field of ASSESSMENT_FIELDS) {
    const value = input[field];
    if (value != null && value.trim().length > 4000) throw new InvalidCarePlanError();
  }
}

export function validateCareNeed(input: CareNeedInput): void {
  if (!CARE_PLAN_NEED_CATEGORIES.includes(input.category)) throw new InvalidCarePlanError();
  if (
    ![
      'client_report',
      'professional_observation',
      'representative_report',
      'clinical_record',
    ].includes(input.source)
  )
    throw new InvalidCarePlanError();
  if (!['low', 'normal', 'high'].includes(input.priority)) throw new InvalidCarePlanError();
  if (!['active', 'addressed', 'deferred'].includes(input.status)) throw new InvalidCarePlanError();
  requireText(input.title, 1, 200);
  requireOptionalText(input.description, 2000);
}

export function validateCareResource(input: CareResourceInput): void {
  if (!CARE_PLAN_RESOURCE_CATEGORIES.includes(input.category)) throw new InvalidCarePlanError();
  if (!['available', 'needs_support', 'unavailable'].includes(input.status))
    throw new InvalidCarePlanError();
  requireText(input.description, 1, 2000);
}

export function validateCareRiskResponse(input: CareRiskResponseInput): void {
  requireUuid(input.clinicalRecordId);
  if (!CARE_PLAN_RISK_RESPONSE_STATUSES.includes(input.status)) throw new InvalidCarePlanError();
  requireText(input.plannedResponse, 1, 2000);
  requireUniqueIds(input.needIds);
  requireUniqueIds(input.measureIds);
}

export function validateCareGoal(input: CareGoalInput): void {
  requireText(input.title, 1, 200);
  requireOptionalText(input.description, 2000);
  if (input.targetDate != null) requireDate(input.targetDate);
  if (!CARE_PLAN_GOAL_STATUSES.includes(input.status)) throw new InvalidCarePlanError();
  if (!['low', 'normal', 'high'].includes(input.priority)) throw new InvalidCarePlanError();
  requireUniqueIds(input.needIds);
}

export function validateCareMeasure(input: CareMeasureInput): void {
  requireText(input.title, 1, 200);
  requireText(input.instruction, 1, 4000);
  if (!CARE_PLAN_MEASURE_CATEGORIES.includes(input.category)) throw new InvalidCarePlanError();
  requireUniqueIds(input.needIds);
  requireUniqueIds(input.goalIds);
  requireOptionalUuid(input.serviceDefinitionId);
  requireOptionalText(input.frequencyText, 500);
  requireOptionalText(input.responsibleRole, 100);
  requireDate(input.validFrom);
  if (input.validUntil != null) {
    requireDate(input.validUntil);
    if (input.validUntil < input.validFrom) throw new InvalidCarePlanError();
  }
  if (!CARE_PLAN_MEASURE_STATUSES.includes(input.status)) throw new InvalidCarePlanError();
}

export function validateCarePlanSourceReference(input: CarePlanSourceReferenceInput): void {
  requireUuid(input.clinicalRecordId);
  if (!['measurement', 'observation', 'assessment', 'risk_assessment'].includes(input.recordKind)) {
    throw new InvalidCarePlanError();
  }
  requireOptionalText(input.rationale, 1000);
}

export function validateCarePlanEvaluation(input: CarePlanEvaluationInput): void {
  requireExpectedVersion(input.expectedVersion);
  requireUuid(input.revisionId);
  if (!CARE_PLAN_EVALUATION_RESULTS.includes(input.result)) throw new InvalidCarePlanError();
  if (!['none', 'revision_required'].includes(input.planChange)) throw new InvalidCarePlanError();
  requireText(input.summary, 1, 4000);
  if (input.nextEvaluationDue != null) requireDate(input.nextEvaluationDue);
  requireUniqueIds(input.goals.map(({ goalId }) => goalId));
  for (const goal of input.goals) {
    requireUuid(goal.goalId);
    if (
      !['achieved', 'partially_achieved', 'not_achieved', 'not_applicable'].includes(goal.outcome)
    ) {
      throw new InvalidCarePlanError();
    }
    requireOptionalText(goal.note, 1000);
  }
}

export function validateActivationCompleteness(input: {
  assessment: CarePlanAssessment | null;
  needs: readonly CareNeed[];
  resources: readonly CareResource[];
  measures: readonly CareMeasure[];
  effectiveDate: string;
}): void {
  const assessmentHasContent = input.assessment
    ? ASSESSMENT_FIELDS.some((field) => {
        const value = input.assessment?.[field as keyof CarePlanAssessment];
        return typeof value === 'string' && value.trim().length > 0;
      })
    : false;
  const hasNeedOrResource = input.needs.length > 0 || input.resources.length > 0;
  const hasMeaningfulMeasure = input.measures.some(
    (measure) =>
      measure.status === 'active' &&
      measure.validFrom <= input.effectiveDate &&
      (measure.validUntil === null || measure.validUntil >= input.effectiveDate) &&
      measure.title.trim().length > 0 &&
      measure.instruction.trim().length > 0,
  );
  if (!assessmentHasContent || !hasNeedOrResource || !hasMeaningfulMeasure) {
    throw new CarePlanActivationIncompleteError();
  }
}

export function assertExpectedCarePlanVersion(actual: number, expected: number): void {
  requireExpectedVersion(expected);
  if (actual !== expected) throw new CarePlanVersionConflictError();
}

export function transitionCarePlanStatus(
  current: CarePlanStatus,
  next: CarePlanStatus,
): CarePlanStatus {
  const allowed: Record<CarePlanStatus, readonly CarePlanStatus[]> = {
    draft: ['active'],
    active: ['under_review', 'ended'],
    under_review: ['active', 'ended'],
    ended: [],
  };
  if (current !== next && !allowed[current].includes(next)) {
    throw new CarePlanLifecycleTransitionError(current, next);
  }
  return next;
}

export function copyForwardRevisionContent(
  source: CarePlanRevisionDetail,
  targetRevisionId: string,
): Omit<CarePlanRevisionDetail, 'revision'> {
  return {
    assessment: { ...source.assessment, revisionId: targetRevisionId },
    sourceReferences: source.sourceReferences.map((item) => ({ ...item })),
    needs: source.needs.map((item) => ({ ...item, revisionId: targetRevisionId })),
    resources: source.resources.map((item) => ({ ...item, revisionId: targetRevisionId })),
    riskResponses: source.riskResponses.map((item) => ({
      ...item,
      revisionId: targetRevisionId,
      needIds: [...item.needIds],
      measureIds: [...item.measureIds],
    })),
    goals: source.goals.map((item) => ({
      ...item,
      revisionId: targetRevisionId,
      needIds: [...item.needIds],
    })),
    measures: source.measures.map((item) => ({
      ...item,
      revisionId: targetRevisionId,
      needIds: [...item.needIds],
      goalIds: [...item.goalIds],
    })),
  };
}

export function diffCarePlanRevisions(
  previous: CarePlanRevisionDetail,
  next: CarePlanRevisionDetail,
): CarePlanRevisionDiff {
  return {
    needs: diffItems(previous.needs, next.needs),
    resources: diffItems(previous.resources, next.resources),
    riskResponses: diffItems(previous.riskResponses, next.riskResponses),
    goals: diffItems(previous.goals, next.goals),
    measures: diffItems(previous.measures, next.measures),
    sourceReferences: diffItems(
      previous.sourceReferences,
      next.sourceReferences,
      (item) => item.clinicalRecordId,
    ),
    assessmentChanged: !sameValue(
      assessmentComparable(previous.assessment),
      assessmentComparable(next.assessment),
    ),
  };
}

function diffItems<T extends { id?: string }>(
  before: readonly T[],
  after: readonly T[],
  getId: (item: T) => string = (item) => item.id!,
): { added: string[]; changed: string[]; removed: string[] } {
  const beforeById = new Map(before.map((item) => [getId(item), item]));
  const afterById = new Map(after.map((item) => [getId(item), item]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, item] of afterById) {
    const prior = beforeById.get(id);
    if (!prior) added.push(id);
    else if (!sameValue(itemComparable(prior), itemComparable(item))) changed.push(id);
  }
  for (const id of beforeById.keys()) if (!afterById.has(id)) removed.push(id);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

function itemComparable<T extends object>(item: T): unknown {
  const {
    revisionId: _revisionId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...content
  } = item as Record<string, unknown>;
  for (const key of ['needIds', 'goalIds']) {
    if (Array.isArray(content[key])) content[key] = [...(content[key] as string[])].sort();
  }
  return content;
}

function assessmentComparable(assessment: CarePlanAssessment): unknown {
  const { revisionId: _revisionId, updatedAt: _updatedAt, ...content } = assessment;
  return content;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExpectedVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new InvalidCarePlanError();
}

function requireUniqueIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length || ids.some((id) => !isUuid(id))) {
    throw new InvalidCarePlanError();
  }
}

function requireDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidCarePlanError();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidCarePlanError();
  }
}

function requireText(value: string, minLength: number, maxLength: number): void {
  if (value.trim().length < minLength || value.trim().length > maxLength) {
    throw new InvalidCarePlanError();
  }
}

function requireOptionalText(value: string | null | undefined, maxLength: number): void {
  if (value != null && value.trim().length > maxLength) throw new InvalidCarePlanError();
}

function requireUuid(value: string): void {
  if (!isUuid(value)) throw new InvalidCarePlanError();
}

function requireOptionalUuid(value: string | null | undefined): void {
  if (value != null) requireUuid(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class InvalidCarePlanError extends Error {
  readonly code = 'CARE_PLAN_INVALID';

  constructor() {
    super('The care plan data is invalid');
    this.name = 'InvalidCarePlanError';
  }
}

export class CarePlanActivationIncompleteError extends Error {
  readonly code = 'CARE_PLAN_REVISION_INCOMPLETE';

  constructor() {
    super('The care plan revision is incomplete');
    this.name = 'CarePlanActivationIncompleteError';
  }
}

export class CarePlanVersionConflictError extends Error {
  readonly code = 'CARE_PLAN_VERSION_CONFLICT';

  constructor() {
    super('The care plan changed since it was loaded');
    this.name = 'CarePlanVersionConflictError';
  }
}

export class CarePlanLifecycleTransitionError extends Error {
  readonly code = 'CARE_PLAN_TRANSITION_INVALID';

  constructor(
    readonly current: CarePlanStatus,
    readonly next: CarePlanStatus,
  ) {
    super('The care plan lifecycle transition is invalid');
    this.name = 'CarePlanLifecycleTransitionError';
  }
}
