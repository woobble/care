import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const optionalName = z.string().trim().min(1).max(160);
const optionalCode = z.string().trim().min(1).max(40).nullable().optional();
const optionalAddress = z.string().trim().max(500).nullable().optional();
const optionalPhone = z.string().trim().max(40).nullable().optional();
const optionalEmail = z.string().email().max(320).nullable().optional();

export const createOrganizationSchema = z
  .object({
    name: optionalName,
    legalName: z.string().trim().min(1).max(200).nullable().optional(),
    code: optionalCode,
    address: optionalAddress,
    phone: optionalPhone,
    email: optionalEmail,
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const updateOrganizationSchema = createOrganizationSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one organization field is required');

export const createFacilitySchema = z
  .object({
    organizationId: z.string().uuid(),
    name: optionalName,
    code: optionalCode,
    address: optionalAddress,
    phone: optionalPhone,
    email: optionalEmail,
    timezone: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict();

export const updateFacilitySchema = createFacilitySchema
  .omit({ organizationId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one facility field is required');

export const createTeamSchema = z
  .object({
    organizationId: z.string().uuid(),
    facilityId: z.string().uuid().nullable().optional(),
    name: optionalName,
  })
  .strict();

export const updateTeamSchema = z
  .object({
    facilityId: z.string().uuid().nullable().optional(),
    name: optionalName.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one team field is required');

export const structureStatusSchema = z.enum(['active', 'archived']);

export class OrganizationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  legalName!: string | null;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ example: 'Europe/Berlin' })
  timezone!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class FacilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty({ enum: ['active', 'archived'] })
  organizationStatus!: 'active' | 'archived';

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ example: 'Europe/Berlin', nullable: true })
  timezone!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TeamResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ nullable: true })
  facilityId!: string | null;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty({ nullable: true })
  facilityName!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CreateOrganizationDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  name!: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  legalName?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ example: 'Europe/Berlin' })
  timezone?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  name?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  legalName?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ example: 'Europe/Berlin' })
  timezone?: string;
}

export class CreateFacilityDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  name!: string;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ example: 'Europe/Berlin', nullable: true })
  timezone?: string | null;
}

export class UpdateFacilityDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  name?: string;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ example: 'Europe/Berlin', nullable: true })
  timezone?: string | null;
}

export class CreateTeamDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  facilityId?: string | null;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  name!: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  facilityId?: string | null;

  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  name?: string;
}
