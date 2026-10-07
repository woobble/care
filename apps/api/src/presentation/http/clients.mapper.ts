import type {
  ClientAddressSnapshot,
  ClientContactSnapshot,
  ClientInsuranceSnapshot,
  ClientSnapshot,
  ClientSearchItem,
  ClientTimelineEntry,
  PflegegradSnapshot,
} from '@care/clients';
import type {
  ClientAddressResponseDto,
  ClientContactResponseDto,
  ClientInsuranceResponseDto,
  ClientListItemResponseDto,
  ClientResponseDto,
  ClientTimelineEntryDto,
  PflegegradResponseDto,
} from './clients.dto';

export function clientResponse(client: ClientSnapshot): ClientResponseDto {
  return {
    id: client.id,
    tenantId: client.tenantId,
    organizationId: client.organizationId,
    primaryFacilityId: client.primaryFacilityId,
    firstName: client.firstName,
    lastName: client.lastName,
    preferredName: client.preferredName ?? null,
    dateOfBirth: client.dateOfBirth ?? null,
    dateOfDeath: client.dateOfDeath ?? null,
    gender: client.gender ?? null,
    salutation: client.salutation ?? null,
    email: client.email ?? null,
    phone: client.phone ?? null,
    mobile: client.mobile ?? null,
    status: client.status,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

export function clientListItemResponse(item: ClientSearchItem): ClientListItemResponseDto {
  return {
    ...clientResponse(item.client),
    organizationName: item.organizationName,
    facilityName: item.facilityName,
    currentPflegegrad: item.currentPflegegrad,
  };
}

export function clientAddressResponse(address: ClientAddressSnapshot): ClientAddressResponseDto {
  return {
    id: address.id,
    addressType: address.addressType,
    street: address.street,
    houseNumber: address.houseNumber ?? null,
    addressAddition: address.addressAddition ?? null,
    postalCode: address.postalCode ?? null,
    city: address.city,
    countryCode: address.countryCode,
    validFrom: address.validFrom ?? null,
    validUntil: address.validUntil ?? null,
    isPrimary: address.isPrimary,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

export function clientContactResponse(contact: ClientContactSnapshot): ClientContactResponseDto {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    relationshipType: contact.relationshipType,
    roles: contact.roles,
    phone: contact.phone ?? null,
    mobile: contact.mobile ?? null,
    email: contact.email ?? null,
    addressStreet: contact.addressStreet ?? null,
    addressHouseNumber: contact.addressHouseNumber ?? null,
    addressAddition: contact.addressAddition ?? null,
    addressPostalCode: contact.addressPostalCode ?? null,
    addressCity: contact.addressCity ?? null,
    addressCountryCode: contact.addressCountryCode ?? null,
    representationType: contact.representationType ?? null,
    representationValidFrom: contact.representationValidFrom ?? null,
    representationValidUntil: contact.representationValidUntil ?? null,
    representationReference: contact.representationReference ?? null,
    notes: contact.notes ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function clientInsuranceResponse(
  insurance: ClientInsuranceSnapshot,
): ClientInsuranceResponseDto {
  return {
    id: insurance.id,
    insuranceType: insurance.insuranceType,
    insurerName: insurance.insurerName,
    insuranceNumber: insurance.insuranceNumber ?? null,
    memberNumber: insurance.memberNumber ?? null,
    validFrom: insurance.validFrom ?? null,
    validUntil: insurance.validUntil ?? null,
    isPrimary: insurance.isPrimary,
    notes: insurance.notes ?? null,
    createdAt: insurance.createdAt.toISOString(),
    updatedAt: insurance.updatedAt.toISOString(),
  };
}

export function pflegegradResponse(record: PflegegradSnapshot): PflegegradResponseDto {
  return {
    id: record.id,
    grade: record.grade,
    validFrom: record.validFrom,
    validUntil: record.validUntil ?? null,
    decisionDate: record.decisionDate ?? null,
    insurerReference: record.insurerReference ?? null,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function clientTimelineResponse(entry: ClientTimelineEntry): ClientTimelineEntryDto {
  return { ...entry };
}
