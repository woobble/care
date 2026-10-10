import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });

export const createServicePriceSchema = z
  .object({
    organizationId: z.string().uuid(),
    facilityId: z.string().uuid().nullable().optional(),
    priceCents: z.number().int().positive().max(2_000_000_000),
    pricingUnit: z.enum(['hour', 'minute', 'visit', 'fixed']),
    validFrom: isoDate,
    validUntil: isoDate.nullable().optional(),
  })
  .strict();

export const servicePriceQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    facilityId: z.string().uuid().optional(),
    validAt: isoDate,
  })
  .strict();

export class ServicePriceInputDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  facilityId?: string | null;

  @ApiProperty({ minimum: 1, maximum: 2_000_000_000, description: 'Price in EUR cents' })
  priceCents!: number;

  @ApiProperty({ enum: ['hour', 'minute', 'visit', 'fixed'] })
  pricingUnit!: 'hour' | 'minute' | 'visit' | 'fixed';

  @ApiProperty({ type: String, format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class ServicePriceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  facilityId!: string | null;

  @ApiProperty({ description: 'Price in EUR cents' })
  priceCents!: number;

  @ApiProperty({ enum: ['hour', 'minute', 'visit', 'fixed'] })
  pricingUnit!: 'hour' | 'minute' | 'visit' | 'fixed';

  @ApiProperty({ type: String, format: 'date' })
  validFrom!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ServicePriceListResponseDto {
  @ApiProperty({ type: [ServicePriceResponseDto] })
  items!: ServicePriceResponseDto[];
}
