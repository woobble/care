export type ClientAddressType = 'home' | 'billing' | 'other';

export interface ClientAddressData {
  addressType: ClientAddressType;
  street: string;
  houseNumber?: string | null;
  addressAddition?: string | null;
  postalCode?: string | null;
  city: string;
  countryCode?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  isPrimary: boolean;
}

export interface ClientAddressSnapshot extends Omit<
  ClientAddressData,
  'houseNumber' | 'addressAddition' | 'postalCode' | 'countryCode' | 'validFrom' | 'validUntil'
> {
  id: string;
  tenantId: string;
  clientId: string;
  houseNumber: string | null;
  addressAddition: string | null;
  postalCode: string | null;
  countryCode: string;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClientRelationshipType =
  | 'daughter'
  | 'son'
  | 'spouse'
  | 'relative'
  | 'legal_representative'
  | 'guardian'
  | 'other';

export type ClientContactRole =
  | 'primary_contact'
  | 'emergency_contact'
  | 'legal_representative'
  | 'authorized_contact'
  | 'invoice_recipient';

export type ClientRepresentationType =
  | 'power_of_attorney'
  | 'legal_guardianship'
  | 'authorized_representative';

export interface ClientContactData {
  firstName: string;
  lastName: string;
  relationshipType: ClientRelationshipType;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  addressStreet?: string | null;
  addressHouseNumber?: string | null;
  addressAddition?: string | null;
  addressPostalCode?: string | null;
  addressCity?: string | null;
  addressCountryCode?: string | null;
  representationType?: ClientRepresentationType | null;
  representationValidFrom?: string | null;
  representationValidUntil?: string | null;
  representationReference?: string | null;
  roles: ClientContactRole[];
  notes?: string | null;
}

export interface ClientContactSnapshot extends Omit<
  ClientContactData,
  | 'phone'
  | 'mobile'
  | 'email'
  | 'addressStreet'
  | 'addressHouseNumber'
  | 'addressAddition'
  | 'addressPostalCode'
  | 'addressCity'
  | 'addressCountryCode'
  | 'representationType'
  | 'representationValidFrom'
  | 'representationValidUntil'
  | 'representationReference'
  | 'notes'
> {
  id: string;
  tenantId: string;
  clientId: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  addressStreet: string | null;
  addressHouseNumber: string | null;
  addressAddition: string | null;
  addressPostalCode: string | null;
  addressCity: string | null;
  addressCountryCode: string | null;
  representationType: ClientRepresentationType | null;
  representationValidFrom: string | null;
  representationValidUntil: string | null;
  representationReference: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClientInsuranceType =
  | 'pflegeversicherung'
  | 'krankenversicherung'
  | 'private'
  | 'other';

export interface ClientInsuranceData {
  insuranceType: ClientInsuranceType;
  insurerName: string;
  insuranceNumber?: string | null;
  memberNumber?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  isPrimary: boolean;
  notes?: string | null;
}

export interface ClientInsuranceSnapshot extends Omit<
  ClientInsuranceData,
  'insuranceNumber' | 'memberNumber' | 'validFrom' | 'validUntil' | 'notes'
> {
  id: string;
  tenantId: string;
  clientId: string;
  insuranceNumber: string | null;
  memberNumber: string | null;
  validFrom: string | null;
  validUntil: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PflegegradStatus = 'pending' | 'confirmed' | 'revoked';

export interface PflegegradData {
  grade: number;
  validFrom: string;
  validUntil?: string | null;
  decisionDate?: string | null;
  insurerReference?: string | null;
  status: PflegegradStatus;
}

export interface PflegegradSnapshot extends Omit<
  PflegegradData,
  'validUntil' | 'decisionDate' | 'insurerReference'
> {
  id: string;
  tenantId: string;
  clientId: string;
  validUntil: string | null;
  decisionDate: string | null;
  insurerReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function validateClientAddress(input: ClientAddressData): void {
  if (!input.street.trim() || !input.city.trim() || !isCountryCode(input.countryCode ?? 'DE')) {
    throw new InvalidClientAddressError();
  }
  validateDateRange(input.validFrom, input.validUntil, InvalidClientAddressError);
}

export function validateClientContact(input: ClientContactData): void {
  if (
    !input.firstName.trim() ||
    !input.lastName.trim() ||
    (input.notes && input.notes.length > 500)
  ) {
    throw new InvalidClientContactError();
  }
  if (new Set(input.roles).size !== input.roles.length) throw new InvalidClientContactError();
  if (input.representationType && !input.roles.includes('legal_representative')) {
    throw new InvalidClientContactError();
  }
  validateDateRange(
    input.representationValidFrom,
    input.representationValidUntil,
    InvalidClientContactError,
  );
}

export function validateClientInsurance(input: ClientInsuranceData): void {
  if (!input.insurerName.trim() || (input.notes && input.notes.length > 500)) {
    throw new InvalidClientInsuranceError();
  }
  validateDateRange(input.validFrom, input.validUntil, InvalidClientInsuranceError);
}

export function validatePflegegrad(input: PflegegradData): void {
  if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 5) {
    throw new InvalidPflegegradError();
  }
  if (!isISODate(input.validFrom) || (input.validUntil && !isISODate(input.validUntil))) {
    throw new InvalidPflegegradError();
  }
  if (input.validUntil && input.validUntil <= input.validFrom) throw new InvalidPflegegradError();
  if (input.decisionDate && !isISODate(input.decisionDate)) throw new InvalidPflegegradError();
}

function validateDateRange(
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
  ErrorType: new () => Error,
): void {
  if ((validFrom && !isISODate(validFrom)) || (validUntil && !isISODate(validUntil))) {
    throw new ErrorType();
  }
  if (validFrom && validUntil && validUntil <= validFrom) throw new ErrorType();
}

function isISODate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

export class InvalidClientAddressError extends Error {
  readonly code = 'INVALID_CLIENT_ADDRESS';

  constructor() {
    super('Client address fields or validity period are invalid');
    this.name = 'InvalidClientAddressError';
  }
}

export class ClientAddressNotFoundError extends Error {
  readonly code = 'CLIENT_ADDRESS_NOT_FOUND';

  constructor() {
    super('Client address not found');
    this.name = 'ClientAddressNotFoundError';
  }
}

export class InvalidClientContactError extends Error {
  readonly code = 'INVALID_CLIENT_CONTACT';

  constructor() {
    super('Client contact fields or representation validity are invalid');
    this.name = 'InvalidClientContactError';
  }
}

export class ClientContactNotFoundError extends Error {
  readonly code = 'CLIENT_CONTACT_NOT_FOUND';

  constructor() {
    super('Client contact not found');
    this.name = 'ClientContactNotFoundError';
  }
}

export class InvalidClientInsuranceError extends Error {
  readonly code = 'INVALID_CLIENT_INSURANCE';

  constructor() {
    super('Client insurance fields or validity period are invalid');
    this.name = 'InvalidClientInsuranceError';
  }
}

export class ClientInsuranceNotFoundError extends Error {
  readonly code = 'CLIENT_INSURANCE_NOT_FOUND';

  constructor() {
    super('Client insurance relationship not found');
    this.name = 'ClientInsuranceNotFoundError';
  }
}

export class InvalidPflegegradError extends Error {
  readonly code = 'INVALID_PFLEGEGRAD';

  constructor() {
    super('Pflegegrad or validity period is invalid');
    this.name = 'InvalidPflegegradError';
  }
}

export class PflegegradNotFoundError extends Error {
  readonly code = 'PFLEGEGRAD_NOT_FOUND';

  constructor() {
    super('Pflegegrad record not found');
    this.name = 'PflegegradNotFoundError';
  }
}

export class OverlappingPflegegradPeriodError extends Error {
  readonly code = 'OVERLAPPING_PFLEGEGRAD_PERIOD';

  constructor() {
    super('Pflegegrad validity periods cannot overlap');
    this.name = 'OverlappingPflegegradPeriodError';
  }
}
