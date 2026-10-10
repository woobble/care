import { z } from 'zod';
import { needsAssessmentSchema } from '@care/onboarding';

const uuid = z.uuid();
const stage = z.enum([
  'inquiry',
  'assessment',
  'preparation',
  'ready_for_admission',
  'admitted',
  'declined',
  'withdrawn',
]);
const isoDate = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });

export const onboardingSearchSchema = z.object({
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
  stage: stage.optional(),
  ownerEmployeeId: uuid.optional(),
  createdFrom: isoDate.optional(),
  createdTo: isoDate.optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  readiness: z.enum(['ready', 'blocked']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const onboardingCaseCreateSchema = z
  .object({
    organizationId: uuid,
    facilityId: uuid.nullable().optional(),
    ownerEmployeeId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    contactMethod: z.enum(['phone', 'email', 'in_person', 'letter', 'other']),
    requesterName: z.string().max(160).nullable().optional(),
    requesterRelationship: z.string().max(120).nullable().optional(),
    contactEmail: z.email().max(254).nullable().optional(),
    contactPhone: z.string().max(80).nullable().optional(),
    requestedServices: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    preferredStartDate: isoDate.nullable().optional(),
    serviceLocation: z.string().max(500).nullable().optional(),
    inquirySource: z.string().trim().min(1).max(120),
    fundingPlan: z.enum(['unknown', 'private_pay', 'benefits', 'other']).optional(),
    fundingPlanDetails: z.string().trim().max(1000).nullable().optional(),
    initialNotes: z.string().max(4000).nullable().optional(),
    nextFollowUpAt: timestamp.nullable().optional(),
  })
  .strict();

export const onboardingCasePatchSchema = onboardingCaseCreateSchema
  .omit({ organizationId: true, clientId: true })
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .strict();

export const onboardingClientLinkSchema = z
  .object({
    clientId: uuid,
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const onboardingAssessmentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    data: needsAssessmentSchema,
  })
  .strict();

export const onboardingTransitionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    toStage: stage,
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const onboardingVersionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const onboardingChecklistResponseSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(['complete', 'not_applicable']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const onboardingDocumentLinkSchema = z
  .object({
    documentArtifactId: uuid,
    requirementCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  })
  .strict();

export const onboardingTemplateQuerySchema = z.object({ organizationId: uuid.optional() });
export const onboardingTemplatePatchSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    items: z
      .array(
        z
          .object({
            code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
            category: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(160),
            source: z.enum(['automatic', 'manual', 'document']),
            mandatory: z.boolean(),
            requirementType: z.enum(['policy', 'external']),
          })
          .strict(),
      )
      .min(7)
      .max(40),
  })
  .strict();

export const onboardingTaskLinkSchema = z.object({ taskId: uuid }).strict();
export const onboardingCommunicationLinkSchema = z.object({ interactionId: uuid }).strict();
export const onboardingProspectCommunicationSchema = z
  .object({
    direction: z.enum(['inbound', 'outbound', 'internal']),
    channel: z.enum(['phone', 'in_person', 'email', 'letter', 'portal', 'other']),
    category: z.enum([
      'general_inquiry',
      'appointment_coordination',
      'cancellation_rescheduling',
      'service_request',
      'service_agreement',
      'documentation',
      'billing_payment',
      'benefits_payer',
      'complaint_feedback',
      'other',
    ]),
    subject: z.string().trim().min(1).max(200),
    summary: z.string().max(4000).nullable().optional(),
    outcome: z.enum([
      'information_provided',
      'request_received',
      'action_required',
      'appointment_agreed',
      'no_answer',
      'resolved',
      'other',
    ]),
    occurredAt: timestamp,
  })
  .strict();
export const onboardingVisitLinkSchema = z
  .object({
    visitId: uuid,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
