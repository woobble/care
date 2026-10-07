import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction } from '@care/database';
import type { DomainEvent } from '@care/events';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

export async function appendClientChange(input: {
  transaction: DatabaseTransaction;
  audit: AuditWriter;
  outbox: OutboxWriter;
  principal: AuthorizationPrincipal;
  context: RequestContext;
  auditContext: { ip?: string; userAgent?: string };
  clientId: string;
  occurredAt: Date;
  action: string;
  metadata: Record<string, unknown>;
  event: DomainEvent;
}): Promise<void> {
  await input.audit.append(input.transaction, {
    id: input.event.id,
    tenantId: input.principal.tenantId,
    actorId: input.principal.userId,
    action: input.action,
    resourceType: 'client',
    resourceId: input.clientId,
    timestamp: input.occurredAt,
    requestId: input.context.requestId,
    correlationId: input.context.correlationId,
    ...(input.auditContext.ip === undefined ? {} : { ip: input.auditContext.ip }),
    ...(input.auditContext.userAgent === undefined
      ? {}
      : { userAgent: input.auditContext.userAgent }),
    metadata: input.metadata,
  });
  await input.outbox.enqueue(input.transaction, input.event);
}
