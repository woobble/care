import type { Request } from 'express';
import type { RequestContext, UUID } from '@care/contracts';
import type { AuthorizationPrincipal } from '@care/permissions';

export interface ApiRequest extends Request {
  context: RequestContext;
  identity?: { userId: string; issuer: string; subject: string };
  principal?: AuthorizationPrincipal;
}

export function requestContext(request: ApiRequest): RequestContext {
  return {
    ...request.context,
    ...(request.identity ? { userId: request.identity.userId as UUID } : {}),
    ...(request.principal ? { tenantId: request.principal.tenantId as UUID } : {}),
  };
}
