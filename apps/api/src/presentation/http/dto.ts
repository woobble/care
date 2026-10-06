import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const personalDataShape = {
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  preferredName: z.string().trim().max(120).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
};

export const createClientSchema = z.object(personalDataShape).strict();
export const updateClientSchema = z
  .object(personalDataShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one client field is required');

export class CreateClientDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  firstName!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  lastName!: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;
}

export class UpdateClientDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  firstName?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  lastName?: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;
}

export class ClientResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  dateOfBirth!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ enum: ['pending', 'active', 'archived'] })
  status!: 'pending' | 'active' | 'archived';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ClientListResponseDto {
  @ApiProperty({ type: [ClientResponseDto] })
  items!: ClientResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class MeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: 'active' | 'disabled';
}

export class TenantSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProblemDetailsDto {
  @ApiProperty({ format: 'uri' })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: number;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  traceId!: string;
}
