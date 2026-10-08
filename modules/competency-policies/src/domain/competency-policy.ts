export type CompetencyRequirementMode = 'ANY' | 'ALL';

export interface RequirementEvaluation {
  allowed: boolean;
  matchedQualificationIds: string[];
  missingQualificationIds: string[];
}

export function evaluateRequirements(
  mode: CompetencyRequirementMode,
  requiredQualificationIds: readonly string[],
  validQualificationIds: ReadonlySet<string>,
): RequirementEvaluation {
  const required = [...new Set(requiredQualificationIds)];
  const matchedQualificationIds = required.filter((id) => validQualificationIds.has(id));
  const missingQualificationIds = required.filter((id) => !validQualificationIds.has(id));

  if (required.length === 0) {
    return { allowed: false, matchedQualificationIds: [], missingQualificationIds: [] };
  }

  return {
    allowed:
      mode === 'ANY' ? matchedQualificationIds.length > 0 : missingQualificationIds.length === 0,
    matchedQualificationIds,
    missingQualificationIds,
  };
}

export function qualificationIsValidAt(
  validFrom: string | null,
  validUntil: string | null,
  effectiveDate: string,
): boolean {
  return (
    (validFrom === null || validFrom <= effectiveDate) &&
    (validUntil === null || validUntil >= effectiveDate)
  );
}
