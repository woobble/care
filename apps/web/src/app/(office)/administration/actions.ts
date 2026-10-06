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
      (scopeType !== 'organization' && scopeType !== 'facility') ||
      !scopeId ||
      !uuidPattern.test(scopeId)
    ) {
      return null;
    }
    return { scopeType: scopeType as 'organization' | 'facility', scopeId };
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
