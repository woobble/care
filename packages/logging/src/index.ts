import pino, { type Logger } from 'pino';
import pinoHttp from 'pino-http';
import { v7 as uuidv7 } from 'uuid';

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'authorization',
        'accessToken',
        'refreshToken',
        'idToken',
        'client_secret',
        'password',
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
      ],
      censor: '[redacted]',
    },
  });
}

export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(request, response) {
      const header = request.headers['x-request-id'];
      const requestId =
        typeof header === 'string' && /^[\w.-]{1,128}$/.test(header) ? header : uuidv7();
      response.setHeader('x-request-id', requestId);
      return requestId;
    },
    customProps(request) {
      const requestHeader = request.headers['x-correlation-id'];
      const correlationId =
        typeof requestHeader === 'string' && /^[\w.-]{1,128}$/.test(requestHeader)
          ? requestHeader
          : request.id;
      const normalizedCorrelationId = String(correlationId);
      request.headers['x-care-correlation-id'] = normalizedCorrelationId;
      return { correlationId: normalizedCorrelationId };
    },
    serializers: {
      req(request) {
        return { id: request.id, method: request.method, url: request.url.split('?', 1)[0] };
      },
      res(response) {
        return { statusCode: response.statusCode };
      },
    },
  });
}

export function correlationIdFromRequest(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-care-correlation-id'];
  return typeof value === 'string' ? value : uuidv7();
}
