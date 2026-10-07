import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
const optionalDate = date.nullable().optional();

const categoryFields = {
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).nullable().optional(),
};
export const createServiceCategorySchema = z.object(categoryFields).strict();
export const updateServiceCategorySchema = z
  .object(categoryFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const serviceFields = {
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  categoryId: z.string().uuid(),
  unit: z.enum(['occurrence', 'minute', 'hour', 'day']),
  defaultDurationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  validFrom: date,
  validUntil: optionalDate,
};
export const createServiceSchema = z.object(serviceFields).strict();
export const updateServiceSchema = z
  .object(serviceFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const serviceAvailabilitySchema = z
  .object({
    organizationId: z.string().uuid(),
    facilityId: z.string().uuid().nullable().optional(),
    active: z.boolean().default(true),
    validFrom: optionalDate,
    validUntil: optionalDate,
  })
  .strict();
export const replaceAvailabilitySchema = z
  .object({ items: z.array(serviceAvailabilitySchema).max(200) })
  .strict();

export class ServiceCategoryInputDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10000 })
  sortOrder?: number | null;
}

export class ServiceCategoryPatchDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10000 })
  sortOrder?: number | null;
}

export class ServiceCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ nullable: true })
  sortOrder!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ServiceCategoryListResponseDto {
  @ApiProperty({ type: [ServiceCategoryResponseDto] })
  items!: ServiceCategoryResponseDto[];
}

export class ServiceInputDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  code!: string;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  description?: string | null;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit!: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 1440 })
  defaultDurationMinutes?: number | null;

  @ApiProperty({ type: String, format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class ServicePatchDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 64 })
  code?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit?: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 1440 })
  defaultDurationMinutes?: number | null;

  @ApiPropertyOptional({ type: String, format: 'date' })
  validFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class ServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit!: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiProperty({ nullable: true })
  defaultDurationMinutes!: number | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';

  @ApiProperty({ type: String, format: 'date' })
  validFrom!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ServiceListItemResponseDto extends ServiceResponseDto {
  @ApiProperty()
  categoryName!: string;

  @ApiProperty({ minimum: 0 })
  availabilityCount!: number;
}

export class ServiceListResponseDto {
  @ApiProperty({ type: [ServiceListItemResponseDto] })
  items!: ServiceListItemResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class ServiceAvailabilityInputDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  facilityId?: string | null;

  @ApiPropertyOptional({ default: true })
  active?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class ReplaceServiceAvailabilityDto {
  @ApiProperty({ type: [ServiceAvailabilityInputDto], maxItems: 200 })
  items!: ServiceAvailabilityInputDto[];
}

export class ServiceAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  facilityId!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
