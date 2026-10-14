import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const employeeFields = {
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  preferredName: z.string().trim().max(120).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  personnelNumber: z.string().trim().min(1).max(64).nullable().optional(),
  employmentType: z.string().trim().min(1).max(80).nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  weeklyHours: z.number().min(0).max(168).nullable().optional(),
};

export const createEmployeeSchema = z
  .object({ organizationId: z.string().uuid(), ...employeeFields })
  .strict();
export const updateEmployeeSchema = z
  .object(employeeFields)
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one employee field is required');
export const employeeStatusSchema = z.enum(['active', 'inactive', 'archived']);
export const employeeSearchSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: employeeStatusSchema.optional(),
    userId: z.string().uuid().optional(),
    ids: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.split(',').map((id) => id.trim()) : value),
        z.array(z.string().uuid()).min(1).max(100),
      )
      .optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['lastName', 'firstName', 'status', 'createdAt']).default('lastName'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export const linkableUserSearchSchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const definitionSearchSchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const facilityAssignmentSchema = z
  .object({
    isPrimary: z.boolean().optional(),
    validFrom: z.iso.date().nullable().optional(),
    validUntil: z.iso.date().nullable().optional(),
  })
  .strict();
export const teamMembershipSchema = z
  .object({
    role: z.string().trim().max(80).nullable().optional(),
    validFrom: z.iso.date().nullable().optional(),
    validUntil: z.iso.date().nullable().optional(),
  })
  .strict();
export const qualificationAssignmentSchema = z
  .object({
    validFrom: z.iso.date().nullable().optional(),
    validUntil: z.iso.date().nullable().optional(),
    issuer: z.string().trim().max(160).nullable().optional(),
  })
  .strict();
export const linkUserSchema = z.object({ userId: z.string().uuid() }).strict();

const definitionFields = {
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(40).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
};
export const createDefinitionSchema = z.object(definitionFields).strict();
export const updateDefinitionSchema = z
  .object({
    name: definitionFields.name.optional(),
    code: definitionFields.code,
    description: definitionFields.description,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one definition field is required');
export const definitionStatusSchema = z.enum(['active', 'archived']);

export class EmployeeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ nullable: true })
  organizationName!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiProperty({ description: 'Whether an employee is linked to a local user account.' })
  hasLinkedUser!: boolean;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  personnelNumber!: string | null;

  @ApiProperty({ nullable: true })
  employmentType!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  startDate!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  endDate!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  weeklyHours!: number | null;

  @ApiProperty({ enum: ['active', 'inactive', 'archived'] })
  status!: 'active' | 'inactive' | 'archived';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class FacilityAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty()
  facilityName!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: 'active' | 'inactive';

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  facilityStatus!: 'active' | 'archived';
}

export class TeamMembershipResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  teamId!: string;

  @ApiProperty()
  teamName!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  facilityId!: string | null;

  @ApiProperty({ nullable: true })
  role!: string | null;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: 'active' | 'inactive';

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  teamStatus!: 'active' | 'archived';
}

export class EmployeeQualificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  qualificationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ nullable: true })
  issuer!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ enum: ['active', 'revoked'] })
  assignmentStatus!: 'active' | 'revoked';

  @ApiProperty({ format: 'date-time', nullable: true })
  revokedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class EmployeeSkillResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  skillId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';
}

export class EmployeeUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  displayName!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ enum: ['active', 'disabled'] })
  userStatus!: 'active' | 'disabled';

  @ApiProperty({ enum: ['pending', 'active', 'inactive', 'revoked'] })
  membershipStatus!: 'pending' | 'active' | 'inactive' | 'revoked';
}

export class EmployeeDetailResponseDto extends EmployeeResponseDto {
  @ApiProperty({ description: 'Whether the current principal may link or unlink a user account.' })
  canLinkUser!: boolean;

  @ApiProperty({ type: [FacilityAssignmentResponseDto] })
  facilityAssignments!: FacilityAssignmentResponseDto[];

  @ApiProperty({ type: [TeamMembershipResponseDto] })
  teamMemberships!: TeamMembershipResponseDto[];

  @ApiProperty({ type: [EmployeeQualificationResponseDto] })
  qualifications!: EmployeeQualificationResponseDto[];

  @ApiProperty({ type: [EmployeeSkillResponseDto] })
  skills!: EmployeeSkillResponseDto[];

  @ApiProperty({ type: EmployeeUserResponseDto, nullable: true })
  linkedUser!: EmployeeUserResponseDto | null;
}

export class EmployeeListResponseDto {
  @ApiProperty({ type: [EmployeeResponseDto] })
  items!: EmployeeResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class DefinitionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DefinitionSearchResponseDto {
  @ApiProperty({ type: [DefinitionResponseDto] })
  items!: DefinitionResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class LinkableUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  displayName!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;
}

export class LinkableUserSearchResponseDto {
  @ApiProperty({ type: [LinkableUserResponseDto] })
  items!: LinkableUserResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class CreateEmployeeDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  firstName!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  lastName!: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  personnelNumber?: string | null;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  employmentType?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  startDate?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  endDate?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 168 })
  weeklyHours?: number | null;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  firstName?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  lastName?: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  personnelNumber?: string | null;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  employmentType?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  startDate?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  endDate?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 168 })
  weeklyHours?: number | null;
}

export class LinkUserDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;
}

export class FacilityAssignmentDto {
  @ApiPropertyOptional()
  isPrimary?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class TeamMembershipDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 80 })
  role?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class QualificationAssignmentDto {
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 160 })
  issuer?: string | null;
}

export class CreateDefinitionDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  name!: string;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  description?: string | null;
}

export class UpdateDefinitionDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  name?: string;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  description?: string | null;
}
