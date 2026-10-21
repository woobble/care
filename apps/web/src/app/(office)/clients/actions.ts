'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  readString,
  readNullableText,
  readNullableDate,
  readUuid,
  requireClientId,
  readChoice,
  clientPath,
  refreshClient,
} from '@app/web/features/clients/lib/client-form-data';
import { updateClientAction as updateClient } from '@app/web/features/clients/actions/update-client';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const contactRoles = [
  'primary_contact',
  'emergency_contact',
  'legal_representative',
  'authorized_contact',
  'invoice_recipient',
] as const;

// Keep the route action entry point compatible with Next's use-server export transform.
export async function updateClientAction(formData: FormData): Promise<boolean | void> {
  const result = await updateClient(formData);
  if (result?.ok === false) return false;
}

export async function createClientAction(formData: FormData): Promise<boolean | void> {
  const firstName = readString(formData, 'firstName');
  const lastName = readString(formData, 'lastName');
  const organizationId = readUuid(formData.get('organizationId'));
  const primaryFacilityId = readUuid(formData.get('primaryFacilityId'));
  const preferredName = readString(formData, 'preferredName');
  const dateOfBirth = readString(formData, 'dateOfBirth');
  const dateOfDeath = readString(formData, 'dateOfDeath');
  const gender = readChoice(formData, 'gender', ['female', 'male', 'diverse'] as const);
  const salutation = readChoice(formData, 'salutation', ['mr', 'ms', 'mx', 'other'] as const);
  const email = readString(formData, 'email');
  const phone = readString(formData, 'phone');
  const mobile = readString(formData, 'mobile');
  const street = readString(formData, 'addressStreet');
  const houseNumber = readString(formData, 'addressHouseNumber');
  const addressAddition = readString(formData, 'addressAddition');
  const postalCode = readString(formData, 'addressPostalCode');
  const city = readString(formData, 'addressCity');
  const countryCode = readString(formData, 'addressCountryCode').toUpperCase() || 'DE';
  const hasAddress = [street, houseNumber, addressAddition, postalCode, city].some(Boolean);
  if (
    !firstName ||
    !lastName ||
    !organizationId ||
    !primaryFacilityId ||
    (hasAddress && (!street || !city))
  ) {
    return false;
  }
  const body = {
    firstName,
    lastName,
    organizationId,
    primaryFacilityId,
    ...(preferredName ? { preferredName } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(dateOfDeath ? { dateOfDeath } : {}),
    ...(gender ? { gender } : {}),
    ...(salutation ? { salutation } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(mobile ? { mobile } : {}),
    ...(hasAddress
      ? {
          primaryAddress: {
            addressType: 'home' as const,
            street,
            city,
            countryCode,
            isPrimary: true,
            ...(houseNumber ? { houseNumber } : {}),
            ...(addressAddition ? { addressAddition } : {}),
            ...(postalCode ? { postalCode } : {}),
          },
        }
      : {}),
  };
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/clients', {
    params: { header: await getTenantHeader() },
    body,
  });
  if (error || !data) return false;
  revalidatePath('/clients');
  redirect(`/clients/${data.id}`);
}

export async function activateClientAction(formData: FormData): Promise<void> {
  await changeClientState(formData, 'activate');
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  await changeClientState(formData, 'archive');
}

export async function changeClientProviderContextAction(
  formData: FormData,
): Promise<boolean | void> {
  const id = requireClientId(formData);
  const organizationId = readUuid(formData.get('organizationId'));
  const primaryFacilityId = readUuid(formData.get('primaryFacilityId'));
  if (!organizationId || !primaryFacilityId) return false;
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/clients/{id}/provider-context', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { organizationId, primaryFacilityId },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function addClientAddressAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const street = readString(formData, 'street');
  const city = readString(formData, 'city');
  const addressType = readChoice(formData, 'addressType', ['home', 'billing', 'other'] as const);
  if (!street || !city || !addressType) return false;
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/addresses', {
    params: { path: { clientId: id }, header: await getTenantHeader() },
    body: {
      addressType,
      street,
      city,
      houseNumber: readNullableText(formData, 'houseNumber'),
      addressAddition: readNullableText(formData, 'addressAddition'),
      postalCode: readNullableText(formData, 'postalCode'),
      countryCode: readString(formData, 'countryCode').toUpperCase() || 'DE',
      validFrom: readNullableDate(formData, 'validFrom'),
      validUntil: readNullableDate(formData, 'validUntil'),
      isPrimary: formData.get('isPrimary') === 'on',
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function updateClientAddressAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const addressId = readUuid(formData.get('addressId'));
  const street = readString(formData, 'street');
  const city = readString(formData, 'city');
  if (!addressId || !street || !city) return false;
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/clients/{clientId}/addresses/{addressId}', {
    params: { path: { clientId: id, addressId }, header: await getTenantHeader() },
    body: {
      addressType: readChoice(formData, 'addressType', ['home', 'billing', 'other']) ?? 'home',
      street,
      city,
      houseNumber: readNullableText(formData, 'houseNumber'),
      addressAddition: readNullableText(formData, 'addressAddition'),
      postalCode: readNullableText(formData, 'postalCode'),
      countryCode: readString(formData, 'countryCode').toUpperCase() || 'DE',
      validFrom: readNullableDate(formData, 'validFrom'),
      validUntil: readNullableDate(formData, 'validUntil'),
      isPrimary: formData.get('isPrimary') === 'on',
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function removeClientAddressAction(formData: FormData): Promise<void> {
  const id = requireClientId(formData);
  const addressId = readUuid(formData.get('addressId'));
  if (!addressId) redirect(clientPath(id, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/clients/{clientId}/addresses/{addressId}', {
    params: { path: { clientId: id, addressId }, header: await getTenantHeader() },
  });
  if (error) redirect(clientPath(id, error.code));
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function addClientContactAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const firstName = readString(formData, 'firstName');
  const lastName = readString(formData, 'lastName');
  const relationshipType = readChoice(formData, 'relationshipType', [
    'daughter',
    'son',
    'spouse',
    'relative',
    'legal_representative',
    'guardian',
    'other',
  ] as const);
  if (!firstName || !lastName || !relationshipType) return false;
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/contacts', {
    params: { path: { clientId: id }, header: await getTenantHeader() },
    body: {
      firstName,
      lastName,
      relationshipType,
      phone: readNullableText(formData, 'phone'),
      mobile: readNullableText(formData, 'mobile'),
      email: readNullableText(formData, 'email'),
      roles: readChoices(formData, 'roles', contactRoles),
      representationType:
        readChoice(formData, 'representationType', [
          'power_of_attorney',
          'legal_guardianship',
          'authorized_representative',
        ] as const) ?? null,
      representationValidFrom: readNullableDate(formData, 'representationValidFrom'),
      representationValidUntil: readNullableDate(formData, 'representationValidUntil'),
      representationReference: readNullableText(formData, 'representationReference'),
      addressStreet: readNullableText(formData, 'addressStreet'),
      addressHouseNumber: readNullableText(formData, 'addressHouseNumber'),
      addressAddition: readNullableText(formData, 'addressAddition'),
      addressPostalCode: readNullableText(formData, 'addressPostalCode'),
      addressCity: readNullableText(formData, 'addressCity'),
      addressCountryCode: readNullableText(formData, 'addressCountryCode')?.toUpperCase() ?? null,
      notes: readNullableText(formData, 'notes'),
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function updateClientContactAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const contactId = readUuid(formData.get('contactId'));
  const firstName = readString(formData, 'firstName');
  const lastName = readString(formData, 'lastName');
  const relationshipType = readChoice(formData, 'relationshipType', [
    'daughter',
    'son',
    'spouse',
    'relative',
    'legal_representative',
    'guardian',
    'other',
  ] as const);
  if (!contactId || !firstName || !lastName || !relationshipType) return false;
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/clients/{clientId}/contacts/{contactId}', {
    params: { path: { clientId: id, contactId }, header: await getTenantHeader() },
    body: {
      firstName,
      lastName,
      relationshipType,
      phone: readNullableText(formData, 'phone'),
      mobile: readNullableText(formData, 'mobile'),
      email: readNullableText(formData, 'email'),
      addressStreet: readNullableText(formData, 'addressStreet'),
      addressHouseNumber: readNullableText(formData, 'addressHouseNumber'),
      addressAddition: readNullableText(formData, 'addressAddition'),
      addressPostalCode: readNullableText(formData, 'addressPostalCode'),
      addressCity: readNullableText(formData, 'addressCity'),
      addressCountryCode: readNullableText(formData, 'addressCountryCode')?.toUpperCase() ?? null,
      representationType:
        readChoice(formData, 'representationType', [
          'power_of_attorney',
          'legal_guardianship',
          'authorized_representative',
        ] as const) ?? null,
      representationValidFrom: readNullableDate(formData, 'representationValidFrom'),
      representationValidUntil: readNullableDate(formData, 'representationValidUntil'),
      representationReference: readNullableText(formData, 'representationReference'),
      roles: readChoices(formData, 'roles', contactRoles),
      notes: readNullableText(formData, 'notes'),
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function removeClientContactAction(formData: FormData): Promise<void> {
  const id = requireClientId(formData);
  const contactId = readUuid(formData.get('contactId'));
  if (!contactId) redirect(clientPath(id, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/clients/{clientId}/contacts/{contactId}', {
    params: { path: { clientId: id, contactId }, header: await getTenantHeader() },
  });
  if (error) redirect(clientPath(id, error.code));
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function addClientInsuranceAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const insuranceType = readChoice(formData, 'insuranceType', [
    'pflegeversicherung',
    'krankenversicherung',
    'private',
    'other',
  ] as const);
  const insurerName = readString(formData, 'insurerName');
  if (!insuranceType || !insurerName) return false;
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/insurances', {
    params: { path: { clientId: id }, header: await getTenantHeader() },
    body: {
      insuranceType,
      insurerName,
      insuranceNumber: readNullableText(formData, 'insuranceNumber'),
      memberNumber: readNullableText(formData, 'memberNumber'),
      validFrom: readNullableDate(formData, 'validFrom'),
      validUntil: readNullableDate(formData, 'validUntil'),
      isPrimary: formData.get('isPrimary') === 'on',
      notes: readNullableText(formData, 'notes'),
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function updateClientInsuranceAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const insuranceId = readUuid(formData.get('insuranceId'));
  const insuranceType = readChoice(formData, 'insuranceType', [
    'pflegeversicherung',
    'krankenversicherung',
    'private',
    'other',
  ] as const);
  const insurerName = readString(formData, 'insurerName');
  if (!insuranceId || !insuranceType || !insurerName) return false;
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/clients/{clientId}/insurances/{insuranceId}', {
    params: { path: { clientId: id, insuranceId }, header: await getTenantHeader() },
    body: {
      insuranceType,
      insurerName,
      insuranceNumber: readNullableText(formData, 'insuranceNumber'),
      memberNumber: readNullableText(formData, 'memberNumber'),
      validFrom: readNullableDate(formData, 'validFrom'),
      validUntil: readNullableDate(formData, 'validUntil'),
      isPrimary: formData.get('isPrimary') === 'on',
      notes: readNullableText(formData, 'notes'),
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function addClientPflegegradAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const grade = readInteger(formData, 'grade');
  const validFrom = readString(formData, 'validFrom');
  const status = readChoice(formData, 'status', ['pending', 'confirmed', 'revoked'] as const);
  if (!grade || !validFrom || !datePattern.test(validFrom) || !status) return false;
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/pflegegrade', {
    params: { path: { clientId: id }, header: await getTenantHeader() },
    body: {
      grade,
      validFrom,
      status,
      validUntil: readNullableDate(formData, 'validUntil'),
      decisionDate: readNullableDate(formData, 'decisionDate'),
      insurerReference: readNullableText(formData, 'insurerReference'),
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function updateFuturePflegegradAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const recordId = readUuid(formData.get('recordId'));
  const grade = readInteger(formData, 'grade');
  const validFrom = readString(formData, 'validFrom');
  const status = readChoice(formData, 'status', ['pending', 'confirmed', 'revoked'] as const);
  if (!recordId || !grade || !validFrom || !datePattern.test(validFrom) || !status) return false;
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/clients/{clientId}/pflegegrade/{recordId}', {
    params: { path: { clientId: id, recordId }, header: await getTenantHeader() },
    body: { grade, validFrom, status },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

export async function saveClientSchedulingPreferencesAction(
  formData: FormData,
): Promise<boolean | void> {
  const id = requireClientId(formData);
  const preferredWeekdays = readIntegers(formData, 'preferredWeekdays', 1, 7);
  const preferredEmployeeId = readUuid(formData.get('preferredEmployeeId')) ?? null;
  const avoidedEmployeeIds = readUuids(formData, 'avoidedEmployeeIds');
  const preferredTimeWindows: Array<{ startsAt: string; endsAt: string }> = [];
  for (let slot = 1; slot <= 4; slot += 1) {
    const startsAt = readString(formData, `preferredWindow${slot}Start`);
    const endsAt = readString(formData, `preferredWindow${slot}End`);
    if (!startsAt && !endsAt) continue;
    if (!validTime(startsAt) || !validTime(endsAt) || startsAt >= endsAt) {
      return false;
    }
    preferredTimeWindows.push({ startsAt, endsAt });
  }
  if (preferredEmployeeId && avoidedEmployeeIds.includes(preferredEmployeeId)) {
    return false;
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/clients/{clientId}/scheduling-preferences', {
    params: { path: { clientId: id }, header: await getTenantHeader() },
    body: { preferredWeekdays, preferredTimeWindows, preferredEmployeeId, avoidedEmployeeIds },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(`${clientPath(id, '')}?updated=scheduling_preferences#scheduling`);
}

export async function saveClientRoutingLocationAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const latitude = readCoordinate(formData, 'latitude', -90, 90);
  const longitude = readCoordinate(formData, 'longitude', -180, 180);
  if (latitude === undefined || longitude === undefined) {
    return false;
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/clients/{clientId}/routing-location', {
    params: { path: { clientId: id }, header: await getTenantHeader() },
    body: { latitude, longitude },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(`${clientPath(id, '')}?updated=routing_location#scheduling`);
}

async function changeClientState(formData: FormData, state: 'activate' | 'archive'): Promise<void> {
  const id = requireClientId(formData);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const response =
    state === 'activate'
      ? await api.POST('/api/v1/clients/{id}/activate', { params: { path: { id }, header } })
      : await api.POST('/api/v1/clients/{id}/archive', { params: { path: { id }, header } });
  if (response.error) redirect(clientPath(id, response.error.code));
  await refreshClient(id);
  redirect(clientPath(id, ''));
}

function readChoices<const Values extends readonly string[]>(
  formData: FormData,
  name: string,
  values: Values,
): Values[number][] {
  return [
    ...new Set(formData.getAll(name).filter((item): item is string => typeof item === 'string')),
  ].filter((item): item is Values[number] => values.includes(item as Values[number]));
}

function readInteger(formData: FormData, name: string): number | undefined {
  const value = readString(formData, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readIntegers(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
): number[] {
  return [...new Set(formData.getAll(name))]
    .filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function readUuids(formData: FormData, name: string): string[] {
  return [...new Set(formData.getAll(name))]
    .filter((value): value is string => typeof value === 'string' && uuidPattern.test(value.trim()))
    .map((value) => value.trim());
}

function readCoordinate(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = readString(formData, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
