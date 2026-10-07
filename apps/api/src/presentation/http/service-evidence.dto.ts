import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const signatory = z.discriminatedUnion('type', [
  z.object({ type: z.literal('client') }).strict(),
  z
    .object({
      type: z.enum(['representative', 'other_authorized_person']),
      contactId: z.string().uuid(),
    })
    .strict(),
]);
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const strokes = z.array(z.array(point).min(2).max(2000)).min(1).max(32);

export const acknowledgeEvidenceSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    signatory,
    method: z.enum(['touch_signature', 'typed_confirmation']),
    confirmationName: z.string().trim().min(1).max(200).optional(),
    strokes: strokes.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method === 'touch_signature' && !value.strokes) {
      context.addIssue({ code: 'custom', message: 'Touch signature strokes are required' });
    }
    if (value.method === 'touch_signature' && value.confirmationName !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Confirmation name is not used for a signature',
      });
    }
    if (value.method === 'typed_confirmation' && !value.confirmationName) {
      context.addIssue({ code: 'custom', message: 'Confirmation name is required' });
    }
    if (value.method === 'typed_confirmation' && value.strokes !== undefined) {
      context.addIssue({ code: 'custom', message: 'Strokes are not used for typed confirmation' });
    }
  });

export const declineEvidenceSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    signatory,
    reasonCode: z.enum([
      'declined_without_reason',
      'disagrees_with_record',
      'unable_to_sign',
      'signatory_not_available',
      'other',
    ]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const revokeAcknowledgementSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

const worklistStatuses = [
  'awaiting_acknowledgement',
  'acknowledged',
  'declined',
  'revoked',
  'outdated',
  'superseded',
] as const;

export const serviceEvidenceWorklistQuerySchema = z.object({
  from: timestamp,
  until: timestamp,
  status: z.enum(worklistStatuses).optional(),
  visitId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  clientQuery: z.string().trim().min(1).max(120).optional(),
  employeeId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  signatoryType: z.enum(['client', 'representative', 'other_authorized_person']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export class EvidencePackageItemDto {
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiProperty() serviceCode!: string;
  @ApiProperty() serviceName!: string;
  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] }) unit!: string;
  @ApiPropertyOptional({ nullable: true }) plannedQuantity!: string | null;
  @ApiPropertyOptional({ nullable: true }) actualQuantity!: string | null;
  @ApiProperty({ enum: ['performed', 'partially_performed', 'not_performed'] }) outcome!: string;
  @ApiPropertyOptional({ nullable: true }) reasonCode!: string | null;
  @ApiProperty({ format: 'uuid' }) performedByEmployeeId!: string;
  @ApiProperty({ enum: ['documented', 'not_required'] }) evidenceState!: string;
}

export class EvidenceSnapshotDto {
  @ApiProperty({ enum: [1] }) snapshotVersion!: 1;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ format: 'uuid' }) executionId!: string;
  @ApiProperty() executionVersion!: number;
  @ApiProperty({ format: 'date-time' }) actualStart!: string;
  @ApiProperty({ format: 'date-time' }) actualEnd!: string;
  @ApiProperty({ format: 'uuid' }) documentationId!: string;
  @ApiProperty() documentationVersion!: number;
  @ApiProperty() amendmentCount!: number;
  @ApiProperty({ type: [EvidencePackageItemDto] }) items!: EvidencePackageItemDto[];
}

export class EvidenceAcknowledgementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['acknowledged', 'declined', 'revoked'] }) status!: string;
  @ApiProperty({ enum: ['client', 'representative', 'other_authorized_person'] })
  signatoryType!: string;
  @ApiProperty() signatoryName!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) signatoryContactId!: string | null;
  @ApiProperty({
    enum: ['client', 'legal_guardian', 'authorized_representative', 'relative', 'other'],
  })
  capacity!: string;
  @ApiPropertyOptional({ nullable: true }) relationship!: string | null;
  @ApiPropertyOptional({ nullable: true }) representationType!: string | null;
  @ApiProperty() method!: string;
  @ApiProperty() statementVersion!: string;
  @ApiProperty() statementText!: string;
  @ApiProperty() evidencePackageHash!: string;
  @ApiPropertyOptional({ nullable: true }) signatureSha256!: string | null;
  @ApiProperty() signatureAvailable!: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) acknowledgedAt!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) declinedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) declineReasonCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) declineNote!: string | null;
  @ApiProperty({ format: 'uuid' }) capturedByEmployeeId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) revokedAt!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) revokedByUserId!: string | null;
  @ApiPropertyOptional({ nullable: true }) revocationReason!: string | null;
}

export class EligibleSignatoryDto {
  @ApiProperty({ format: 'uuid' }) contactId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['representative', 'other_authorized_person'] }) signatoryType!: string;
  @ApiProperty({ enum: ['legal_guardian', 'authorized_representative', 'relative', 'other'] })
  capacity!: string;
  @ApiProperty() relationship!: string;
  @ApiProperty({ enum: ['power_of_attorney', 'legal_guardianship', 'authorized_representative'] })
  representationType!: string;
}

export class EvidencePackageResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) documentationId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty() snapshotHash!: string;
  @ApiProperty({ type: EvidenceSnapshotDto }) snapshot!: EvidenceSnapshotDto;
  @ApiProperty() statementVersion!: string;
  @ApiProperty() statementText!: string;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty({ enum: ['ready', 'acknowledged', 'declined', 'revoked', 'outdated'] })
  status!: string;
  @ApiProperty() acknowledgementRequired!: boolean;
  @ApiProperty({ type: [EvidenceAcknowledgementDto] })
  acknowledgements!: EvidenceAcknowledgementDto[];
  @ApiProperty({ type: [EligibleSignatoryDto] }) eligibleSignatories!: EligibleSignatoryDto[];
}

export class ServiceEvidenceWorklistItemDto {
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'uuid' }) documentationId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) evidencePackageId!: string | null;
  @ApiPropertyOptional({ nullable: true }) packageVersion!: number | null;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: worklistStatuses }) status!: (typeof worklistStatuses)[number];
  @ApiPropertyOptional({ nullable: true }) snapshotHash!: string | null;
  @ApiPropertyOptional({ nullable: true }) signatoryType!: string | null;
  @ApiPropertyOptional({ nullable: true }) signatoryName!: string | null;
  @ApiPropertyOptional({ nullable: true }) capacity!: string | null;
  @ApiPropertyOptional({ nullable: true }) method!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) acknowledgedAt!: string | null;
  @ApiProperty() signatureAvailable!: boolean;
}

export class ServiceEvidenceWorklistDto {
  @ApiProperty({ type: [ServiceEvidenceWorklistItemDto] }) items!: ServiceEvidenceWorklistItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export class SignaturePointDto {
  @ApiProperty({ minimum: 0, maximum: 1 }) x!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) y!: number;
}

export class SignatureResponseDto {
  @ApiProperty({ enum: [1] }) version!: 1;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  })
  strokes!: SignaturePointDto[][];
}

export class SignatoryRequestDto {
  @ApiProperty({ enum: ['client', 'representative', 'other_authorized_person'] }) type!: string;
  @ApiPropertyOptional({ format: 'uuid' }) contactId?: string;
}

export class AcknowledgeEvidenceRequestDto {
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiProperty({ type: SignatoryRequestDto }) signatory!: SignatoryRequestDto;
  @ApiProperty({ enum: ['touch_signature', 'typed_confirmation'] }) method!: string;
  @ApiPropertyOptional() confirmationName?: string;
  @ApiPropertyOptional({
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  })
  strokes?: SignaturePointDto[][];
}

export class DeclineEvidenceRequestDto {
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiProperty({ type: SignatoryRequestDto }) signatory!: SignatoryRequestDto;
  @ApiProperty({
    enum: [
      'declined_without_reason',
      'disagrees_with_record',
      'unable_to_sign',
      'signatory_not_available',
      'other',
    ],
  })
  reasonCode!: string;
  @ApiPropertyOptional({ maxLength: 500, nullable: true }) note?: string | null;
}

export class RevokeAcknowledgementRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) reason!: string;
}
