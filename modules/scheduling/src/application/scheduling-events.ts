import type { AuditWriter } from '@care/audit';

import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction } from '@care/database';

import type { DomainEvent } from '@care/events';

import { type AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

type AuditContext = { ip?: string; userAgent?: string };

export class SchedulingEventWriter {
  constructor(
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    input: {
      event: DomainEvent;
      action: string;
      resourceType: string;
      resourceId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: input.event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: new Date(input.event.occurredAt),
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}
