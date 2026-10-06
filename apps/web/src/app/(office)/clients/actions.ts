'use server';

import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../lib/api';

export async function createClientAction(formData: FormData): Promise<void> {
  const firstName = readString(formData, 'firstName');
  const lastName = readString(formData, 'lastName');
  const preferredName = readString(formData, 'preferredName');
  const dateOfBirth = readString(formData, 'dateOfBirth');
  const email = readString(formData, 'email');
  const phone = readString(formData, 'phone');
  const body = {
    firstName,
    lastName,
    ...(preferredName ? { preferredName } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/clients', {
    params: { header: await getTenantHeader() },
    body,
  });
  if (error || !data) redirect('/clients/new?error=create');
  redirect(`/clients/${data.id}`);
}

export async function activateClientAction(formData: FormData): Promise<void> {
  await changeClientState(formData, 'activate');
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  await changeClientState(formData, 'archive');
}

async function changeClientState(formData: FormData, state: 'activate' | 'archive'): Promise<void> {
  const id = readString(formData, 'id');
  const api = await getApiClient();
  const header = await getTenantHeader();
  const response =
    state === 'activate'
      ? await api.POST('/api/v1/clients/{id}/activate', { params: { path: { id }, header } })
      : await api.POST('/api/v1/clients/{id}/archive', { params: { path: { id }, header } });
  if (response.error) redirect(`/clients/${encodeURIComponent(id)}?error=${state}`);
  redirect(`/clients/${encodeURIComponent(id)}`);
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
