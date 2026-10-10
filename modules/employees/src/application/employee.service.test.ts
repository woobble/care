import { describe, expect, test } from 'bun:test';
import type { AuditRecord, AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { DomainEvent } from '@care/events';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type {
  EmployeeDetailSnapshot,
  EmployeeQualificationSnapshot,
  EmployeeSnapshot,
  QualificationDefinitionSnapshot,
  SkillDefinitionSnapshot,
} from '../domain/employee';
import {
  CrossTenantReferenceError,
  EmployeeAlreadyLinkedError,
  InvalidTeamAssignmentError,
  PrimaryFacilityRequiredError,
  QualificationArchivedError,
  UserAlreadyLinkedError,
} from '../domain/employee';
import { EmployeeApplicationService } from './employee.service';
import type { EmployeeRepository } from '../infrastructure/persistence/employee.repository';

const tenantId = '91ce6a63-434f-7423-a7dc-3eaf36766378';
const organizationId = '193df432-2718-76ba-8a42-6b4242c3f121';
const employeeId = '814ff2bb-b5f8-7c6b-a4dc-2ea98b6b7c16';
const principalUserId = 'd7f8230b-0732-7da4-8373-1bb84ac3c893';
const userId = 'e3ee3c73-5c2d-7da9-82ac-c90bcb35f909';
const employee: EmployeeSnapshot = {
  id: employeeId,
  tenantId,
  organizationId,
  organizationName: 'Test Organization',
  userId: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
  preferredName: null,
  email: null,
  phone: null,
  personnelNumber: null,
  employmentType: null,
  startDate: null,
  endDate: null,
  weeklyHours: null,
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const requestContext: RequestContext = { requestId: 'request-id', correlationId: 'correlation-id' };

describe('employee application rules', () => {
  test('requires a primary facility and atomically promotes a newly assigned primary', async () => {
    const existingAssignment = {
      id: '036d992d-a4a2-7ce2-9843-19c6162ef4c8',
      employeeId,
      facilityId: '936f521e-324f-74c0-aa72-5bcb9440bd28',
      facilityName: 'Facility One',
      organizationId,
      isPrimary: true,
      status: 'active' as const,
      validFrom: null,
      validUntil: null,
      facilityStatus: 'active' as const,
    };
    let demotedOtherAssignments = false;
    let createdAssignment:
      | Parameters<EmployeeRepository['createFacilityAssignment']>[1]
      | undefined;
    const service = createService({
      facilityContext: async () => ({
        id: 'Facility Two',
        organizationId,
        status: 'active',
        organizationStatus: 'active',
      }),
      facilityAssignments: async () => [existingAssignment],
      setOtherFacilityAssignmentsNonPrimary: async () => {
        demotedOtherAssignments = true;
      },
      createFacilityAssignment: async (_transaction, input) => {
        createdAssignment = input;
      },
    });

    await expect(
      service.service.assignFacility(
        principal('employee.assign_facility', 'employee.read'),
        employeeId,
        '36e28b6a-b51d-79cc-bc28-4db824f6d762',
        { isPrimary: true },
        requestContext,
        {},
      ),
    ).resolves.toBeDefined();

    expect(demotedOtherAssignments).toBe(true);
    expect(createdAssignment).toMatchObject({
      employeeId,
      facilityId: '36e28b6a-b51d-79cc-bc28-4db824f6d762',
      isPrimary: true,
    });
    expect(service.auditRecords.map((entry) => entry.action)).toContain(
      'employee.facility_assigned',
    );

    const primaryRequired = createService({
      facilityContext: async () => ({
        id: 'Facility Two',
        organizationId,
        status: 'active',
        organizationStatus: 'active',
      }),
      facilityAssignments: async () => [],
      createFacilityAssignment: async () => {
        throw new Error('A non-primary first assignment must not be written');
      },
    });
    await expect(
      primaryRequired.service.assignFacility(
        principal('employee.assign_facility'),
        employeeId,
        '36e28b6a-b51d-79cc-bc28-4db824f6d762',
        { isPrimary: false },
        requestContext,
        {},
      ),
    ).rejects.toBeInstanceOf(PrimaryFacilityRequiredError);
  });

  test('archives qualification master data without a generic policy engine', async () => {
    let archived = false;
    const qualification: QualificationDefinitionSnapshot = {
      id: '5c48a02f-c8e8-4e59-9891-9fa2dbb0e81e',
      tenantId,
      name: 'Registered nurse',
      code: 'RN',
      description: null,
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const service = createService({
      getQualification: async () => qualification,
      setQualificationStatus: async () => {
        archived = true;
        return { ...qualification, status: 'archived' };
      },
    });

    const result = await service.service.archiveQualification(
      principal('employee.manage_qualifications'),
      qualification.id,
      requestContext,
      {},
    );

    expect(archived).toBe(true);
    expect(result.status).toBe('archived');
    expect(service.auditRecords).toHaveLength(1);
  });

  test('rejects links outside the tenant and users already linked to another employee', async () => {
    const noMembership = createService({
      hasActiveMembership: async () => false,
    });
    await expect(
      noMembership.service.linkUser(
        principal('employee.link_user'),
        employeeId,
        userId,
        requestContext,
        {},
      ),
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);

    const alreadyLinked = createService({
      hasActiveMembership: async () => true,
      employeeLinkedToUser: async () => true,
    });
    await expect(
      alreadyLinked.service.linkUser(
        principal('employee.link_user'),
        employeeId,
        userId,
        requestContext,
        {},
      ),
    ).rejects.toBeInstanceOf(UserAlreadyLinkedError);

    const employeeHasDifferentUser = createService({
      findById: async () => ({ ...employee, userId: '252ce385-06dc-79a1-9873-bfc2db391959' }),
    });
    await expect(
      employeeHasDifferentUser.service.linkUser(
        principal('employee.link_user'),
        employeeId,
        userId,
        requestContext,
        {},
      ),
    ).rejects.toBeInstanceOf(EmployeeAlreadyLinkedError);
  });

  test('rejects team membership across the employee owning organization', async () => {
    const service = createService({
      teamContext: async () => ({
        id: '487b8ea6-7cc0-7be2-a810-26c76f142d0c',
        organizationId: 'different-organization',
        facilityId: null,
        status: 'active',
        organizationStatus: 'active',
        facilityStatus: null,
      }),
      createTeamMembership: async () => {
        throw new Error('A cross-organization membership must not be written');
      },
    });
    await expect(
      service.service.assignTeam(
        principal('employee.assign_team'),
        employeeId,
        '487b8ea6-7cc0-7be2-a810-26c76f142d0c',
        {},
        requestContext,
        {},
      ),
    ).rejects.toBeInstanceOf(InvalidTeamAssignmentError);
  });

  test('records an active qualification with its validity and issuer', async () => {
    let created: Parameters<EmployeeRepository['addQualification']>[1] | undefined;
    const qualification: QualificationDefinitionSnapshot = {
      id: '3b6a8edb-868f-73aa-9fd2-3bf213760a18',
      tenantId,
      name: 'Registered Nurse',
      code: 'RN',
      description: null,
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const service = createService({
      getQualification: async () => qualification,
      findEmployeeQualification: async () => null,
      addQualification: async (_transaction, input) => {
        created = input;
      },
    });

    await service.service.assignQualification(
      principal('employee.manage_qualifications', 'employee.read'),
      employeeId,
      qualification.id,
      { validFrom: '2026-01-01', validUntil: '2026-12-31', issuer: 'State Board' },
      requestContext,
      {},
    );

    expect(created).toMatchObject({
      employeeId,
      qualificationId: qualification.id,
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      issuer: 'State Board',
    });
    expect(service.auditRecords.map((entry) => entry.action)).toContain(
      'employee.qualification_added',
    );
    expect(service.events.map((event) => event.type)).toContain('employee.qualification_changed');

    const archived = createService({
      getQualification: async () => ({ ...qualification, status: 'archived' }),
    });
    await expect(
      archived.service.assignQualification(
        principal('employee.manage_qualifications'),
        employeeId,
        qualification.id,
        {},
        requestContext,
        {},
      ),
    ).rejects.toBeInstanceOf(QualificationArchivedError);
  });

  test('creates a new qualification assignment when no active assignment exists', async () => {
    let created: Parameters<EmployeeRepository['addQualification']>[1] | undefined;
    let updated = false;
    const qualification: QualificationDefinitionSnapshot = {
      id: '3b6a8edb-868f-73aa-9fd2-3bf213760a18',
      tenantId,
      name: 'Registered Nurse',
      code: 'RN',
      description: null,
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const service = createService({
      getQualification: async () => qualification,
      findEmployeeQualification: async () => null,
      addQualification: async (_transaction, input) => {
        created = input;
      },
      updateEmployeeQualification: async () => {
        updated = true;
      },
    });

    await service.service.assignQualification(
      principal('employee.manage_qualifications'),
      employeeId,
      qualification.id,
      { validFrom: '2026-05-01', issuer: 'State Board' },
      requestContext,
      {},
    );

    expect(created).toMatchObject({
      employeeId,
      qualificationId: qualification.id,
      validFrom: '2026-05-01',
      validUntil: null,
      issuer: 'State Board',
    });
    expect(updated).toBe(false);
  });

  test('revokes a qualification assignment and records the same timestamp', async () => {
    let revokedAt: Date | undefined;
    const service = createService({
      getQualification: async () => ({
        id: '3b6a8edb-868f-73aa-9fd2-3bf213760a18',
        tenantId,
        name: 'Registered Nurse',
        code: 'RN',
        description: null,
        status: 'active',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      removeQualification: async (_transaction, _tenantId, _employeeId, _qualificationId, now) => {
        revokedAt = now;
        return true;
      },
    });

    await service.service.removeQualification(
      principal('employee.manage_qualifications'),
      employeeId,
      '3b6a8edb-868f-73aa-9fd2-3bf213760a18',
      requestContext,
      {},
    );

    expect(revokedAt).toBeInstanceOf(Date);
    expect(service.auditRecords[0]?.timestamp).toBe(revokedAt);
    expect(service.auditRecords.map((entry) => entry.action)).toContain(
      'employee.qualification_removed',
    );
  });

  test('retains revoked qualification assignments in employee detail', async () => {
    const revoked: EmployeeQualificationSnapshot = {
      id: '5fa83edc-7e95-7db9-9a27-34b38e8be881',
      qualificationId: '3b6a8edb-868f-73aa-9fd2-3bf213760a18',
      name: 'Registered Nurse',
      code: 'RN',
      description: null,
      validFrom: '2025-01-01',
      validUntil: null,
      issuer: 'State Board',
      status: 'active',
      assignmentStatus: 'revoked',
      revokedAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const detail = { ...employeeDetail(employee), qualifications: [revoked] };
    const service = createService({ detail: async () => detail });

    const result = await service.service.get(principal('employee.read'), employeeId);

    expect(result.qualifications).toEqual([revoked]);
  });

  test('records an active skill assignment', async () => {
    let assignedSkill: { employeeId: string; skillId: string } | undefined;
    const skill: SkillDefinitionSnapshot = {
      id: '1368228f-8091-7d8f-bfb2-9dd6f1698199',
      tenantId,
      name: 'Wound Care',
      code: null,
      description: null,
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const service = createService({
      getSkill: async () => skill,
      hasSkill: async () => false,
      addSkill: async (_transaction, input) => {
        assignedSkill = input;
      },
    });

    await service.service.assignSkill(
      principal('employee.manage_skills', 'employee.read'),
      employeeId,
      skill.id,
      requestContext,
      {},
    );

    expect(assignedSkill).toMatchObject({ employeeId, skillId: skill.id });
    expect(service.auditRecords.map((entry) => entry.action)).toContain('employee.skill_added');
    expect(service.events.map((event) => event.type)).toContain('employee.skill_changed');
  });
});

function createService(overrides: Partial<EmployeeRepository> = {}) {
  const auditRecords: AuditRecord[] = [];
  const events: DomainEvent[] = [];
  const unitOfWork: UnitOfWork = {
    transaction: async (_options, operation) => operation({} as DatabaseTransaction),
  };
  const audit: AuditWriter = {
    append: async (_transaction, record) => {
      auditRecords.push(record);
    },
  };
  const outbox: OutboxWriter = {
    enqueue: async (_transaction, event) => {
      events.push(event);
    },
  };
  const repository: Partial<EmployeeRepository> = {
    findById: async () => employee,
    readContext: async () => ({ organizationId, facilityIds: [], teamIds: [] }),
    detail: async (_transaction, snapshot) => employeeDetail(snapshot),
    ...overrides,
  };
  return {
    service: new EmployeeApplicationService(
      unitOfWork,
      audit,
      outbox,
      repository as unknown as EmployeeRepository,
    ),
    auditRecords,
    events,
  };
}

function employeeDetail(snapshot: EmployeeSnapshot): EmployeeDetailSnapshot {
  return {
    ...snapshot,
    facilityAssignments: [],
    teamMemberships: [],
    qualifications: [],
    skills: [],
    linkedUser: null,
  };
}

function principal(...permissions: Permission[]): AuthorizationPrincipal {
  return {
    userId: principalUserId,
    tenantId,
    grants: permissions.map((permission) => ({
      permission,
      scopeType: 'tenant',
      scopeId: tenantId,
    })),
  };
}
