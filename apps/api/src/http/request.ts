import type { FastifyRequest } from 'fastify';
import type { RequestContext, UUID } from '@care/contracts';
import type { AuthorizationPrincipal } from '@care/permissions';

declare module 'fastify' {
  interface FastifyRequest {
    context: RequestContext;
    identity?: { userId: string; issuer: string; subject: string };
    principal?: AuthorizationPrincipal;
  }
}

export interface ApiRequest extends FastifyRequest {}

export function requestContext(request: ApiRequest): RequestContext {
  return {
    ...request.context,
    ...(request.identity ? { userId: request.identity.userId as UUID } : {}),
    ...(request.principal ? { tenantId: request.principal.tenantId as UUID } : {}),
  };
}
