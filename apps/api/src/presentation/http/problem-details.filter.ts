import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

import type { ApiRequest } from '@app/api/http/request';
import {
  BenefitAdjustmentConflictError,
  BenefitAllocationAlreadyReversedError,
  BenefitAllocationConflictError,
  BenefitAllocationNotFoundError,
  BenefitBudgetInsufficientError,
  BenefitClientNotFoundError,
  BenefitEntitlementNotFoundError,
  BenefitEntitlementPeriodConflictError,
  BenefitEntitlementVersionConflictError,
  BenefitFundingSourceNotFoundError,
  BenefitProviderRecognitionRequiredError,
  BenefitServiceNotEligibleError,
  InvalidBenefitAdjustmentError,
  InvalidBenefitAmountError,
  InvalidBenefitDateError,
  InvalidBenefitEntitlementError,
  InvalidBenefitFundingSourceError,
  InvalidBenefitWorklistQueryError,
  InvalidProviderRecognitionError,
  ProviderRecognitionNotFoundError,
} from '@care/benefits';
import { BillingDomainError } from '@care/billing';
import {
  AmendmentReasonRequiredError,
  CareDocumentationAlreadyFinalizedError,
  CareDocumentationEmployeeLinkRequiredError,
  CareDocumentationIncompleteError,
  CareDocumentationInvalidStateError,
  CareDocumentationNotFinalizedError,
  CareDocumentationNotFoundError,
  CareDocumentationVersionConflictError,
  CareDocumentationVisitRelationshipRequiredError,
  DocumentationEntryNotFoundError,
  InvalidDocumentationWorklistQueryError,
  InvalidDocumentationEntryError,
  InvalidServiceEvidenceError,
  ServiceEvidenceNotFoundError,
  VisitExecutionNotCompletedError,
  VisitExecutionRequiredError,
} from '@care/care-documentation';
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
  CommunicationNotFoundError,
  CommunicationSourceNotFoundError,
  CommunicationVersionConflictError,
  InvalidCommunicationInputError,
} from '@care/communications';
import type { ProblemDetails } from '@care/contracts';
import { DocumentDomainError } from '@care/documents';
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
  InvalidOperationsInputError,
  OperationsAssigneeInvalidError,
  OperationsSourceNotFoundError,
  OperationsTaskNotFoundError,
  OperationsTaskStateError,
  OperationsTaskVersionConflictError,
  OperationsWorkItemNotFoundError,
} from '@care/operations';
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
import { AuthorizationDeniedError } from '@care/permissions';
import {
  DuplicateVisitAssignmentError,
  InvalidEmployeeUnavailabilityError,
  EmployeeUnavailabilityNotFoundError,
  InvalidEmployeeAvailabilityError,
  AvailabilityExceptionNotFoundError,
  SchedulingVersionConflictError,
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
  VisitOutsideEmployeeAvailabilityError,
  VisitTravelBufferConflictError,
  VisitDailyPlanLimitError,
  VisitNotFoundError,
  VisitOutsideProviderContextError,
  VisitExecutionPlanningLockedError,
  ActiveVisitSubstitutionError,
  VisitSubstitutionNotFoundError,
  VisitSubstitutionStaleError,
  TourNotFoundError,
  SchedulingConflictsError,
  InvalidTourError,
  TourVersionConflictError,
} from '@care/scheduling';
import {
  ServiceAgreementError,
  ServiceAgreementHasFutureVisitsError,
} from '@care/service-agreements';
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
  InvalidServicePriceError,
  InvalidServicePriceQuantityError,
  ServicePriceConflictError,
  ServicePriceNotFoundError,
  ServicePriceScopeDeniedError,
  ServicePricingUnitMismatchError,
} from '@care/services';
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

@Injectable()
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ApiRequest>();
    const response = http.getResponse<FastifyReply>();
    const problem = problemFor(exception, request.context?.requestId ?? request.id ?? 'unknown');
    response.code(problem.status).type('application/problem+json').send(problem);
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
  } else if (
    exception instanceof CommunicationNotFoundError ||
    exception instanceof CommunicationSourceNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (exception instanceof CommunicationVersionConflictError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof InvalidCommunicationInputError) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof OperationsTaskNotFoundError ||
    exception instanceof OperationsWorkItemNotFoundError ||
    exception instanceof OperationsSourceNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof OperationsTaskVersionConflictError ||
    exception instanceof OperationsTaskStateError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidOperationsInputError ||
    exception instanceof OperationsAssigneeInvalidError
  ) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof BillingDomainError) {
    code = exception.code;
    if (code.endsWith('_NOT_FOUND')) status = 404;
    else if (code.startsWith('INVALID_') || code === 'PAYMENT_AMOUNT_INVALID') status = 400;
    else status = 409;
  } else if (exception instanceof DocumentDomainError) {
    code = exception.code;
    if (code === 'DOCUMENT_ACCESS_DENIED') status = 403;
    else if (code.endsWith('_NOT_FOUND')) status = 404;
    else if (code === 'EXPORT_ROW_LIMIT_EXCEEDED') status = 413;
    else if (
      code === 'DOCUMENT_TEMPLATE_INVALID' ||
      code === 'EXPORT_FILTER_INVALID' ||
      code === 'EXPORT_FORMAT_UNSUPPORTED'
    ) {
      status = 400;
    } else if (
      code.endsWith('_CONFLICT') ||
      code === 'DOCUMENT_SOURCE_NOT_READY' ||
      code === 'DOCUMENT_TEMPLATE_VERSION_CONFLICT'
    ) {
      status = 409;
    } else {
      status = 500;
    }
  } else if (
    exception instanceof BenefitClientNotFoundError ||
    exception instanceof BenefitFundingSourceNotFoundError ||
    exception instanceof BenefitEntitlementNotFoundError ||
    exception instanceof BenefitAllocationNotFoundError ||
    exception instanceof ProviderRecognitionNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof BenefitEntitlementVersionConflictError ||
    exception instanceof BenefitEntitlementPeriodConflictError ||
    exception instanceof BenefitAdjustmentConflictError ||
    exception instanceof BenefitBudgetInsufficientError ||
    exception instanceof BenefitServiceNotEligibleError ||
    exception instanceof BenefitAllocationConflictError ||
    exception instanceof BenefitAllocationAlreadyReversedError ||
    exception instanceof BenefitProviderRecognitionRequiredError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidBenefitAdjustmentError ||
    exception instanceof InvalidBenefitAmountError ||
    exception instanceof InvalidBenefitDateError ||
    exception instanceof InvalidBenefitEntitlementError ||
    exception instanceof InvalidBenefitFundingSourceError ||
    exception instanceof InvalidBenefitWorklistQueryError ||
    exception instanceof InvalidProviderRecognitionError
  ) {
    status = 400;
    code = exception.code;
  } else if (exception instanceof ServicePriceScopeDeniedError) {
    status = 403;
    code = exception.code;
  } else if (
    exception instanceof ServiceNotFoundError ||
    exception instanceof ServiceCategoryNotFoundError ||
    exception instanceof ServicePriceNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof ServiceCategoryArchivedError ||
    exception instanceof ServiceDefinitionArchivedError ||
    exception instanceof ServicePriceConflictError
  ) {
    status = 409;
    code = exception.code;
  } else if (
    exception instanceof InvalidServiceAvailabilityError ||
    exception instanceof InvalidServiceCategoryError ||
    exception instanceof InvalidServiceDefinitionError ||
    exception instanceof InvalidServicePaginationError ||
    exception instanceof InvalidServicePriceError ||
    exception instanceof InvalidServicePriceQuantityError ||
    exception instanceof ServicePricingUnitMismatchError
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
    exception instanceof VisitAssignmentNotFoundError ||
    exception instanceof AvailabilityExceptionNotFoundError ||
    exception instanceof EmployeeUnavailabilityNotFoundError ||
    exception instanceof VisitSubstitutionNotFoundError ||
    exception instanceof TourNotFoundError
  ) {
    status = 404;
    code = exception.code;
  } else if (
    exception instanceof InvalidVisitDataError ||
    exception instanceof InvalidVisitServiceError ||
    exception instanceof InvalidVisitQueryError ||
    exception instanceof InvalidScheduleGenerationRangeError ||
    exception instanceof InvalidEmployeeUnavailabilityError ||
    exception instanceof InvalidEmployeeAvailabilityError ||
    exception instanceof InvalidVisitAssignmentError ||
    exception instanceof InvalidTourError ||
    exception instanceof InvalidSchedulingTimezoneError
  ) {
    status = 400;
    code = exception.code;
  } else if (
    exception instanceof InvalidVisitStatusError ||
    exception instanceof VisitCancelledError ||
    exception instanceof VisitOutsideProviderContextError ||
    exception instanceof VisitExecutionPlanningLockedError ||
    exception instanceof SchedulingVersionConflictError ||
    exception instanceof VisitClientConflictError ||
    exception instanceof VisitEmployeeConflictError ||
    exception instanceof VisitEmployeeUnavailableError ||
    exception instanceof VisitOutsideEmployeeAvailabilityError ||
    exception instanceof VisitTravelBufferConflictError ||
    exception instanceof VisitDailyPlanLimitError ||
    exception instanceof ActiveVisitSubstitutionError ||
    exception instanceof VisitSubstitutionStaleError ||
    exception instanceof TourVersionConflictError ||
    exception instanceof SchedulingConflictsError ||
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
  } else if (onboardingCode(exception)) {
    code = onboardingCode(exception)!;
    if (code.endsWith('_NOT_FOUND') || code === 'ONBOARDING_CLIENT_LINK_INVALID') {
      status = 404;
    } else if (
      code.includes('CONFLICT') ||
      code.includes('IMMUTABLE') ||
      code.includes('INVALID_TRANSITION') ||
      code.includes('READINESS_BLOCKED') ||
      code.includes('NOT_READY_FOR_ADMISSION') ||
      code.includes('FIRST_VISIT_STAGE') ||
      code.includes('CLIENT_LINK_REQUIRED') ||
      code.includes('FACILITY_REQUIRED') ||
      code.includes('CASE_CLOSED')
    ) {
      status = 409;
    } else {
      status = 400;
    }
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
  const schedulingConflicts =
    exception instanceof SchedulingConflictsError ? exception.conflicts : undefined;
  return {
    type: `https://care-platform.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    traceId,
    ...(conflictingInterval ? { conflictingInterval } : {}),
    ...(schedulingConflicts ? { conflicts: schedulingConflicts } : {}),
  };
}

function onboardingCode(exception: unknown): string | null {
  if (!(exception instanceof Error) || !('code' in exception)) return null;
  const code = exception.code;
  return typeof code === 'string' && code.startsWith('ONBOARDING_') ? code : null;
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
