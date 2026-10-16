import { and, asc, eq, gt, isNull, lt, lte, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { facilities } from '@care/organizations';
import { assertCan, AuthorizationDeniedError, can } from '@care/permissions';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  InvalidServicePriceError,
  ServicePriceConflictError,
  ServicePriceNotFoundError,
  ServicePriceScopeDeniedError,
  selectEffectiveServicePrice,
  validateServicePrice,
  type ServicePriceInput,
  type ServicePriceSnapshot,
} from '@module/services/domain/service-price';
import { serviceDefinitions, servicePrices } from '@module/services/schema';

type AuditContext = { ip?: string; userAgent?: string };

export class ServicePriceApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async list(
    principal: AuthorizationPrincipal,
    serviceId: string,
    input: { organizationId: string; facilityId?: string | null; validAt: string },
  ): Promise<ServicePriceSnapshot[]> {
    this.requireServiceRead(principal, input.organizationId, input.facilityId);
    if (!isIsoDate(input.validAt)) throw new InvalidServicePriceError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select()
        .from(servicePrices)
        .where(
          and(
            eq(servicePrices.tenantId, principal.tenantId),
            eq(servicePrices.serviceId, serviceId),
            eq(servicePrices.organizationId, input.organizationId),
            or(
              and(
                input.facilityId
                  ? eq(servicePrices.facilityId, input.facilityId)
                  : isNull(servicePrices.facilityId),
                lte(servicePrices.validFrom, input.validAt),
                or(isNull(servicePrices.validUntil), gt(servicePrices.validUntil, input.validAt)),
              ),
              ...(input.facilityId
                ? [
                    and(
                      isNull(servicePrices.facilityId),
                      lte(servicePrices.validFrom, input.validAt),
                      or(
                        isNull(servicePrices.validUntil),
                        gt(servicePrices.validUntil, input.validAt),
                      ),
                    ),
                  ]
                : []),
            ),
          ),
        )
        .orderBy(asc(servicePrices.facilityId), asc(servicePrices.validFrom));
      return rows.map(toSnapshot);
    });
  }

  async getEffective(
    principal: AuthorizationPrincipal,
    serviceId: string,
    input: { organizationId: string; facilityId?: string | null; validAt: string },
  ): Promise<ServicePriceSnapshot> {
    const prices = await this.list(principal, serviceId, input);
    const match = selectEffectiveServicePrice(prices, input);
    if (!match) throw new ServicePriceNotFoundError();
    return match;
  }

  /** Read the effective snapshot inside another domain's authorized transaction. */
  async getEffectiveForBilling(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceId: string,
    input: { organizationId: string; facilityId?: string | null; validAt: string },
  ): Promise<ServicePriceSnapshot | null> {
    if (!isIsoDate(input.validAt)) return null;
    const rows = await transaction
      .select()
      .from(servicePrices)
      .where(
        and(
          eq(servicePrices.tenantId, tenantId),
          eq(servicePrices.serviceId, serviceId),
          eq(servicePrices.organizationId, input.organizationId),
          lte(servicePrices.validFrom, input.validAt),
          or(isNull(servicePrices.validUntil), gt(servicePrices.validUntil, input.validAt)),
          input.facilityId
            ? or(eq(servicePrices.facilityId, input.facilityId), isNull(servicePrices.facilityId))
            : isNull(servicePrices.facilityId),
        ),
      )
      .orderBy(asc(servicePrices.facilityId), asc(servicePrices.validFrom));
    return selectEffectiveServicePrice(rows.map(toSnapshot), input) ?? null;
  }

  async create(
    principal: AuthorizationPrincipal,
    input: ServicePriceInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServicePriceSnapshot> {
    validateServicePrice(input);
    if (
      !can(principal, {
        action: 'service.manage_pricing',
        resource: {
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          ...(input.facilityId ? { facilityId: input.facilityId } : {}),
        },
      })
    ) {
      throw new AuthorizationDeniedError('service.manage_pricing');
    }

    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [service] = await transaction
        .select()
        .from(serviceDefinitions)
        .where(
          and(
            eq(serviceDefinitions.tenantId, principal.tenantId),
            eq(serviceDefinitions.id, input.serviceId),
          ),
        )
        .for('update')
        .limit(1);
      if (!service || service.status !== 'active') throw new ServicePriceNotFoundError();

      if (input.facilityId) {
        const [facility] = await transaction
          .select({ id: facilities.id })
          .from(facilities)
          .where(
            and(
              eq(facilities.tenantId, principal.tenantId),
              eq(facilities.organizationId, input.organizationId),
              eq(facilities.id, input.facilityId),
            ),
          )
          .limit(1);
        if (!facility) throw new ServicePriceScopeDeniedError();
      }

      const scope = and(
        eq(servicePrices.tenantId, principal.tenantId),
        eq(servicePrices.serviceId, input.serviceId),
        eq(servicePrices.organizationId, input.organizationId),
        input.facilityId
          ? eq(servicePrices.facilityId, input.facilityId)
          : isNull(servicePrices.facilityId),
      );
      const existing = await transaction.select().from(servicePrices).where(scope).for('update');
      if (
        existing.some((price) => price.validUntil === null && price.validFrom < input.validFrom)
      ) {
        await transaction
          .update(servicePrices)
          .set({ validUntil: input.validFrom })
          .where(
            and(
              scope,
              isNull(servicePrices.validUntil),
              lt(servicePrices.validFrom, input.validFrom),
            ),
          );
      }

      const id = uuidv7();
      let row: typeof servicePrices.$inferSelect | undefined;
      try {
        const inserted = await transaction
          .insert(servicePrices)
          .values({
            id,
            tenantId: principal.tenantId,
            serviceId: input.serviceId,
            organizationId: input.organizationId,
            facilityId: input.facilityId ?? null,
            priceCents: input.priceCents,
            pricingUnit: input.pricingUnit,
            validFrom: input.validFrom,
            validUntil: input.validUntil ?? null,
            createdBy: principal.userId,
            createdAt: now,
          })
          .returning();
        row = inserted[0];
      } catch (error) {
        if (hasConstraint(error, 'service_prices_no_overlap'))
          throw new ServicePriceConflictError();
        throw error;
      }
      if (!row) throw new Error('Service price insert returned no row');
      const event = createDomainEvent({
        type: 'service.price_recorded',
        tenantId: principal.tenantId,
        aggregateType: 'service',
        aggregateId: input.serviceId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: {
          serviceId: input.serviceId,
          priceId: id,
          organizationId: input.organizationId,
          facilityId: input.facilityId ?? null,
          priceCents: input.priceCents,
          pricingUnit: input.pricingUnit,
          validFrom: input.validFrom,
        },
      });
      await this.audit.append(transaction, {
        id: event.id,
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: event.type,
        resourceType: 'service',
        resourceId: input.serviceId,
        timestamp: now,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ...(auditContext.ip ? { ip: auditContext.ip } : {}),
        ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
        metadata: {
          priceId: id,
          priceCents: input.priceCents,
          pricingUnit: input.pricingUnit,
          organizationId: input.organizationId,
          facilityId: input.facilityId ?? null,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
        },
      });
      await this.outbox.enqueue(transaction, event);
      return toSnapshot(row);
    });
  }

  private requireServiceRead(
    principal: AuthorizationPrincipal,
    organizationId: string,
    facilityId?: string | null,
  ): void {
    assertCan(principal, {
      action: 'service.read',
      resource: {
        tenantId: principal.tenantId,
        organizationId,
        ...(facilityId ? { facilityId } : {}),
      },
    });
  }
}

function toSnapshot(row: typeof servicePrices.$inferSelect): ServicePriceSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serviceId: row.serviceId,
    organizationId: row.organizationId,
    facilityId: row.facilityId,
    priceCents: row.priceCents,
    pricingUnit: row.pricingUnit,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function hasConstraint(error: unknown, constraint: string): boolean {
  const candidate = error as { constraint?: unknown; cause?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') return false;
  return candidate.constraint === constraint || hasConstraint(candidate.cause, constraint);
}
