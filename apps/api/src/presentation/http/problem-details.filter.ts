import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { ProblemDetails } from '@care/contracts';
import {
  CarePlanActiveRevisionRequiredError,
  CarePlanActivationIncompleteError,
  CarePlanAlreadyEndedError,
  CarePlanClientInactiveError,
  CarePlanCurrentPlanExistsError,
  CarePlanDraftAlreadyExistsError,
  CarePlanDraftRequiredError,
  CarePlanEmployeeRequiredError,
  CarePlanGoalNotFoundError,
  CarePlanItemConflictError,
  CarePlanItemNotFoundError,
  CarePlanLifecycleTransitionError,
  CarePlanNotFoundError,
  CarePlanProviderContextRequiredError,
  CarePlanRelationshipConflictError,
  CarePlanRelationshipInvalidError,
  CarePlanRevisionNotFoundError,
  CarePlanVersionConflictError,
  CarePlanVisitNotFoundError,
  CarePlanInvalidQueryError,
  InvalidCarePlanError,
} from '@care/care-planning';
import { ClinicalRecordAmendmentConflictError } from '@care/clinical-documentation';
import { AuthorizationDeniedError, ProfessionalCompetencyDeniedError } from '@care/permissions';
import {
  CompetencyPolicyNotFoundError,
  CompetencyPolicyVersionConflictError,
  InvalidCompetencyPolicyConfigurationError,
} from '@care/competency-policies';
import {
  InvalidWorkforceComplianceInputError,
  InvalidWorkforceComplianceQueryError,
  InvalidWorkforceComplianceSettingsError,
  WorkforceComplianceAccessDeniedError,
  WorkforceComplianceEmployeeNotFoundError,
  WorkforceComplianceSettingsNotFoundError,
  WorkforceComplianceSettingsVersionConflictError,
} from '@care/workforce-compliance';
import { MedicationError, MedicationReconciliationError } from '@care/medication';
import {
  ClientArchivedError,
  ClientAddressNotFoundError,
  ClientContactNotFoundError,
  ClientInsuranceNotFoundError,
  ClientNotFoundError,
  ClientHasActiveServiceAgreementsError,
  ClientExecutionInProgressError,
  FutureVisitsExistError,
  FacilityNotInOrganizationError,
  InvalidClientAddressError,
  InvalidClientContactError,
  InvalidClientInsuranceError,
  InvalidClientPersonalDataError,
  InvalidPflegegradError,
  InvalidClientTransitionError,
  InvalidPaginationError,
  InvalidProviderContextError,
  OverlappingPflegegradPeriodError,
  PflegegradNotFoundError,
  PflegegradRecordImmutableError,
} from '@care/clients';
import {
  CrossTenantReferenceError,
  EmployeeAlreadyLinkedError,
  EmployeeArchivedError,
  EmployeeConflictError,
  EmployeeNotFoundError,
  EmployeeHasFutureVisitsError,
  EmployeeHasInProgressExecutionError,
  EmployeeNotActiveForScheduleError,
  EmployeeNotAssignedToFacilityError,
  InvalidEmployeeDataError,
  InvalidEmployeePaginationError,
  InvalidEmployeeTransitionError,
  InvalidFacilityAssignmentError,
  InvalidTeamAssignmentError,
  PrimaryFacilityRequiredError,
  QualificationArchivedError,
  QualificationNotFoundError,
  QualificationRequiredByActivePolicyError,
  SkillArchivedError,
  SkillNotFoundError,
  UserAlreadyLinkedError,
} from '@care/employees';
import {
  DisabledUserError,
  InvitationNotPendingError,
  InvalidMembershipTransitionError,
  MembershipAlreadyActiveError,
  MembershipRevokedError,
  TenantAccessDeniedError,
  TenantAccessError,
} from '@care/identity';
import {
  FacilityArchivedError,
  FacilityHasActiveTeamsError,
  FacilityNotFoundError,
  InvalidTeamAssignmentError as InvalidStructureTeamAssignmentError,
  OrganizationArchivedError,
  OrganizationHasActiveChildrenError,
  OrganizationHasActiveServiceAgreementsError,
  OrganizationNotFoundError,
  TeamArchivedError,
  TeamNotFoundError,
  FacilityHasActiveServiceAgreementsError,
  FacilityHasFutureVisitsError,
  OrganizationHasFutureVisitsError,
  OrganizationExecutionInProgressError,
  InvalidSchedulingTimezoneError,
  FacilityExecutionInProgressError,
} from '@care/organizations';
import {
  InvalidServiceAvailabilityError,
  InvalidServiceCategoryError,
  InvalidServiceDefinitionError,
  InvalidServicePaginationError,
  ServiceCategoryArchivedError,
  ServiceCategoryNotFoundError,
  ServiceDefinitionArchivedError,
  ServiceNotFoundError,
  ServiceNotAvailableForProviderError,
  ServiceNotValidForPeriodError,
  ServiceDefinitionHasActiveServiceAgreementsError,
} from '@care/services';
import {
  ServiceAgreementError,
  ServiceAgreementHasFutureVisitsError,
} from '@care/service-agreements';
import {
  DuplicateVisitAssignmentError,
  InvalidEmployeeUnavailabilityError,
  InvalidScheduleGenerationRangeError,
  InvalidVisitAssignmentError,
  InvalidVisitDataError,
  InvalidVisitQueryError,
  InvalidVisitServiceError,
  InvalidVisitStatusError,
  VisitAgreementInvalidError,
  VisitAgreementServiceInvalidError,
  VisitAssignmentNotFoundError,
  VisitCancelledError,
  VisitClientConflictError,
  VisitEmployeeConflictError,
  VisitEmployeeUnavailableError,
  VisitNotFoundError,
  VisitOutsideProviderContextError,
  VisitExecutionPlanningLockedError,
} from '@care/scheduling';
import {
  EmployeeLinkRequiredError,
  ExecutionCorrectionReasonRequiredError,
  InvalidPerformedServiceQuantityError,
  InvalidPerformedServiceStatusError,
  InvalidVisitExecutionQueryError,
  PerformedServiceNotFoundError,
  PerformedServiceRequiredError,
  PerformedServiceServiceInvalidError,
  VisitExecutionAlreadyCompletedError,
  VisitExecutionNotFoundError,
  VisitExecutionNotStartedError,
  VisitExecutionTimeInvalidError,
  VisitExecutionVersionConflictError,
  VisitExecutionVisitCancelledError,
  VisitNotAssignedToEmployeeError,
} from '@care/visit-execution';
import {
  AmendmentReasonRequiredError,
  AssessmentInvalidError,
  CareDocumentationAlreadyFinalizedError,
  CareDocumentationEmployeeLinkRequiredError,
  CareDocumentationIncompleteError,
  CareDocumentationInvalidStateError,
  CareDocumentationNotFinalizedError,
  CareDocumentationNotFoundError,
  CareDocumentationVersionConflictError,
  CareDocumentationVisitRelationshipRequiredError,
  ClinicalDocumentationNotAuthorizedError,
  ClinicalDocumentationVisitRequiredError,
  ClinicalHistoryInvalidQueryError,
  ClinicalRecordDocumentationNotFoundError,
  ClinicalRecordFinalizedError,
  ClinicalRecordInvalidError,
  ClinicalRecordNotFinalizedError,
  ClinicalRecordNotFoundError,
  ClinicalRecordVersionConflictError,
  DocumentationEntryNotFoundError,
  InvalidDocumentationWorklistQueryError,
  InvalidDocumentationEntryError,
  InvalidServiceEvidenceError,
  MeasurementInvalidError,
  ObservationInvalidError,
  RiskAssessmentInvalidError,
  ServiceEvidenceNotFoundError,
  VisitExecutionNotCompletedError,
  VisitExecutionRequiredError,
} from '@care/care-documentation';
import {
  AcknowledgementAlreadyExistsError,
  AcknowledgementConfirmationNameMismatchError,
  AcknowledgementConfirmationRequiredError,
  AcknowledgementIdempotencyConflictError,
  AcknowledgementInvalidInputError,
  AcknowledgementInvalidStateError,
  AcknowledgementNotFoundError,
  AcknowledgementRevocationReasonRequiredError,
  AcknowledgementSignatureCleanupError,
  AcknowledgementSignatureIntegrityError,
  AcknowledgementSignatureNotFoundError,
  AcknowledgementSignatureRequiredError,
  AcknowledgementSignatoryInvalidError,
  DocumentationNotFinalizedError,
  EmptySignatureError,
  EvidencePackageIntegrityError,
  EvidencePackageInvalidStateError,
  EvidencePackageNotFoundError,
  EvidencePackageNotReadyError,
  EvidencePackageStaleError,
  InvalidServiceEvidenceWorklistQueryError,
  InvalidSignatureError,
  ServiceEvidenceEmployeeLinkRequiredError,
  ServiceEvidenceVisitRelationshipRequiredError,
  SignatureTooLargeError,
} from '@care/service-evidence';
import type { ApiRequest } from '../../http/request';

@Injectable()
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ApiRequest>();
    const response = http.getResponse<Response>();
    const problem = problemFor(exception, request.context?.requestId ?? request.id ?? 'unknown');
    response.status(problem.status).type('application/problem+json').json(problem);
  }
}

function problemFor(exception: unknown, traceId: string): ProblemDetails {
  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';

  if (exception instanceof ZodError) {
    status = 400;
    code = 'INVALID_REQUEST';
  } else if (exception instanceof ClientNotFoundError) {
    status = 404;
    code = exception.code;
  } else if (exception instanceof InvalidClientPersonalDataError) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof InvalidPaginationError) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof InvalidEmployeePaginationError) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof ClientArchivedError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof ClientHasActiveServiceAgreementsError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof FutureVisitsExistError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof ClientExecutionInProgressError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof InvalidClientTransitionError) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof ClientAddressNotFoundError ||
    exception instanceof ClientContactNotFoundError ||
    exception instanceof ClientInsuranceNotFoundError ||
    exception instanceof PflegegradNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof OverlappingPflegegradPeriodError ||
    exception instanceof PflegegradRecordImmutableError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidClientAddressError ||
    exception instanceof InvalidClientContactError ||
    exception instanceof InvalidClientInsuranceError ||
    exception instanceof InvalidPflegegradError ||
    exception instanceof InvalidProviderContextError ||
    exception instanceof FacilityNotInOrganizationError
  ) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof AuthorizationDeniedError) {
    status = 403;
    code = exception.code;
  } else if (exception instanceof ProfessionalCompetencyDeniedError) {
    status = 403;
    code = exception.code;
  } else if (exception instanceof CompetencyPolicyNotFoundError) {
    status = 404;
    code = exception.code;
  } else if (exception instanceof CompetencyPolicyVersionConflictError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof InvalidCompetencyPolicyConfigurationError) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof WorkforceComplianceAccessDeniedError) {
    status = 403;
    code = exception.code;
  } else if (exception instanceof MedicationError || exception instanceof MedicationReconciliationError) {
    status = exception.status;
    code = exception.code;
  } else if (
    exception instanceof WorkforceComplianceEmployeeNotFoundError ||
    exception instanceof WorkforceComplianceSettingsNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (exception instanceof WorkforceComplianceSettingsVersionConflictError) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidWorkforceComplianceInputError ||
    exception instanceof InvalidWorkforceComplianceQueryError ||
    exception instanceof InvalidWorkforceComplianceSettingsError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof CarePlanNotFoundError ||
    exception instanceof CarePlanRevisionNotFoundError ||
    exception instanceof CarePlanItemNotFoundError ||
    exception instanceof CarePlanGoalNotFoundError ||
    exception instanceof CarePlanVisitNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (exception instanceof CarePlanEmployeeRequiredError) {
    status = 403;
    code = exception.code;
  } else if (
    exception instanceof CarePlanActivationIncompleteError ||
    exception instanceof CarePlanAlreadyEndedError ||
    exception instanceof CarePlanClientInactiveError ||
    exception instanceof CarePlanCurrentPlanExistsError ||
    exception instanceof CarePlanDraftAlreadyExistsError ||
    exception instanceof CarePlanDraftRequiredError ||
    exception instanceof CarePlanActiveRevisionRequiredError ||
    exception instanceof CarePlanLifecycleTransitionError ||
    exception instanceof CarePlanItemConflictError ||
    exception instanceof CarePlanProviderContextRequiredError ||
    exception instanceof CarePlanRelationshipConflictError ||
    exception instanceof CarePlanVersionConflictError
  ) {
    status = 409;
    code = exception.code;
  } else if (isCarePlanClinicalReferenceForeignKeyViolation(exception)) {
    status = 400;
    code = 'CARE_PLAN_RELATIONSHIP_INVALID';
  } else if (
    exception instanceof InvalidCarePlanError ||
    exception instanceof CarePlanInvalidQueryError ||
    exception instanceof CarePlanRelationshipInvalidError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof ServiceNotFoundError ||
    exception instanceof ServiceCategoryNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof ServiceCategoryArchivedError ||
    exception instanceof ServiceDefinitionArchivedError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidServiceAvailabilityError ||
    exception instanceof InvalidServiceCategoryError ||
    exception instanceof InvalidServiceDefinitionError ||
    exception instanceof InvalidServicePaginationError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof ServiceNotAvailableForProviderError ||
    exception instanceof ServiceNotValidForPeriodError ||
    exception instanceof ServiceDefinitionHasActiveServiceAgreementsError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof VisitNotFoundError ||
    exception instanceof VisitAssignmentNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof InvalidVisitDataError ||
    exception instanceof InvalidVisitServiceError ||
    exception instanceof InvalidVisitQueryError ||
    exception instanceof InvalidScheduleGenerationRangeError ||
    exception instanceof InvalidEmployeeUnavailabilityError ||
    exception instanceof InvalidVisitAssignmentError ||
    exception instanceof InvalidSchedulingTimezoneError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof InvalidVisitStatusError ||
    exception instanceof VisitCancelledError ||
    exception instanceof VisitOutsideProviderContextError ||
    exception instanceof VisitExecutionPlanningLockedError ||
    exception instanceof VisitClientConflictError ||
    exception instanceof VisitEmployeeConflictError ||
    exception instanceof VisitEmployeeUnavailableError ||
    exception instanceof VisitAgreementInvalidError ||
    exception instanceof VisitAgreementServiceInvalidError ||
    exception instanceof DuplicateVisitAssignmentError ||
    exception instanceof EmployeeNotActiveForScheduleError ||
    exception instanceof EmployeeNotAssignedToFacilityError ||
    exception instanceof EmployeeHasFutureVisitsError ||
    exception instanceof EmployeeHasInProgressExecutionError ||
    exception instanceof OrganizationHasFutureVisitsError ||
    exception instanceof OrganizationExecutionInProgressError ||
    exception instanceof FacilityHasFutureVisitsError ||
    exception instanceof FacilityExecutionInProgressError ||
    exception instanceof VisitExecutionAlreadyCompletedError ||
    exception instanceof VisitExecutionNotStartedError ||
    exception instanceof VisitExecutionTimeInvalidError ||
    exception instanceof VisitExecutionVersionConflictError ||
    exception instanceof VisitExecutionVisitCancelledError ||
    exception instanceof PerformedServiceRequiredError ||
    exception instanceof PerformedServiceServiceInvalidError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof VisitExecutionNotFoundError ||
    exception instanceof PerformedServiceNotFoundError ||
    exception instanceof ClinicalRecordDocumentationNotFoundError ||
    exception instanceof ClinicalRecordNotFoundError ||
    exception instanceof CareDocumentationNotFoundError ||
    exception instanceof DocumentationEntryNotFoundError ||
    exception instanceof ServiceEvidenceNotFoundError ||
    exception instanceof EvidencePackageNotFoundError ||
    exception instanceof AcknowledgementNotFoundError ||
    exception instanceof AcknowledgementSignatureNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof EmployeeLinkRequiredError ||
    exception instanceof VisitNotAssignedToEmployeeError
  ) {
    status = 403;
    code = exception.code;
  } else if (
    exception instanceof CareDocumentationEmployeeLinkRequiredError ||
    exception instanceof CareDocumentationVisitRelationshipRequiredError ||
    exception instanceof ClinicalDocumentationVisitRequiredError ||
    exception instanceof ClinicalDocumentationNotAuthorizedError ||
    exception instanceof ServiceEvidenceEmployeeLinkRequiredError ||
    exception instanceof ServiceEvidenceVisitRelationshipRequiredError ||
    exception instanceof AcknowledgementSignatoryInvalidError
  ) {
    status = 403;
    code = exception.code;
  } else if (
    exception instanceof CareDocumentationAlreadyFinalizedError ||
    exception instanceof CareDocumentationNotFinalizedError ||
    exception instanceof CareDocumentationIncompleteError ||
    exception instanceof CareDocumentationInvalidStateError ||
    exception instanceof CareDocumentationVersionConflictError ||
    exception instanceof ClinicalRecordAmendmentConflictError ||
    exception instanceof ClinicalRecordFinalizedError ||
    exception instanceof ClinicalRecordNotFinalizedError ||
    exception instanceof ClinicalRecordVersionConflictError ||
    exception instanceof VisitExecutionRequiredError ||
    exception instanceof VisitExecutionNotCompletedError ||
    exception instanceof DocumentationNotFinalizedError ||
    exception instanceof EvidencePackageNotReadyError ||
    exception instanceof EvidencePackageStaleError ||
    exception instanceof EvidencePackageInvalidStateError ||
    exception instanceof AcknowledgementAlreadyExistsError ||
    exception instanceof AcknowledgementInvalidStateError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof AmendmentReasonRequiredError ||
    exception instanceof InvalidDocumentationWorklistQueryError ||
    exception instanceof InvalidDocumentationEntryError ||
    exception instanceof ClinicalRecordInvalidError ||
    exception instanceof MeasurementInvalidError ||
    exception instanceof ObservationInvalidError ||
    exception instanceof AssessmentInvalidError ||
    exception instanceof RiskAssessmentInvalidError ||
    exception instanceof ClinicalHistoryInvalidQueryError ||
    exception instanceof InvalidServiceEvidenceError ||
    exception instanceof AcknowledgementConfirmationNameMismatchError ||
    exception instanceof AcknowledgementConfirmationRequiredError ||
    exception instanceof AcknowledgementIdempotencyConflictError ||
    exception instanceof AcknowledgementInvalidInputError ||
    exception instanceof AcknowledgementRevocationReasonRequiredError ||
    exception instanceof AcknowledgementSignatureRequiredError ||
    exception instanceof EmptySignatureError ||
    exception instanceof InvalidSignatureError ||
    exception instanceof SignatureTooLargeError ||
    exception instanceof InvalidServiceEvidenceWorklistQueryError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof EvidencePackageIntegrityError ||
    exception instanceof AcknowledgementSignatureIntegrityError ||
    exception instanceof AcknowledgementSignatureCleanupError
  ) {
    status = 500;
    code = exception.code;
  } else if (
    exception instanceof InvalidPerformedServiceQuantityError ||
    exception instanceof InvalidPerformedServiceStatusError ||
    exception instanceof InvalidVisitExecutionQueryError ||
    exception instanceof ExecutionCorrectionReasonRequiredError
  ) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof TenantAccessError) {
    status = exception.status;
    code = exception.code;
  } else if (
    exception instanceof MembershipAlreadyActiveError ||
    exception instanceof MembershipRevokedError ||
    exception instanceof InvalidMembershipTransitionError ||
    exception instanceof InvitationNotPendingError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof OrganizationNotFoundError ||
    exception instanceof FacilityNotFoundError ||
    exception instanceof TeamNotFoundError ||
    exception instanceof EmployeeNotFoundError ||
    exception instanceof QualificationNotFoundError ||
    exception instanceof SkillNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof OrganizationArchivedError ||
    exception instanceof FacilityArchivedError ||
    exception instanceof TeamArchivedError ||
    exception instanceof EmployeeArchivedError ||
    exception instanceof InvalidEmployeeTransitionError ||
    exception instanceof EmployeeAlreadyLinkedError ||
    exception instanceof UserAlreadyLinkedError ||
    exception instanceof PrimaryFacilityRequiredError ||
    exception instanceof QualificationArchivedError ||
    exception instanceof QualificationRequiredByActivePolicyError ||
    exception instanceof SkillArchivedError ||
    exception instanceof OrganizationHasActiveChildrenError ||
    exception instanceof OrganizationHasActiveServiceAgreementsError ||
    exception instanceof FacilityHasActiveServiceAgreementsError ||
    exception instanceof FacilityHasActiveTeamsError ||
    exception instanceof EmployeeConflictError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidEmployeeDataError ||
    exception instanceof InvalidFacilityAssignmentError ||
    exception instanceof InvalidTeamAssignmentError ||
    exception instanceof InvalidStructureTeamAssignmentError ||
    exception instanceof CrossTenantReferenceError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof DisabledUserError ||
    exception instanceof TenantAccessDeniedError
  ) {
    status = 403;
    code = exception.code;
  } else if (exception instanceof ServiceAgreementError) {
    status = exception.status;
    code = exception.code;
  } else if (exception instanceof ServiceAgreementHasFutureVisitsError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    code = statusCode(status);
  }

  const title = titleFor(status);
  const conflictingInterval =
    exception instanceof VisitEmployeeConflictError
      ? {
          plannedStart: exception.plannedStart.toISOString(),
          plannedEnd: exception.plannedEnd.toISOString(),
          timezone: exception.timezone,
        }
      : undefined;
  return {
    type: `https://care-platform.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    traceId,
    ...(conflictingInterval ? { conflictingInterval } : {}),
  };
}

function isCarePlanClinicalReferenceForeignKeyViolation(exception: unknown): boolean {
  const visited = new Set<object>();
  let current = exception;
  for (
    let depth = 0;
    depth < 8 && typeof current === 'object' && current !== null && !visited.has(current);
    depth += 1
  ) {
    visited.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (
      candidate.code === '23503' &&
      (candidate.constraint === 'care_plan_risk_responses_clinical_record_fk' ||
        candidate.constraint === 'care_plan_source_refs_clinical_record_fk')
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function statusCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR';
  }
}

function titleFor(status: number): string {
  switch (status) {
    case 400:
      return 'Request is invalid';
    case 401:
      return 'Authentication required';
    case 403:
      return 'Access denied';
    case 404:
      return 'Resource not found';
    case 409:
      return 'Request conflicts with current state';
    default:
      return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}
