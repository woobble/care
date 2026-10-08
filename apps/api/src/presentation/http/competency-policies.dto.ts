import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COMPETENCY_OPERATIONS } from '@care/permissions';
import { z } from 'zod';

export const competencyOperationSchema = z.enum(COMPETENCY_OPERATIONS);
export const competencyPolicyDraftSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).nullable().optional(),
    requirementMode: z.enum(['ANY', 'ALL']),
    qualificationDefinitionIds: z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export class CompetencyPolicyDraftInputDto {
  @ApiProperty({ minimum: 0 })
  expectedVersion!: number;

  @ApiProperty({ maxLength: 160 })
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  description?: string | null;

  @ApiProperty({ enum: ['ANY', 'ALL'] })
  requirementMode!: 'ANY' | 'ALL';

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 100 })
  qualificationDefinitionIds!: string[];
}

export class CompetencyPolicyQualificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty()
  name!: string;
}

export class CompetencyPolicyRequirementDto {
  @ApiProperty({ format: 'uuid' })
  qualificationDefinitionId!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';
}

export class CompetencyPolicyVersionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['ANY', 'ALL'] })
  requirementMode!: 'ANY' | 'ALL';

  @ApiProperty({ enum: ['draft', 'active', 'inactive'] })
  status!: 'draft' | 'active' | 'inactive';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  activatedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  deactivatedAt!: string | null;

  @ApiProperty({ type: [CompetencyPolicyRequirementDto] })
  requirements!: CompetencyPolicyRequirementDto[];
}

export class CompetencyPolicyOperationDto {
  @ApiProperty({ enum: COMPETENCY_OPERATIONS })
  operationKey!: (typeof COMPETENCY_OPERATIONS)[number];

  @ApiProperty({ format: 'uuid', nullable: true })
  policyId!: string | null;

  @ApiProperty({ minimum: 0 })
  latestVersion!: number;

  @ApiProperty({ minimum: 1, nullable: true })
  activeVersion!: number | null;

  @ApiProperty({ type: [CompetencyPolicyVersionDto] })
  versions!: CompetencyPolicyVersionDto[];
}

export class CompetencyPolicyAdminDto {
  @ApiProperty({ type: [CompetencyPolicyOperationDto] })
  operations!: CompetencyPolicyOperationDto[];

  @ApiProperty({ type: [CompetencyPolicyQualificationDto] })
  qualificationDefinitions!: CompetencyPolicyQualificationDto[];
}
