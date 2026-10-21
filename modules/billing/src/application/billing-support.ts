import { inArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { RequestContext } from '@care/contracts';

import { assertCan } from '@care/permissions';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';

import { invoices, payments } from '@module/billing/schema';

type AuditContext = { ip?: string; userAgent?: string };
type BillingPermission = Extract<Permission, `billing.${string}`>;
export function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function billingScopeConditions(
  principal: AuthorizationPrincipal,
  permission: 'billing.read' | 'billing.payments.read',
): SQL | null {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  if (
    grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
  ) {
    return sql`true`;
  }
  const organizations = grants
    .filter((grant) => grant.scopeType === 'organization')
    .map((grant) => grant.scopeId);
  const facilityScopeIds = grants
    .filter((grant) => grant.scopeType === 'facility')
    .map((grant) => grant.scopeId);
  const clauses: SQL[] = [];
  if (organizations.length) clauses.push(inArray(invoices.organizationId, organizations));
  if (facilityScopeIds.length) clauses.push(inArray(invoices.facilityId, facilityScopeIds));
  return or(...clauses) ?? null;
}

export function billingPaymentScopeConditions(principal: AuthorizationPrincipal): SQL | null {
  const grants = principal.grants.filter((grant) => grant.permission === 'billing.payments.read');
  if (
    grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
  ) {
    return sql`true`;
  }
  const organizations = grants
    .filter((grant) => grant.scopeType === 'organization')
    .map((grant) => grant.scopeId);
  return organizations.length ? inArray(payments.organizationId, organizations) : null;
}

export function requireOrganization(
  principal: AuthorizationPrincipal,
  action: BillingPermission,
  organizationId: string,
): void {
  assertCan(principal, {
    action,
    resource: { tenantId: principal.tenantId, organizationId },
  });
}
export function requireClient(
  principal: AuthorizationPrincipal,
  action: BillingPermission,
  clientId: string,
  organizationId: string,
  facilityId?: string | null,
): void {
  assertCan(principal, {
    action,
    resource: {
      tenantId: principal.tenantId,
      clientId,
      organizationId,
      ...(facilityId ? { facilityId } : {}),
    },
  });
}
export function auditRecord(
  principal: AuthorizationPrincipal,
  request: RequestContext,
  context: AuditContext,
  input: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  },
) {
  return {
    id: input.id,
    tenantId: principal.tenantId,
    actorId: principal.userId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    timestamp: new Date(),
    requestId: request.requestId,
    correlationId: request.correlationId,
    ...(context.ip ? { ip: context.ip } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    metadata: input.metadata,
  };
}
