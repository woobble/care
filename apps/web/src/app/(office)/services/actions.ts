'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const units = ['occurrence', 'minute', 'hour', 'day'] as const;

export async function createServiceCategoryAction(formData: FormData): Promise<void> {
  const name = readString(formData, 'name');
  const sortOrder = readNullableInteger(formData, 'sortOrder');
  if (!name || sortOrder === undefined) redirect('/services?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/service-categories', {
    params: { header: await getTenantHeader() },
    body: {
      name,
      code: readNullableText(formData, 'code'),
      description: readNullableText(formData, 'description'),
      sortOrder,
    },
  });
  if (error) redirect(`/services?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/services');
  redirect('/services?updated=category');
}

export async function updateServiceCategoryAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('categoryId'));
  const name = readString(formData, 'name');
  const sortOrder = readNullableInteger(formData, 'sortOrder');
  if (!id || !name || sortOrder === undefined) redirect('/services?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/service-categories/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      name,
      code: readNullableText(formData, 'code'),
      description: readNullableText(formData, 'description'),
      sortOrder,
    },
  });
  if (error) redirect(`/services?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/services');
  redirect('/services?updated=category');
}

export async function archiveServiceCategoryAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('categoryId'));
  if (!id) redirect('/services?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/service-categories/{id}/archive', {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error) redirect(`/services?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/services');
  redirect('/services?updated=category');
}

export async function createServiceAction(formData: FormData): Promise<void> {
  const code = readString(formData, 'code');
  const name = readString(formData, 'name');
  const categoryId = readUuid(formData.get('categoryId'));
  const unit = readChoice(formData, 'unit', units);
  const validFrom = readString(formData, 'validFrom');
  const defaultDurationMinutes = readNullableInteger(formData, 'defaultDurationMinutes');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (
    !code ||
    !name ||
    !categoryId ||
    !unit ||
    !validFrom ||
    !datePattern.test(validFrom) ||
    validUntil === undefined ||
    defaultDurationMinutes === undefined
  )
    redirect('/services/new?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/services', {
    params: { header: await getTenantHeader() },
    body: {
      code,
      name,
      categoryId,
      unit,
      validFrom,
      validUntil,
      defaultDurationMinutes,
      description: readNullableText(formData, 'description'),
    },
  });
  if (error || !data)
    redirect(`/services/new?error=${encodeURIComponent(error?.code ?? 'CREATE_FAILED')}`);
  revalidatePath('/services');
  redirect(`/services/${data.id}`);
}

export async function updateServiceAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const code = readString(formData, 'code');
  const name = readString(formData, 'name');
  const categoryId = readUuid(formData.get('categoryId'));
  const unit = readChoice(formData, 'unit', units);
  const validFrom = readString(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  const defaultDurationMinutes = readNullableInteger(formData, 'defaultDurationMinutes');
  if (
    !id ||
    !code ||
    !name ||
    !categoryId ||
    !unit ||
    !validFrom ||
    !datePattern.test(validFrom) ||
    validUntil === undefined ||
    defaultDurationMinutes === undefined
  )
    redirect(servicePath(id, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/services/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      code,
      name,
      categoryId,
      unit,
      validFrom,
      validUntil,
      defaultDurationMinutes,
      description: readNullableText(formData, 'description'),
    },
  });
  if (error) redirect(servicePath(id, error.code));
  refreshService(id);
  redirect(servicePath(id, ''));
}

export async function archiveServiceAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  if (!id) redirect('/services?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/services/{id}/archive', {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error) redirect(servicePath(id, error.code));
  refreshService(id);
  redirect(servicePath(id, ''));
}

export async function setServiceAvailabilityAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const validFrom = readNullableDate(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (!id || validFrom === undefined || validUntil === undefined)
    redirect(servicePath(id, 'INVALID_REQUEST'));

  const api = await getApiClient();
  const header = await getTenantHeader();
  const [organizationsResult, facilitiesResult] = await Promise.all([
    api.GET('/api/v1/organizations', { params: { header } }),
    api.GET('/api/v1/facilities', { params: { header } }),
  ]);
  if (organizationsResult.error || facilitiesResult.error)
    redirect(servicePath(id, 'PROVIDER_LIST_FAILED'));
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const selectedOrganizationIds = new Set(
    readUuids(formData, 'organizationIds').filter((organizationId) =>
      organizations.some((organization) => organization.id === organizationId),
    ),
  );
  const selectedFacilityIds = new Set(
    readUuids(formData, 'facilityIds').filter((facilityId) =>
      facilities.some((facility) => facility.id === facilityId),
    ),
  );
  const items = [
    ...[...selectedOrganizationIds].map((organizationId) => ({
      organizationId,
      active: true,
      validFrom,
      validUntil,
    })),
    ...[...selectedFacilityIds].flatMap((facilityId) => {
      const facility = facilities.find((item) => item.id === facilityId);
      return facility
        ? [
            {
              organizationId: facility.organizationId,
              facilityId,
              active: true,
              validFrom,
              validUntil,
            },
          ]
        : [];
    }),
  ];
  const { error } = await api.PUT('/api/v1/services/{id}/availability', {
    params: { path: { id }, header },
    body: { items },
  });
  if (error) redirect(servicePath(id, error.code));
  refreshService(id);
  redirect(servicePath(id, ''));
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableText(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

function readNullableDate(formData: FormData, name: string): string | null | undefined {
  const value = readString(formData, name);
  if (!value) return null;
  return datePattern.test(value) ? value : undefined;
}

function readInteger(formData: FormData, name: string): number | undefined {
  const value = readString(formData, name);
  if (!value) return undefined;
  const result = Number(value);
  return Number.isInteger(result) ? result : undefined;
}

function readNullableInteger(formData: FormData, name: string): number | null | undefined {
  const value = readString(formData, name);
  if (!value) return null;
  return readInteger(formData, name);
}

function readUuid(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return uuidPattern.test(id) ? id : undefined;
}

function readUuids(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .map((value) => readUuid(value))
        .filter((id) => id !== undefined),
    ),
  ];
}

function readChoice<const Values extends readonly string[]>(
  formData: FormData,
  name: string,
  values: Values,
): Values[number] | undefined {
  const value = readString(formData, name);
  return values.includes(value) ? (value as Values[number]) : undefined;
}

function servicePath(id: string | undefined, error: string): string {
  if (!id) return '/services?error=INVALID_REQUEST';
  return error
    ? `/services/${encodeURIComponent(id)}?error=${encodeURIComponent(error)}`
    : `/services/${encodeURIComponent(id)}`;
}

function refreshService(id: string): void {
  revalidatePath('/services');
  revalidatePath(`/services/${id}`);
}
