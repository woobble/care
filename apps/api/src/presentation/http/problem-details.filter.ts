import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { ProblemDetails } from '@care/contracts';
import { AuthorizationDeniedError } from '@care/permissions';
import {
  ClientArchivedError,
  ClientNotFoundError,
  InvalidClientPersonalDataError,
  InvalidClientTransitionError,
  InvalidPaginationError,
} from '@care/clients';
import {
  DisabledUserError,
  InvitationNotPendingError,
  InvalidMembershipTransitionError,
  MembershipAlreadyActiveError,
  MembershipRevokedError,
  TenantAccessDeniedError,
  TenantAccessError,
} from '@care/identity';
import { FacilityNotFoundError, OrganizationNotFoundError } from '@care/organizations';
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
  } else if (exception instanceof ClientArchivedError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof InvalidClientTransitionError) {
    status = 409;
    code = exception.code;
  } else if (exception instanceof AuthorizationDeniedError) {
    status = 403;
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
    exception instanceof FacilityNotFoundError
  ) {
    status = 404;
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
