import { z } from 'zod';

const uuid = z.uuid();
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  });
const locale = z.enum(['de', 'en']).optional();
const commandOptions = {
  locale,
  preview: z.boolean().optional(),
  idempotencyKey: uuid.optional(),
};

export const documentTypeSchema = z.enum([
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
]);

export const documentGenerationCommandSchema = z.discriminatedUnion('sourceType', [
  z
    .object({
      ...commandOptions,
      sourceType: z.literal('evidence_package'),
      evidencePackageId: uuid,
    })
    .strict(),
  z
    .object({
      ...commandOptions,
      sourceType: z.literal('evidence_period'),
      clientId: uuid,
      organizationId: uuid,
      facilityId: uuid.optional(),
      from: date,
      until: date,
    })
    .strict()
    .refine((value) => value.from <= value.until),
  z
    .object({
      ...commandOptions,
      sourceType: z.literal('service_agreement'),
      agreementId: uuid,
    })
    .strict(),
  z
    .object({
      ...commandOptions,
      sourceType: z.literal('benefit_overview'),
      clientId: uuid,
      asOf: date.optional(),
    })
    .strict(),
]);

export const documentListQuerySchema = z
  .object({
    organizationId: uuid.optional(),
    clientId: uuid.optional(),
    facilityId: uuid.optional(),
    documentType: documentTypeSchema.optional(),
    page,
    pageSize,
  })
  .strict()
  .refine((value) => Boolean(value.organizationId || value.clientId));

export const documentTemplateTypeSchema = documentTypeSchema;
export const documentTemplateQuerySchema = z.object({ organizationId: uuid }).strict();

export const documentTemplateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    logoAssetId: uuid.nullable().optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable()
      .optional(),
    headerText: z.string().max(500).nullable().optional(),
    footerText: z.string().max(500).nullable().optional(),
    contactEmail: z.string().max(254).nullable().optional(),
    contactPhone: z.string().max(80).nullable().optional(),
    contactWebsite: z.string().max(254).nullable().optional(),
    defaultLocale: z.enum(['de', 'en']).optional(),
    contractTermsText: z.string().max(8000).nullable().optional(),
  })
  .strict();

export const documentLogoUploadSchema = z.object({ organizationId: uuid }).strict();

const exportRange = {
  from: date,
  until: date,
  organizationId: uuid,
  facilityId: uuid.optional(),
  clientId: uuid.optional(),
  bom: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
};

export const billingExportQuerySchema = z
  .object({
    ...exportRange,
    status: z.enum(['draft', 'issued', 'cancelled']).optional(),
    recipientType: z.enum(['client', 'payer']).optional(),
    fundingType: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .refine((value) => value.from <= value.until);

export const benefitAllocationExportQuerySchema = z
  .object({
    ...exportRange,
    benefitType: z
      .enum(['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'])
      .optional(),
    fundingSourceType: z
      .enum([
        'statutory_long_term_care_insurance',
        'private_long_term_care_insurance',
        'self_pay',
        'other',
      ])
      .optional(),
  })
  .strict()
  .refine((value) => value.from <= value.until);

export type DocumentGenerationCommand = z.infer<typeof documentGenerationCommandSchema>;
