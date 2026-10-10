import { and, asc, count, desc, eq, exists, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import type {
  AgreementServiceSnapshot,
  AgreementStatus,
  ServiceAgreementSnapshot,
  Weekday,
} from '@module/service-agreements/domain/service-agreement';
import { agreementServices, agreements } from '@module/service-agreements/schema';

export interface AgreementReadScope {
  tenantWide: boolean;
  organizationIds: readonly string[];
  facilityIds: readonly string[];
}

export interface ServiceAgreementSearchFilter {
  tenantId: string;
  clientReadScope: AgreementReadScope;
  agreementReadScope: AgreementReadScope;
  clientId?: string;
  status?: AgreementStatus;
  organizationId?: string;
  facilityId?: string;
  validAt?: string;
  serviceDefinitionId?: string;
  page: number;
  pageSize: number;
  sortBy: 'validFrom' | 'createdAt' | 'status';
  sortOrder: 'asc' | 'desc';
}

export interface ServiceAgreementListRow {
  agreement: ServiceAgreementSnapshot;
  serviceCount: number;
}

export class ServiceAgreementRepository {
  async insertAgreement(
    transaction: DatabaseTransaction,
    snapshot: ServiceAgreementSnapshot,
  ): Promise<void> {
    await transaction.insert(agreements).values(toAgreementRow(snapshot));
  }

  async getAgreement(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<ServiceAgreementSnapshot | null> {
    const query = transaction
      .select()
      .from(agreements)
      .where(and(eq(agreements.tenantId, tenantId), eq(agreements.id, id)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? toAgreementSnapshot(row) : null;
  }

  async updateAgreement(
    transaction: DatabaseTransaction,
    snapshot: ServiceAgreementSnapshot,
  ): Promise<void> {
    await transaction
      .update(agreements)
      .set(toAgreementRow(snapshot))
      .where(and(eq(agreements.tenantId, snapshot.tenantId), eq(agreements.id, snapshot.id)));
  }

  async insertService(
    transaction: DatabaseTransaction,
    snapshot: AgreementServiceSnapshot,
  ): Promise<void> {
    await transaction.insert(agreementServices).values(toServiceRow(snapshot));
  }

  async getService(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    id: string,
    lock = false,
  ): Promise<AgreementServiceSnapshot | null> {
    const query = transaction
      .select()
      .from(agreementServices)
      .where(
        and(
          eq(agreementServices.tenantId, tenantId),
          eq(agreementServices.agreementId, agreementId),
          eq(agreementServices.id, id),
        ),
      );
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? toServiceSnapshot(row) : null;
  }

  async updateService(
    transaction: DatabaseTransaction,
    snapshot: AgreementServiceSnapshot,
  ): Promise<void> {
    await transaction
      .update(agreementServices)
      .set(toServiceRow(snapshot))
      .where(
        and(
          eq(agreementServices.tenantId, snapshot.tenantId),
          eq(agreementServices.agreementId, snapshot.agreementId),
          eq(agreementServices.id, snapshot.id),
        ),
      );
  }

  async listServices(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
  ): Promise<AgreementServiceSnapshot[]> {
    const rows = await transaction
      .select()
      .from(agreementServices)
      .where(
        and(
          eq(agreementServices.tenantId, tenantId),
          eq(agreementServices.agreementId, agreementId),
        ),
      )
      .orderBy(
        asc(agreementServices.status),
        asc(agreementServices.createdAt),
        asc(agreementServices.id),
      );
    return rows.map(toServiceSnapshot);
  }

  async activeServiceCount(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
  ): Promise<number> {
    const [row] = await transaction
      .select({ total: count() })
      .from(agreementServices)
      .where(
        and(
          eq(agreementServices.tenantId, tenantId),
          eq(agreementServices.agreementId, agreementId),
          eq(agreementServices.status, 'active'),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async hasActiveServiceDefinition(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    serviceDefinitionId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: agreementServices.id })
      .from(agreementServices)
      .where(
        and(
          eq(agreementServices.tenantId, tenantId),
          eq(agreementServices.agreementId, agreementId),
          eq(agreementServices.serviceDefinitionId, serviceDefinitionId),
          eq(agreementServices.status, 'active'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async endActiveServices(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(agreementServices)
      .set({ status: 'ended', endedAt: now, updatedAt: now })
      .where(
        and(
          eq(agreementServices.tenantId, tenantId),
          eq(agreementServices.agreementId, agreementId),
          eq(agreementServices.status, 'active'),
        ),
      );
  }

  async hasActiveOverlap(
    transaction: DatabaseTransaction,
    input: {
      tenantId: string;
      clientId: string;
      organizationId: string;
      facilityId: string;
      validFrom: string;
      validUntil: string | null;
      excludeId?: string;
    },
  ): Promise<boolean> {
    const filters: SQL[] = [
      eq(agreements.tenantId, input.tenantId),
      eq(agreements.clientId, input.clientId),
      eq(agreements.organizationId, input.organizationId),
      eq(agreements.facilityId, input.facilityId),
      eq(agreements.status, 'active'),
      or(isNull(agreements.validUntil), gte(agreements.validUntil, input.validFrom))!,
      input.validUntil ? lte(agreements.validFrom, input.validUntil) : sql`true`,
    ];
    if (input.excludeId) filters.push(sql`${agreements.id} <> ${input.excludeId}`);
    const [row] = await transaction
      .select({ id: agreements.id })
      .from(agreements)
      .where(and(...filters))
      .limit(1);
    return row !== undefined;
  }

  async search(
    transaction: DatabaseTransaction,
    input: ServiceAgreementSearchFilter,
  ): Promise<{ items: ServiceAgreementListRow[]; total: number }> {
    const filters = buildFilters(input);
    const primary =
      input.sortBy === 'validFrom'
        ? input.sortOrder === 'asc'
          ? asc(agreements.validFrom)
          : desc(agreements.validFrom)
        : input.sortBy === 'createdAt'
          ? input.sortOrder === 'asc'
            ? asc(agreements.createdAt)
            : desc(agreements.createdAt)
          : input.sortOrder === 'asc'
            ? asc(agreements.status)
            : desc(agreements.status);
    const secondary =
      input.sortBy === 'status'
        ? [desc(agreements.createdAt), asc(agreements.id)]
        : [asc(agreements.id)];
    const rows = await transaction
      .select({ agreement: agreements, serviceCount: count(agreementServices.id) })
      .from(agreements)
      .leftJoin(
        agreementServices,
        and(
          eq(agreementServices.tenantId, agreements.tenantId),
          eq(agreementServices.agreementId, agreements.id),
          eq(agreementServices.status, 'active'),
        ),
      )
      .where(and(...filters))
      .groupBy(agreements.id)
      .orderBy(primary, ...secondary)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const totals = await transaction
      .select({ total: count() })
      .from(agreements)
      .where(and(...filters));
    return {
      items: rows.map((row) => ({
        agreement: toAgreementSnapshot(row.agreement),
        serviceCount: Number(row.serviceCount),
      })),
      total: Number(totals[0]?.total ?? 0),
    };
  }
}

function buildFilters(input: ServiceAgreementSearchFilter): SQL[] {
  const clientScope = scopeFilter(input.tenantId, input.clientReadScope);
  const agreementScope = scopeFilter(input.tenantId, input.agreementReadScope);
  const filters: SQL[] = [eq(agreements.tenantId, input.tenantId), clientScope, agreementScope];
  if (input.clientId) filters.push(eq(agreements.clientId, input.clientId));
  if (input.status) filters.push(eq(agreements.status, input.status));
  if (input.organizationId) filters.push(eq(agreements.organizationId, input.organizationId));
  if (input.facilityId) filters.push(eq(agreements.facilityId, input.facilityId));
  if (input.validAt) {
    filters.push(lte(agreements.validFrom, input.validAt));
    filters.push(or(isNull(agreements.validUntil), gte(agreements.validUntil, input.validAt))!);
  }
  if (input.serviceDefinitionId) {
    filters.push(
      exists(
        sql`select 1 from service_agreements.agreement_services s
             where s.tenant_id = ${agreements.tenantId}
               and s.agreement_id = ${agreements.id}
               and s.service_definition_id = ${input.serviceDefinitionId}`,
      ),
    );
  }
  return filters;
}

function scopeFilter(tenantId: string, scope: AgreementReadScope): SQL {
  const filters: SQL[] = [];
  if (scope.tenantWide) filters.push(eq(agreements.tenantId, tenantId));
  if (scope.organizationIds.length > 0) {
    filters.push(inArray(agreements.organizationId, [...scope.organizationIds]));
  }
  if (scope.facilityIds.length > 0) {
    filters.push(inArray(agreements.facilityId, [...scope.facilityIds]));
  }
  return or(...filters) ?? sql`false`;
}

function toAgreementRow(snapshot: ServiceAgreementSnapshot) {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    clientId: snapshot.clientId,
    organizationId: snapshot.organizationId,
    facilityId: snapshot.facilityId,
    status: snapshot.status,
    validFrom: snapshot.validFrom,
    validUntil: snapshot.validUntil,
    reference: snapshot.reference,
    description: snapshot.description,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function toAgreementSnapshot(row: typeof agreements.$inferSelect): ServiceAgreementSnapshot {
  return { ...row };
}

function toServiceRow(snapshot: AgreementServiceSnapshot) {
  const schedule = snapshot.scheduleRule;
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    agreementId: snapshot.agreementId,
    serviceDefinitionId: snapshot.serviceDefinitionId,
    serviceCode: snapshot.serviceCode,
    serviceName: snapshot.serviceName,
    serviceUnit: snapshot.serviceUnit,
    status: snapshot.status,
    validFrom: snapshot.validFrom,
    validUntil: snapshot.validUntil,
    quantity: snapshot.quantity,
    note: snapshot.note,
    scheduleType: schedule?.type ?? null,
    weekdays: schedule?.type === 'weekly' ? schedule.weekdays : null,
    occurrencesPerWeek: schedule?.type === 'occurrences_per_week' ? schedule.count : null,
    intervalDays: schedule?.type === 'interval_days' ? schedule.intervalDays : null,
    preferredTimeStart: snapshot.preferredTimeStart,
    preferredTimeEnd: snapshot.preferredTimeEnd,
    endedAt: snapshot.endedAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function toServiceSnapshot(row: typeof agreementServices.$inferSelect): AgreementServiceSnapshot {
  let scheduleRule: AgreementServiceSnapshot['scheduleRule'] = null;
  if (row.scheduleType === 'daily' || row.scheduleType === 'on_demand') {
    scheduleRule = { type: row.scheduleType };
  } else if (row.scheduleType === 'weekly' && row.weekdays) {
    scheduleRule = { type: 'weekly', weekdays: row.weekdays as Weekday[] };
  } else if (row.scheduleType === 'occurrences_per_week' && row.occurrencesPerWeek !== null) {
    scheduleRule = { type: 'occurrences_per_week', count: row.occurrencesPerWeek };
  } else if (row.scheduleType === 'interval_days' && row.intervalDays !== null) {
    scheduleRule = { type: 'interval_days', intervalDays: row.intervalDays };
  }
  return {
    ...row,
    quantity: row.quantity,
    scheduleRule,
    preferredTimeStart: row.preferredTimeStart?.slice(0, 5) ?? null,
    preferredTimeEnd: row.preferredTimeEnd?.slice(0, 5) ?? null,
  };
}
