import { ApiProperty, ApiPropertyOptional, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableDate = dateString.nullable().optional();
const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const agreementScheduleRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily') }).strict(),
  z
    .object({ type: z.literal('weekly'), weekdays: z.array(z.enum(weekdays)).min(1).max(7) })
    .strict(),
  z.object({ type: z.literal('occurrences_per_week'), count: z.number().int() }).strict(),
  z.object({ type: z.literal('interval_days'), intervalDays: z.number().int() }).strict(),
  z.object({ type: z.literal('on_demand') }).strict(),
]);

const agreementScheduleRuleOpenApi: SchemaObject[] = [
  {
    type: 'object',
    required: ['type'],
    properties: { type: { type: 'string', enum: ['daily'] } },
  },
  {
    type: 'object',
    required: ['type', 'weekdays'],
    properties: {
      type: { type: 'string', enum: ['weekly'] },
      weekdays: { type: 'array', items: { type: 'string', enum: [...weekdays] } },
    },
  },
  {
    type: 'object',
    required: ['type', 'count'],
    properties: {
      type: { type: 'string', enum: ['occurrences_per_week'] },
      count: { type: 'integer' },
    },
  },
  {
    type: 'object',
    required: ['type', 'intervalDays'],
    properties: {
      type: { type: 'string', enum: ['interval_days'] },
      intervalDays: { type: 'integer' },
    },
  },
  {
    type: 'object',
    required: ['type'],
    properties: { type: { type: 'string', enum: ['on_demand'] } },
  },
];

export const createServiceAgreementSchema = z
  .object({
    validFrom: dateString,
    validUntil: nullableDate,
    reference: z.string().max(120).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const updateServiceAgreementSchema = z
  .object({
    validFrom: dateString.optional(),
    validUntil: nullableDate,
    reference: z.string().max(120).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const serviceAgreementQuerySchema = z
  .object({
    clientId: z.string().uuid().optional(),
    status: z.enum(['draft', 'active', 'suspended', 'ended']).optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    validAt: dateString.optional(),
    serviceDefinitionId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['validFrom', 'createdAt', 'status']).default('validFrom'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const serviceAgreementClientQuerySchema = serviceAgreementQuerySchema.omit({
  clientId: true,
});

export const createAgreementServiceSchema = z
  .object({
    serviceDefinitionId: z.string().uuid(),
    validFrom: nullableDate,
    validUntil: nullableDate,
    quantity: z.string().max(13).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    scheduleRule: agreementScheduleRuleSchema.nullable().optional(),
    preferredTimeStart: z.string().max(5).nullable().optional(),
    preferredTimeEnd: z.string().max(5).nullable().optional(),
  })
  .strict();

export const updateAgreementServiceSchema = z
  .object({
    validFrom: nullableDate,
    validUntil: nullableDate,
    quantity: z.string().max(13).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    scheduleRule: agreementScheduleRuleSchema.nullable().optional(),
    preferredTimeStart: z.string().max(5).nullable().optional(),
    preferredTimeEnd: z.string().max(5).nullable().optional(),
  })
  .strict();

export class CreateServiceAgreementDto {
  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  description?: string | null;
}

export class UpdateServiceAgreementDto {
  @ApiPropertyOptional({ format: 'date' })
  validFrom?: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  description?: string | null;
}

export class AgreementServiceInputDto {
  @ApiProperty({ format: 'uuid' })
  serviceDefinitionId!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Exact decimal quantity with at most three fractional digits',
  })
  quantity?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  note?: string | null;

  @ApiPropertyOptional({ oneOf: agreementScheduleRuleOpenApi, nullable: true })
  scheduleRule?: unknown;

  @ApiPropertyOptional({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', nullable: true })
  preferredTimeStart?: string | null;

  @ApiPropertyOptional({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', nullable: true })
  preferredTimeEnd?: string | null;
}

export class UpdateAgreementServiceDto {
  @ApiPropertyOptional({ format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  quantity?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  note?: string | null;

  @ApiPropertyOptional({ oneOf: agreementScheduleRuleOpenApi, nullable: true })
  scheduleRule?: unknown;

  @ApiPropertyOptional({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', nullable: true })
  preferredTimeStart?: string | null;

  @ApiPropertyOptional({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', nullable: true })
  preferredTimeEnd?: string | null;
}

export class ServiceAgreementResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty({ enum: ['draft', 'active', 'suspended', 'ended'] })
  status!: 'draft' | 'active' | 'suspended' | 'ended';

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiPropertyOptional({ nullable: true })
  reference!: string | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ServiceAgreementListItemDto extends ServiceAgreementResponseDto {
  @ApiProperty({ minimum: 0 })
  serviceCount!: number;
}

export class ServiceAgreementListResponseDto {
  @ApiProperty({ type: [ServiceAgreementListItemDto] })
  items!: ServiceAgreementListItemDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

export class AgreementServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  agreementId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceDefinitionId!: string;

  @ApiProperty()
  serviceCode!: string;

  @ApiProperty()
  serviceName!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  serviceUnit!: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiProperty({ enum: ['active', 'ended'] })
  status!: 'active' | 'ended';

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  quantity!: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  note!: string | null;

  @ApiPropertyOptional({ oneOf: agreementScheduleRuleOpenApi, nullable: true })
  scheduleRule!: unknown;

  @ApiPropertyOptional({ nullable: true })
  preferredTimeStart!: string | null;

  @ApiPropertyOptional({ nullable: true })
  preferredTimeEnd!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  endedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
