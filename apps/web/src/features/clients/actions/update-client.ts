'use server';

import { redirect } from 'next/navigation';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';

import {
  readString,
  readNullableText,
  readNullableDate,
  requireClientId,
  readChoice,
  clientPath,
  refreshClient,
} from '../lib/client-form-data';

export async function updateClientAction(formData: FormData): Promise<boolean | void> {
  const id = requireClientId(formData);
  const firstName = readString(formData, 'firstName');
  const lastName = readString(formData, 'lastName');
  if (!firstName || !lastName) return false;
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/clients/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      firstName,
      lastName,
      preferredName: readNullableText(formData, 'preferredName'),
      dateOfBirth: readNullableDate(formData, 'dateOfBirth'),
      dateOfDeath: readNullableDate(formData, 'dateOfDeath'),
      gender: readChoice(formData, 'gender', ['female', 'male', 'diverse'] as const) ?? null,
      salutation: readChoice(formData, 'salutation', ['mr', 'ms', 'mx', 'other'] as const) ?? null,
      email: readNullableText(formData, 'email'),
      phone: readNullableText(formData, 'phone'),
      mobile: readNullableText(formData, 'mobile'),
    },
  });
  if (error) return false;
  await refreshClient(id);
  redirect(clientPath(id, ''));
}
