import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import type { ApiRequest } from './request';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: ApiRequest, response: Response, next: NextFunction): void {
    const requestId = String(request.id ?? uuidv7());
    const header = request.headers['x-correlation-id'];
    const correlationId =
      typeof header === 'string' && /^[\w.-]{1,128}$/.test(header) ? header : requestId;
    request.headers['x-care-correlation-id'] = correlationId;
    request.context = { requestId, correlationId };
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-correlation-id', correlationId);
    next();
  }
}
