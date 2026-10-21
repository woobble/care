'use server';

import { redirect } from 'next/navigation';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';

import { clientPath, refreshClient } from '../lib/client-form-data';
import { parseClientUpdate, type ClientUpdateFailure } from '../lib/client-update.schema';

export async function updateClientAction(formData: FormData): Promise<ClientUpdateFailure | void> {
  const parsed = parseClientUpdate(formData);
  if (!parsed.success) {
    // Invalid IDs keep the existing redirect, including precedence over name errors.
    if (parsed.error.issues.some((issue) => issue.path[0] === 'id')) {
      redirect('/clients?error=INVALID_REQUEST');
    }
    const fieldErrors: ClientUpdateFailure['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'firstName' || issue.path[0] === 'lastName') {
        fieldErrors[issue.path[0]] = ['required'];
      }
    }
    return { ok: false, fieldErrors };
  }
  const { id, ...body } = parsed.data;
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/clients/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body,
  });
  if (error) return { ok: false, formError: 'actionFailed' };
  await refreshClient(id);
  redirect(clientPath(id, ''));
}
