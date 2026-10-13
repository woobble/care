import { and, asc, count, desc, eq, exists, ilike, inArray, notExists, or, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import type { AuthorizationPrincipal } from '@care/permissions';
import { tenantMemberships, users } from '@care/identity';
import { facilities, organizationsTable, teams } from '@care/organizations';
import {
  employeeFacilityAssignments,
  employeeQualifications,
  employeeRecords,
  employeeSkills,
  employeeTeamMemberships,
  qualificationDefinitions,
  skillDefinitions,
} from '@module/employees/schema';
import type {
  EmployeeChanges,
  EmployeeDetailSnapshot,
  EmployeeListResult,
  EmployeeSnapshot,
  EmployeeUserLinkSnapshot,
  FacilityAssignmentSnapshot,
  QualificationDefinitionSnapshot,
  SkillDefinitionSnapshot,
  TeamMembershipSnapshot,
} from '@module/employees/domain/employee';
import { employeeVisibilityPredicate } from './employee-visibility';

export interface EmployeeSearch {
  tenantId: string;
  principal: AuthorizationPrincipal;
  text?: string;
  status?: 'active' | 'inactive' | 'archived';
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  userId?: string;
  ids?: string[];
  page: number;
  pageSize: number;
  sortBy: 'lastName' | 'firstName' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

export interface EmployeeReadContext {
  organizationId: string | null;
  facilityIds: string[];
  teamIds: string[];
}

export interface FacilityContext {
  id: string;
  organizationId: string;
  status: 'active' | 'archived';
  organizationStatus: 'active' | 'archived';
}

export interface TeamContext {
  id: string;
  organizationId: string;
  facilityId: string | null;
  status: 'active' | 'archived';
  organizationStatus: 'active' | 'archived';
  facilityStatus: 'active' | 'archived' | null;
}

export interface OrganizationContext {
  id: string;
  status: 'active' | 'archived';
}

export interface ActiveFacilityAssignment {
  id: string;
  facilityId: string;
  isPrimary: boolean;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: Date;
}

export class EmployeeRepository {
  async search(
    transaction: DatabaseTransaction,
    input: EmployeeSearch,
  ): Promise<EmployeeListResult> {
    const filters = this.searchFilters(transaction, input);
    const where = and(...filters);
    const totals = await transaction.select({ total: count() }).from(employeeRecords).where(where);

    const ordered =
      input.sortBy === 'firstName'
        ? input.sortOrder === 'desc'
          ? [
              desc(employeeRecords.firstName),
              desc(employeeRecords.lastName),
              asc(employeeRecords.id),
            ]
          : [asc(employeeRecords.firstName), asc(employeeRecords.lastName), asc(employeeRecords.id)]
        : input.sortBy === 'createdAt'
          ? input.sortOrder === 'desc'
            ? [desc(employeeRecords.createdAt), asc(employeeRecords.id)]
            : [asc(employeeRecords.createdAt), asc(employeeRecords.id)]
          : input.sortOrder === 'desc'
            ? [
                desc(employeeRecords.lastName),
                desc(employeeRecords.firstName),
                asc(employeeRecords.id),
              ]
            : [
                asc(employeeRecords.lastName),
                asc(employeeRecords.firstName),
                asc(employeeRecords.id),
              ];
    const rows = await transaction
      .select({
        id: employeeRecords.id,
        tenantId: employeeRecords.tenantId,
        organizationId: employeeRecords.organizationId,
        organizationName: organizationsTable.name,
        userId: employeeRecords.userId,
        firstName: employeeRecords.firstName,
        lastName: employeeRecords.lastName,
        preferredName: employeeRecords.preferredName,
        email: employeeRecords.email,
        phone: employeeRecords.phone,
        personnelNumber: employeeRecords.personnelNumber,
        employmentType: employeeRecords.employmentType,
        startDate: employeeRecords.startDate,
        endDate: employeeRecords.endDate,
        weeklyHours: employeeRecords.weeklyHours,
        status: employeeRecords.status,
        createdAt: employeeRecords.createdAt,
        updatedAt: employeeRecords.updatedAt,
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
      .orderBy(...ordered)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    return {
      items: rows.map((row) => ({ ...row })),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totals[0]?.total ?? 0),
    };
  }

  async findById(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<EmployeeSnapshot | null> {
    const query = transaction
      .select({
        id: employeeRecords.id,
        tenantId: employeeRecords.tenantId,
        organizationId: employeeRecords.organizationId,
        organizationName: organizationsTable.name,
        userId: employeeRecords.userId,
        firstName: employeeRecords.firstName,
        lastName: employeeRecords.lastName,
        preferredName: employeeRecords.preferredName,
        email: employeeRecords.email,
        phone: employeeRecords.phone,
        personnelNumber: employeeRecords.personnelNumber,
        employmentType: employeeRecords.employmentType,
        startDate: employeeRecords.startDate,
        endDate: employeeRecords.endDate,
        weeklyHours: employeeRecords.weeklyHours,
        status: employeeRecords.status,
        createdAt: employeeRecords.createdAt,
        updatedAt: employeeRecords.updatedAt,
      })
      .from(employeeRecords)
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, employeeRecords.tenantId),
          eq(organizationsTable.id, employeeRecords.organizationId),
        ),
      )
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.id, id)));
    if (lock) {
      await transaction
        .select({ id: employeeRecords.id })
        .from(employeeRecords)
        .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.id, id)))
        .for('update')
        .limit(1);
    }
    const [row] = await query.limit(1);
    return row ? { ...row } : null;
  }

  async insert(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    data: {
      organizationId: string;
      firstName: string;
      lastName: string;
      preferredName: string | null;
      email: string | null;
      phone: string | null;
      personnelNumber: string | null;
      employmentType: string | null;
      startDate: string | null;
      endDate: string | null;
      weeklyHours: number | null;
    },
    now: Date,
  ): Promise<EmployeeSnapshot> {
    await transaction.insert(employeeRecords).values({
      id,
      tenantId,
      ...data,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const employee = await this.findById(transaction, tenantId, id);
    if (!employee) throw new Error('Employee insert returned no row');
    return employee;
  }

  async update(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    changes: EmployeeChanges,
    now: Date,
  ): Promise<EmployeeSnapshot | null> {
    await transaction
      .update(employeeRecords)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.id, id)));
    return this.findById(transaction, tenantId, id);
  }

  async setStatus(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: 'active' | 'inactive' | 'archived',
    now: Date,
  ): Promise<EmployeeSnapshot | null> {
    await transaction
      .update(employeeRecords)
      .set({ status, updatedAt: now })
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.id, id)));
    return this.findById(transaction, tenantId, id);
  }

  async readContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeReadContext> {
    const employee = await this.findById(transaction, tenantId, employeeId);
    if (!employee) return { organizationId: null, facilityIds: [], teamIds: [] };
    const facilityRows = await transaction
      .select({ facilityId: employeeFacilityAssignments.facilityId })
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
          eq(employeeFacilityAssignments.employeeId, employeeId),
          eq(employeeFacilityAssignments.status, 'active'),
          eq(facilities.status, 'active'),
        ),
      );
    const teamRows = await transaction
      .select({ teamId: employeeTeamMemberships.teamId })
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
          eq(employeeTeamMemberships.employeeId, employeeId),
          eq(employeeTeamMemberships.status, 'active'),
          eq(teams.status, 'active'),
        ),
      );
    return {
      organizationId: employee.organizationId,
      facilityIds: facilityRows.map((row) => row.facilityId),
      teamIds: teamRows.map((row) => row.teamId),
    };
  }

  async detail(
    transaction: DatabaseTransaction,
    employee: EmployeeSnapshot,
  ): Promise<EmployeeDetailSnapshot> {
    const facilityAssignments = await this.facilityAssignments(
      transaction,
      employee.tenantId,
      employee.id,
    );
    const teamMemberships = await this.teamMemberships(transaction, employee.tenantId, employee.id);
    const qualifications = await this.qualifications(transaction, employee.tenantId, employee.id);
    const skills = await this.skills(transaction, employee.tenantId, employee.id);
    const linkedUser = await this.linkedUser(transaction, employee.tenantId, employee.userId);
    return {
      ...employee,
      facilityAssignments,
      teamMemberships,
      qualifications,
      skills,
      linkedUser,
    };
  }

  async facilityAssignments(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<FacilityAssignmentSnapshot[]> {
    const rows = await transaction
      .select({
        id: employeeFacilityAssignments.id,
        employeeId: employeeFacilityAssignments.employeeId,
        facilityId: facilities.id,
        facilityName: facilities.name,
        organizationId: facilities.organizationId,
        isPrimary: employeeFacilityAssignments.isPrimary,
        status: employeeFacilityAssignments.status,
        validFrom: employeeFacilityAssignments.validFrom,
        validUntil: employeeFacilityAssignments.validUntil,
        facilityStatus: facilities.status,
      })
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
          eq(employeeFacilityAssignments.employeeId, employeeId),
        ),
      )
      .orderBy(
        desc(employeeFacilityAssignments.isPrimary),
        asc(facilities.name),
        asc(facilities.id),
      );
    return rows.map((row) => ({ ...row }));
  }

  async teamMemberships(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<TeamMembershipSnapshot[]> {
    const rows = await transaction
      .select({
        id: employeeTeamMemberships.id,
        employeeId: employeeTeamMemberships.employeeId,
        teamId: teams.id,
        teamName: teams.name,
        facilityId: teams.facilityId,
        role: employeeTeamMemberships.role,
        status: employeeTeamMemberships.status,
        validFrom: employeeTeamMemberships.validFrom,
        validUntil: employeeTeamMemberships.validUntil,
        teamStatus: teams.status,
      })
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
          eq(employeeTeamMemberships.employeeId, employeeId),
        ),
      )
      .orderBy(asc(teams.name), asc(teams.id));
    return rows.map((row) => ({ ...row }));
  }

  async qualifications(transaction: DatabaseTransaction, tenantId: string, employeeId: string) {
    return transaction
      .select({
        id: employeeQualifications.id,
        qualificationId: qualificationDefinitions.id,
        name: qualificationDefinitions.name,
        code: qualificationDefinitions.code,
        description: qualificationDefinitions.description,
        validFrom: employeeQualifications.validFrom,
        validUntil: employeeQualifications.validUntil,
        issuer: employeeQualifications.issuer,
        status: qualificationDefinitions.status,
        assignmentStatus: employeeQualifications.status,
        revokedAt: employeeQualifications.revokedAt,
        updatedAt: employeeQualifications.updatedAt,
      })
      .from(employeeQualifications)
      .innerJoin(
        qualificationDefinitions,
        and(
          eq(qualificationDefinitions.tenantId, employeeQualifications.tenantId),
          eq(qualificationDefinitions.id, employeeQualifications.qualificationId),
        ),
      )
      .where(
        and(
          eq(employeeQualifications.tenantId, tenantId),
          eq(employeeQualifications.employeeId, employeeId),
        ),
      )
      .orderBy(
        asc(qualificationDefinitions.name),
        asc(qualificationDefinitions.id),
        asc(employeeQualifications.createdAt),
        asc(employeeQualifications.id),
      );
  }

  async skills(transaction: DatabaseTransaction, tenantId: string, employeeId: string) {
    return transaction
      .select({
        id: employeeSkills.id,
        skillId: skillDefinitions.id,
        name: skillDefinitions.name,
        code: skillDefinitions.code,
        description: skillDefinitions.description,
        status: skillDefinitions.status,
      })
      .from(employeeSkills)
      .innerJoin(
        skillDefinitions,
        and(
          eq(skillDefinitions.tenantId, employeeSkills.tenantId),
          eq(skillDefinitions.id, employeeSkills.skillId),
        ),
      )
      .where(and(eq(employeeSkills.tenantId, tenantId), eq(employeeSkills.employeeId, employeeId)))
      .orderBy(asc(skillDefinitions.name), asc(skillDefinitions.id));
  }

  async linkedUser(
    transaction: DatabaseTransaction,
    tenantId: string,
    userId: string | null,
  ): Promise<EmployeeUserLinkSnapshot | null> {
    if (!userId) return null;
    const rows = await transaction
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        membershipStatus: tenantMemberships.status,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
    const first = rows[0];
    if (!first) return null;
    return {
      id: first.id,
      displayName: first.displayName,
      email: first.email,
      membershipStatus: first.membershipStatus,
    };
  }

  async linkableUsers(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<Array<{ id: string; displayName: string | null; email: string | null }>> {
    return transaction
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(users.status, 'active'),
          notExists(
            transaction
              .select({ id: employeeRecords.id })
              .from(employeeRecords)
              .where(
                and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.userId, users.id)),
              ),
          ),
        ),
      )
      .orderBy(asc(users.displayName), asc(users.email), asc(users.id))
      .limit(100);
  }

  async hasActiveMembership(
    transaction: DatabaseTransaction,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, 'active'),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async employeeLinkedToUser(
    transaction: DatabaseTransaction,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .select({ id: employeeRecords.id })
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  async organizationContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<OrganizationContext | null> {
    const [row] = await transaction
      .select({ id: organizationsTable.id, status: organizationsTable.status })
      .from(organizationsTable)
      .where(
        and(eq(organizationsTable.tenantId, tenantId), eq(organizationsTable.id, organizationId)),
      )
      .limit(1);
    return row ? { ...row } : null;
  }

  async setUserLink(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    userId: string | null,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(employeeRecords)
      .set({ userId, updatedAt: now })
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.id, employeeId)));
  }

  async facilityContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<FacilityContext | null> {
    const [row] = await transaction
      .select({
        id: facilities.id,
        organizationId: facilities.organizationId,
        status: facilities.status,
        organizationStatus: organizationsTable.status,
      })
      .from(facilities)
      .innerJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, facilities.tenantId),
          eq(organizationsTable.id, facilities.organizationId),
        ),
      )
      .where(and(eq(facilities.tenantId, tenantId), eq(facilities.id, facilityId)))
      .limit(1);
    return row ? { ...row } : null;
  }

  async activeFacilityAssignments(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    lock = false,
  ): Promise<ActiveFacilityAssignment[]> {
    const query = transaction
      .select({
        id: employeeFacilityAssignments.id,
        facilityId: employeeFacilityAssignments.facilityId,
        isPrimary: employeeFacilityAssignments.isPrimary,
        validFrom: employeeFacilityAssignments.validFrom,
        validUntil: employeeFacilityAssignments.validUntil,
        createdAt: employeeFacilityAssignments.createdAt,
      })
      .from(employeeFacilityAssignments)
      .where(
        and(
          eq(employeeFacilityAssignments.tenantId, tenantId),
          eq(employeeFacilityAssignments.employeeId, employeeId),
          eq(employeeFacilityAssignments.status, 'active'),
        ),
      )
      .orderBy(asc(employeeFacilityAssignments.createdAt), asc(employeeFacilityAssignments.id));
    const rows = lock ? await query.for('update') : await query;
    return rows.map((row) => ({ ...row }));
  }

  async createFacilityAssignment(
    transaction: DatabaseTransaction,
    input: {
      id: string;
      tenantId: string;
      organizationId: string;
      employeeId: string;
      facilityId: string;
      isPrimary: boolean;
      validFrom: string | null;
      validUntil: string | null;
      now: Date;
    },
  ): Promise<void> {
    await transaction.insert(employeeFacilityAssignments).values({
      ...input,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  async updateActiveFacilityAssignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    facilityId: string,
    changes: {
      isPrimary?: boolean;
      validFrom?: string | null;
      validUntil?: string | null;
    },
    now: Date,
  ): Promise<void> {
    await transaction
      .update(employeeFacilityAssignments)
      .set({ ...changes, updatedAt: now })
      .where(
        and(
          eq(employeeFacilityAssignments.tenantId, tenantId),
          eq(employeeFacilityAssignments.employeeId, employeeId),
          eq(employeeFacilityAssignments.facilityId, facilityId),
          eq(employeeFacilityAssignments.status, 'active'),
        ),
      );
  }

  async deactivateFacilityAssignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    facilityId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await transaction
      .update(employeeFacilityAssignments)
      .set({ status: 'inactive', isPrimary: false, updatedAt: now })
      .where(
        and(
          eq(employeeFacilityAssignments.tenantId, tenantId),
          eq(employeeFacilityAssignments.employeeId, employeeId),
          eq(employeeFacilityAssignments.facilityId, facilityId),
          eq(employeeFacilityAssignments.status, 'active'),
        ),
      )
      .returning({ id: employeeFacilityAssignments.id });
    return rows.length > 0;
  }

  async setPrimaryFacilityAssignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    facilityId: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(employeeFacilityAssignments)
      .set({ isPrimary: true, updatedAt: now })
      .where(
        and(
          eq(employeeFacilityAssignments.tenantId, tenantId),
          eq(employeeFacilityAssignments.employeeId, employeeId),
          eq(employeeFacilityAssignments.facilityId, facilityId),
          eq(employeeFacilityAssignments.status, 'active'),
        ),
      );
  }

  async setOtherFacilityAssignmentsNonPrimary(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    exceptFacilityId: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .update(employeeFacilityAssignments)
      .set({ isPrimary: false, updatedAt: now })
      .where(
        and(
          eq(employeeFacilityAssignments.tenantId, tenantId),
          eq(employeeFacilityAssignments.employeeId, employeeId),
          eq(employeeFacilityAssignments.status, 'active'),
          sql`${employeeFacilityAssignments.facilityId} <> ${exceptFacilityId}::uuid`,
        ),
      );
  }

  async teamContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    teamId: string,
  ): Promise<TeamContext | null> {
    const [row] = await transaction
      .select({
        id: teams.id,
        organizationId: teams.organizationId,
        facilityId: teams.facilityId,
        status: teams.status,
        organizationStatus: organizationsTable.status,
        facilityStatus: facilities.status,
      })
      .from(teams)
      .innerJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, teams.tenantId),
          eq(organizationsTable.id, teams.organizationId),
        ),
      )
      .leftJoin(
        facilities,
        and(eq(facilities.tenantId, teams.tenantId), eq(facilities.id, teams.facilityId)),
      )
      .where(and(eq(teams.tenantId, tenantId), eq(teams.id, teamId)))
      .limit(1);
    return row ? { ...row } : null;
  }

  async activeTeamMembership(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    teamId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(employeeTeamMemberships)
      .where(
        and(
          eq(employeeTeamMemberships.tenantId, tenantId),
          eq(employeeTeamMemberships.employeeId, employeeId),
          eq(employeeTeamMemberships.teamId, teamId),
          eq(employeeTeamMemberships.status, 'active'),
        ),
      );
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ?? null;
  }

  async createTeamMembership(
    transaction: DatabaseTransaction,
    input: {
      id: string;
      tenantId: string;
      organizationId: string;
      employeeId: string;
      teamId: string;
      role: string | null;
      validFrom: string | null;
      validUntil: string | null;
      now: Date;
    },
  ): Promise<void> {
    await transaction.insert(employeeTeamMemberships).values({
      ...input,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  async updateActiveTeamMembership(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    teamId: string,
    changes: { role?: string | null; validFrom?: string | null; validUntil?: string | null },
    now: Date,
  ): Promise<void> {
    await transaction
      .update(employeeTeamMemberships)
      .set({ ...changes, updatedAt: now })
      .where(
        and(
          eq(employeeTeamMemberships.tenantId, tenantId),
          eq(employeeTeamMemberships.employeeId, employeeId),
          eq(employeeTeamMemberships.teamId, teamId),
          eq(employeeTeamMemberships.status, 'active'),
        ),
      );
  }

  async deactivateTeamMembership(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    teamId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await transaction
      .update(employeeTeamMemberships)
      .set({ status: 'inactive', updatedAt: now })
      .where(
        and(
          eq(employeeTeamMemberships.tenantId, tenantId),
          eq(employeeTeamMemberships.employeeId, employeeId),
          eq(employeeTeamMemberships.teamId, teamId),
          eq(employeeTeamMemberships.status, 'active'),
        ),
      )
      .returning({ id: employeeTeamMemberships.id });
    return rows.length > 0;
  }

  async listQualifications(
    transaction: DatabaseTransaction,
    tenantId: string,
    status?: 'active' | 'archived',
  ): Promise<QualificationDefinitionSnapshot[]> {
    const filters = [eq(qualificationDefinitions.tenantId, tenantId)];
    if (status) filters.push(eq(qualificationDefinitions.status, status));
    return transaction
      .select()
      .from(qualificationDefinitions)
      .where(and(...filters))
      .orderBy(asc(qualificationDefinitions.name), asc(qualificationDefinitions.id));
  }

  async getQualification(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<QualificationDefinitionSnapshot | null> {
    const query = transaction
      .select()
      .from(qualificationDefinitions)
      .where(
        and(eq(qualificationDefinitions.tenantId, tenantId), eq(qualificationDefinitions.id, id)),
      );
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? { ...row } : null;
  }

  async createQualification(
    transaction: DatabaseTransaction,
    input: {
      id: string;
      tenantId: string;
      name: string;
      code: string | null;
      description: string | null;
      now: Date;
    },
  ): Promise<QualificationDefinitionSnapshot> {
    const [row] = await transaction
      .insert(qualificationDefinitions)
      .values({ ...input, status: 'active', createdAt: input.now, updatedAt: input.now })
      .returning();
    if (!row) throw new Error('Qualification insert returned no row');
    return { ...row };
  }

  async updateQualification(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    changes: Partial<Pick<QualificationDefinitionSnapshot, 'name' | 'code' | 'description'>>,
    now: Date,
  ): Promise<QualificationDefinitionSnapshot | null> {
    const [row] = await transaction
      .update(qualificationDefinitions)
      .set({ ...changes, updatedAt: now })
      .where(
        and(eq(qualificationDefinitions.tenantId, tenantId), eq(qualificationDefinitions.id, id)),
      )
      .returning();
    return row ? { ...row } : null;
  }

  async setQualificationStatus(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: 'active' | 'archived',
    now: Date,
  ): Promise<QualificationDefinitionSnapshot | null> {
    const [row] = await transaction
      .update(qualificationDefinitions)
      .set({ status, updatedAt: now })
      .where(
        and(eq(qualificationDefinitions.tenantId, tenantId), eq(qualificationDefinitions.id, id)),
      )
      .returning();
    return row ? { ...row } : null;
  }

  async addQualification(
    transaction: DatabaseTransaction,
    input: {
      id: string;
      tenantId: string;
      employeeId: string;
      qualificationId: string;
      validFrom: string | null;
      validUntil: string | null;
      issuer: string | null;
      now: Date;
    },
  ): Promise<void> {
    await transaction.insert(employeeQualifications).values({
      id: input.id,
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      qualificationId: input.qualificationId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      issuer: input.issuer,
      status: 'active',
      revokedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  async findEmployeeQualification(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    qualificationId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.tenantId, tenantId),
          eq(employeeQualifications.employeeId, employeeId),
          eq(employeeQualifications.qualificationId, qualificationId),
          eq(employeeQualifications.status, 'active'),
        ),
      );
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ?? null;
  }

  async updateEmployeeQualification(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    qualificationId: string,
    changes: { validFrom: string | null; validUntil: string | null; issuer: string | null },
    now: Date,
  ): Promise<void> {
    await transaction
      .update(employeeQualifications)
      .set({ ...changes, updatedAt: now })
      .where(
        and(
          eq(employeeQualifications.tenantId, tenantId),
          eq(employeeQualifications.employeeId, employeeId),
          eq(employeeQualifications.qualificationId, qualificationId),
          eq(employeeQualifications.status, 'active'),
        ),
      );
  }

  async removeQualification(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    qualificationId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await transaction
      .update(employeeQualifications)
      .set({ status: 'revoked', revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(employeeQualifications.tenantId, tenantId),
          eq(employeeQualifications.employeeId, employeeId),
          eq(employeeQualifications.qualificationId, qualificationId),
          eq(employeeQualifications.status, 'active'),
        ),
      )
      .returning({ id: employeeQualifications.id });
    return rows.length > 0;
  }

  async listSkills(
    transaction: DatabaseTransaction,
    tenantId: string,
    status?: 'active' | 'archived',
  ): Promise<SkillDefinitionSnapshot[]> {
    const filters = [eq(skillDefinitions.tenantId, tenantId)];
    if (status) filters.push(eq(skillDefinitions.status, status));
    return transaction
      .select()
      .from(skillDefinitions)
      .where(and(...filters))
      .orderBy(asc(skillDefinitions.name), asc(skillDefinitions.id));
  }

  async getSkill(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<SkillDefinitionSnapshot | null> {
    const query = transaction
      .select()
      .from(skillDefinitions)
      .where(and(eq(skillDefinitions.tenantId, tenantId), eq(skillDefinitions.id, id)));
    const [row] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return row ? { ...row } : null;
  }

  async createSkill(
    transaction: DatabaseTransaction,
    input: {
      id: string;
      tenantId: string;
      name: string;
      code: string | null;
      description: string | null;
      now: Date;
    },
  ): Promise<SkillDefinitionSnapshot> {
    const [row] = await transaction
      .insert(skillDefinitions)
      .values({ ...input, status: 'active', createdAt: input.now, updatedAt: input.now })
      .returning();
    if (!row) throw new Error('Skill insert returned no row');
    return { ...row };
  }

  async updateSkill(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    changes: Partial<Pick<SkillDefinitionSnapshot, 'name' | 'code' | 'description'>>,
    now: Date,
  ): Promise<SkillDefinitionSnapshot | null> {
    const [row] = await transaction
      .update(skillDefinitions)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(skillDefinitions.tenantId, tenantId), eq(skillDefinitions.id, id)))
      .returning();
    return row ? { ...row } : null;
  }

  async setSkillStatus(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    status: 'active' | 'archived',
    now: Date,
  ): Promise<SkillDefinitionSnapshot | null> {
    const [row] = await transaction
      .update(skillDefinitions)
      .set({ status, updatedAt: now })
      .where(and(eq(skillDefinitions.tenantId, tenantId), eq(skillDefinitions.id, id)))
      .returning();
    return row ? { ...row } : null;
  }

  async addSkill(
    transaction: DatabaseTransaction,
    input: { id: string; tenantId: string; employeeId: string; skillId: string; now: Date },
  ): Promise<void> {
    await transaction.insert(employeeSkills).values({
      id: input.id,
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      skillId: input.skillId,
      createdAt: input.now,
    });
  }

  async removeSkill(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    skillId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .delete(employeeSkills)
      .where(
        and(
          eq(employeeSkills.tenantId, tenantId),
          eq(employeeSkills.employeeId, employeeId),
          eq(employeeSkills.skillId, skillId),
        ),
      )
      .returning({ id: employeeSkills.id });
    return rows.length > 0;
  }

  async hasQualification(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    qualificationId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .select({ id: employeeQualifications.id })
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.tenantId, tenantId),
          eq(employeeQualifications.employeeId, employeeId),
          eq(employeeQualifications.qualificationId, qualificationId),
          eq(employeeQualifications.status, 'active'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async hasSkill(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    skillId: string,
  ): Promise<boolean> {
    const rows = await transaction
      .select({ id: employeeSkills.id })
      .from(employeeSkills)
      .where(
        and(
          eq(employeeSkills.tenantId, tenantId),
          eq(employeeSkills.employeeId, employeeId),
          eq(employeeSkills.skillId, skillId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async existingDefinitions(
    transaction: DatabaseTransaction,
    tenantId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await transaction
      .select({ id: qualificationDefinitions.id })
      .from(qualificationDefinitions)
      .where(
        and(
          eq(qualificationDefinitions.tenantId, tenantId),
          inArray(qualificationDefinitions.id, ids),
        ),
      );
    return rows.map((row) => row.id);
  }

  private searchFilters(transaction: DatabaseTransaction, input: EmployeeSearch) {
    const visibleScopes = input.principal.grants
      .filter(
        (grant) => grant.permission === 'employee.read' || grant.permission === 'employee.manage',
      )
      .map(({ scopeType, scopeId }) => ({ scopeType, scopeId }));
    const filters = [
      eq(employeeRecords.tenantId, input.tenantId),
      employeeVisibilityPredicate(transaction, input.tenantId, visibleScopes),
    ];
    if (input.ids) filters.push(inArray(employeeRecords.id, input.ids));
    if (input.status) filters.push(eq(employeeRecords.status, input.status));
    if (input.userId) filters.push(eq(employeeRecords.userId, input.userId));
    if (input.organizationId) {
      filters.push(eq(employeeRecords.organizationId, input.organizationId));
    }
    if (input.facilityId) {
      filters.push(
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
                eq(employeeFacilityAssignments.tenantId, input.tenantId),
                eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
                eq(employeeFacilityAssignments.facilityId, input.facilityId),
                eq(employeeFacilityAssignments.status, 'active'),
                eq(facilities.status, 'active'),
              ),
            ),
        ),
      );
    }
    if (input.teamId) {
      filters.push(
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
                eq(employeeTeamMemberships.tenantId, input.tenantId),
                eq(employeeTeamMemberships.employeeId, employeeRecords.id),
                eq(employeeTeamMemberships.teamId, input.teamId),
                eq(employeeTeamMemberships.status, 'active'),
                eq(teams.status, 'active'),
              ),
            ),
        ),
      );
    }
    if (input.text) {
      const pattern = `%${input.text}%`;
      filters.push(
        or(
          ilike(employeeRecords.firstName, pattern),
          ilike(employeeRecords.lastName, pattern),
          ilike(employeeRecords.personnelNumber, pattern),
        )!,
      );
    }
    return filters;
  }
}
