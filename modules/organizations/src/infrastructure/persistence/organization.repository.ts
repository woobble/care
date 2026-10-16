import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';
import type {
  FacilityData,
  FacilitySnapshot,
  OrganizationData,
  OrganizationSnapshot,
  StructureStatus,
  TeamData,
  TeamSnapshot,
} from '@module/organizations/domain/organization';
import { facilities, organizationsTable, teams } from '@module/organizations/schema';

import {
  structureVisibilityPredicate,
  type StructureVisibilityGrant,
} from './organization-visibility';

export class OrganizationRepository {
  async searchOrganizations(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly StructureVisibilityGrant[],
    filter: {
      page: number;
      pageSize: number;
      ids?: string[];
      text?: string;
      status?: StructureStatus;
    },
  ) {
    const filters = [
      eq(organizationsTable.tenantId, tenantId),
      structureVisibilityPredicate('organization', tenantId, grants),
    ];
    if (filter.ids) filters.push(inArray(organizationsTable.id, filter.ids));
    if (filter.status) filters.push(eq(organizationsTable.status, filter.status));
    if (filter.text) {
      const pattern = `%${filter.text}%`;
      filters.push(
        or(
          ilike(organizationsTable.name, pattern),
          ilike(organizationsTable.legalName, pattern),
          ilike(organizationsTable.code, pattern),
        )!,
      );
    }
    const where = and(...filters);
    const [countRows, rows] = await Promise.all([
      transaction.select({ total: count() }).from(organizationsTable).where(where),
      transaction
        .select()
        .from(organizationsTable)
        .where(where)
        .orderBy(asc(organizationsTable.name), asc(organizationsTable.id))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map((row) => ({ ...row })),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages: Math.ceil(total / filter.pageSize),
    };
  }

  async searchFacilities(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly StructureVisibilityGrant[],
    filter: {
      page: number;
      pageSize: number;
      ids?: string[];
      text?: string;
      organizationId?: string;
      status?: StructureStatus;
    },
  ) {
    const filters = [
      eq(facilities.tenantId, tenantId),
      structureVisibilityPredicate('facility', tenantId, grants),
    ];
    if (filter.ids) filters.push(inArray(facilities.id, filter.ids));
    if (filter.organizationId) filters.push(eq(facilities.organizationId, filter.organizationId));
    if (filter.status) filters.push(eq(facilities.status, filter.status));
    if (filter.text) {
      const pattern = `%${filter.text}%`;
      filters.push(or(ilike(facilities.name, pattern), ilike(facilities.code, pattern))!);
    }
    const where = and(...filters);
    const from = () =>
      transaction
        .select({
          id: facilities.id,
          tenantId: facilities.tenantId,
          organizationId: facilities.organizationId,
          organizationName: organizationsTable.name,
          organizationStatus: organizationsTable.status,
          name: facilities.name,
          code: facilities.code,
          address: facilities.address,
          phone: facilities.phone,
          email: facilities.email,
          timezone: facilities.timezone,
          status: facilities.status,
          createdAt: facilities.createdAt,
          updatedAt: facilities.updatedAt,
        })
        .from(facilities)
        .innerJoin(
          organizationsTable,
          and(
            eq(facilities.organizationId, organizationsTable.id),
            eq(facilities.tenantId, organizationsTable.tenantId),
          ),
        );
    const [countRows, rows] = await Promise.all([
      transaction
        .select({ total: count() })
        .from(facilities)
        .innerJoin(
          organizationsTable,
          and(
            eq(facilities.organizationId, organizationsTable.id),
            eq(facilities.tenantId, organizationsTable.tenantId),
          ),
        )
        .where(where),
      from()
        .where(where)
        .orderBy(asc(organizationsTable.name), asc(facilities.name), asc(facilities.id))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map((row) => ({ ...row })),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages: Math.ceil(total / filter.pageSize),
    };
  }

  async searchTeams(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly StructureVisibilityGrant[],
    filter: {
      page: number;
      pageSize: number;
      ids?: string[];
      text?: string;
      organizationId?: string;
      facilityId?: string;
      status?: StructureStatus;
    },
  ) {
    const filters = [
      eq(teams.tenantId, tenantId),
      structureVisibilityPredicate('team', tenantId, grants),
    ];
    if (filter.ids) filters.push(inArray(teams.id, filter.ids));
    if (filter.organizationId) filters.push(eq(teams.organizationId, filter.organizationId));
    if (filter.facilityId) filters.push(eq(teams.facilityId, filter.facilityId));
    if (filter.status) filters.push(eq(teams.status, filter.status));
    if (filter.text) {
      const pattern = `%${filter.text}%`;
      filters.push(ilike(teams.name, pattern));
    }
    const where = and(...filters);
    const query = () =>
      transaction
        .select({
          id: teams.id,
          tenantId: teams.tenantId,
          organizationId: teams.organizationId,
          facilityId: teams.facilityId,
          name: teams.name,
          status: teams.status,
          organizationName: organizationsTable.name,
          organizationStatus: organizationsTable.status,
          facilityName: facilities.name,
          createdAt: teams.createdAt,
          updatedAt: teams.updatedAt,
        })
        .from(teams)
        .innerJoin(
          organizationsTable,
          and(
            eq(teams.tenantId, organizationsTable.tenantId),
            eq(teams.organizationId, organizationsTable.id),
          ),
        )
        .leftJoin(
          facilities,
          and(
            eq(teams.tenantId, facilities.tenantId),
            eq(teams.facilityId, facilities.id),
            eq(teams.organizationId, facilities.organizationId),
          ),
        );
    const [countRows, rows] = await Promise.all([
      transaction
        .select({ total: count() })
        .from(teams)
        .innerJoin(
          organizationsTable,
          and(
            eq(teams.tenantId, organizationsTable.tenantId),
            eq(teams.organizationId, organizationsTable.id),
          ),
        )
        .leftJoin(
          facilities,
          and(
            eq(teams.tenantId, facilities.tenantId),
            eq(teams.facilityId, facilities.id),
            eq(teams.organizationId, facilities.organizationId),
          ),
        )
        .where(where),
      query()
        .where(where)
        .orderBy(asc(organizationsTable.name), asc(teams.name), asc(teams.id))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map((row) => ({ ...row })),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages: Math.ceil(total / filter.pageSize),
    };
  }

  async listOrganizations(
    transaction: DatabaseTransaction,
    tenantId: string,
    status?: StructureStatus,
  ): Promise<OrganizationSnapshot[]> {
    const filters = [eq(organizationsTable.tenantId, tenantId)];
    if (status) filters.push(eq(organizationsTable.status, status));
    const rows = await transaction
      .select()
      .from(organizationsTable)
      .where(and(...filters))
      .orderBy(asc(organizationsTable.name), asc(organizationsTable.id));
    return rows.map((row) => ({ ...row }));
  }

  async getOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<OrganizationSnapshot | null> {
    const query = transaction
      .select()
      .from(organizationsTable)
      .where(and(eq(organizationsTable.id, id), eq(organizationsTable.tenantId, tenantId)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? { ...row } : null;
  }

  async createOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    data: OrganizationData,
    now: Date,
  ): Promise<OrganizationSnapshot> {
    const [row] = await transaction
      .insert(organizationsTable)
      .values({ id, tenantId, ...data, status: 'active', createdAt: now, updatedAt: now })
      .returning();
    if (!row) throw new Error('Organization insert returned no row');
    return { ...row };
  }

  async updateOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    changes: Partial<OrganizationData>,
    now: Date,
  ): Promise<OrganizationSnapshot | null> {
    const [row] = await transaction
      .update(organizationsTable)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(organizationsTable.tenantId, tenantId), eq(organizationsTable.id, id)))
      .returning();
    return row ? { ...row } : null;
  }

  async setOrganizationStatus(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: StructureStatus,
    now: Date,
  ): Promise<OrganizationSnapshot | null> {
    const [row] = await transaction
      .update(organizationsTable)
      .set({ status, updatedAt: now })
      .where(and(eq(organizationsTable.tenantId, tenantId), eq(organizationsTable.id, id)))
      .returning();
    return row ? { ...row } : null;
  }

  async hasActiveChildren(transaction: DatabaseTransaction, tenantId: string, id: string) {
    const [facilityCount] = await transaction
      .select({ total: count() })
      .from(facilities)
      .where(
        and(
          eq(facilities.tenantId, tenantId),
          eq(facilities.organizationId, id),
          eq(facilities.status, 'active'),
        ),
      );
    const [teamCount] = await transaction
      .select({ total: count() })
      .from(teams)
      .where(
        and(eq(teams.tenantId, tenantId), eq(teams.organizationId, id), eq(teams.status, 'active')),
      );
    return Number(facilityCount?.total ?? 0) > 0 || Number(teamCount?.total ?? 0) > 0;
  }

  async listFacilities(
    transaction: DatabaseTransaction,
    tenantId: string,
    filter: { organizationId?: string; status?: StructureStatus } = {},
  ): Promise<FacilitySnapshot[]> {
    const filters = [eq(facilities.tenantId, tenantId)];
    if (filter.organizationId) filters.push(eq(facilities.organizationId, filter.organizationId));
    if (filter.status) filters.push(eq(facilities.status, filter.status));
    const rows = await transaction
      .select({
        id: facilities.id,
        tenantId: facilities.tenantId,
        organizationId: facilities.organizationId,
        organizationName: organizationsTable.name,
        organizationStatus: organizationsTable.status,
        name: facilities.name,
        code: facilities.code,
        address: facilities.address,
        phone: facilities.phone,
        email: facilities.email,
        timezone: facilities.timezone,
        status: facilities.status,
        createdAt: facilities.createdAt,
        updatedAt: facilities.updatedAt,
      })
      .from(facilities)
      .innerJoin(
        organizationsTable,
        and(
          eq(facilities.organizationId, organizationsTable.id),
          eq(facilities.tenantId, organizationsTable.tenantId),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(organizationsTable.name), asc(facilities.name), asc(facilities.id));
    return rows.map((row) => ({ ...row }));
  }

  async getFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<FacilitySnapshot | null> {
    const query = transaction
      .select({
        id: facilities.id,
        tenantId: facilities.tenantId,
        organizationId: facilities.organizationId,
        organizationName: organizationsTable.name,
        organizationStatus: organizationsTable.status,
        name: facilities.name,
        code: facilities.code,
        address: facilities.address,
        phone: facilities.phone,
        email: facilities.email,
        timezone: facilities.timezone,
        status: facilities.status,
        createdAt: facilities.createdAt,
        updatedAt: facilities.updatedAt,
      })
      .from(facilities)
      .innerJoin(
        organizationsTable,
        and(
          eq(facilities.organizationId, organizationsTable.id),
          eq(facilities.tenantId, organizationsTable.tenantId),
        ),
      )
      .where(and(eq(facilities.id, id), eq(facilities.tenantId, tenantId)));
    if (lock) {
      await transaction
        .select({ id: facilities.id })
        .from(facilities)
        .where(and(eq(facilities.id, id), eq(facilities.tenantId, tenantId)))
        .for('update')
        .limit(1);
    }
    const [row] = await query.limit(1);
    return row ? { ...row } : null;
  }

  async createFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    data: FacilityData,
    now: Date,
  ): Promise<FacilitySnapshot | null> {
    await transaction
      .insert(facilities)
      .values({ id, tenantId, ...data, status: 'active', createdAt: now, updatedAt: now });
    return this.getFacility(transaction, tenantId, id);
  }

  async updateFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    changes: Partial<Omit<FacilityData, 'organizationId'>>,
    now: Date,
  ): Promise<FacilitySnapshot | null> {
    await transaction
      .update(facilities)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(facilities.tenantId, tenantId), eq(facilities.id, id)));
    return this.getFacility(transaction, tenantId, id);
  }

  async setFacilityStatus(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: StructureStatus,
    now: Date,
  ): Promise<FacilitySnapshot | null> {
    await transaction
      .update(facilities)
      .set({ status, updatedAt: now })
      .where(and(eq(facilities.tenantId, tenantId), eq(facilities.id, id)));
    return this.getFacility(transaction, tenantId, id);
  }

  async hasActiveTeamsForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean> {
    const [result] = await transaction
      .select({ total: count() })
      .from(teams)
      .where(
        and(
          eq(teams.tenantId, tenantId),
          eq(teams.facilityId, facilityId),
          eq(teams.status, 'active'),
        ),
      );
    return Number(result?.total ?? 0) > 0;
  }

  async listTeams(
    transaction: DatabaseTransaction,
    tenantId: string,
    filter: { organizationId?: string; facilityId?: string; status?: StructureStatus } = {},
  ): Promise<TeamSnapshot[]> {
    const filters = [eq(teams.tenantId, tenantId)];
    if (filter.organizationId) filters.push(eq(teams.organizationId, filter.organizationId));
    if (filter.facilityId) filters.push(eq(teams.facilityId, filter.facilityId));
    if (filter.status) filters.push(eq(teams.status, filter.status));
    const rows = await transaction
      .select({
        id: teams.id,
        tenantId: teams.tenantId,
        organizationId: teams.organizationId,
        facilityId: teams.facilityId,
        name: teams.name,
        status: teams.status,
        organizationName: organizationsTable.name,
        organizationStatus: organizationsTable.status,
        facilityName: facilities.name,
        createdAt: teams.createdAt,
        updatedAt: teams.updatedAt,
      })
      .from(teams)
      .innerJoin(
        organizationsTable,
        and(
          eq(teams.tenantId, organizationsTable.tenantId),
          eq(teams.organizationId, organizationsTable.id),
        ),
      )
      .leftJoin(
        facilities,
        and(
          eq(teams.tenantId, facilities.tenantId),
          eq(teams.facilityId, facilities.id),
          eq(teams.organizationId, facilities.organizationId),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(organizationsTable.name), asc(teams.name), asc(teams.id));
    return rows.map((row) => ({ ...row }));
  }

  async getTeam(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<TeamSnapshot | null> {
    const query = transaction
      .select({
        id: teams.id,
        tenantId: teams.tenantId,
        organizationId: teams.organizationId,
        facilityId: teams.facilityId,
        name: teams.name,
        status: teams.status,
        organizationName: organizationsTable.name,
        organizationStatus: organizationsTable.status,
        facilityName: facilities.name,
        createdAt: teams.createdAt,
        updatedAt: teams.updatedAt,
      })
      .from(teams)
      .innerJoin(
        organizationsTable,
        and(
          eq(teams.tenantId, organizationsTable.tenantId),
          eq(teams.organizationId, organizationsTable.id),
        ),
      )
      .leftJoin(
        facilities,
        and(
          eq(teams.tenantId, facilities.tenantId),
          eq(teams.facilityId, facilities.id),
          eq(teams.organizationId, facilities.organizationId),
        ),
      )
      .where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)));
    if (lock) {
      await transaction
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId)))
        .for('update')
        .limit(1);
    }
    const [row] = await query.limit(1);
    return row ? { ...row } : null;
  }

  async createTeam(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    data: TeamData,
    now: Date,
  ): Promise<TeamSnapshot | null> {
    await transaction
      .insert(teams)
      .values({ id, tenantId, ...data, status: 'active', createdAt: now, updatedAt: now });
    return this.getTeam(transaction, tenantId, id);
  }

  async updateTeam(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    changes: Partial<Pick<TeamData, 'name' | 'facilityId'>>,
    now: Date,
  ): Promise<TeamSnapshot | null> {
    await transaction
      .update(teams)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)));
    return this.getTeam(transaction, tenantId, id);
  }

  async setTeamStatus(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: StructureStatus,
    now: Date,
  ): Promise<TeamSnapshot | null> {
    await transaction
      .update(teams)
      .set({ status, updatedAt: now })
      .where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)));
    return this.getTeam(transaction, tenantId, id);
  }
}
