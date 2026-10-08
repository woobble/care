export type EmployeeStatus = 'active' | 'inactive' | 'archived';
export type DefinitionStatus = 'active' | 'archived';
export type AssignmentStatus = 'active' | 'inactive';
export type QualificationAssignmentStatus = 'active' | 'revoked';

export interface EmployeeData {
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
}

export type EmployeeChanges = Partial<Omit<EmployeeData, 'organizationId'>>;

export interface EmployeeSnapshot extends Omit<EmployeeData, 'organizationId'> {
  id: string;
  tenantId: string;
  organizationId: string | null;
  organizationName: string | null;
  userId: string | null;
  status: EmployeeStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilityAssignmentSnapshot {
  id: string;
  employeeId: string;
  facilityId: string;
  facilityName: string;
  organizationId: string;
  isPrimary: boolean;
  status: AssignmentStatus;
  validFrom: string | null;
  validUntil: string | null;
  facilityStatus: DefinitionStatus;
}

export interface TeamMembershipSnapshot {
  id: string;
  employeeId: string;
  teamId: string;
  teamName: string;
  facilityId: string | null;
  role: string | null;
  status: AssignmentStatus;
  validFrom: string | null;
  validUntil: string | null;
  teamStatus: DefinitionStatus;
}

export interface QualificationDefinitionSnapshot {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  description: string | null;
  status: DefinitionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeQualificationSnapshot {
  id: string;
  qualificationId: string;
  name: string;
  code: string | null;
  description: string | null;
  validFrom: string | null;
  validUntil: string | null;
  issuer: string | null;
  status: DefinitionStatus;
  assignmentStatus: QualificationAssignmentStatus;
  revokedAt: Date | null;
  updatedAt: Date;
}

export interface SkillDefinitionSnapshot {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  description: string | null;
  status: DefinitionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeSkillSnapshot {
  id: string;
  skillId: string;
  name: string;
  code: string | null;
  description: string | null;
  status: DefinitionStatus;
}

export interface EmployeeUserLinkSnapshot {
  id: string;
  displayName: string | null;
  email: string | null;
  membershipStatus: 'pending' | 'active' | 'inactive' | 'revoked';
}

export interface EmployeeDetailSnapshot extends EmployeeSnapshot {
  facilityAssignments: FacilityAssignmentSnapshot[];
  teamMemberships: TeamMembershipSnapshot[];
  qualifications: EmployeeQualificationSnapshot[];
  skills: EmployeeSkillSnapshot[];
  linkedUser: EmployeeUserLinkSnapshot | null;
}

export interface EmployeeListResult {
  items: EmployeeSnapshot[];
  page: number;
  pageSize: number;
  total: number;
}

export function transitionEmployeeStatus(
  current: EmployeeStatus,
  operation: 'activate' | 'deactivate' | 'archive',
): EmployeeStatus {
  if (current === 'archived' && operation !== 'archive') {
    throw new InvalidEmployeeTransitionError();
  }
  if (operation === 'activate') return 'active';
  if (operation === 'deactivate') return 'inactive';
  return 'archived';
}

export function isValidDateRange(from: string | null, until: string | null): boolean {
  return from === null || until === null || from <= until;
}

export class EmployeeNotFoundError extends Error {
  readonly code = 'EMPLOYEE_NOT_FOUND';

  constructor() {
    super('Employee was not found');
    this.name = 'EmployeeNotFoundError';
  }
}

export class EmployeeArchivedError extends Error {
  readonly code = 'EMPLOYEE_ARCHIVED';

  constructor() {
    super('Employee is archived');
    this.name = 'EmployeeArchivedError';
  }
}

export class InvalidEmployeeTransitionError extends Error {
  readonly code = 'INVALID_STATUS_TRANSITION';

  constructor() {
    super('The requested employee status transition is invalid');
    this.name = 'InvalidEmployeeTransitionError';
  }
}

export class InvalidEmployeeDataError extends Error {
  readonly code = 'INVALID_EMPLOYEE_DATA';

  constructor() {
    super('Employee data is invalid');
    this.name = 'InvalidEmployeeDataError';
  }
}

export class EmployeeAlreadyLinkedError extends Error {
  readonly code = 'EMPLOYEE_ALREADY_LINKED';

  constructor() {
    super('Employee is already linked to a different user');
    this.name = 'EmployeeAlreadyLinkedError';
  }
}

export class UserAlreadyLinkedError extends Error {
  readonly code = 'USER_ALREADY_LINKED';

  constructor() {
    super('User is already linked to an employee in this tenant');
    this.name = 'UserAlreadyLinkedError';
  }
}

export class CrossTenantReferenceError extends Error {
  readonly code = 'CROSS_TENANT_REFERENCE';

  constructor() {
    super('The referenced resource is not available in this tenant');
    this.name = 'CrossTenantReferenceError';
  }
}

export class InvalidFacilityAssignmentError extends Error {
  readonly code = 'INVALID_FACILITY_ASSIGNMENT';

  constructor() {
    super('Facility cannot be assigned to this employee');
    this.name = 'InvalidFacilityAssignmentError';
  }
}

export class InvalidTeamAssignmentError extends Error {
  readonly code = 'INVALID_TEAM_ASSIGNMENT';

  constructor() {
    super('Team cannot be assigned to this employee');
    this.name = 'InvalidTeamAssignmentError';
  }
}

export class PrimaryFacilityRequiredError extends Error {
  readonly code = 'PRIMARY_FACILITY_REQUIRED';

  constructor() {
    super('An employee with a facility assignment must have one primary facility');
    this.name = 'PrimaryFacilityRequiredError';
  }
}

export class QualificationNotFoundError extends Error {
  readonly code = 'QUALIFICATION_NOT_FOUND';

  constructor() {
    super('Qualification was not found');
    this.name = 'QualificationNotFoundError';
  }
}

export class SkillNotFoundError extends Error {
  readonly code = 'SKILL_NOT_FOUND';

  constructor() {
    super('Skill was not found');
    this.name = 'SkillNotFoundError';
  }
}

export class QualificationArchivedError extends Error {
  readonly code = 'QUALIFICATION_ARCHIVED';

  constructor() {
    super('Qualification definition is archived');
    this.name = 'QualificationArchivedError';
  }
}

export class QualificationRequiredByActivePolicyError extends Error {
  readonly code = 'QUALIFICATION_REQUIRED_BY_ACTIVE_COMPETENCY_POLICY';

  constructor() {
    super('Qualification is required by an active competency policy');
    this.name = 'QualificationRequiredByActivePolicyError';
  }
}

export class SkillArchivedError extends Error {
  readonly code = 'SKILL_ARCHIVED';

  constructor() {
    super('Skill definition is archived');
    this.name = 'SkillArchivedError';
  }
}

export class InvalidEmployeePaginationError extends Error {
  readonly code = 'INVALID_PAGINATION';

  constructor() {
    super('Employee pagination or sorting values are invalid');
    this.name = 'InvalidEmployeePaginationError';
  }
}

export class EmployeeConflictError extends Error {
  readonly code: string;

  constructor(
    code:
      | 'EMPLOYEE_PERSONNEL_NUMBER_ALREADY_EXISTS'
      | 'QUALIFICATION_ALREADY_EXISTS'
      | 'SKILL_ALREADY_EXISTS',
  ) {
    super('A record with the same unique value already exists');
    this.code = code;
    this.name = 'EmployeeConflictError';
  }
}
