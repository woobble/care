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
const optionalText = (max = 200) => z.string().trim().max(max).nullable().optional();
const email = z.string().email().max(320).nullable().optional();

const addressFields = {
  addressType: z.enum(['home', 'billing', 'other']),
  street: z.string().trim().min(1).max(160),
  houseNumber: optionalText(40),
  addressAddition: optionalText(120),
  postalCode: optionalText(20),
  city: z.string().trim().min(1).max(120),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  validFrom: optionalDate,
  validUntil: optionalDate,
};

export const clientAddressSchema = z
  .object({ ...addressFields, isPrimary: z.boolean().default(false) })
  .strict();
export const createClientSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    preferredName: optionalText(120),
    dateOfBirth: optionalDate,
    dateOfDeath: optionalDate,
    gender: z.enum(['female', 'male', 'diverse']).nullable().optional(),
    salutation: z.enum(['mr', 'ms', 'mx', 'other']).nullable().optional(),
    email,
    phone: optionalText(40),
    mobile: optionalText(40),
    organizationId: z.string().uuid(),
    primaryFacilityId: z.string().uuid(),
    primaryAddress: z.object(addressFields).strict().nullable().optional(),
  })
  .strict();

const personalDataShape = {
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  preferredName: optionalText(120),
  dateOfBirth: optionalDate,
  dateOfDeath: optionalDate,
  gender: z.enum(['female', 'male', 'diverse']).nullable().optional(),
  salutation: z.enum(['mr', 'ms', 'mx', 'other']).nullable().optional(),
  email,
  phone: optionalText(40),
  mobile: optionalText(40),
};

export const updateClientSchema = z
  .object(personalDataShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const providerContextSchema = z
  .object({ organizationId: z.string().uuid(), primaryFacilityId: z.string().uuid() })
  .strict();
export const createAddressSchema = clientAddressSchema;
export const updateAddressSchema = z
  .object({ ...addressFields, isPrimary: z.boolean().optional() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const contactRoles = [
  'primary_contact',
  'emergency_contact',
  'legal_representative',
  'authorized_contact',
  'invoice_recipient',
] as const;
const contactFields = {
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  relationshipType: z.enum([
    'daughter',
    'son',
    'spouse',
    'relative',
    'legal_representative',
    'guardian',
    'other',
  ]),
  phone: optionalText(40),
  mobile: optionalText(40),
  email,
  addressStreet: optionalText(160),
  addressHouseNumber: optionalText(40),
  addressAddition: optionalText(120),
  addressPostalCode: optionalText(20),
  addressCity: optionalText(120),
  addressCountryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  representationType: z
    .enum(['power_of_attorney', 'legal_guardianship', 'authorized_representative'])
    .nullable()
    .optional(),
  representationValidFrom: optionalDate,
  representationValidUntil: optionalDate,
  representationReference: optionalText(120),
  roles: z.array(z.enum(contactRoles)).max(contactRoles.length).default([]),
  notes: optionalText(500),
};
export const createContactSchema = z.object(contactFields).strict();
export const updateContactSchema = z
  .object(contactFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const insuranceFields = {
  insuranceType: z.enum(['pflegeversicherung', 'krankenversicherung', 'private', 'other']),
  insurerName: z.string().trim().min(1).max(200),
  insuranceNumber: optionalText(120),
  memberNumber: optionalText(120),
  validFrom: optionalDate,
  validUntil: optionalDate,
  isPrimary: z.boolean().default(false),
  notes: optionalText(500),
};
export const createInsuranceSchema = z.object(insuranceFields).strict();
export const updateInsuranceSchema = z
  .object(insuranceFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const pflegegradFields = {
  grade: z.number().int(),
  validFrom: date,
  validUntil: optionalDate,
  decisionDate: optionalDate,
  insurerReference: optionalText(120),
  status: z.enum(['pending', 'confirmed', 'revoked']),
};
export const createPflegegradSchema = z.object(pflegegradFields).strict();
export const updatePflegegradSchema = z
  .object(pflegegradFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export class PrimaryAddressInputDto {
  @ApiProperty({ enum: ['home', 'billing', 'other'] })
  addressType!: 'home' | 'billing' | 'other';

  @ApiProperty()
  street!: string;

  @ApiPropertyOptional({ nullable: true })
  houseNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressAddition?: string | null;

  @ApiPropertyOptional({ nullable: true })
  postalCode?: string | null;

  @ApiProperty()
  city!: string;

  @ApiPropertyOptional({ default: 'DE', pattern: '^[A-Z]{2}$' })
  countryCode?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;
}

export class CreateClientDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  firstName!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  lastName!: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  preferredName?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dateOfDeath?: string | null;

  @ApiPropertyOptional({ enum: ['female', 'male', 'diverse'], nullable: true })
  gender?: 'female' | 'male' | 'diverse' | null;

  @ApiPropertyOptional({ enum: ['mr', 'ms', 'mx', 'other'], nullable: true })
  salutation?: 'mr' | 'ms' | 'mx' | 'other' | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  mobile?: string | null;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  primaryFacilityId!: string;

  @ApiPropertyOptional({ type: () => PrimaryAddressInputDto, nullable: true })
  primaryAddress?: PrimaryAddressInputDto | null;
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

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dateOfDeath?: string | null;

  @ApiPropertyOptional({ enum: ['female', 'male', 'diverse'], nullable: true })
  gender?: 'female' | 'male' | 'diverse' | null;

  @ApiPropertyOptional({ enum: ['mr', 'ms', 'mx', 'other'], nullable: true })
  salutation?: 'mr' | 'ms' | 'mx' | 'other' | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  mobile?: string | null;
}

export class CreateClientAddressDto extends PrimaryAddressInputDto {
  @ApiProperty()
  isPrimary!: boolean;
}

export class UpdateClientAddressDto {
  @ApiPropertyOptional({ enum: ['home', 'billing', 'other'] })
  addressType?: 'home' | 'billing' | 'other';

  @ApiPropertyOptional()
  street?: string;

  @ApiPropertyOptional({ nullable: true })
  houseNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressAddition?: string | null;

  @ApiPropertyOptional({ nullable: true })
  postalCode?: string | null;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional({ pattern: '^[A-Z]{2}$' })
  countryCode?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional()
  isPrimary?: boolean;
}

export class ClientContactInputDto {
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({
    enum: ['daughter', 'son', 'spouse', 'relative', 'legal_representative', 'guardian', 'other'],
  })
  relationshipType!: string;

  @ApiPropertyOptional({ nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mobile?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressStreet?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressHouseNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressAddition?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressPostalCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressCity?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^[A-Z]{2}$' })
  addressCountryCode?: string | null;

  @ApiPropertyOptional({
    enum: ['power_of_attorney', 'legal_guardianship', 'authorized_representative'],
    nullable: true,
  })
  representationType?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  representationValidFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  representationValidUntil?: string | null;

  @ApiPropertyOptional({ nullable: true })
  representationReference?: string | null;

  @ApiPropertyOptional({ type: [String], enum: contactRoles })
  roles?: string[];

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  notes?: string | null;
}

export class ClientContactPatchDto {
  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional({
    enum: ['daughter', 'son', 'spouse', 'relative', 'legal_representative', 'guardian', 'other'],
  })
  relationshipType?: string;

  @ApiPropertyOptional({ nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mobile?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressStreet?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressHouseNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressAddition?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressPostalCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressCity?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^[A-Z]{2}$' })
  addressCountryCode?: string | null;

  @ApiPropertyOptional({
    enum: ['power_of_attorney', 'legal_guardianship', 'authorized_representative'],
    nullable: true,
  })
  representationType?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  representationValidFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  representationValidUntil?: string | null;

  @ApiPropertyOptional({ nullable: true })
  representationReference?: string | null;

  @ApiPropertyOptional({ type: [String], enum: contactRoles })
  roles?: string[];

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  notes?: string | null;
}

export class ClientInsuranceInputDto {
  @ApiProperty({ enum: ['pflegeversicherung', 'krankenversicherung', 'private', 'other'] })
  insuranceType!: string;

  @ApiProperty()
  insurerName!: string;

  @ApiPropertyOptional({ nullable: true })
  insuranceNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  memberNumber?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  notes?: string | null;
}

export class ClientInsurancePatchDto {
  @ApiPropertyOptional({ enum: ['pflegeversicherung', 'krankenversicherung', 'private', 'other'] })
  insuranceType?: string;

  @ApiPropertyOptional()
  insurerName?: string;

  @ApiPropertyOptional({ nullable: true })
  insuranceNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  memberNumber?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional()
  isPrimary?: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  notes?: string | null;
}

export class PflegegradInputDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  grade!: number;

  @ApiProperty({ type: String, format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  decisionDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  insurerReference?: string | null;

  @ApiProperty({ enum: ['pending', 'confirmed', 'revoked'] })
  status!: string;
}

export class PflegegradPatchDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  grade?: number;

  @ApiPropertyOptional({ type: String, format: 'date' })
  validFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  decisionDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  insurerReference?: string | null;

  @ApiPropertyOptional({ enum: ['pending', 'confirmed', 'revoked'] })
  status?: string;
}

export class ProviderContextDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  primaryFacilityId!: string;
}

export class ClientResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  primaryFacilityId!: string | null;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  dateOfBirth!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  dateOfDeath!: string | null;

  @ApiProperty({ enum: ['female', 'male', 'diverse'], nullable: true })
  gender!: 'female' | 'male' | 'diverse' | null;

  @ApiProperty({ enum: ['mr', 'ms', 'mx', 'other'], nullable: true })
  salutation!: 'mr' | 'ms' | 'mx' | 'other' | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  mobile!: string | null;

  @ApiProperty({ enum: ['pending', 'active', 'archived'] })
  status!: 'pending' | 'active' | 'archived';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ClientListItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  primaryFacilityId!: string | null;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  dateOfBirth!: string | null;

  @ApiProperty({ enum: ['pending', 'active', 'archived'] })
  status!: 'pending' | 'active' | 'archived';

  @ApiProperty({ nullable: true })
  organizationName!: string | null;

  @ApiProperty({ nullable: true })
  facilityName!: string | null;

  @ApiProperty({ nullable: true, minimum: 1, maximum: 5 })
  currentPflegegrad!: number | null;
}

export class ClientListResponseDto {
  @ApiProperty({ type: [ClientListItemResponseDto] })
  items!: ClientListItemResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class ClientAddressResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['home', 'billing', 'other'] })
  addressType!: 'home' | 'billing' | 'other';

  @ApiProperty()
  street!: string;

  @ApiProperty({ nullable: true })
  houseNumber!: string | null;

  @ApiProperty({ nullable: true })
  addressAddition!: string | null;

  @ApiProperty({ nullable: true })
  postalCode!: string | null;

  @ApiProperty()
  city!: string;

  @ApiProperty({ pattern: '^[A-Z]{2}$' })
  countryCode!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ClientContactResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({
    enum: ['daughter', 'son', 'spouse', 'relative', 'legal_representative', 'guardian', 'other'],
  })
  relationshipType!: string;

  @ApiProperty({ type: [String], enum: contactRoles })
  roles!: string[];

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  mobile!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  addressStreet!: string | null;

  @ApiProperty({ nullable: true })
  addressHouseNumber!: string | null;

  @ApiProperty({ nullable: true })
  addressAddition!: string | null;

  @ApiProperty({ nullable: true })
  addressPostalCode!: string | null;

  @ApiProperty({ nullable: true })
  addressCity!: string | null;

  @ApiProperty({ nullable: true, pattern: '^[A-Z]{2}$' })
  addressCountryCode!: string | null;

  @ApiProperty({
    enum: ['power_of_attorney', 'legal_guardianship', 'authorized_representative'],
    nullable: true,
  })
  representationType!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  representationValidFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  representationValidUntil!: string | null;

  @ApiProperty({ nullable: true })
  representationReference!: string | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ClientInsuranceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['pflegeversicherung', 'krankenversicherung', 'private', 'other'] })
  insuranceType!: string;

  @ApiProperty()
  insurerName!: string;

  @ApiProperty({ nullable: true })
  insuranceNumber!: string | null;

  @ApiProperty({ nullable: true })
  memberNumber!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PflegegradResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  grade!: number;

  @ApiProperty({ type: String, format: 'date' })
  validFrom!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  decisionDate!: string | null;

  @ApiProperty({ nullable: true })
  insurerReference!: string | null;

  @ApiProperty({ enum: ['pending', 'confirmed', 'revoked'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ClientTimelineEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ format: 'uuid' })
  actorId!: string;

  @ApiProperty()
  action!: string;
}
