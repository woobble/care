import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COMPETENCY_OPERATIONS } from '@care/permissions';
import type { EmployeeStatus } from '@care/employees';
import type {
  QualificationComplianceStatus,
  WorkforceComplianceFindingCode,
  WorkforceReadiness,
} from '@care/workforce-compliance';
import { z } from 'zod';

const readQueryFields = {
  asOf: z.iso.date().optional(),
  horizonDays: z.coerce.number().int().min(1).max(365).optional(),
};

const paginationFields = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
};

export const workforceComplianceReadQuerySchema = z.object(readQueryFields).strict();

export const workforceComplianceEmployeeQuerySchema = z
  .object({
    ...readQueryFields,
    ...paginationFields,
    q: z.string().trim().max(120).optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    sortBy: z.enum(['lastName', 'firstName']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const workforceComplianceQualificationQuerySchema = z
  .object({
    ...readQueryFields,
    ...paginationFields,
    q: z.string().trim().max(120).optional(),
    qualificationId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    status: z.enum(['valid', 'expiring_soon', 'expired', 'not_yet_valid', 'revoked']).optional(),
    assignmentStatus: z.enum(['active', 'revoked']).optional(),
    expiresBefore: z.iso.date().optional(),
    expiresWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    sortBy: z
      .enum(['priority', 'qualificationName', 'employeeName', 'validUntil', 'status'])
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const workforceComplianceImpactQuerySchema = z
  .object({
    ...readQueryFields,
    ...paginationFields,
    operationKey: z.enum(COMPETENCY_OPERATIONS).optional(),
  })
  .strict();

export const workforceComplianceSettingsUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    criticalDays: z.number().int().min(1).max(365).optional(),
    warningDays: z.number().int().min(1).max(365).optional(),
    reportingTimezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export class WorkforceComplianceReadQueryDto {
  @ApiPropertyOptional({ type: String, format: 'date' })
  asOf?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  horizonDays?: number;
}

export class WorkforceComplianceEmployeeQueryDto extends WorkforceComplianceReadQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  q?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'archived'] })
  status?: EmployeeStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  organizationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  facilityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  teamId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  pageSize?: number;

  @ApiPropertyOptional({ enum: ['lastName', 'firstName'] })
  sortBy?: 'lastName' | 'firstName';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  sortOrder?: 'asc' | 'desc';
}

export class WorkforceComplianceQualificationQueryDto extends WorkforceComplianceReadQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  qualificationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  organizationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  facilityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  teamId?: string;

  @ApiPropertyOptional({ enum: ['valid', 'expiring_soon', 'expired', 'not_yet_valid', 'revoked'] })
  status?: QualificationComplianceStatus;

  @ApiPropertyOptional({ enum: ['active', 'revoked'] })
  assignmentStatus?: 'active' | 'revoked';

  @ApiPropertyOptional({ type: String, format: 'date' })
  expiresBefore?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  expiresWithinDays?: number;

  @ApiPropertyOptional({ minimum: 1 })
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  pageSize?: number;

  @ApiPropertyOptional({
    enum: ['priority', 'qualificationName', 'employeeName', 'validUntil', 'status'],
    default: 'priority',
  })
  sortBy?: 'priority' | 'qualificationName' | 'employeeName' | 'validUntil' | 'status';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  sortOrder?: 'asc' | 'desc';
}

export class WorkforceComplianceSettingsUpdateDto {
  @ApiProperty({ minimum: 0 })
  expectedVersion!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  criticalDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  warningDays?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  reportingTimezone?: string;
}

export class WorkforceComplianceReadinessCountsDto {
  @ApiProperty({ minimum: 0 })
  ready!: number;

  @ApiProperty({ minimum: 0 })
  atRisk!: number;

  @ApiProperty({ minimum: 0 })
  notReady!: number;
}

export class WorkforceCompliancePolicyRequirementDto {
  @ApiProperty({ format: 'uuid' })
  qualificationId!: string;

  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ enum: ['active', 'inactive', 'missing'] })
  status!: 'active' | 'inactive' | 'missing';

  @ApiProperty({ minimum: 0 })
  missingEmployeeCount!: number;

  @ApiProperty({ minimum: 0 })
  expiringEmployeeCount!: number;
}

export class WorkforceCompliancePolicySummaryDto {
  @ApiProperty({ enum: ['missing', 'inactive', 'invalid', 'active'] })
  status!: 'missing' | 'inactive' | 'invalid' | 'active';

  @ApiProperty({ format: 'uuid', nullable: true })
  policyId!: string | null;

  @ApiProperty({ minimum: 1, nullable: true })
  policyVersion!: number | null;

  @ApiProperty({ enum: ['ANY', 'ALL'], nullable: true })
  requirementMode!: 'ANY' | 'ALL' | null;

  @ApiProperty({ minimum: 0 })
  requirementCount!: number;

  @ApiProperty({ type: [WorkforceCompliancePolicyRequirementDto] })
  requirements!: WorkforceCompliancePolicyRequirementDto[];
}

export class WorkforceComplianceOperationSummaryDto {
  @ApiProperty({ enum: COMPETENCY_OPERATIONS })
  operationKey!: (typeof COMPETENCY_OPERATIONS)[number];

  @ApiProperty({ type: String, format: 'date', nullable: true })
  asOf!: string | null;

  @ApiProperty({ minimum: 1, maximum: 365 })
  horizonDays!: number;

  @ApiProperty({ type: WorkforceCompliancePolicySummaryDto })
  policy!: WorkforceCompliancePolicySummaryDto;

  @ApiProperty({ type: WorkforceComplianceReadinessCountsDto })
  readiness!: WorkforceComplianceReadinessCountsDto;

  @ApiProperty({ type: Object, additionalProperties: { type: 'integer', minimum: 0 } })
  findingCounts!: Partial<Record<WorkforceComplianceFindingCode, number>>;
}

export class WorkforceCompliancePolicyDetailDto {
  @ApiProperty({ enum: COMPETENCY_OPERATIONS })
  operationKey!: (typeof COMPETENCY_OPERATIONS)[number];

  @ApiProperty({ type: String, format: 'date', nullable: true })
  asOf!: string | null;

  @ApiProperty({ minimum: 1, maximum: 365 })
  horizonDays!: number;

  @ApiProperty({ type: WorkforceCompliancePolicySummaryDto })
  policy!: WorkforceCompliancePolicySummaryDto;

  @ApiProperty({ type: WorkforceComplianceReadinessCountsDto })
  readiness!: WorkforceComplianceReadinessCountsDto;

  @ApiProperty({ type: Object, additionalProperties: { type: 'integer', minimum: 0 } })
  findingCounts!: Partial<Record<WorkforceComplianceFindingCode, number>>;
}

export class WorkforceComplianceSummaryDto {
  @ApiProperty({ type: String, format: 'date', nullable: true })
  asOf!: string | null;

  @ApiProperty({ minimum: 1, maximum: 365 })
  horizonDays!: number;

  @ApiProperty({ minimum: 0 })
  employeeCount!: number;

  @ApiProperty({ minimum: 0 })
  employeesWithMissingRequirements!: number;

  @ApiProperty({ minimum: 0 })
  expiredQualifications!: number;

  @ApiProperty({ minimum: 0 })
  expiringQualifications!: number;

  @ApiProperty({ type: [WorkforceComplianceOperationSummaryDto] })
  operations!: WorkforceComplianceOperationSummaryDto[];

  @ApiProperty({ type: [String] })
  historyLimitations!: readonly string[];
}

export class WorkforceComplianceOperationReadinessDto {
  @ApiProperty({ enum: COMPETENCY_OPERATIONS })
  operationKey!: (typeof COMPETENCY_OPERATIONS)[number];

  @ApiProperty({ enum: ['ready', 'at_risk', 'not_ready'], nullable: true })
  readiness!: WorkforceReadiness | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  projectedEligibilityEnd!: string | null;

  @ApiProperty({
    type: [String],
    enum: [
      'COMPETENCY_POLICY_MISSING',
      'COMPETENCY_POLICY_INACTIVE',
      'COMPETENCY_POLICY_INVALID',
      'EMPLOYEE_INACTIVE',
      'EMPLOYEE_LINK_MISSING',
      'COMPETENCY_REQUIREMENT_UNMET',
      'COMPETENCY_ELIGIBILITY_EXPIRING',
    ],
  })
  findingCodes!: WorkforceComplianceFindingCode[];
}

export class WorkforceComplianceFindingDto {
  @ApiProperty({
    enum: [
      'COMPETENCY_POLICY_MISSING',
      'COMPETENCY_POLICY_INACTIVE',
      'COMPETENCY_POLICY_INVALID',
      'EMPLOYEE_INACTIVE',
      'EMPLOYEE_LINK_MISSING',
      'COMPETENCY_REQUIREMENT_UNMET',
      'COMPETENCY_ELIGIBILITY_EXPIRING',
    ],
  })
  code!: WorkforceComplianceFindingCode;

  @ApiProperty({ enum: ['warning', 'critical'] })
  severity!: 'warning' | 'critical';

  @ApiProperty()
  blocking!: boolean;

  @ApiProperty({ type: String, format: 'date' })
  effectiveDate!: string;

  @ApiProperty({ enum: COMPETENCY_OPERATIONS })
  operationKey!: (typeof COMPETENCY_OPERATIONS)[number];

  @ApiProperty({ format: 'uuid', nullable: true })
  policyId!: string | null;

  @ApiProperty({ minimum: 1, nullable: true })
  policyVersion!: number | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  qualificationIds!: readonly string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  assignmentIds!: readonly string[];
}

export class WorkforceComplianceOperationDetailDto extends WorkforceComplianceOperationReadinessDto {
  @ApiProperty({ type: [WorkforceComplianceFindingDto] })
  findings!: WorkforceComplianceFindingDto[];
}

export class WorkforceComplianceEmployeeDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ nullable: true })
  organizationName!: string | null;

  @ApiProperty({ enum: ['active', 'inactive', 'archived'] })
  status!: EmployeeStatus;

  @ApiProperty({ type: String, format: 'date' })
  asOf!: string;

  @ApiProperty({ type: [WorkforceComplianceOperationReadinessDto] })
  operations!: WorkforceComplianceOperationReadinessDto[];

  @ApiProperty({ type: [String] })
  findingCodes!: WorkforceComplianceFindingCode[];
}

export class WorkforceComplianceQualificationDto {
  @ApiProperty({ format: 'uuid' })
  assignmentId!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty()
  employeeFirstName!: string;

  @ApiProperty()
  employeeLastName!: string;

  @ApiProperty({ enum: ['active', 'inactive', 'archived'] })
  employeeStatus!: EmployeeStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ nullable: true })
  organizationName!: string | null;

  @ApiProperty({ format: 'uuid' })
  qualificationId!: string;

  @ApiProperty()
  qualificationName!: string;

  @ApiProperty({ nullable: true })
  qualificationCode!: string | null;

  @ApiProperty({ enum: ['active', 'revoked'] })
  assignmentStatus!: 'active' | 'revoked';

  @ApiProperty({ enum: ['valid', 'expiring_soon', 'expired', 'not_yet_valid', 'revoked'] })
  complianceStatus!: QualificationComplianceStatus;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;

  @ApiProperty({ type: String, format: 'date' })
  asOf!: string;
}

export class WorkforceComplianceEmployeeDetailDto extends WorkforceComplianceEmployeeDto {
  @ApiProperty({ type: [WorkforceComplianceOperationDetailDto] })
  override operations!: WorkforceComplianceOperationDetailDto[];

  @ApiProperty({ type: [WorkforceComplianceQualificationDto] })
  qualifications!: WorkforceComplianceQualificationDto[];

  @ApiProperty({ type: [String] })
  historyLimitations!: readonly string[];
}

export class WorkforceComplianceAffectedOperationDto {
  @ApiProperty({ enum: COMPETENCY_OPERATIONS })
  operationKey!: (typeof COMPETENCY_OPERATIONS)[number];

  @ApiProperty({ enum: ['ready', 'at_risk', 'not_ready'], nullable: true })
  readiness!: WorkforceReadiness | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  projectedEligibilityEnd!: string | null;

  @ApiProperty({ type: [String] })
  findingCodes!: WorkforceComplianceFindingCode[];
}

export class WorkforceComplianceQualificationImpactEmployeeDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ nullable: true })
  organizationName!: string | null;

  @ApiProperty({ enum: ['active', 'inactive', 'archived'] })
  status!: EmployeeStatus;

  @ApiProperty({ enum: ['ready', 'at_risk', 'not_ready'], nullable: true })
  readiness!: WorkforceReadiness | null;

  @ApiProperty({ type: [WorkforceComplianceAffectedOperationDto] })
  affectedOperations!: WorkforceComplianceAffectedOperationDto[];
}

export class WorkforceComplianceEmployeePageDto {
  @ApiProperty({ type: [WorkforceComplianceEmployeeDto] })
  items!: WorkforceComplianceEmployeeDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

export class WorkforceComplianceQualificationPageDto {
  @ApiProperty({ type: [WorkforceComplianceQualificationDto] })
  items!: WorkforceComplianceQualificationDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

export class WorkforceComplianceQualificationImpactPageDto {
  @ApiProperty({ type: [WorkforceComplianceQualificationImpactEmployeeDto] })
  items!: WorkforceComplianceQualificationImpactEmployeeDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

export class WorkforceComplianceSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 365 })
  criticalDays!: number;

  @ApiProperty({ minimum: 1, maximum: 365 })
  warningDays!: number;

  @ApiProperty()
  reportingTimezone!: string;

  @ApiProperty({ minimum: 0 })
  version!: number;
}

export class WorkforceComplianceSettingsReadDto extends WorkforceComplianceSettingsDto {
  @ApiProperty()
  canManage!: boolean;
}
