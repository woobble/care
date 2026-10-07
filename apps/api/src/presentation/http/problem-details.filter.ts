import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { ProblemDetails } from '@care/contracts';
import { AuthorizationDeniedError } from '@care/permissions';
import {
  ClientArchivedError,
  ClientAddressNotFoundError,
  ClientContactNotFoundError,
  ClientInsuranceNotFoundError,
  ClientNotFoundError,
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
  FacilityArchivedError,
  FacilityHasActiveTeamsError,
  FacilityNotFoundError,
  InvalidTeamAssignmentError as InvalidStructureTeamAssignmentError,
  OrganizationArchivedError,
  OrganizationHasActiveChildrenError,
  OrganizationNotFoundError,
  TeamArchivedError,
  TeamNotFoundError,
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
} from '@care/services';
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
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    code = statusCode(status);
  }

  const title = titleFor(status);
  return {
    type: `https://care-platform.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    traceId,
  };
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
