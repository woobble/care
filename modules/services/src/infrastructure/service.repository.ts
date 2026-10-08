import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { facilities } from '@care/organizations';
import { serviceAvailability, serviceCategories, serviceDefinitions } from '../schema';
import type {
  ServiceAvailabilitySnapshot,
  ServiceCategoryData,
  ServiceCategorySnapshot,
  ServiceDefinitionSnapshot,
} from '../domain/service';

export interface ServiceReadScope {
  tenantWide: boolean;
  organizationIds: readonly string[];
  facilityIds: readonly string[];
}

export interface ServiceSearchFilter {
  tenantId: string;
  access: ServiceReadScope;
  text?: string;
  status?: 'active' | 'archived';
  categoryId?: string;
  organizationId?: string;
  facilityId?: string;
  serviceId?: string;
  validAt: string;
  validFrom?: string;
  validUntil?: string;
  page: number;
  pageSize: number;
}

export interface ServiceSearchItem {
  service: ServiceDefinitionSnapshot;
  categoryName: string;
  availabilityCount: number;
}

export class ServiceRepository {
  async listCategories(
    transaction: DatabaseTransaction,
    tenantId: string,
    includeArchived = false,
  ): Promise<ServiceCategorySnapshot[]> {
    const filters = [eq(serviceCategories.tenantId, tenantId)];
    if (!includeArchived) filters.push(eq(serviceCategories.status, 'active'));
    const rows = await transaction
      .select()
      .from(serviceCategories)
      .where(and(...filters))
      .orderBy(
        asc(serviceCategories.sortOrder),
        asc(serviceCategories.name),
        asc(serviceCategories.id),
      );
    return rows.map(toCategory);
  }

  async getCategory(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<ServiceCategorySnapshot | null> {
    const query = transaction
      .select()
      .from(serviceCategories)
      .where(and(eq(serviceCategories.tenantId, tenantId), eq(serviceCategories.id, id)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? toCategory(row) : null;
  }

  async insertCategory(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    input: ServiceCategoryData,
    now: Date,
  ): Promise<ServiceCategorySnapshot> {
    const [row] = await transaction
      .insert(serviceCategories)
      .values({
        id,
        tenantId,
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: 'active',
        sortOrder: input.sortOrder ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('Service category insert returned no row');
    return toCategory(row);
  }

  async updateCategory(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    input: ServiceCategoryData,
    now: Date,
  ): Promise<ServiceCategorySnapshot | null> {
    const [row] = await transaction
      .update(serviceCategories)
      .set({
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? null,
        updatedAt: now,
      })
      .where(and(eq(serviceCategories.tenantId, tenantId), eq(serviceCategories.id, id)))
      .returning();
    return row ? toCategory(row) : null;
  }

  async archiveCategory(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    now: Date,
  ): Promise<ServiceCategorySnapshot | null> {
    const [row] = await transaction
      .update(serviceCategories)
      .set({ status: 'archived', updatedAt: now })
      .where(and(eq(serviceCategories.tenantId, tenantId), eq(serviceCategories.id, id)))
      .returning();
    return row ? toCategory(row) : null;
  }

  async getDefinition(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<ServiceDefinitionSnapshot | null> {
    const query = transaction
      .select()
      .from(serviceDefinitions)
      .where(and(eq(serviceDefinitions.tenantId, tenantId), eq(serviceDefinitions.id, id)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? toDefinition(row) : null;
  }

  async insertDefinition(
    transaction: DatabaseTransaction,
    input: ServiceDefinitionSnapshot,
  ): Promise<void> {
    await transaction.insert(serviceDefinitions).values(toDefinitionRow(input));
  }

  async updateDefinition(
    transaction: DatabaseTransaction,
    input: ServiceDefinitionSnapshot,
  ): Promise<void> {
    await transaction
      .update(serviceDefinitions)
      .set(toDefinitionRow(input))
      .where(
        and(eq(serviceDefinitions.tenantId, input.tenantId), eq(serviceDefinitions.id, input.id)),
      );
  }

  async search(
    transaction: DatabaseTransaction,
    input: ServiceSearchFilter,
  ): Promise<{ items: ServiceSearchItem[]; total: number }> {
    const filters: SQL[] = [eq(serviceDefinitions.tenantId, input.tenantId)];
    filters.push(eq(serviceDefinitions.status, input.status ?? 'active'));
    if (input.validFrom) {
      filters.push(lte(serviceDefinitions.validFrom, input.validFrom));
      filters.push(
        input.validUntil
          ? or(
              isNull(serviceDefinitions.validUntil),
              gt(serviceDefinitions.validUntil, input.validUntil),
            )!
          : isNull(serviceDefinitions.validUntil),
      );
    } else {
      filters.push(lte(serviceDefinitions.validFrom, input.validAt));
      filters.push(
        or(
          isNull(serviceDefinitions.validUntil),
          gt(serviceDefinitions.validUntil, input.validAt),
        )!,
      );
    }
    if (input.categoryId) filters.push(eq(serviceDefinitions.categoryId, input.categoryId));
    if (input.serviceId) filters.push(eq(serviceDefinitions.id, input.serviceId));
    if (input.text?.trim()) {
      const escaped = input.text
        .trim()
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      const pattern = `%${escaped}%`;
      filters.push(
        or(ilike(serviceDefinitions.name, pattern), ilike(serviceDefinitions.code, pattern))!,
      );
    }

    const availabilityScope = this.availabilityScope(transaction, input);
    const availabilityQueryFilter = this.availabilityQueryFilter(transaction, input);
    const hasAvailabilityFilter =
      !input.access.tenantWide ||
      input.organizationId !== undefined ||
      input.facilityId !== undefined;
    const availabilityFilters = [
      eq(serviceAvailability.tenantId, input.tenantId),
      eq(serviceAvailability.serviceId, serviceDefinitions.id),
      eq(serviceAvailability.active, true),
      input.validFrom
        ? or(
            isNull(serviceAvailability.validFrom),
            lte(serviceAvailability.validFrom, input.validFrom),
          )!
        : or(
            isNull(serviceAvailability.validFrom),
            lte(serviceAvailability.validFrom, input.validAt),
          )!,
      input.validFrom
        ? input.validUntil
          ? or(
              isNull(serviceAvailability.validUntil),
              gt(serviceAvailability.validUntil, input.validUntil),
            )!
          : isNull(serviceAvailability.validUntil)
        : or(
            isNull(serviceAvailability.validUntil),
            gt(serviceAvailability.validUntil, input.validAt),
          )!,
      ...(availabilityScope ? [availabilityScope] : []),
      ...(availabilityQueryFilter ? [availabilityQueryFilter] : []),
    ];
    const rows = await transaction
      .select({
        service: serviceDefinitions,
        categoryName: serviceCategories.name,
        availabilityCount: count(serviceAvailability.id),
      })
      .from(serviceDefinitions)
      .innerJoin(
        serviceCategories,
        and(
          eq(serviceCategories.tenantId, serviceDefinitions.tenantId),
          eq(serviceCategories.id, serviceDefinitions.categoryId),
        ),
      )
      .leftJoin(serviceAvailability, and(...availabilityFilters))
      .where(and(...filters, ...(hasAvailabilityFilter ? [isNotNull(serviceAvailability.id)] : [])))
      .groupBy(serviceDefinitions.id, serviceCategories.name)
      .orderBy(asc(serviceDefinitions.code), asc(serviceDefinitions.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const totals = await transaction
      .select({ total: countDistinct(serviceDefinitions.id) })
      .from(serviceDefinitions)
      .innerJoin(
        serviceCategories,
        and(
          eq(serviceCategories.tenantId, serviceDefinitions.tenantId),
          eq(serviceCategories.id, serviceDefinitions.categoryId),
        ),
      )
      .leftJoin(serviceAvailability, and(...availabilityFilters))
      .where(
        and(...filters, ...(hasAvailabilityFilter ? [isNotNull(serviceAvailability.id)] : [])),
      );
    return {
      items: rows.map((row) => ({
        service: toDefinition(row.service),
        categoryName: row.categoryName,
        availabilityCount: Number(row.availabilityCount),
      })),
      total: Number(totals[0]?.total ?? 0),
    };
  }

  async listAvailability(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceId: string,
  ): Promise<ServiceAvailabilitySnapshot[]> {
    const rows = await transaction
      .select()
      .from(serviceAvailability)
      .where(
        and(
          eq(serviceAvailability.tenantId, tenantId),
          eq(serviceAvailability.serviceId, serviceId),
        ),
      )
      .orderBy(
        desc(serviceAvailability.active),
        asc(serviceAvailability.organizationId),
        asc(serviceAvailability.facilityId),
        desc(serviceAvailability.validFrom),
        asc(serviceAvailability.id),
      );
    return rows.map(toAvailability);
  }

  async replaceAvailability(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceId: string,
    items: readonly ServiceAvailabilitySnapshot[],
    now: Date,
  ): Promise<ServiceAvailabilitySnapshot[]> {
    await transaction
      .update(serviceAvailability)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(serviceAvailability.tenantId, tenantId),
          eq(serviceAvailability.serviceId, serviceId),
          eq(serviceAvailability.active, true),
        ),
      );
    if (items.length === 0) return [];
    const rows = await transaction
      .insert(serviceAvailability)
      .values(items.map(toAvailabilityRow))
      .returning();
    return rows.map(toAvailability);
  }

  private availabilityScope(
    transaction: DatabaseTransaction,
    input: ServiceSearchFilter,
  ): SQL | undefined {
    const scopes: SQL[] = [];
    if (input.access.organizationIds.length > 0) {
      scopes.push(inArray(serviceAvailability.organizationId, [...input.access.organizationIds]));
    }
    if (input.access.facilityIds.length > 0) {
      scopes.push(inArray(serviceAvailability.facilityId, [...input.access.facilityIds]));
      scopes.push(
        and(
          isNull(serviceAvailability.facilityId),
          inArray(
            serviceAvailability.organizationId,
            transaction
              .select({ organizationId: facilities.organizationId })
              .from(facilities)
              .where(
                and(
                  eq(facilities.tenantId, input.tenantId),
                  inArray(facilities.id, [...input.access.facilityIds]),
                ),
              ),
          ),
        )!,
      );
    }
    if (input.access.tenantWide && !input.organizationId && !input.facilityId) return undefined;
    return scopes.length > 0 ? or(...scopes) : undefined;
  }

  private availabilityQueryFilter(
    transaction: DatabaseTransaction,
    input: ServiceSearchFilter,
  ): SQL | undefined {
    const filters: SQL[] = [];
    if (input.organizationId) {
      filters.push(eq(serviceAvailability.organizationId, input.organizationId));
    }
    if (input.facilityId) {
      filters.push(
        or(
          eq(serviceAvailability.facilityId, input.facilityId),
          and(
            isNull(serviceAvailability.facilityId),
            inArray(
              serviceAvailability.organizationId,
              transaction
                .select({ organizationId: facilities.organizationId })
                .from(facilities)
                .where(
                  and(eq(facilities.tenantId, input.tenantId), eq(facilities.id, input.facilityId)),
                ),
            ),
          ),
        )!,
      );
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }
}

function toCategory(row: typeof serviceCategories.$inferSelect): ServiceCategorySnapshot {
  return { ...row };
}

function toDefinition(row: typeof serviceDefinitions.$inferSelect): ServiceDefinitionSnapshot {
  return { ...row };
}

function toDefinitionRow(input: ServiceDefinitionSnapshot) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    categoryId: input.categoryId,
    unit: input.unit,
    defaultDurationMinutes: input.defaultDurationMinutes ?? null,
    status: input.status,
    validFrom: input.validFrom,
    validUntil: input.validUntil ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toAvailability(row: typeof serviceAvailability.$inferSelect): ServiceAvailabilitySnapshot {
  return { ...row };
}

function toAvailabilityRow(input: ServiceAvailabilitySnapshot) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    serviceId: input.serviceId,
    organizationId: input.organizationId,
    facilityId: input.facilityId ?? null,
    active: input.active,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}
