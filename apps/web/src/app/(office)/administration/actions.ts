'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readUuid(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

export async function inviteUserAction(formData: FormData): Promise<void> {
  const email = formData.get('email');
  if (typeof email !== 'string' || !email.trim().includes('@') || email.trim().length > 254) {
    redirect('/administration/users?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/admin/invitations', {
    params: { header: await getTenantHeader() },
    body: { email: email.trim() },
  });
  if (error) redirect(`/administration/users?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/users');
  redirect('/administration/users?invited=1');
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('invitationId'));
  if (!id) redirect('/administration/users?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/admin/invitations/{id}/revoke', {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error) redirect(`/administration/users?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/users');
  redirect('/administration/users?updated=invitation');
}

export async function activateMemberAction(formData: FormData): Promise<void> {
  await changeMemberStatus(formData, 'activate');
}

export async function deactivateMemberAction(formData: FormData): Promise<void> {
  await changeMemberStatus(formData, 'deactivate');
}

export async function revokeMemberAction(formData: FormData): Promise<void> {
  await changeMemberStatus(formData, 'revoke');
}

async function changeMemberStatus(
  formData: FormData,
  operation: 'activate' | 'deactivate' | 'revoke',
): Promise<void> {
  const id = readUuid(formData.get('membershipId'));
  if (!id) redirect('/administration/users?error=INVALID_REQUEST');
  const api = await getApiClient();
  const path = `/api/v1/admin/members/{id}/${operation}` as const;
  const { error } = await api.POST(path, {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error) redirect(`/administration/users?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/users');
  revalidatePath(`/administration/users/${id}`);
  redirect(`/administration/users/${id}?updated=${operation}`);
}

export async function replaceMemberRolesAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('membershipId'));
  const roleIds = formData.getAll('roleId');
  if (
    !id ||
    roleIds.length > 20 ||
    !roleIds.every((roleId) => typeof roleId === 'string' && uuidPattern.test(roleId)) ||
    new Set(roleIds).size !== roleIds.length
  ) {
    redirect('/administration/users?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/admin/members/{id}/roles', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { roleIds: roleIds as string[] },
  });
  if (error) redirect(`/administration/users/${id}?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/users');
  revalidatePath(`/administration/users/${id}`);
  redirect(`/administration/users/${id}?updated=roles`);
}

export async function replaceMemberScopesAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('membershipId'));
  const scopeMode = formData.get('scopeMode');
  if (!id || (scopeMode !== 'tenant' && scopeMode !== 'scoped')) {
    redirect('/administration/users?error=INVALID_REQUEST');
  }
  const tenantHeader = await getTenantHeader();
  const tenantId = tenantHeader['X-Tenant-Id'];
  if (!uuidPattern.test(tenantId)) redirect('/?error=tenant');

  const selectedScopes = formData.getAll('scope').map((item) => {
    if (typeof item !== 'string') return null;
    const [scopeType, scopeId, extra] = item.split(':');
    if (
      extra !== undefined ||
      (scopeType !== 'organization' && scopeType !== 'facility' && scopeType !== 'team') ||
      !scopeId ||
      !uuidPattern.test(scopeId)
    ) {
      return null;
    }
    return { scopeType: scopeType as 'organization' | 'facility' | 'team', scopeId };
  });
  if (selectedScopes.some((scope) => scope === null)) {
    redirect(`/administration/users/${id}?error=INVALID_REQUEST`);
  }
  const scopes =
    scopeMode === 'tenant'
      ? [{ scopeType: 'tenant' as const, scopeId: tenantId }]
      : selectedScopes.filter((scope) => scope !== null);

  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/admin/members/{id}/scopes', {
    params: { path: { id }, header: tenantHeader },
    body: { scopes },
  });
  if (error) redirect(`/administration/users/${id}?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/users');
  revalidatePath(`/administration/users/${id}`);
  redirect(`/administration/users/${id}?updated=scopes`);
}

export async function createOrganizationAction(formData: FormData): Promise<void> {
  const name = readText(formData, 'name');
  if (!name || name.length > 160) redirect('/administration/organizations?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/organizations', {
    params: { header: await getTenantHeader() },
    body: {
      name,
      legalName: readNullableText(formData, 'legalName'),
      code: readNullableText(formData, 'code'),
      address: readNullableText(formData, 'address'),
      phone: readNullableText(formData, 'phone'),
      email: readNullableText(formData, 'email'),
    },
  });
  if (error || !data)
    redirect(
      `/administration/organizations?error=${encodeURIComponent(error?.code ?? 'CREATE_FAILED')}`,
    );
  revalidatePath('/administration/organizations');
  redirect(`/administration/organizations/${data.id}`);
}

export async function updateOrganizationAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const name = readText(formData, 'name');
  if (!id || !name || name.length > 160)
    redirect('/administration/organizations?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/organizations/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      name,
      legalName: readNullableText(formData, 'legalName'),
      code: readNullableText(formData, 'code'),
      address: readNullableText(formData, 'address'),
      phone: readNullableText(formData, 'phone'),
      email: readNullableText(formData, 'email'),
    },
  });
  if (error)
    redirect(`/administration/organizations/${id}?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/organizations');
  revalidatePath(`/administration/organizations/${id}`);
  redirect(`/administration/organizations/${id}?updated=organization`);
}

export async function setOrganizationStatusAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const operation = formData.get('operation');
  if (!id || (operation !== 'activate' && operation !== 'archive')) {
    redirect('/administration/organizations?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const response =
    operation === 'activate'
      ? await api.POST('/api/v1/organizations/{id}/activate', {
          params: { path: { id }, header: await getTenantHeader() },
        })
      : await api.POST('/api/v1/organizations/{id}/archive', {
          params: { path: { id }, header: await getTenantHeader() },
        });
  if (response.error)
    redirect(
      `/administration/organizations/${id}?error=${encodeURIComponent(response.error.code)}`,
    );
  revalidatePath('/administration/organizations');
  revalidatePath(`/administration/organizations/${id}`);
  redirect(`/administration/organizations/${id}?updated=${operation}`);
}

export async function createFacilityAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const name = readText(formData, 'name');
  const redirectTo = organizationId
    ? `/administration/organizations/${organizationId}`
    : '/administration/facilities';
  if (!organizationId || !name || name.length > 160)
    redirect(`${redirectTo}?error=INVALID_REQUEST`);
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/facilities', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      name,
      code: readNullableText(formData, 'code'),
      address: readNullableText(formData, 'address'),
      phone: readNullableText(formData, 'phone'),
      email: readNullableText(formData, 'email'),
    },
  });
  if (error || !data)
    redirect(`${redirectTo}?error=${encodeURIComponent(error?.code ?? 'CREATE_FAILED')}`);
  revalidatePath('/administration/organizations');
  revalidatePath('/administration/facilities');
  revalidatePath(redirectTo);
  redirect(`/administration/facilities/${data.id}`);
}

export async function updateFacilityAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const name = readText(formData, 'name');
  if (!id || !name || name.length > 160)
    redirect('/administration/facilities?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/facilities/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      name,
      code: readNullableText(formData, 'code'),
      address: readNullableText(formData, 'address'),
      phone: readNullableText(formData, 'phone'),
      email: readNullableText(formData, 'email'),
    },
  });
  if (error) redirect(`/administration/facilities/${id}?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/facilities');
  revalidatePath(`/administration/facilities/${id}`);
  redirect(`/administration/facilities/${id}?updated=facility`);
}

export async function setFacilityStatusAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const operation = formData.get('operation');
  if (!id || (operation !== 'activate' && operation !== 'archive')) {
    redirect('/administration/facilities?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const response =
    operation === 'activate'
      ? await api.POST('/api/v1/facilities/{id}/activate', {
          params: { path: { id }, header: await getTenantHeader() },
        })
      : await api.POST('/api/v1/facilities/{id}/archive', {
          params: { path: { id }, header: await getTenantHeader() },
        });
  if (response.error)
    redirect(`/administration/facilities/${id}?error=${encodeURIComponent(response.error.code)}`);
  revalidatePath('/administration/facilities');
  revalidatePath(`/administration/facilities/${id}`);
  redirect(`/administration/facilities/${id}?updated=${operation}`);
}

export async function createTeamAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const facilityValue = readText(formData, 'facilityId');
  const facilityId = facilityValue ? readUuid(facilityValue) : null;
  const name = readText(formData, 'name');
  if (!organizationId || (facilityValue && !facilityId) || !name || name.length > 160) {
    redirect('/administration/teams?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/teams', {
    params: { header: await getTenantHeader() },
    body: { organizationId, facilityId, name },
  });
  if (error || !data)
    redirect(`/administration/teams?error=${encodeURIComponent(error?.code ?? 'CREATE_FAILED')}`);
  revalidatePath('/administration/teams');
  redirect(`/administration/teams/${data.id}`);
}

export async function updateTeamAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const facilityValue = readText(formData, 'facilityId');
  const facilityId = facilityValue ? readUuid(facilityValue) : null;
  const name = readText(formData, 'name');
  if (!id || (facilityValue && !facilityId) || !name || name.length > 160) {
    redirect('/administration/teams?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/teams/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { name, facilityId },
  });
  if (error) redirect(`/administration/teams/${id}?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/teams');
  revalidatePath(`/administration/teams/${id}`);
  redirect(`/administration/teams/${id}?updated=team`);
}

export async function setTeamStatusAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const operation = formData.get('operation');
  if (!id || (operation !== 'activate' && operation !== 'archive')) {
    redirect('/administration/teams?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const response =
    operation === 'activate'
      ? await api.POST('/api/v1/teams/{id}/activate', {
          params: { path: { id }, header: await getTenantHeader() },
        })
      : await api.POST('/api/v1/teams/{id}/archive', {
          params: { path: { id }, header: await getTenantHeader() },
        });
  if (response.error)
    redirect(`/administration/teams/${id}?error=${encodeURIComponent(response.error.code)}`);
  revalidatePath('/administration/teams');
  revalidatePath(`/administration/teams/${id}`);
  redirect(`/administration/teams/${id}?updated=${operation}`);
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableText(formData: FormData, name: string): string | null {
  const value = readText(formData, name);
  return value || null;
}
