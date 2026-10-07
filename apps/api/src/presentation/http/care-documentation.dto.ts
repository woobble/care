import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const positiveVersion = z.number().int().positive();
const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const entryTypes = ['care_note', 'observation', 'deviation', 'incident'] as const;
const severities = ['low', 'moderate', 'high', 'critical'] as const;

export const documentationWorklistQuerySchema = z.object({
  from: timestamp,
  until: timestamp,
  clientQuery: z.string().trim().min(1).max(120).optional(),
  facilityId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['draft', 'finalized', 'missing']).optional(),
  incomplete: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const addDocumentationEntrySchema = z
  .object({
    expectedVersion: positiveVersion,
    type: z.enum(entryTypes),
    content: z.string().trim().min(1).max(4000),
    occurredAt: timestamp.nullable().optional(),
    severity: z.enum(severities).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.type === 'incident' && (!value.occurredAt || !value.severity)) {
      context.addIssue({ code: 'custom', message: 'Incident time and severity are required' });
    }
    if (value.type !== 'incident' && value.severity != null) {
      context.addIssue({ code: 'custom', message: 'Severity is only valid for incidents' });
    }
  });

export const updateDocumentationEntrySchema = z
  .object({
    expectedVersion: positiveVersion,
    type: z.enum(entryTypes).optional(),
    content: z.string().trim().min(1).max(4000).optional(),
    occurredAt: timestamp.nullable().optional(),
    severity: z.enum(severities).nullable().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'));

export const recordServiceEvidenceSchema = z.object({
  expectedVersion: positiveVersion,
  status: z.enum(['documented', 'not_required']),
  note: z.string().max(1000).nullable().optional(),
});

export const finalizeDocumentationSchema = z.object({ expectedVersion: positiveVersion });

export const addDocumentationAmendmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  correction: z.string().trim().min(1).max(4000),
});

export class DocumentationMissingRequirementDto {
  @ApiProperty({
    enum: [
      'DOCUMENTATION_REQUIRED',
      'VISIT_EXECUTION_REQUIRED',
      'SERVICE_EVIDENCE_REQUIRED',
      'NOT_PERFORMED_REASON_REQUIRED',
      'PARTIAL_SERVICE_EXPLANATION_REQUIRED',
    ],
  })
  code!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  performedServiceId?: string;
}

export class DocumentationCompletenessDto {
  @ApiProperty()
  isComplete!: boolean;

  @ApiProperty({ type: [DocumentationMissingRequirementDto] })
  missing!: DocumentationMissingRequirementDto[];
}

export class DocumentationVisitDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientDisplayName!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) facilityId!: string;
  @ApiProperty({ enum: ['planned', 'confirmed', 'cancelled'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty({ format: 'date-time' }) plannedEnd!: string;
  @ApiProperty() timezone!: string;
}

export class DocumentationExecutionDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) id!: string | null;
  @ApiProperty({ enum: ['not_started', 'in_progress', 'completed'] }) status!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) actualStart!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) actualEnd!: string | null;
}

export class CareDocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) createdByEmployeeId!: string;
  @ApiPropertyOptional({ nullable: true }) createdByEmployeeName!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) finalizedByEmployeeId!: string | null;
  @ApiPropertyOptional({ nullable: true }) finalizedByEmployeeName!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) finalizedAt!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ServiceEvidenceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['documented', 'not_required'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) documentedByEmployeeId!: string;
  @ApiPropertyOptional({ nullable: true }) documentedByEmployeeName!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DocumentationServiceDto {
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiProperty() serviceName!: string;
  @ApiProperty() serviceCode!: string;
  @ApiProperty({ enum: ['performed', 'partially_performed', 'not_performed'] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) reasonCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) actualQuantity!: string | null;
  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] }) unit!: string;
  @ApiPropertyOptional({ type: ServiceEvidenceDto, nullable: true })
  evidence!: ServiceEvidenceDto | null;
}

export class DocumentationEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: entryTypes }) type!: (typeof entryTypes)[number];
  @ApiProperty({ format: 'uuid' }) authorEmployeeId!: string;
  @ApiPropertyOptional({ nullable: true }) authorEmployeeName!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) occurredAt!: string | null;
  @ApiPropertyOptional({ enum: severities, nullable: true }) severity!:
    | (typeof severities)[number]
    | null;
  @ApiProperty() content!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DocumentationAmendmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) authorUserId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() correction!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class DocumentationHistoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) actorUserId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) actorEmployeeId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
}

export class CareDocumentationDetailDto {
  @ApiProperty({ type: DocumentationVisitDto }) visit!: DocumentationVisitDto;
  @ApiProperty({ type: DocumentationExecutionDto }) execution!: DocumentationExecutionDto;
  @ApiPropertyOptional({ type: CareDocumentDto, nullable: true })
  documentation!: CareDocumentDto | null;
  @ApiProperty({ type: [DocumentationServiceDto] }) services!: DocumentationServiceDto[];
  @ApiProperty({ type: [DocumentationEntryDto] }) entries!: DocumentationEntryDto[];
  @ApiProperty({ type: [DocumentationAmendmentDto] }) amendments!: DocumentationAmendmentDto[];
  @ApiProperty({ type: [DocumentationHistoryDto] }) history!: DocumentationHistoryDto[];
  @ApiProperty({ type: DocumentationCompletenessDto }) completeness!: DocumentationCompletenessDto;
}

export class DocumentationWorklistItemDto {
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientDisplayName!: string;
  @ApiProperty({ format: 'uuid' }) facilityId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['in_progress', 'completed'] }) executionStatus!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) documentationId!: string | null;
  @ApiProperty({ enum: ['missing', 'draft', 'finalized'] }) documentationStatus!: string;
  @ApiPropertyOptional({ nullable: true }) documentationVersion!: number | null;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiPropertyOptional({ nullable: true }) employeeName!: string | null;
  @ApiProperty({ type: [DocumentationMissingRequirementDto] })
  missing!: DocumentationMissingRequirementDto[];
}

export class DocumentationWorklistDto {
  @ApiProperty({ type: [DocumentationWorklistItemDto] }) items!: DocumentationWorklistItemDto[];
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}

export class AddDocumentationEntryRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: entryTypes }) type!: (typeof entryTypes)[number];
  @ApiProperty({ minLength: 1, maxLength: 4000 }) content!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) occurredAt?: string | null;
  @ApiPropertyOptional({ enum: severities, nullable: true }) severity?:
    | (typeof severities)[number]
    | null;
}

export class UpdateDocumentationEntryRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiPropertyOptional({ enum: entryTypes }) type?: (typeof entryTypes)[number];
  @ApiPropertyOptional({ minLength: 1, maxLength: 4000 }) content?: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) occurredAt?: string | null;
  @ApiPropertyOptional({ enum: severities, nullable: true }) severity?:
    | (typeof severities)[number]
    | null;
}

export class RecordServiceEvidenceRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: ['documented', 'not_required'] }) status!: 'documented' | 'not_required';
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) note?: string | null;
}

export class FinalizeDocumentationRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
}

export class AddDocumentationAmendmentRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) reason!: string;
  @ApiProperty({ minLength: 1, maxLength: 4000 }) correction!: string;
}
