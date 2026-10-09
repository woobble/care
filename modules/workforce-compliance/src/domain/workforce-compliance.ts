import {
  evaluateRequirements,
  qualificationIsValidAt,
  type CompetencyRequirementMode,
} from '@care/competency-policies';
import type { EmployeeStatus, QualificationAssignmentStatus } from '@care/employees';
import type { CompetencyOperation } from '@care/permissions';

export type IsoCalendarDate = string;

export type QualificationComplianceStatus =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'not_yet_valid'
  | 'revoked';

export interface QualificationFacts {
  id: string;
  qualificationId: string;
  assignmentStatus: QualificationAssignmentStatus;
  validFrom: IsoCalendarDate | null;
  validUntil: IsoCalendarDate | null;
}

export interface QualificationStatusThresholds {
  warningDays: number;
  criticalDays: number;
}

export type WorkforcePolicyFacts =
  | { status: 'missing'; operationKey: CompetencyOperation }
  | { status: 'inactive'; operationKey: CompetencyOperation; policyId: string }
  | {
      status: 'invalid';
      operationKey: CompetencyOperation;
      policyId: string;
      policyVersion: number;
      reason: WorkforcePolicyInvalidReason;
      qualificationIds: readonly string[];
    }
  | {
      status: 'active';
      operationKey: CompetencyOperation;
      policyId: string;
      policyVersion: number;
      requirementMode: CompetencyRequirementMode;
      requirementCount: number;
      requiredQualificationIds: readonly string[];
      qualificationDefinitionStatuses: readonly {
        qualificationId: string;
        status: 'active' | 'inactive' | 'missing';
      }[];
    };

export type WorkforcePolicyInvalidReason =
  | 'empty_requirements'
  | 'requirement_count_mismatch'
  | 'qualification_definition_unavailable';

export interface WorkforceReadinessInput {
  employee: {
    employeeId: string;
    status: EmployeeStatus;
    requiresEmployeeLink: boolean;
    employeeLinked: boolean;
  };
  policy: WorkforcePolicyFacts;
  qualifications: readonly QualificationFacts[];
  horizon: { from: IsoCalendarDate; through: IsoCalendarDate };
  thresholds: QualificationStatusThresholds;
}

export type WorkforceReadiness = 'ready' | 'at_risk' | 'not_ready';

export type WorkforceComplianceFindingCode =
  | 'COMPETENCY_POLICY_MISSING'
  | 'COMPETENCY_POLICY_INACTIVE'
  | 'COMPETENCY_POLICY_INVALID'
  | 'EMPLOYEE_INACTIVE'
  | 'EMPLOYEE_LINK_MISSING'
  | 'COMPETENCY_REQUIREMENT_UNMET'
  | 'COMPETENCY_ELIGIBILITY_EXPIRING';

export interface WorkforceComplianceFinding {
  code: WorkforceComplianceFindingCode;
  severity: 'warning' | 'critical';
  blocking: boolean;
  effectiveDate: IsoCalendarDate;
  operationKey: CompetencyOperation;
  employeeId: string;
  policyId: string | null;
  policyVersion: number | null;
  qualificationIds: readonly string[];
  assignmentIds: readonly string[];
}

export interface WorkforceReadinessResult {
  /** Null means the policy is missing, inactive, or invalid, so employee eligibility cannot be evaluated. */
  readiness: WorkforceReadiness | null;
  /** Last calendar day continuously supported by current facts; null means open-ended or blocked. */
  projectedEligibilityEnd: IsoCalendarDate | null;
  findings: readonly WorkforceComplianceFinding[];
}

const DAY_IN_MILLISECONDS = 86_400_000;
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidWorkforceComplianceInputError extends Error {
  readonly code = 'INVALID_WORKFORCE_COMPLIANCE_INPUT';

  constructor() {
    super('Workforce compliance input is invalid');
    this.name = 'InvalidWorkforceComplianceInputError';
  }
}

export function deriveQualificationStatus(
  qualification: QualificationFacts,
  effectiveDate: IsoCalendarDate,
  thresholds: QualificationStatusThresholds,
): QualificationComplianceStatus {
  validateThresholds(thresholds);
  validateQualification(qualification);
  validateDate(effectiveDate);

  if (qualification.assignmentStatus === 'revoked') return 'revoked';
  if (qualification.validFrom !== null && qualification.validFrom > effectiveDate) {
    return 'not_yet_valid';
  }
  if (qualification.validUntil !== null && qualification.validUntil < effectiveDate) {
    return 'expired';
  }
  if (
    qualification.validUntil !== null &&
    daysBetween(effectiveDate, qualification.validUntil) <= thresholds.warningDays
  ) {
    return 'expiring_soon';
  }
  return 'valid';
}

export function evaluateWorkforceReadiness(
  input: WorkforceReadinessInput,
): WorkforceReadinessResult {
  validateThresholds(input.thresholds);
  validateDate(input.horizon.from);
  validateDate(input.horizon.through);
  if (input.horizon.from > input.horizon.through) {
    throw new InvalidWorkforceComplianceInputError();
  }
  for (const qualification of input.qualifications) validateQualification(qualification);
  validatePolicy(input.policy);

  const findings: WorkforceComplianceFinding[] = [];
  const policyId = input.policy.status === 'missing' ? null : input.policy.policyId;
  const policyVersion =
    input.policy.status === 'active' || input.policy.status === 'invalid'
      ? input.policy.policyVersion
      : null;
  const baseFinding = (
    code: WorkforceComplianceFindingCode,
    severity: WorkforceComplianceFinding['severity'],
    blocking: boolean,
    effectiveDate: IsoCalendarDate,
    qualificationIds: readonly string[] = [],
    assignmentIds: readonly string[] = [],
  ): WorkforceComplianceFinding => ({
    code,
    severity,
    blocking,
    effectiveDate,
    operationKey: input.policy.operationKey,
    employeeId: input.employee.employeeId,
    policyId,
    policyVersion,
    qualificationIds: [...qualificationIds].sort(),
    assignmentIds: [...assignmentIds].sort(),
  });

  if (input.policy.status === 'missing') {
    findings.push(baseFinding('COMPETENCY_POLICY_MISSING', 'critical', true, input.horizon.from));
  } else if (input.policy.status === 'inactive') {
    findings.push(baseFinding('COMPETENCY_POLICY_INACTIVE', 'critical', true, input.horizon.from));
  } else if (input.policy.status === 'invalid') {
    findings.push(
      baseFinding(
        'COMPETENCY_POLICY_INVALID',
        'critical',
        true,
        input.horizon.from,
        input.policy.qualificationIds,
      ),
    );
  }

  if (input.employee.status !== 'active') {
    findings.push(baseFinding('EMPLOYEE_INACTIVE', 'critical', true, input.horizon.from));
  }
  if (input.employee.requiresEmployeeLink && !input.employee.employeeLinked) {
    findings.push(baseFinding('EMPLOYEE_LINK_MISSING', 'critical', true, input.horizon.from));
  }

  if (input.policy.status === 'active') {
    const activePolicy = input.policy;
    const invalidPolicyReason = invalidActivePolicyReason(activePolicy);
    if (invalidPolicyReason !== null) {
      findings.push(
        baseFinding(
          'COMPETENCY_POLICY_INVALID',
          'critical',
          true,
          input.horizon.from,
          invalidPolicyQualificationIds(activePolicy, invalidPolicyReason),
        ),
      );
    }
  }

  if (
    findings.some(
      (finding) =>
        finding.code === 'COMPETENCY_POLICY_MISSING' ||
        finding.code === 'COMPETENCY_POLICY_INACTIVE' ||
        finding.code === 'COMPETENCY_POLICY_INVALID',
    )
  ) {
    return result(null, null, findings);
  }

  if (findings.some((finding) => finding.blocking)) {
    return result('not_ready', null, findings);
  }

  if (input.policy.status !== 'active') {
    return result(null, null, findings);
  }

  const requiredIds = [...new Set(input.policy.requiredQualificationIds)];
  const evaluateAt = (date: IsoCalendarDate) => {
    const validQualificationIds = new Set(
      input.qualifications
        .filter(
          (qualification) =>
            qualification.assignmentStatus === 'active' &&
            requiredIds.includes(qualification.qualificationId) &&
            qualificationIsValidAt(qualification.validFrom, qualification.validUntil, date),
        )
        .map((qualification) => qualification.qualificationId),
    );
    return evaluateRequirements(
      input.policy.status === 'active' ? input.policy.requirementMode : 'ALL',
      requiredIds,
      validQualificationIds,
    );
  };

  const currentEvaluation = evaluateAt(input.horizon.from);
  if (!currentEvaluation.allowed) {
    const assignmentIds = assignmentIdsFor(
      input.qualifications,
      currentEvaluation.missingQualificationIds,
    );
    findings.push(
      baseFinding(
        'COMPETENCY_REQUIREMENT_UNMET',
        'critical',
        true,
        input.horizon.from,
        currentEvaluation.missingQualificationIds,
        assignmentIds,
      ),
    );
    return result('not_ready', null, findings);
  }

  const projectedEligibilityEnd = continuousEligibilityEnd(input, requiredIds, evaluateAt);
  if (projectedEligibilityEnd !== null && projectedEligibilityEnd < input.horizon.through) {
    const gapDate = nextCalendarDate(projectedEligibilityEnd);
    if (gapDate === null) throw new InvalidWorkforceComplianceInputError();
    const missing = evaluateAt(gapDate).missingQualificationIds;
    const daysUntilLoss = daysBetween(input.horizon.from, projectedEligibilityEnd);
    findings.push(
      baseFinding(
        'COMPETENCY_ELIGIBILITY_EXPIRING',
        daysUntilLoss <= input.thresholds.criticalDays ? 'critical' : 'warning',
        false,
        gapDate,
        missing,
        assignmentIdsFor(input.qualifications, missing),
      ),
    );
    return result('at_risk', projectedEligibilityEnd, findings);
  }

  return result('ready', projectedEligibilityEnd, findings);
}

function continuousEligibilityEnd(
  input: WorkforceReadinessInput,
  requiredQualificationIds: readonly string[],
  evaluateAt: (date: IsoCalendarDate) => ReturnType<typeof evaluateRequirements>,
): IsoCalendarDate | null {
  const boundaries = new Set<IsoCalendarDate>();
  for (const qualification of input.qualifications) {
    if (
      qualification.assignmentStatus !== 'active' ||
      !requiredQualificationIds.includes(qualification.qualificationId)
    ) {
      continue;
    }
    if (qualification.validFrom !== null && qualification.validFrom > input.horizon.from) {
      boundaries.add(qualification.validFrom);
    }
    if (qualification.validUntil !== null) {
      const firstInvalidDate = nextCalendarDate(qualification.validUntil);
      if (firstInvalidDate !== null && firstInvalidDate > input.horizon.from) {
        boundaries.add(firstInvalidDate);
      }
    }
  }

  for (const boundary of [...boundaries].sort()) {
    if (!evaluateAt(boundary).allowed) return previousCalendarDate(boundary);
  }
  return null;
}

function assignmentIdsFor(
  qualifications: readonly QualificationFacts[],
  qualificationIds: readonly string[],
): string[] {
  return qualifications
    .filter((qualification) => qualificationIds.includes(qualification.qualificationId))
    .map((qualification) => qualification.id);
}

function result(
  readiness: WorkforceReadiness | null,
  projectedEligibilityEnd: IsoCalendarDate | null,
  findings: readonly WorkforceComplianceFinding[],
): WorkforceReadinessResult {
  const sorted = [...findings].sort(
    (left, right) =>
      left.effectiveDate.localeCompare(right.effectiveDate) ||
      left.code.localeCompare(right.code) ||
      left.qualificationIds.join(',').localeCompare(right.qualificationIds.join(',')) ||
      left.assignmentIds.join(',').localeCompare(right.assignmentIds.join(',')),
  );
  return { readiness, projectedEligibilityEnd, findings: sorted };
}

function validatePolicy(policy: WorkforcePolicyFacts): void {
  if (
    (policy.status === 'active' || policy.status === 'invalid') &&
    (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1)
  ) {
    throw new InvalidWorkforceComplianceInputError();
  }
  if (
    policy.status === 'active' &&
    (!Number.isSafeInteger(policy.requirementCount) || policy.requirementCount < 0)
  ) {
    throw new InvalidWorkforceComplianceInputError();
  }
}

function invalidActivePolicyReason(
  policy: Extract<WorkforcePolicyFacts, { status: 'active' }>,
): WorkforcePolicyInvalidReason | null {
  if (policy.requiredQualificationIds.length === 0) return 'empty_requirements';
  if (
    policy.requirementCount !== policy.requiredQualificationIds.length ||
    new Set(policy.requiredQualificationIds).size !== policy.requiredQualificationIds.length
  ) {
    return 'requirement_count_mismatch';
  }

  const definitionsById = new Map(
    policy.qualificationDefinitionStatuses.map((definition) => [
      definition.qualificationId,
      definition.status,
    ]),
  );
  if (
    definitionsById.size !== policy.qualificationDefinitionStatuses.length ||
    policy.requiredQualificationIds.some((id) => definitionsById.get(id) !== 'active')
  ) {
    return 'qualification_definition_unavailable';
  }
  return null;
}

function invalidPolicyQualificationIds(
  policy: Extract<WorkforcePolicyFacts, { status: 'active' }>,
  reason: WorkforcePolicyInvalidReason,
): string[] {
  if (reason === 'empty_requirements') return [];
  if (reason === 'requirement_count_mismatch') return [...new Set(policy.requiredQualificationIds)];

  const definitionStatuses = new Map(
    policy.qualificationDefinitionStatuses.map((definition) => [
      definition.qualificationId,
      definition.status,
    ]),
  );
  return policy.requiredQualificationIds.filter((id) => definitionStatuses.get(id) !== 'active');
}

function validateQualification(qualification: QualificationFacts): void {
  if (qualification.validFrom !== null) validateDate(qualification.validFrom);
  if (qualification.validUntil !== null) validateDate(qualification.validUntil);
  if (
    qualification.validFrom !== null &&
    qualification.validUntil !== null &&
    qualification.validUntil < qualification.validFrom
  ) {
    throw new InvalidWorkforceComplianceInputError();
  }
}

function validateThresholds(thresholds: QualificationStatusThresholds): void {
  if (
    !Number.isSafeInteger(thresholds.warningDays) ||
    thresholds.warningDays <= 0 ||
    thresholds.warningDays > 365 ||
    !Number.isSafeInteger(thresholds.criticalDays) ||
    thresholds.criticalDays <= 0 ||
    thresholds.criticalDays > 365 ||
    thresholds.criticalDays > thresholds.warningDays
  ) {
    throw new InvalidWorkforceComplianceInputError();
  }
}

function validateDate(value: IsoCalendarDate): void {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) throw new InvalidWorkforceComplianceInputError();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new InvalidWorkforceComplianceInputError();
  }
  if (formatCalendarDate(calendarDateEpoch(value)) !== value) {
    throw new InvalidWorkforceComplianceInputError();
  }
}

function daysBetween(from: IsoCalendarDate, through: IsoCalendarDate): number {
  return (calendarDateEpoch(through) - calendarDateEpoch(from)) / DAY_IN_MILLISECONDS;
}

function calendarDateEpoch(value: IsoCalendarDate): number {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) throw new InvalidWorkforceComplianceInputError();
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getTime();
}

function nextCalendarDate(value: IsoCalendarDate): IsoCalendarDate | null {
  return formatCalendarDate(calendarDateEpoch(value) + DAY_IN_MILLISECONDS);
}

function previousCalendarDate(value: IsoCalendarDate): IsoCalendarDate {
  const previous = formatCalendarDate(calendarDateEpoch(value) - DAY_IN_MILLISECONDS);
  if (previous === null) throw new InvalidWorkforceComplianceInputError();
  return previous;
}

function formatCalendarDate(epoch: number): IsoCalendarDate | null {
  const date = new Date(epoch);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}
