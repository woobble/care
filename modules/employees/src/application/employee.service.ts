import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import { assertCan, can, type AuthorizationPrincipal, type Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { OrganizationArchivedError, OrganizationNotFoundError } from '@care/organizations';
import type {
  EmployeeChanges,
  EmployeeData,
  EmployeeDetailSnapshot,
  EmployeeSnapshot,
  EmployeeStatus,
  QualificationDefinitionSnapshot,
  SkillDefinitionSnapshot,
} from '../domain/employee';
import {
  CrossTenantReferenceError,
  EmployeeAlreadyLinkedError,
  EmployeeArchivedError,
  EmployeeConflictError,
  EmployeeNotFoundError,
  InvalidEmployeeDataError,
  InvalidEmployeePaginationError,
  InvalidFacilityAssignmentError,
  InvalidTeamAssignmentError,
  PrimaryFacilityRequiredError,
  QualificationArchivedError,
  QualificationNotFoundError,
  QualificationRequiredByActivePolicyError,
  SkillArchivedError,
  SkillNotFoundError,
  UserAlreadyLinkedError,
  isValidDateRange,
  transitionEmployeeStatus,
} from '../domain/employee';
import { EmployeeRepository } from '../infrastructure/persistence/employee.repository';

export interface EmployeeRequestMetadata {
  ip?: string;
  userAgent?: string;
}

export interface EmployeeSchedulingGuard {
  hasFutureAssignmentsForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<boolean>;
}

export interface EmployeeExecutionGuard {
  hasInProgressExecutionForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<boolean>;
}

export interface EmployeeQualificationPolicyGuard {
  isQualificationUsedByActivePolicy(
    transaction: DatabaseTransaction,
    tenantId: string,
    qualificationDefinitionId: string,
  ): Promise<boolean>;
}

export interface EmployeeSearchInput {
  text?: string;
  status?: EmployeeStatus;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'lastName' | 'firstName' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface FacilityAssignmentInput {
  isPrimary?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface TeamMembershipInput {
  role?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface QualificationInput {
  validFrom?: string | null;
  validUntil?: string | null;
  issuer?: string | null;
}

interface DefinitionInput {
  name: string;
  code: string | null;
  description: string | null;
}

type DefinitionChanges = Partial<DefinitionInput>;

export class EmployeeApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly qualificationPolicies: EmployeeQualificationPolicyGuard,
    private readonly employees: EmployeeRepository = new EmployeeRepository(),
    private readonly scheduling?: EmployeeSchedulingGuard,
    private readonly execution?: EmployeeExecutionGuard,
  ) {}

  async validateForScheduling(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    organizationId: string,
    facilityId: string,
    onDate: string,
  ): Promise<EmployeeSnapshot> {
    const employee = await this.requireEmployee(transaction, tenantId, employeeId, true);
    if (employee.status !== 'active') throw new EmployeeNotActiveForScheduleError();
    if (employee.organizationId !== organizationId) {
      throw new EmployeeNotAssignedToFacilityError();
    }
    const assignments = await this.employees.facilityAssignments(transaction, tenantId, employeeId);
    if (
      !assignments.some(
        (assignment) =>
          assignment.facilityId === facilityId &&
          assignment.organizationId === organizationId &&
          assignment.status === 'active' &&
          assignment.facilityStatus === 'active' &&
          (assignment.validFrom === null || assignment.validFrom <= onDate) &&
          (assignment.validUntil === null || assignment.validUntil >= onDate),
      )
    ) {
      throw new EmployeeNotAssignedToFacilityError();
    }
    return employee;
  }

  async getForSchedulingManagement(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    lock = false,
  ) {
    const employee = await this.requireEmployee(transaction, tenantId, employeeId, lock);
    const context = await this.employees.readContext(transaction, tenantId, employeeId);
    return { employee, ...context };
  }

  async search(
    principal: AuthorizationPrincipal,
    query: EmployeeSearchInput = {},
  ): Promise<{
    items: EmployeeSnapshot[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    this.requireGrant(principal, 'employee.read');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (query.text !== undefined && query.text.length > 120)
    ) {
      throw new InvalidEmployeePaginationError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.employees.search(transaction, {
        tenantId: principal.tenantId,
        principal,
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.organizationId === undefined ? {} : { organizationId: query.organizationId }),
        ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
        ...(query.teamId === undefined ? {} : { teamId: query.teamId }),
        page,
        pageSize,
        sortBy: query.sortBy ?? 'lastName',
        sortOrder: query.sortOrder ?? 'asc',
      }),
    );
  }

  async get(principal: AuthorizationPrincipal, id: string): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(transaction, principal.tenantId, id);
      const context = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.read', context);
      return this.detailForPrincipal(transaction, principal, employee, context);
    });
  }

  async create(
    principal: AuthorizationPrincipal,
    data: EmployeeData,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    this.validateEmployeeData(data);
    const now = new Date();
    const id = uuidv7();
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const organization = await this.employees.organizationContext(
            transaction,
            principal.tenantId,
            data.organizationId,
          );
          if (!organization) throw new OrganizationNotFoundError();
          if (organization.status === 'archived') throw new OrganizationArchivedError();
          this.authorize(principal, 'employee.create', {
            tenantId: principal.tenantId,
            organizationId: organization.id,
          });
          const employee = await this.employees.insert(
            transaction,
            principal.tenantId,
            id,
            data,
            now,
          );
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'employee.created',
            resourceType: 'employee',
            resourceId: id,
            timestamp: now,
            metadata: {
              organizationId: data.organizationId,
              changedFields: Object.keys(data),
            },
            event: createDomainEvent({
              type: 'employee.created',
              tenantId: principal.tenantId,
              aggregateType: 'employee',
              aggregateId: id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { employeeId: id, organizationId: data.organizationId },
            }),
          });
          return this.detailForPrincipal(
            transaction,
            principal,
            employee,
            this.emptyEmployeeContext(employee),
          );
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'employees_personnel_number_uq')) {
        throw new EmployeeConflictError('EMPLOYEE_PERSONNEL_NUMBER_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async update(
    principal: AuthorizationPrincipal,
    id: string,
    changes: EmployeeChanges,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const current = await this.requireEmployee(transaction, principal.tenantId, id, true);
          const resource = await this.employeeContext(transaction, principal.tenantId, current);
          this.authorize(principal, 'employee.update', resource);
          this.ensureWritable(current);
          this.validateEmployeeChanges(current, changes);
          const fields = Object.keys(changes);
          if (fields.length === 0) {
            return this.detailForPrincipal(transaction, principal, current, resource);
          }
          const now = new Date();
          const employee = await this.employees.update(
            transaction,
            principal.tenantId,
            id,
            changes,
            now,
          );
          if (!employee) throw new EmployeeNotFoundError();
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'employee.updated',
            resourceType: 'employee',
            resourceId: id,
            timestamp: now,
            metadata: { changedFields: fields },
            event: createDomainEvent({
              type: 'employee.updated',
              tenantId: principal.tenantId,
              aggregateType: 'employee',
              aggregateId: id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { employeeId: id, changedFields: fields },
            }),
          });
          return this.detailForPrincipal(
            transaction,
            principal,
            employee,
            await this.employeeContext(transaction, principal.tenantId, employee),
          );
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'employees_personnel_number_uq')) {
        throw new EmployeeConflictError('EMPLOYEE_PERSONNEL_NUMBER_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async activate(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.changeStatus(principal, id, 'activate', context, request);
  }

  async deactivate(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.changeStatus(principal, id, 'deactivate', context, request);
  }

  async archive(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.changeStatus(principal, id, 'archive', context, request);
  }

  async linkUser(
    principal: AuthorizationPrincipal,
    employeeId: string,
    userId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const employee = await this.requireEmployee(
            transaction,
            principal.tenantId,
            employeeId,
            true,
          );
          const resource = await this.employeeContext(transaction, principal.tenantId, employee);
          this.authorize(principal, 'employee.link_user', resource);
          this.ensureWritable(employee);
          if (employee.userId && employee.userId !== userId) {
            throw new EmployeeAlreadyLinkedError();
          }
          if (employee.userId === userId) {
            return this.detailForPrincipal(transaction, principal, employee, resource);
          }
          if (
            !(await this.employees.hasActiveMembership(transaction, principal.tenantId, userId))
          ) {
            throw new CrossTenantReferenceError();
          }
          if (await this.employees.employeeLinkedToUser(transaction, principal.tenantId, userId)) {
            throw new UserAlreadyLinkedError();
          }
          const now = new Date();
          await this.employees.setUserLink(
            transaction,
            principal.tenantId,
            employeeId,
            userId,
            now,
          );
          const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'employee.user_linked',
            resourceType: 'employee',
            resourceId: employeeId,
            timestamp: now,
            metadata: { userId },
            event: createDomainEvent({
              type: 'employee.user_linked',
              tenantId: principal.tenantId,
              aggregateType: 'employee',
              aggregateId: employeeId,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { employeeId, userId },
            }),
          });
          return this.detailForPrincipal(
            transaction,
            principal,
            updated,
            await this.employeeContext(transaction, principal.tenantId, updated),
          );
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'employees_user_per_tenant_uq')) {
        throw new UserAlreadyLinkedError();
      }
      throw error;
    }
  }

  async unlinkUser(
    principal: AuthorizationPrincipal,
    employeeId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.link_user', resource);
      this.ensureWritable(employee);
      if (!employee.userId)
        return this.detailForPrincipal(transaction, principal, employee, resource);
      const now = new Date();
      await this.employees.setUserLink(transaction, principal.tenantId, employeeId, null, now);
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.user_unlinked',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: {},
        event: createDomainEvent({
          type: 'employee.user_unlinked',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async listLinkableUsers(
    principal: AuthorizationPrincipal,
    employeeId: string,
  ): Promise<Array<{ id: string; displayName: string | null; email: string | null }>> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      const context = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.link_user', context);
      return this.employees.linkableUsers(transaction, principal.tenantId);
    });
  }

  async assignFacility(
    principal: AuthorizationPrincipal,
    employeeId: string,
    facilityId: string,
    input: FacilityAssignmentInput,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    this.validateDateRange(input.validFrom ?? null, input.validUntil ?? null);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.assign_facility', resource);
      this.ensureWritable(employee);
      if (employee.status !== 'active' || !employee.organizationId) {
        throw new InvalidFacilityAssignmentError();
      }
      const facility = await this.employees.facilityContext(
        transaction,
        principal.tenantId,
        facilityId,
      );
      if (
        !facility ||
        facility.organizationId !== employee.organizationId ||
        facility.status !== 'active' ||
        facility.organizationStatus !== 'active'
      ) {
        throw new InvalidFacilityAssignmentError();
      }
      this.authorize(principal, 'employee.assign_facility', {
        tenantId: principal.tenantId,
        organizationId: facility.organizationId,
        facilityId,
      });
      const all = await this.employees.facilityAssignments(
        transaction,
        principal.tenantId,
        employeeId,
      );
      const active = all.filter(
        (assignment) => assignment.status === 'active' && assignment.facilityStatus === 'active',
      );
      const existing = active.find((assignment) => assignment.facilityId === facilityId);
      const primary = input.isPrimary ?? existing?.isPrimary ?? active.length === 0;
      if (active.length === 0 && !primary) throw new PrimaryFacilityRequiredError();
      if (!active.some((assignment) => assignment.isPrimary) && active.length > 0 && !primary) {
        throw new PrimaryFacilityRequiredError();
      }
      const validFrom =
        input.validFrom === undefined ? (existing?.validFrom ?? null) : input.validFrom;
      const validUntil =
        input.validUntil === undefined ? (existing?.validUntil ?? null) : input.validUntil;
      this.validateDateRange(validFrom, validUntil);
      const unchanged =
        existing &&
        existing.isPrimary === primary &&
        existing.validFrom === validFrom &&
        existing.validUntil === validUntil;
      if (unchanged) return this.detailForPrincipal(transaction, principal, employee, resource);

      const now = new Date();
      const primaryWasChanged = primary !== (existing?.isPrimary ?? false);
      if (primary) {
        await this.employees.setOtherFacilityAssignmentsNonPrimary(
          transaction,
          principal.tenantId,
          employeeId,
          facilityId,
          now,
        );
      }
      if (existing) {
        await this.employees.updateActiveFacilityAssignment(
          transaction,
          principal.tenantId,
          employeeId,
          facilityId,
          { isPrimary: primary, validFrom, validUntil },
          now,
        );
      } else {
        await this.employees.createFacilityAssignment(transaction, {
          id: uuidv7(),
          tenantId: principal.tenantId,
          organizationId: employee.organizationId,
          employeeId,
          facilityId,
          isPrimary: primary,
          validFrom,
          validUntil,
          now,
        });
      }
      if (!primary && existing?.isPrimary) {
        const next = active.find((assignment) => assignment.facilityId !== facilityId);
        if (!next) throw new PrimaryFacilityRequiredError();
        await this.employees.setPrimaryFacilityAssignment(
          transaction,
          principal.tenantId,
          employeeId,
          next.facilityId,
          now,
        );
      }
      const operation = existing
        ? primaryWasChanged
          ? 'primary_changed'
          : 'assigned'
        : 'assigned';
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.facility_assigned',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { facilityId, isPrimary: primary, validFrom, validUntil },
        event: createDomainEvent({
          type: 'employee.facility_assignment_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, facilityId, operation },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async unassignFacility(
    principal: AuthorizationPrincipal,
    employeeId: string,
    facilityId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.assign_facility', resource);
      this.ensureWritable(employee);
      if (!employee.organizationId) throw new InvalidFacilityAssignmentError();
      const facility = await this.employees.facilityContext(
        transaction,
        principal.tenantId,
        facilityId,
      );
      if (!facility || facility.organizationId !== employee.organizationId) {
        throw new InvalidFacilityAssignmentError();
      }
      this.authorize(principal, 'employee.assign_facility', {
        tenantId: principal.tenantId,
        organizationId: facility.organizationId,
        facilityId,
      });
      const assignments = await this.employees.facilityAssignments(
        transaction,
        principal.tenantId,
        employeeId,
      );
      const target = assignments.find(
        (assignment) => assignment.facilityId === facilityId && assignment.status === 'active',
      );
      if (!target) return this.detailForPrincipal(transaction, principal, employee, resource);
      const now = new Date();
      await this.employees.deactivateFacilityAssignment(
        transaction,
        principal.tenantId,
        employeeId,
        facilityId,
        now,
      );
      let promotedFacilityId: string | undefined;
      if (target.isPrimary) {
        const next = assignments.find(
          (assignment) =>
            assignment.facilityId !== facilityId &&
            assignment.status === 'active' &&
            assignment.facilityStatus === 'active',
        );
        if (next) {
          await this.employees.setPrimaryFacilityAssignment(
            transaction,
            principal.tenantId,
            employeeId,
            next.facilityId,
            now,
          );
          promotedFacilityId = next.facilityId;
        }
      }
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.facility_unassigned',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { facilityId, ...(promotedFacilityId ? { promotedFacilityId } : {}) },
        event: createDomainEvent({
          type: 'employee.facility_assignment_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, facilityId, operation: 'unassigned' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async assignTeam(
    principal: AuthorizationPrincipal,
    employeeId: string,
    teamId: string,
    input: TeamMembershipInput,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    this.validateDateRange(input.validFrom ?? null, input.validUntil ?? null);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.assign_team', resource);
      this.ensureWritable(employee);
      if (employee.status !== 'active' || !employee.organizationId) {
        throw new InvalidTeamAssignmentError();
      }
      const team = await this.employees.teamContext(transaction, principal.tenantId, teamId);
      if (
        !team ||
        team.organizationId !== employee.organizationId ||
        team.status !== 'active' ||
        team.organizationStatus !== 'active' ||
        team.facilityStatus === 'archived'
      ) {
        throw new InvalidTeamAssignmentError();
      }
      const teamResource = {
        tenantId: principal.tenantId,
        organizationId: team.organizationId,
        ...(team.facilityId ? { facilityId: team.facilityId } : {}),
        teamId,
      };
      this.authorize(principal, 'employee.assign_team', teamResource);
      const existing = await this.employees.activeTeamMembership(
        transaction,
        principal.tenantId,
        employeeId,
        teamId,
        true,
      );
      const role = input.role === undefined ? (existing?.role ?? null) : input.role;
      const validFrom =
        input.validFrom === undefined ? (existing?.validFrom ?? null) : input.validFrom;
      const validUntil =
        input.validUntil === undefined ? (existing?.validUntil ?? null) : input.validUntil;
      this.validateDateRange(validFrom, validUntil);
      if (
        existing &&
        existing.role === role &&
        existing.validFrom === validFrom &&
        existing.validUntil === validUntil
      ) {
        return this.detailForPrincipal(transaction, principal, employee, resource);
      }
      const now = new Date();
      if (existing) {
        await this.employees.updateActiveTeamMembership(
          transaction,
          principal.tenantId,
          employeeId,
          teamId,
          { role, validFrom, validUntil },
          now,
        );
      } else {
        await this.employees.createTeamMembership(transaction, {
          id: uuidv7(),
          tenantId: principal.tenantId,
          organizationId: employee.organizationId,
          employeeId,
          teamId,
          role,
          validFrom,
          validUntil,
          now,
        });
      }
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.team_assigned',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { teamId, role, validFrom, validUntil },
        event: createDomainEvent({
          type: 'employee.team_membership_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, teamId, operation: 'assigned' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async unassignTeam(
    principal: AuthorizationPrincipal,
    employeeId: string,
    teamId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.assign_team', resource);
      this.ensureWritable(employee);
      const team = await this.employees.teamContext(transaction, principal.tenantId, teamId);
      if (!team || !employee.organizationId || team.organizationId !== employee.organizationId) {
        throw new InvalidTeamAssignmentError();
      }
      this.authorize(principal, 'employee.assign_team', {
        tenantId: principal.tenantId,
        organizationId: team.organizationId,
        ...(team.facilityId ? { facilityId: team.facilityId } : {}),
        teamId,
      });
      const existing = await this.employees.activeTeamMembership(
        transaction,
        principal.tenantId,
        employeeId,
        teamId,
        true,
      );
      if (!existing) return this.detailForPrincipal(transaction, principal, employee, resource);
      const now = new Date();
      await this.employees.deactivateTeamMembership(
        transaction,
        principal.tenantId,
        employeeId,
        teamId,
        now,
      );
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.team_unassigned',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { teamId },
        event: createDomainEvent({
          type: 'employee.team_membership_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, teamId, operation: 'unassigned' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async listQualifications(
    principal: AuthorizationPrincipal,
    status?: 'active' | 'archived',
  ): Promise<QualificationDefinitionSnapshot[]> {
    this.requireGrant(principal, 'employee.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.employees.listQualifications(transaction, principal.tenantId, status),
    );
  }

  async createQualification(
    principal: AuthorizationPrincipal,
    input: DefinitionInput,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<QualificationDefinitionSnapshot> {
    this.authorizeTenantManagement(principal, 'employee.manage_qualifications');
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const now = new Date();
          const id = uuidv7();
          const qualification = await this.employees.createQualification(transaction, {
            id,
            tenantId: principal.tenantId,
            ...input,
            now,
          });
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'qualification.created',
            resourceType: 'qualification',
            resourceId: id,
            timestamp: now,
            metadata: { changedFields: Object.keys(input) },
            event: createDomainEvent({
              type: 'qualification.created',
              tenantId: principal.tenantId,
              aggregateType: 'qualification',
              aggregateId: id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { qualificationId: id },
            }),
          });
          return qualification;
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'qualification_definitions_tenant_name_uq')) {
        throw new EmployeeConflictError('QUALIFICATION_ALREADY_EXISTS');
      }
      if (hasConstraint(error, 'qualification_definitions_tenant_code_uq')) {
        throw new EmployeeConflictError('QUALIFICATION_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async updateQualification(
    principal: AuthorizationPrincipal,
    id: string,
    changes: DefinitionChanges,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<QualificationDefinitionSnapshot> {
    this.authorizeTenantManagement(principal, 'employee.manage_qualifications');
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const current = await this.employees.getQualification(
            transaction,
            principal.tenantId,
            id,
            true,
          );
          if (!current) throw new QualificationNotFoundError();
          if (current.status === 'archived') throw new QualificationArchivedError();
          const fields = Object.keys(changes);
          if (fields.length === 0) return current;
          const now = new Date();
          const qualification = await this.employees.updateQualification(
            transaction,
            principal.tenantId,
            id,
            changes,
            now,
          );
          if (!qualification) throw new QualificationNotFoundError();
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'qualification.updated',
            resourceType: 'qualification',
            resourceId: id,
            timestamp: now,
            metadata: { changedFields: fields },
            event: createDomainEvent({
              type: 'qualification.updated',
              tenantId: principal.tenantId,
              aggregateType: 'qualification',
              aggregateId: id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { qualificationId: id, changedFields: fields },
            }),
          });
          return qualification;
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'qualification_definitions_tenant_name_uq')) {
        throw new EmployeeConflictError('QUALIFICATION_ALREADY_EXISTS');
      }
      if (hasConstraint(error, 'qualification_definitions_tenant_code_uq')) {
        throw new EmployeeConflictError('QUALIFICATION_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async archiveQualification(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<QualificationDefinitionSnapshot> {
    this.authorizeTenantManagement(principal, 'employee.manage_qualifications');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.employees.getQualification(
        transaction,
        principal.tenantId,
        id,
        true,
      );
      if (!current) throw new QualificationNotFoundError();
      if (current.status === 'archived') return current;
      if (
        await this.qualificationPolicies.isQualificationUsedByActivePolicy(
          transaction,
          principal.tenantId,
          id,
        )
      ) {
        throw new QualificationRequiredByActivePolicyError();
      }
      const now = new Date();
      const qualification = await this.employees.setQualificationStatus(
        transaction,
        principal.tenantId,
        id,
        'archived',
        now,
      );
      if (!qualification) throw new QualificationNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'qualification.archived',
        resourceType: 'qualification',
        resourceId: id,
        timestamp: now,
        metadata: { status: 'archived' },
        event: createDomainEvent({
          type: 'qualification.archived',
          tenantId: principal.tenantId,
          aggregateType: 'qualification',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { qualificationId: id },
        }),
      });
      return qualification;
    });
  }

  async assignQualification(
    principal: AuthorizationPrincipal,
    employeeId: string,
    qualificationId: string,
    input: QualificationInput,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    const details = {
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      issuer: input.issuer ?? null,
    };
    this.validateDateRange(details.validFrom, details.validUntil);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.manage_qualifications', resource);
      this.ensureWritable(employee);
      const qualification = await this.employees.getQualification(
        transaction,
        principal.tenantId,
        qualificationId,
        true,
      );
      if (!qualification) throw new QualificationNotFoundError();
      if (qualification.status === 'archived') throw new QualificationArchivedError();
      const existing = await this.employees.findEmployeeQualification(
        transaction,
        principal.tenantId,
        employeeId,
        qualificationId,
        true,
      );
      if (
        existing &&
        existing.validFrom === details.validFrom &&
        existing.validUntil === details.validUntil &&
        existing.issuer === details.issuer
      ) {
        return this.detailForPrincipal(transaction, principal, employee, resource);
      }
      const now = new Date();
      if (existing) {
        await this.employees.updateEmployeeQualification(
          transaction,
          principal.tenantId,
          employeeId,
          qualificationId,
          details,
          now,
        );
      } else {
        await this.employees.addQualification(transaction, {
          id: uuidv7(),
          tenantId: principal.tenantId,
          employeeId,
          qualificationId,
          ...details,
          now,
        });
      }
      const action = existing ? 'employee.qualification_updated' : 'employee.qualification_added';
      await this.record(transaction, {
        principal,
        context,
        request,
        action,
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { qualificationId, ...details },
        event: createDomainEvent({
          type: 'employee.qualification_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, qualificationId, operation: existing ? 'updated' : 'added' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async removeQualification(
    principal: AuthorizationPrincipal,
    employeeId: string,
    qualificationId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.manage_qualifications', resource);
      this.ensureWritable(employee);
      if (
        !(await this.employees.getQualification(transaction, principal.tenantId, qualificationId))
      ) {
        throw new QualificationNotFoundError();
      }
      const now = new Date();
      const removed = await this.employees.removeQualification(
        transaction,
        principal.tenantId,
        employeeId,
        qualificationId,
        now,
      );
      if (!removed) return this.detailForPrincipal(transaction, principal, employee, resource);
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.qualification_removed',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { qualificationId },
        event: createDomainEvent({
          type: 'employee.qualification_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, qualificationId, operation: 'removed' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async listSkills(
    principal: AuthorizationPrincipal,
    status?: 'active' | 'archived',
  ): Promise<SkillDefinitionSnapshot[]> {
    this.requireGrant(principal, 'employee.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.employees.listSkills(transaction, principal.tenantId, status),
    );
  }

  async createSkill(
    principal: AuthorizationPrincipal,
    input: DefinitionInput,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<SkillDefinitionSnapshot> {
    this.authorizeTenantManagement(principal, 'employee.manage_skills');
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const now = new Date();
          const id = uuidv7();
          const skill = await this.employees.createSkill(transaction, {
            id,
            tenantId: principal.tenantId,
            ...input,
            now,
          });
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'skill.created',
            resourceType: 'skill',
            resourceId: id,
            timestamp: now,
            metadata: { changedFields: Object.keys(input) },
            event: createDomainEvent({
              type: 'skill.created',
              tenantId: principal.tenantId,
              aggregateType: 'skill',
              aggregateId: id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { skillId: id },
            }),
          });
          return skill;
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'skill_definitions_tenant_name_uq')) {
        throw new EmployeeConflictError('SKILL_ALREADY_EXISTS');
      }
      if (hasConstraint(error, 'skill_definitions_tenant_code_uq')) {
        throw new EmployeeConflictError('SKILL_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async updateSkill(
    principal: AuthorizationPrincipal,
    id: string,
    changes: DefinitionChanges,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<SkillDefinitionSnapshot> {
    this.authorizeTenantManagement(principal, 'employee.manage_skills');
    try {
      return await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const current = await this.employees.getSkill(transaction, principal.tenantId, id, true);
          if (!current) throw new SkillNotFoundError();
          if (current.status === 'archived') throw new SkillArchivedError();
          const fields = Object.keys(changes);
          if (fields.length === 0) return current;
          const now = new Date();
          const skill = await this.employees.updateSkill(
            transaction,
            principal.tenantId,
            id,
            changes,
            now,
          );
          if (!skill) throw new SkillNotFoundError();
          await this.record(transaction, {
            principal,
            context,
            request,
            action: 'skill.updated',
            resourceType: 'skill',
            resourceId: id,
            timestamp: now,
            metadata: { changedFields: fields },
            event: createDomainEvent({
              type: 'skill.updated',
              tenantId: principal.tenantId,
              aggregateType: 'skill',
              aggregateId: id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { skillId: id, changedFields: fields },
            }),
          });
          return skill;
        },
      );
    } catch (error) {
      if (hasConstraint(error, 'skill_definitions_tenant_name_uq')) {
        throw new EmployeeConflictError('SKILL_ALREADY_EXISTS');
      }
      if (hasConstraint(error, 'skill_definitions_tenant_code_uq')) {
        throw new EmployeeConflictError('SKILL_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async archiveSkill(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<SkillDefinitionSnapshot> {
    this.authorizeTenantManagement(principal, 'employee.manage_skills');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.employees.getSkill(transaction, principal.tenantId, id, true);
      if (!current) throw new SkillNotFoundError();
      if (current.status === 'archived') return current;
      const now = new Date();
      const skill = await this.employees.setSkillStatus(
        transaction,
        principal.tenantId,
        id,
        'archived',
        now,
      );
      if (!skill) throw new SkillNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'skill.archived',
        resourceType: 'skill',
        resourceId: id,
        timestamp: now,
        metadata: { status: 'archived' },
        event: createDomainEvent({
          type: 'skill.archived',
          tenantId: principal.tenantId,
          aggregateType: 'skill',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { skillId: id },
        }),
      });
      return skill;
    });
  }

  async assignSkill(
    principal: AuthorizationPrincipal,
    employeeId: string,
    skillId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.manage_skills', resource);
      this.ensureWritable(employee);
      const skill = await this.employees.getSkill(transaction, principal.tenantId, skillId, true);
      if (!skill) throw new SkillNotFoundError();
      if (skill.status === 'archived') throw new SkillArchivedError();
      if (await this.employees.hasSkill(transaction, principal.tenantId, employeeId, skillId)) {
        return this.detailForPrincipal(transaction, principal, employee, resource);
      }
      const now = new Date();
      await this.employees.addSkill(transaction, {
        id: uuidv7(),
        tenantId: principal.tenantId,
        employeeId,
        skillId,
        now,
      });
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.skill_added',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { skillId },
        event: createDomainEvent({
          type: 'employee.skill_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, skillId, operation: 'added' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  async removeSkill(
    principal: AuthorizationPrincipal,
    employeeId: string,
    skillId: string,
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(
        transaction,
        principal.tenantId,
        employeeId,
        true,
      );
      const resource = await this.employeeContext(transaction, principal.tenantId, employee);
      this.authorize(principal, 'employee.manage_skills', resource);
      this.ensureWritable(employee);
      if (!(await this.employees.getSkill(transaction, principal.tenantId, skillId))) {
        throw new SkillNotFoundError();
      }
      const removed = await this.employees.removeSkill(
        transaction,
        principal.tenantId,
        employeeId,
        skillId,
      );
      if (!removed) return this.detailForPrincipal(transaction, principal, employee, resource);
      const now = new Date();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'employee.skill_removed',
        resourceType: 'employee',
        resourceId: employeeId,
        timestamp: now,
        metadata: { skillId },
        event: createDomainEvent({
          type: 'employee.skill_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: employeeId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { employeeId, skillId, operation: 'removed' },
        }),
      });
      const updated = await this.requireEmployee(transaction, principal.tenantId, employeeId);
      return this.detailForPrincipal(
        transaction,
        principal,
        updated,
        await this.employeeContext(transaction, principal.tenantId, updated),
      );
    });
  }

  private async changeStatus(
    principal: AuthorizationPrincipal,
    id: string,
    operation: 'activate' | 'deactivate' | 'archive',
    context: RequestContext,
    request: EmployeeRequestMetadata,
  ): Promise<EmployeeDetailSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.requireEmployee(transaction, principal.tenantId, id, true);
      const resource = await this.employeeContext(transaction, principal.tenantId, current);
      const permission = operation === 'archive' ? 'employee.archive' : 'employee.update';
      this.authorize(principal, permission, resource);
      const status = transitionEmployeeStatus(current.status, operation);
      if (status === current.status) {
        return this.detailForPrincipal(transaction, principal, current, resource);
      }
      if (
        status !== 'active' &&
        (await this.execution?.hasInProgressExecutionForEmployee(
          transaction,
          principal.tenantId,
          id,
        ))
      ) {
        throw new EmployeeHasInProgressExecutionError();
      }
      if (
        status !== 'active' &&
        (await this.scheduling?.hasFutureAssignmentsForEmployee(
          transaction,
          principal.tenantId,
          id,
        ))
      ) {
        throw new EmployeeHasFutureVisitsError();
      }
      const now = new Date();
      const employee = await this.employees.setStatus(
        transaction,
        principal.tenantId,
        id,
        status,
        now,
      );
      if (!employee) throw new EmployeeNotFoundError();
      const action =
        status === 'archived'
          ? 'employee.archived'
          : status === 'inactive'
            ? 'employee.deactivated'
            : 'employee.activated';
      await this.record(transaction, {
        principal,
        context,
        request,
        action,
        resourceType: 'employee',
        resourceId: id,
        timestamp: now,
        metadata: { previousStatus: current.status, status },
        event: createDomainEvent({
          type: 'employee.status_changed',
          tenantId: principal.tenantId,
          aggregateType: 'employee',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: {
            employeeId: id,
            previousStatus: current.status as 'active' | 'inactive',
            status,
          },
        }),
      });
      return this.detailForPrincipal(
        transaction,
        principal,
        employee,
        await this.employeeContext(transaction, principal.tenantId, employee),
      );
    });
  }

  private async detailForPrincipal(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    employee: EmployeeSnapshot,
    context: EmployeeResource,
  ): Promise<EmployeeDetailSnapshot> {
    const detail = await this.employees.detail(transaction, employee);
    detail.facilityAssignments = detail.facilityAssignments.filter((assignment) =>
      can(principal, {
        action: 'employee.read',
        resource: {
          tenantId: principal.tenantId,
          organizationId: assignment.organizationId,
          facilityId: assignment.facilityId,
        },
      }),
    );
    detail.teamMemberships = detail.teamMemberships.filter((membership) => {
      const teamContext = {
        tenantId: principal.tenantId,
        ...(employee.organizationId ? { organizationId: employee.organizationId } : {}),
        ...(membership.facilityId ? { facilityId: membership.facilityId } : {}),
        teamId: membership.teamId,
      };
      return can(principal, { action: 'employee.read', resource: teamContext });
    });
    if (!can(principal, { action: 'employee.link_user', resource: context })) {
      detail.linkedUser = null;
    }
    return detail;
  }

  private async requireEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<EmployeeSnapshot> {
    const employee = await this.employees.findById(transaction, tenantId, id, lock);
    if (!employee) throw new EmployeeNotFoundError();
    return employee;
  }

  private async employeeContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    employee: EmployeeSnapshot,
  ): Promise<EmployeeResource> {
    const context = await this.employees.readContext(transaction, tenantId, employee.id);
    return {
      tenantId,
      ...(context.organizationId ? { organizationId: context.organizationId } : {}),
      facilityIds: context.facilityIds,
      teamIds: context.teamIds,
    };
  }

  private emptyEmployeeContext(employee: EmployeeSnapshot): EmployeeResource {
    return {
      tenantId: employee.tenantId,
      ...(employee.organizationId ? { organizationId: employee.organizationId } : {}),
    };
  }

  private authorize(
    principal: AuthorizationPrincipal,
    permission: Permission,
    resource: EmployeeResource,
  ): void {
    assertCan(principal, { action: permission, resource });
  }

  private requireGrant(principal: AuthorizationPrincipal, permission: Permission): void {
    if (
      principal.grants.some(
        (grant) =>
          grant.permission === permission ||
          (grant.permission === 'employee.manage' && permission.startsWith('employee.')),
      )
    ) {
      return;
    }
    this.authorize(principal, permission, { tenantId: principal.tenantId });
  }

  private authorizeTenantManagement(principal: AuthorizationPrincipal, permission: Permission) {
    this.authorize(principal, permission, { tenantId: principal.tenantId });
  }

  private ensureWritable(employee: EmployeeSnapshot): void {
    if (employee.status === 'archived') throw new EmployeeArchivedError();
  }

  private validateEmployeeData(data: EmployeeData): void {
    if (
      !data.firstName.trim() ||
      !data.lastName.trim() ||
      data.firstName.length > 120 ||
      data.lastName.length > 120
    ) {
      throw new InvalidEmployeeDataError();
    }
    this.validateDateRange(data.startDate, data.endDate);
    if (
      data.weeklyHours !== null &&
      (!Number.isFinite(data.weeklyHours) || data.weeklyHours < 0 || data.weeklyHours > 168)
    ) {
      throw new InvalidEmployeeDataError();
    }
  }

  private validateEmployeeChanges(employee: EmployeeSnapshot, changes: EmployeeChanges): void {
    this.validateDateRange(
      changes.startDate === undefined ? employee.startDate : changes.startDate,
      changes.endDate === undefined ? employee.endDate : changes.endDate,
    );
    if (
      changes.weeklyHours !== undefined &&
      changes.weeklyHours !== null &&
      (!Number.isFinite(changes.weeklyHours) ||
        changes.weeklyHours < 0 ||
        changes.weeklyHours > 168)
    ) {
      throw new InvalidEmployeeDataError();
    }
  }

  private validateDateRange(from: string | null, until: string | null): void {
    if (!isValidDateRange(from, until)) throw new InvalidEmployeeDataError();
  }

  private async record(
    transaction: DatabaseTransaction,
    input: {
      principal: AuthorizationPrincipal;
      context: RequestContext;
      request: EmployeeRequestMetadata;
      action: string;
      resourceType: string;
      resourceId: string;
      timestamp: Date;
      metadata: Record<string, unknown>;
      event: DomainEvent;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: uuidv7(),
      tenantId: input.principal.tenantId,
      actorId: input.principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: input.timestamp,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
      ...(input.request.ip ? { ip: input.request.ip } : {}),
      ...(input.request.userAgent ? { userAgent: input.request.userAgent } : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

export class EmployeeNotActiveForScheduleError extends Error {
  readonly code = 'VISIT_EMPLOYEE_INACTIVE';

  constructor() {
    super('Only active employees can be assigned to a visit');
    this.name = 'EmployeeNotActiveForScheduleError';
  }
}

export class EmployeeNotAssignedToFacilityError extends Error {
  readonly code = 'VISIT_EMPLOYEE_NOT_ASSIGNED_TO_FACILITY';

  constructor() {
    super('Employee is not actively assigned to this facility for the visit date');
    this.name = 'EmployeeNotAssignedToFacilityError';
  }
}

export class EmployeeHasFutureVisitsError extends Error {
  readonly code = 'FUTURE_VISITS_EXIST';

  constructor() {
    super('Resolve future assigned visits before deactivating or archiving this employee');
    this.name = 'EmployeeHasFutureVisitsError';
  }
}

export class EmployeeHasInProgressExecutionError extends Error {
  readonly code = 'EMPLOYEE_EXECUTION_IN_PROGRESS';

  constructor() {
    super('Complete the in-progress visit before deactivating or archiving this employee');
    this.name = 'EmployeeHasInProgressExecutionError';
  }
}

type EmployeeResource = {
  tenantId: string;
  organizationId?: string;
  facilityId?: string;
  facilityIds?: readonly string[];
  teamId?: string;
  teamIds?: readonly string[];
};

function hasConstraint(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const value = current as { constraint?: unknown; cause?: unknown };
    if (value.constraint === constraint) return true;
    current = value.cause;
  }
  return false;
}
