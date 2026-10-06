import { and, asc, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { facilities, organizationsTable } from '../../schema';
import type { FacilitySnapshot, OrganizationSnapshot } from '../../domain/organization';

export class OrganizationRepository {
  async listOrganizations(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<OrganizationSnapshot[]> {
    const rows = await transaction
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.tenantId, tenantId))
      .orderBy(asc(organizationsTable.name), asc(organizationsTable.id));
    return rows.map((row) => ({ ...row }));
  }

  async getOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
  ): Promise<OrganizationSnapshot | null> {
    const [row] = await transaction
      .select()
      .from(organizationsTable)
      .where(and(eq(organizationsTable.id, id), eq(organizationsTable.tenantId, tenantId)))
      .limit(1);
    return row ? { ...row } : null;
  }

  async listFacilities(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<FacilitySnapshot[]> {
    const rows = await transaction
      .select({
        id: facilities.id,
        tenantId: facilities.tenantId,
        organizationId: facilities.organizationId,
        organizationName: organizationsTable.name,
        name: facilities.name,
        createdAt: facilities.createdAt,
      })
      .from(facilities)
      .innerJoin(
        organizationsTable,
        and(
          eq(facilities.organizationId, organizationsTable.id),
          eq(facilities.tenantId, organizationsTable.tenantId),
        ),
      )
      .where(eq(facilities.tenantId, tenantId))
      .orderBy(asc(organizationsTable.name), asc(facilities.name), asc(facilities.id));
    return rows.map((row) => ({ ...row }));
  }

  async getFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
  ): Promise<FacilitySnapshot | null> {
    const [row] = await transaction
      .select({
        id: facilities.id,
        tenantId: facilities.tenantId,
        organizationId: facilities.organizationId,
        organizationName: organizationsTable.name,
        name: facilities.name,
        createdAt: facilities.createdAt,
      })
      .from(facilities)
      .innerJoin(
        organizationsTable,
        and(
          eq(facilities.organizationId, organizationsTable.id),
          eq(facilities.tenantId, organizationsTable.tenantId),
        ),
      )
      .where(and(eq(facilities.id, id), eq(facilities.tenantId, tenantId)))
      .limit(1);
    return row ? { ...row } : null;
  }
}
