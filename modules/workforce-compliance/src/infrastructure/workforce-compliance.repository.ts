import { and, asc, count, desc, eq, exists, ilike, inArray, not, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import type { EmployeeVisibilityGrant } from '@care/employees';
import {
  employeeFacilityAssignments,
  employeeQualifications,
  employeeRecords,
  employeeTeamMemberships,
  qualificationDefinitions,
} from '@care/employees';
import { facilities, organizationsTable, teams, tenants } from '@care/organizations';
import type { CompetencyOperation } from '@care/permissions';
import {
  professionalCompetencyPolicies,
  professionalCompetencyPolicyRequirements,
  professionalCompetencyPolicyVersions,
} from '@care/competency-policies';
import { employeeVisibilityPredicate } from '@care/employees';
import { workforceComplianceSettings } from '../schema';

export const DEFAULT_WORKFORCE_COMPLIANCE_SETTINGS = {
  criticalDays: 30,
  warningDays: 90,
  reportingTimezone: 'Europe/Berlin',
} as const;

export interface WorkforceComplianceSettingsSnapshot {
  criticalDays: number;
  warningDays: number;
  reportingTimezone: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WorkforceComplianceEmployeeRecord {
  employeeId: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationTimezone: string | null;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive' | 'archived';
  employeeLinked: boolean;
}

export interface WorkforceComplianceQualificationRecord {
  assignmentId: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  employeeStatus: 'active' | 'inactive' | 'archived';
  organizationId: string | null;
  organizationName: string | null;
  organizationTimezone: string | null;
  qualificationId: string;
  qualificationName: string;
  qualificationCode: string | null;
  qualificationDefinitionStatus: 'active' | 'archived';
  assignmentStatus: 'active' | 'revoked';
  validFrom: string | null;
  validUntil: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface WorkforcePolicyRecord {
  id: string;
  operationKey: CompetencyOperation;
  latestVersion: number;
  createdAt: Date;
}

export interface WorkforcePolicyVersionRecord {
  id: string;
  policyId: string;
  operationKey: CompetencyOperation;
  version: number;
  requirementMode: 'ANY' | 'ALL';
  requirementCount: number;
  status: 'draft' | 'active' | 'inactive';
  createdAt: Date;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
}

export interface WorkforcePolicyRequirementRecord {
  policyVersionId: string;
  qualificationId: string;
  qualificationName: string | null;
  qualificationCode: string | null;
  qualificationDefinitionStatus: 'active' | 'archived' | null;
}

export interface WorkforceComplianceEmployeeFilters {
  text?: string;
  status?: 'active' | 'inactive' | 'archived';
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'firstName' | 'lastName';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkforceComplianceQualificationFilters {
  text?: string;
  qualificationId?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  assignmentStatus?: 'active' | 'revoked';
  status?: 'valid' | 'expiring_soon' | 'expired' | 'not_yet_valid' | 'revoked';
  expiresBefore?: string;
  expiresWithinDays?: number;
  asOf?: string;
  criticalDays?: number;
  warningDays?: number;
  reportingTimezone?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'priority' | 'qualificationName' | 'employeeName' | 'validUntil' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkforceComplianceQualificationWorklistRecord extends WorkforceComplianceQualificationRecord {
  complianceStatus: 'valid' | 'expiring_soon' | 'expired' | 'not_yet_valid' | 'revoked';
  asOf: string;
}

export class WorkforceComplianceRepository {
  async lockTenantSettings(transaction: DatabaseTransaction, tenantId: string): Promise<boolean> {
    const rows = await transaction
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for('update')
      .limit(1);
    return rows.length > 0;
  }

  async findSettings(
    transaction: DatabaseTransaction,
    tenantId: string,
    lock = false,
  ): Promise<WorkforceComplianceSettingsSnapshot | null> {
    const query = transaction
      .select({
        criticalDays: workforceComplianceSettings.criticalDays,
        warningDays: workforceComplianceSettings.warningDays,
        reportingTimezone: workforceComplianceSettings.reportingTimezone,
        version: workforceComplianceSettings.version,
        createdAt: workforceComplianceSettings.createdAt,
        updatedAt: workforceComplianceSettings.updatedAt,
      })
      .from(workforceComplianceSettings)
      .where(eq(workforceComplianceSettings.tenantId, tenantId));
    const rows = lock ? await query.for('update').limit(1) : await query.limit(1);
    return rows[0] ?? null;
  }

  async saveSettings(
    transaction: DatabaseTransaction,
    tenantId: string,
    settings: Pick<
      WorkforceComplianceSettingsSnapshot,
      'criticalDays' | 'warningDays' | 'reportingTimezone' | 'version'
    >,
    now: Date,
  ): Promise<WorkforceComplianceSettingsSnapshot> {
    const [row] = await transaction
      .insert(workforceComplianceSettings)
      .values({ tenantId, ...settings, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: workforceComplianceSettings.tenantId,
        set: {
          criticalDays: settings.criticalDays,
          warningDays: settings.warningDays,
          reportingTimezone: settings.reportingTimezone,
          version: settings.version,
          updatedAt: now,
        },
      })
      .returning({
        criticalDays: workforceComplianceSettings.criticalDays,
        warningDays: workforceComplianceSettings.warningDays,
        reportingTimezone: workforceComplianceSettings.reportingTimezone,
        version: workforceComplianceSettings.version,
        createdAt: workforceComplianceSettings.createdAt,
        updatedAt: workforceComplianceSettings.updatedAt,
      });
    if (!row) throw new Error('Workforce compliance settings upsert returned no row');
    return row;
  }

  async findTenantTimezone(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<string | null> {
    const [row] = await transaction
      .select({ timezone: workforceComplianceSettings.reportingTimezone })
      .from(workforceComplianceSettings)
      .where(eq(workforceComplianceSettings.tenantId, tenantId))
      .limit(1);
    return row?.timezone ?? null;
  }

  async pageVisibleEmployees(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
    filters: WorkforceComplianceEmployeeFilters,
  ): Promise<{ items: WorkforceComplianceEmployeeRecord[]; total: number }> {
    const where = this.employeeWhere(transaction, tenantId, grants, filters);
    const [totalRow] = await transaction
      .select({ total: count() })
      .from(employeeRecords)
      .where(where);
    const rows = await transaction
      .select({
        employeeId: employeeRecords.id,
        organizationId: employeeRecords.organizationId,
        organizationName: organizationsTable.name,
        organizationTimezone: organizationsTable.timezone,
        firstName: employeeRecords.firstName,
        lastName: employeeRecords.lastName,
        status: employeeRecords.status,
        employeeLinked: sql<boolean>`${employeeRecords.userId} IS NOT NULL`,
      })
      .from(employeeRecords)
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, employeeRecords.tenantId),
          eq(organizationsTable.id, employeeRecords.organizationId),
        ),
      )
      .where(where)
      .orderBy(...this.employeeOrder(filters.sortBy ?? 'lastName', filters.sortOrder ?? 'asc'))
      .limit(filters.pageSize ?? 25)
      .offset(((filters.page ?? 1) - 1) * (filters.pageSize ?? 25));
    return { items: rows, total: Number(totalRow?.total ?? 0) };
  }

  async findVisibleEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    grants: readonly EmployeeVisibilityGrant[],
  ): Promise<WorkforceComplianceEmployeeRecord | null> {
    const [row] = await transaction
      .select({
        employeeId: employeeRecords.id,
        organizationId: employeeRecords.organizationId,
        organizationName: organizationsTable.name,
        organizationTimezone: organizationsTable.timezone,
        firstName: employeeRecords.firstName,
        lastName: employeeRecords.lastName,
        status: employeeRecords.status,
        employeeLinked: sql<boolean>`${employeeRecords.userId} IS NOT NULL`,
      })
      .from(employeeRecords)
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, employeeRecords.tenantId),
          eq(organizationsTable.id, employeeRecords.organizationId),
        ),
      )
      .where(
        and(
          eq(employeeRecords.tenantId, tenantId),
          eq(employeeRecords.id, employeeId),
          employeeVisibilityPredicate(transaction, tenantId, grants),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async pageQualificationWorklist(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
    filters: WorkforceComplianceQualificationFilters,
  ): Promise<{ items: WorkforceComplianceQualificationWorklistRecord[]; total: number }> {
    const facilityTimezoneQuery = transaction
      .select({ timezone: facilities.timezone })
      .from(employeeFacilityAssignments)
      .innerJoin(
        facilities,
        and(
          eq(facilities.tenantId, employeeFacilityAssignments.tenantId),
          eq(facilities.id, employeeFacilityAssignments.facilityId),
        ),
      )
      .where(
        and(
          eq(employeeFacilityAssignments.tenantId, tenantId),
          eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
          eq(employeeFacilityAssignments.status, 'active'),
          eq(facilities.status, 'active'),
          this.facilityTimezoneSelection(transaction, tenantId, grants, filters.facilityId),
        ),
      )
      .orderBy(
        desc(employeeFacilityAssignments.isPrimary),
        desc(employeeFacilityAssignments.createdAt),
        asc(employeeFacilityAssignments.facilityId),
      )
      .limit(1);
    const timezone = sql<string>`COALESCE((${facilityTimezoneQuery}), ${organizationsTable.timezone}, ${filters.reportingTimezone ?? 'Europe/Berlin'})`;
    const asOf = filters.asOf
      ? sql<string>`${filters.asOf}::date`
      : sql<string>`timezone(${timezone}, now())::date`;
    const cutoff = filters.asOf
      ? sql<Date>`((${asOf} + 1)::timestamp AT TIME ZONE ${timezone})`
      : sql<Date>`now()`;
    const revokedByCutoff = filters.asOf
      ? sql`${employeeQualifications.revokedAt} < ${cutoff}`
      : sql`${employeeQualifications.revokedAt} <= ${cutoff}`;
    const createdByCutoff = filters.asOf
      ? sql`${employeeQualifications.createdAt} < ${cutoff}`
      : sql`${employeeQualifications.createdAt} <= ${cutoff}`;
    const assignmentStatus = sql<string>`CASE WHEN ${employeeQualifications.revokedAt} IS NOT NULL AND ${revokedByCutoff} THEN 'revoked' ELSE 'active' END`;
    const complianceStatus = sql<string>`CASE
      WHEN ${assignmentStatus} = 'revoked' THEN 'revoked'
      WHEN ${employeeQualifications.validFrom} IS NOT NULL AND ${employeeQualifications.validFrom} > ${asOf} THEN 'not_yet_valid'
      WHEN ${employeeQualifications.validUntil} IS NOT NULL AND ${employeeQualifications.validUntil} < ${asOf} THEN 'expired'
      WHEN ${employeeQualifications.validUntil} IS NOT NULL AND ${employeeQualifications.validUntil} <= (${asOf} + ${filters.warningDays ?? 90}::integer) THEN 'expiring_soon'
      ELSE 'valid'
    END`;
    const conditions: SQL[] = [
      eq(employeeQualifications.tenantId, tenantId),
      employeeVisibilityPredicate(transaction, tenantId, grants),
      createdByCutoff,
    ];
    if (filters.qualificationId) {
      conditions.push(eq(employeeQualifications.qualificationId, filters.qualificationId));
    }
    if (filters.employeeId)
      conditions.push(eq(employeeQualifications.employeeId, filters.employeeId));
    if (filters.organizationId) {
      conditions.push(eq(employeeRecords.organizationId, filters.organizationId));
    }
    if (filters.facilityId) {
      conditions.push(
        exists(
          transaction
            .select({ id: employeeFacilityAssignments.id })
            .from(employeeFacilityAssignments)
            .innerJoin(
              facilities,
              and(
                eq(facilities.tenantId, employeeFacilityAssignments.tenantId),
                eq(facilities.id, employeeFacilityAssignments.facilityId),
              ),
            )
            .where(
              and(
                eq(employeeFacilityAssignments.tenantId, tenantId),
                eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
                eq(employeeFacilityAssignments.facilityId, filters.facilityId),
                eq(employeeFacilityAssignments.status, 'active'),
                eq(facilities.status, 'active'),
              ),
            ),
        ),
      );
    }
    if (filters.teamId) {
      conditions.push(
        exists(
          transaction
            .select({ id: employeeTeamMemberships.id })
            .from(employeeTeamMemberships)
            .innerJoin(
              teams,
              and(
                eq(teams.tenantId, employeeTeamMemberships.tenantId),
                eq(teams.id, employeeTeamMemberships.teamId),
              ),
            )
            .where(
              and(
                eq(employeeTeamMemberships.tenantId, tenantId),
                eq(employeeTeamMemberships.employeeId, employeeRecords.id),
                eq(employeeTeamMemberships.teamId, filters.teamId),
                eq(employeeTeamMemberships.status, 'active'),
                eq(teams.status, 'active'),
              ),
            ),
        ),
      );
    }
    if (filters.assignmentStatus) {
      conditions.push(sql`${assignmentStatus} = ${filters.assignmentStatus}`);
    }
    if (filters.status) conditions.push(sql`${complianceStatus} = ${filters.status}`);
    if (filters.expiresBefore) {
      conditions.push(
        sql`${employeeQualifications.validUntil} IS NOT NULL AND ${employeeQualifications.validUntil} <= ${filters.expiresBefore}::date`,
      );
    }
    if (filters.expiresWithinDays !== undefined) {
      conditions.push(
        and(
          sql`${assignmentStatus} = 'active'`,
          sql`(${employeeQualifications.validFrom} IS NULL OR ${employeeQualifications.validFrom} <= ${asOf})`,
          sql`${employeeQualifications.validUntil} IS NOT NULL`,
          sql`${employeeQualifications.validUntil} >= ${asOf}`,
          sql`${employeeQualifications.validUntil} <= (${asOf} + ${filters.expiresWithinDays}::integer)`,
        )!,
      );
    }
    if (filters.text) {
      const search = `%${filters.text}%`;
      conditions.push(
        or(
          ilike(qualificationDefinitions.name, search),
          ilike(employeeRecords.firstName, search),
          ilike(employeeRecords.lastName, search),
        )!,
      );
    }
    const where = and(...conditions)!;
    const [totalRow] = await transaction
      .select({ total: count() })
      .from(employeeQualifications)
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, employeeQualifications.tenantId),
          eq(employeeRecords.id, employeeQualifications.employeeId),
        ),
      )
      .innerJoin(
        qualificationDefinitions,
        and(
          eq(qualificationDefinitions.tenantId, employeeQualifications.tenantId),
          eq(qualificationDefinitions.id, employeeQualifications.qualificationId),
        ),
      )
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, employeeRecords.tenantId),
          eq(organizationsTable.id, employeeRecords.organizationId),
        ),
      )
      .where(where);
    const sortBy = filters.sortBy ?? 'priority';
    const sortOrder = filters.sortOrder ?? 'asc';
    const expirySort =
      sortOrder === 'desc'
        ? desc(employeeQualifications.validUntil)
        : asc(employeeQualifications.validUntil);
    const orderBy =
      sortBy === 'priority'
        ? [
            sql<number>`CASE
              WHEN ${complianceStatus} = 'expired' THEN 0
              WHEN ${complianceStatus} = 'expiring_soon' AND ${employeeQualifications.validUntil} <= (${asOf} + ${filters.criticalDays ?? 30}::integer) THEN 1
              WHEN ${complianceStatus} = 'expiring_soon' THEN 2
              ELSE 3
            END ASC`,
            sql`CASE WHEN ${employeeQualifications.validUntil} IS NULL THEN 1 ELSE 0 END ASC`,
            asc(employeeQualifications.validUntil),
            asc(employeeQualifications.id),
          ]
        : sortBy === 'employeeName'
          ? sortOrder === 'desc'
            ? [
                desc(employeeRecords.lastName),
                desc(employeeRecords.firstName),
                asc(employeeQualifications.id),
              ]
            : [
                asc(employeeRecords.lastName),
                asc(employeeRecords.firstName),
                asc(employeeQualifications.id),
              ]
          : sortBy === 'qualificationName'
            ? sortOrder === 'desc'
              ? [desc(qualificationDefinitions.name), asc(employeeQualifications.id)]
              : [asc(qualificationDefinitions.name), asc(employeeQualifications.id)]
            : sortBy === 'status'
              ? [
                  sortOrder === 'desc' ? desc(complianceStatus) : asc(complianceStatus),
                  asc(employeeQualifications.id),
                ]
              : [expirySort, asc(employeeQualifications.id)];
    const rows = await transaction
      .select({
        assignmentId: employeeQualifications.id,
        employeeId: employeeRecords.id,
        employeeFirstName: employeeRecords.firstName,
        employeeLastName: employeeRecords.lastName,
        employeeStatus: employeeRecords.status,
        organizationId: employeeRecords.organizationId,
        organizationName: organizationsTable.name,
        organizationTimezone: organizationsTable.timezone,
        qualificationId: qualificationDefinitions.id,
        qualificationName: qualificationDefinitions.name,
        qualificationCode: qualificationDefinitions.code,
        qualificationDefinitionStatus: qualificationDefinitions.status,
        assignmentStatus,
        complianceStatus,
        asOf,
        validFrom: employeeQualifications.validFrom,
        validUntil: employeeQualifications.validUntil,
        createdAt: employeeQualifications.createdAt,
        revokedAt: employeeQualifications.revokedAt,
      })
      .from(employeeQualifications)
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, employeeQualifications.tenantId),
          eq(employeeRecords.id, employeeQualifications.employeeId),
        ),
      )
      .innerJoin(
        qualificationDefinitions,
        and(
          eq(qualificationDefinitions.tenantId, employeeQualifications.tenantId),
          eq(qualificationDefinitions.id, employeeQualifications.qualificationId),
        ),
      )
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, employeeRecords.tenantId),
          eq(organizationsTable.id, employeeRecords.organizationId),
        ),
      )
      .where(where)
      .orderBy(...orderBy)
      .limit(filters.pageSize ?? 25)
      .offset(((filters.page ?? 1) - 1) * (filters.pageSize ?? 25));
    return {
      items: rows.map((row) => ({
        ...row,
        assignmentStatus: row.assignmentStatus as 'active' | 'revoked',
        complianceStatus:
          row.complianceStatus as WorkforceComplianceQualificationWorklistRecord['complianceStatus'],
        asOf: String(row.asOf),
      })),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async listQualificationFacts(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeIds: readonly string[],
    grants: readonly EmployeeVisibilityGrant[],
    filters: WorkforceComplianceQualificationFilters = {},
  ): Promise<WorkforceComplianceQualificationRecord[]> {
    if (employeeIds.length === 0) return [];
    const conditions: SQL[] = [
      eq(employeeQualifications.tenantId, tenantId),
      inArray(employeeQualifications.employeeId, [...employeeIds]),
      employeeVisibilityPredicate(transaction, tenantId, grants),
    ];
    if (filters.qualificationId) {
      conditions.push(eq(employeeQualifications.qualificationId, filters.qualificationId));
    }
    if (filters.employeeId)
      conditions.push(eq(employeeQualifications.employeeId, filters.employeeId));
    if (filters.text) {
      const search = `%${filters.text}%`;
      conditions.push(
        or(
          ilike(qualificationDefinitions.name, search),
          ilike(employeeRecords.firstName, search),
          ilike(employeeRecords.lastName, search),
        )!,
      );
    }
    const rows = await transaction
      .select({
        assignmentId: employeeQualifications.id,
        employeeId: employeeRecords.id,
        employeeFirstName: employeeRecords.firstName,
        employeeLastName: employeeRecords.lastName,
        employeeStatus: employeeRecords.status,
        organizationId: employeeRecords.organizationId,
        organizationName: organizationsTable.name,
        organizationTimezone: organizationsTable.timezone,
        qualificationId: qualificationDefinitions.id,
        qualificationName: qualificationDefinitions.name,
        qualificationCode: qualificationDefinitions.code,
        qualificationDefinitionStatus: qualificationDefinitions.status,
        assignmentStatus: employeeQualifications.status,
        validFrom: employeeQualifications.validFrom,
        validUntil: employeeQualifications.validUntil,
        createdAt: employeeQualifications.createdAt,
        revokedAt: employeeQualifications.revokedAt,
      })
      .from(employeeQualifications)
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, employeeQualifications.tenantId),
          eq(employeeRecords.id, employeeQualifications.employeeId),
        ),
      )
      .innerJoin(
        qualificationDefinitions,
        and(
          eq(qualificationDefinitions.tenantId, employeeQualifications.tenantId),
          eq(qualificationDefinitions.id, employeeQualifications.qualificationId),
        ),
      )
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, employeeRecords.tenantId),
          eq(organizationsTable.id, employeeRecords.organizationId),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        asc(qualificationDefinitions.name),
        asc(employeeRecords.lastName),
        asc(employeeRecords.firstName),
        asc(employeeQualifications.createdAt),
        asc(employeeQualifications.id),
      );
    return rows;
  }

  async facilityTimezones(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeIds: readonly string[],
    grants: readonly EmployeeVisibilityGrant[],
    requestedFacilityId?: string,
  ): Promise<Map<string, string | null>> {
    if (employeeIds.length === 0) return new Map();
    const conditions: SQL[] = [
      eq(employeeFacilityAssignments.tenantId, tenantId),
      inArray(employeeFacilityAssignments.employeeId, [...employeeIds]),
      eq(employeeFacilityAssignments.status, 'active'),
      this.facilityTimezoneSelection(transaction, tenantId, grants, requestedFacilityId),
    ];
    const rows = await transaction
      .select({
        employeeId: employeeFacilityAssignments.employeeId,
        facilityId: employeeFacilityAssignments.facilityId,
        timezone: facilities.timezone,
        isPrimary: employeeFacilityAssignments.isPrimary,
        createdAt: employeeFacilityAssignments.createdAt,
      })
      .from(employeeFacilityAssignments)
      .innerJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, employeeFacilityAssignments.tenantId),
          eq(employeeRecords.id, employeeFacilityAssignments.employeeId),
        ),
      )
      .innerJoin(
        facilities,
        and(
          eq(facilities.tenantId, employeeFacilityAssignments.tenantId),
          eq(facilities.id, employeeFacilityAssignments.facilityId),
        ),
      )
      .where(
        and(
          ...conditions,
          eq(facilities.status, 'active'),
          employeeVisibilityPredicate(transaction, tenantId, grants),
        ),
      )
      .orderBy(
        asc(employeeFacilityAssignments.employeeId),
        desc(employeeFacilityAssignments.isPrimary),
        desc(employeeFacilityAssignments.createdAt),
        asc(employeeFacilityAssignments.facilityId),
      );
    const result = new Map<string, string | null>();
    for (const row of rows) {
      if (!result.has(row.employeeId)) result.set(row.employeeId, row.timezone);
    }
    return result;
  }

  private facilityTimezoneSelection(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
    requestedFacilityId?: string,
  ): SQL {
    if (requestedFacilityId) {
      return eq(employeeFacilityAssignments.facilityId, requestedFacilityId);
    }

    const facilityScopeIds = grants
      .filter((grant) => grant.scopeType === 'facility')
      .map((grant) => grant.scopeId);
    if (facilityScopeIds.length === 0) {
      return eq(employeeFacilityAssignments.isPrimary, true);
    }

    const broaderScope = this.broaderEmployeeVisibility(transaction, tenantId, grants);
    if (!broaderScope) {
      return inArray(employeeFacilityAssignments.facilityId, facilityScopeIds);
    }

    return or(
      and(broaderScope, eq(employeeFacilityAssignments.isPrimary, true)),
      and(not(broaderScope), inArray(employeeFacilityAssignments.facilityId, facilityScopeIds)),
    )!;
  }

  private broaderEmployeeVisibility(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
  ): SQL | null {
    if (grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === tenantId)) {
      return sql`true`;
    }

    const conditions: SQL[] = [];
    const organizationIds = grants
      .filter((grant) => grant.scopeType === 'organization')
      .map((grant) => grant.scopeId);
    if (organizationIds.length > 0) {
      conditions.push(inArray(employeeRecords.organizationId, organizationIds));
    }

    const teamIds = grants
      .filter((grant) => grant.scopeType === 'team')
      .map((grant) => grant.scopeId);
    if (teamIds.length > 0) {
      conditions.push(
        exists(
          transaction
            .select({ id: employeeTeamMemberships.id })
            .from(employeeTeamMemberships)
            .innerJoin(
              teams,
              and(
                eq(teams.tenantId, employeeTeamMemberships.tenantId),
                eq(teams.id, employeeTeamMemberships.teamId),
              ),
            )
            .where(
              and(
                eq(employeeTeamMemberships.tenantId, tenantId),
                eq(employeeTeamMemberships.employeeId, employeeRecords.id),
                inArray(employeeTeamMemberships.teamId, teamIds),
                eq(employeeTeamMemberships.status, 'active'),
                eq(teams.status, 'active'),
              ),
            ),
        ),
      );
    }

    return conditions.length > 0 ? or(...conditions)! : null;
  }

  async listPolicyFacts(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<{
    policies: WorkforcePolicyRecord[];
    versions: WorkforcePolicyVersionRecord[];
    requirements: WorkforcePolicyRequirementRecord[];
  }> {
    const policies = await transaction
      .select({
        id: professionalCompetencyPolicies.id,
        operationKey: professionalCompetencyPolicies.operationKey,
        latestVersion: professionalCompetencyPolicies.latestVersion,
        createdAt: professionalCompetencyPolicies.createdAt,
      })
      .from(professionalCompetencyPolicies)
      .where(eq(professionalCompetencyPolicies.tenantId, tenantId));
    if (policies.length === 0) return { policies, versions: [], requirements: [] };
    const versions = await transaction
      .select({
        id: professionalCompetencyPolicyVersions.id,
        policyId: professionalCompetencyPolicyVersions.policyId,
        operationKey: professionalCompetencyPolicyVersions.operationKey,
        version: professionalCompetencyPolicyVersions.version,
        requirementMode: professionalCompetencyPolicyVersions.requirementMode,
        requirementCount: professionalCompetencyPolicyVersions.requirementCount,
        status: professionalCompetencyPolicyVersions.status,
        createdAt: professionalCompetencyPolicyVersions.createdAt,
        activatedAt: professionalCompetencyPolicyVersions.activatedAt,
        deactivatedAt: professionalCompetencyPolicyVersions.deactivatedAt,
      })
      .from(professionalCompetencyPolicyVersions)
      .where(
        and(
          eq(professionalCompetencyPolicyVersions.tenantId, tenantId),
          inArray(
            professionalCompetencyPolicyVersions.policyId,
            policies.map((policy) => policy.id),
          ),
        ),
      );
    if (versions.length === 0) return { policies, versions, requirements: [] };
    const requirements = await transaction
      .select({
        policyVersionId: professionalCompetencyPolicyRequirements.policyVersionId,
        qualificationId: professionalCompetencyPolicyRequirements.qualificationDefinitionId,
        qualificationName: qualificationDefinitions.name,
        qualificationCode: qualificationDefinitions.code,
        qualificationDefinitionStatus: qualificationDefinitions.status,
      })
      .from(professionalCompetencyPolicyRequirements)
      .leftJoin(
        qualificationDefinitions,
        and(
          eq(qualificationDefinitions.tenantId, professionalCompetencyPolicyRequirements.tenantId),
          eq(
            qualificationDefinitions.id,
            professionalCompetencyPolicyRequirements.qualificationDefinitionId,
          ),
        ),
      )
      .where(
        and(
          eq(professionalCompetencyPolicyRequirements.tenantId, tenantId),
          inArray(
            professionalCompetencyPolicyRequirements.policyVersionId,
            versions.map((version) => version.id),
          ),
        ),
      );
    return { policies, versions, requirements };
  }

  private employeeWhere(
    transaction: DatabaseTransaction,
    tenantId: string,
    grants: readonly EmployeeVisibilityGrant[],
    filters: WorkforceComplianceEmployeeFilters,
  ): SQL {
    const conditions: SQL[] = [
      eq(employeeRecords.tenantId, tenantId),
      employeeVisibilityPredicate(transaction, tenantId, grants),
    ];
    if (filters.status) conditions.push(eq(employeeRecords.status, filters.status));
    if (filters.organizationId) {
      conditions.push(eq(employeeRecords.organizationId, filters.organizationId));
    }
    if (filters.facilityId) {
      conditions.push(
        exists(
          transaction
            .select({ id: employeeFacilityAssignments.id })
            .from(employeeFacilityAssignments)
            .innerJoin(
              facilities,
              and(
                eq(facilities.tenantId, employeeFacilityAssignments.tenantId),
                eq(facilities.id, employeeFacilityAssignments.facilityId),
              ),
            )
            .where(
              and(
                eq(employeeFacilityAssignments.tenantId, tenantId),
                eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
                eq(employeeFacilityAssignments.facilityId, filters.facilityId),
                eq(employeeFacilityAssignments.status, 'active'),
                eq(facilities.status, 'active'),
              ),
            ),
        ),
      );
    }
    if (filters.teamId) {
      conditions.push(
        exists(
          transaction
            .select({ id: employeeTeamMemberships.id })
            .from(employeeTeamMemberships)
            .innerJoin(
              teams,
              and(
                eq(teams.tenantId, employeeTeamMemberships.tenantId),
                eq(teams.id, employeeTeamMemberships.teamId),
              ),
            )
            .where(
              and(
                eq(employeeTeamMemberships.tenantId, tenantId),
                eq(employeeTeamMemberships.employeeId, employeeRecords.id),
                eq(employeeTeamMemberships.teamId, filters.teamId),
                eq(employeeTeamMemberships.status, 'active'),
                eq(teams.status, 'active'),
              ),
            ),
        ),
      );
    }
    if (filters.text) {
      const search = `%${filters.text}%`;
      conditions.push(
        or(ilike(employeeRecords.firstName, search), ilike(employeeRecords.lastName, search))!,
      );
    }
    return and(...conditions)!;
  }

  private employeeOrder(sortBy: 'firstName' | 'lastName', sortOrder: 'asc' | 'desc') {
    if (sortBy === 'firstName') {
      return sortOrder === 'desc'
        ? [desc(employeeRecords.firstName), desc(employeeRecords.lastName), asc(employeeRecords.id)]
        : [asc(employeeRecords.firstName), asc(employeeRecords.lastName), asc(employeeRecords.id)];
    }
    return sortOrder === 'desc'
      ? [desc(employeeRecords.lastName), desc(employeeRecords.firstName), asc(employeeRecords.id)]
      : [asc(employeeRecords.lastName), asc(employeeRecords.firstName), asc(employeeRecords.id)];
  }
}
