import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { v7 as uuidv7 } from 'uuid';
import { createLogger } from '@care/logging';
import { apiMetrics } from '@app/api/operational-metrics';
import type { ApiRequest } from './request';

const VALID_REQUEST_ID = /^[\w.-]{1,128}$/;
const slowRequestThresholdMs = process.env.NODE_ENV === 'production' ? 1_000 : 500;

class ApiFastifyAdapter extends FastifyAdapter {
  override registerParserMiddleware(prefix?: string, rawBody?: boolean): void {
    super.registerParserMiddleware(prefix, rawBody);

    // Keep Express's empty JSON body behavior while retaining Fastify's secure parser.
    const fastify = this.getInstance();
    const { bodyLimit, onProtoPoisoning, onConstructorPoisoning } = fastify.initialConfig;
    const parseJson = fastify.getDefaultJsonParser(
      onProtoPoisoning ?? 'error',
      onConstructorPoisoning ?? 'error',
    );
    fastify.removeContentTypeParser('application/json');
    this.useBodyParser(
      'application/json',
      rawBody ?? false,
      bodyLimit === undefined ? {} : { bodyLimit },
      (request, payload, done) => {
        if (payload.length === 0) {
          done(null, {});
          return;
        }
        parseJson(request, payload.toString('utf8'), done);
      },
    );
  }
}

export function createApiFastifyAdapter(trustedProxyHops = 0): FastifyAdapter {
  return new ApiFastifyAdapter({
    trustProxy: trustedProxyHops > 0 ? (_address, hop) => hop < trustedProxyHops : false,
    multipart: true,
    genReqId(request: IncomingMessage | Http2ServerRequest) {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && VALID_REQUEST_ID.test(header) ? header : uuidv7();
    },
  });
}

export async function configureApiHttp(
  app: NestFastifyApplication,
  webOrigin: string,
  logger?: ReturnType<typeof createLogger>,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest('context', null as unknown as ApiRequest['context']);
  fastify.decorateRequest('identity', null as unknown as ApiRequest['identity']);
  fastify.decorateRequest('principal', null as unknown as ApiRequest['principal']);

  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  fastify.addHook('onRequest', async (request, reply) => {
    const apiRequest = request as ApiRequest;
    const requestId = String(request.id ?? uuidv7());
    const header = request.headers['x-correlation-id'];
    const correlationId =
      typeof header === 'string' && VALID_REQUEST_ID.test(header) ? header : requestId;
    request.headers['x-care-correlation-id'] = correlationId;
    apiRequest.context = { requestId, correlationId };
    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId);
    reply.header('Cache-Control', 'private, no-store');
    requestStartedAt.set(request, performance.now());
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const durationMs = performance.now() - (requestStartedAt.get(request) ?? performance.now());
    apiMetrics.recordHttpRequest({
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode,
      durationSeconds: durationMs / 1000,
    });
    if (logger) {
      logger.info(
        {
          req: {
            id: request.id,
            method: request.method,
            url: request.url.split('?', 1)[0],
          },
          res: { statusCode: reply.statusCode },
          responseTime: durationMs,
          correlationId: request.headers['x-care-correlation-id'],
        },
        'request completed',
      );
      if (durationMs >= slowRequestThresholdMs) {
        logger.warn(
          {
            req: {
              id: request.id,
              method: request.method,
              route: request.routeOptions.url ?? 'unmatched',
            },
            res: { statusCode: reply.statusCode },
            responseTime: durationMs,
            correlationId: request.headers['x-care-correlation-id'],
          },
          'slow API request',
        );
      }
    }
  });

  await app.register(helmet);
  app.enableCors({
    origin: webOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Tenant-Id',
      'X-Request-Id',
      'X-Correlation-Id',
    ],
    credentials: false,
  });
}
