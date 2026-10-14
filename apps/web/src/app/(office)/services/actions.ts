'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import { getFacilitiesByIds } from '@app/web/lib/facility-lookup';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const units = ['occurrence', 'minute', 'hour', 'day'] as const;
const benefitCategories = ['recognized_support', 'clinical_nursing', 'other'] as const;
const pricingUnits = ['hour', 'minute', 'visit', 'fixed'] as const;

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
  if (error)
    redirect(`/services?error=${encodeURIComponent(apiErrorCode(error) ?? 'UNKNOWN_ERROR')}`);
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
  if (error)
    redirect(`/services?error=${encodeURIComponent(apiErrorCode(error) ?? 'UNKNOWN_ERROR')}`);
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
  if (error)
    redirect(`/services?error=${encodeURIComponent(apiErrorCode(error) ?? 'UNKNOWN_ERROR')}`);
  revalidatePath('/services');
  redirect('/services?updated=category');
}

export async function createServiceAction(formData: FormData): Promise<void> {
  const code = readString(formData, 'code');
  const name = readString(formData, 'name');
  const categoryId = readUuid(formData.get('categoryId'));
  const unit = readChoice(formData, 'unit', units);
  const benefitCategory = readChoice(formData, 'benefitCategory', benefitCategories);
  const validFrom = readString(formData, 'validFrom');
  const defaultDurationMinutes = readNullableInteger(formData, 'defaultDurationMinutes');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (
    !code ||
    !name ||
    !categoryId ||
    !unit ||
    !benefitCategory ||
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
      benefitCategory,
      validFrom,
      validUntil,
      defaultDurationMinutes,
      description: readNullableText(formData, 'description'),
    },
  });
  if (error || !data)
    redirect(`/services/new?error=${encodeURIComponent(apiErrorCode(error) ?? 'CREATE_FAILED')}`);
  revalidatePath('/services');
  redirect(`/services/${(data as { id: string }).id}`);
}

export async function updateServiceAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const code = readString(formData, 'code');
  const name = readString(formData, 'name');
  const categoryId = readUuid(formData.get('categoryId'));
  const unit = readChoice(formData, 'unit', units);
  const benefitCategory = readChoice(formData, 'benefitCategory', benefitCategories);
  const validFrom = readString(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  const defaultDurationMinutes = readNullableInteger(formData, 'defaultDurationMinutes');
  if (
    !id ||
    !code ||
    !name ||
    !categoryId ||
    !unit ||
    !benefitCategory ||
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
      benefitCategory,
      validFrom,
      validUntil,
      defaultDurationMinutes,
      description: readNullableText(formData, 'description'),
    },
  });
  if (error) redirect(servicePath(id, apiErrorCode(error) ?? 'UNKNOWN_ERROR'));
  refreshService(id);
  redirect(servicePath(id, ''));
}

export async function recordServicePriceAction(formData: FormData): Promise<void> {
  const serviceId = readUuid(formData.get('serviceId'));
  const organizationId = readUuid(formData.get('organizationId'));
  const facilityId = readUuid(formData.get('facilityId'));
  const priceCents = readEuroCents(readString(formData, 'price'));
  const pricingUnit = readChoice(formData, 'pricingUnit', pricingUnits);
  const validFrom = readString(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (
    !serviceId ||
    !organizationId ||
    !priceCents ||
    !pricingUnit ||
    !datePattern.test(validFrom) ||
    validUntil === undefined ||
    (validUntil !== null && validUntil <= validFrom)
  ) {
    redirect(servicePricePath(serviceId, organizationId, facilityId, validFrom, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/services/{serviceId}/prices', {
    params: { path: { serviceId }, header: await getTenantHeader() },
    body: {
      organizationId,
      ...(facilityId ? { facilityId } : {}),
      priceCents,
      pricingUnit,
      validFrom,
      validUntil,
    },
  });
  if (error)
    redirect(
      servicePricePath(
        serviceId,
        organizationId,
        facilityId,
        validFrom,
        apiErrorCode(error) ?? 'UNKNOWN_ERROR',
      ),
    );
  revalidatePath(`/services/${serviceId}`);
  revalidatePath('/planning');
  revalidatePath('/benefits');
  redirect(servicePricePath(serviceId, organizationId, facilityId, validFrom, null));
}

export async function archiveServiceAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  if (!id) redirect('/services?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/services/{id}/archive', {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error) redirect(servicePath(id, apiErrorCode(error) ?? 'UNKNOWN_ERROR'));
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
  const selectedOrganizationIds = readUuids(formData, 'organizationIds');
  const selectedFacilityIds = readUuids(formData, 'facilityIds');
  if (selectedOrganizationIds.length + selectedFacilityIds.length > 200)
    redirect(servicePath(id, 'INVALID_REQUEST'));
  const [organizationsResult, facilitiesResult] = await Promise.all([
    getOrganizationsByIds(selectedOrganizationIds),
    getFacilitiesByIds(selectedFacilityIds),
  ]);
  if (
    organizationsResult.failed ||
    facilitiesResult.failed ||
    organizationsResult.items.length !== selectedOrganizationIds.length ||
    facilitiesResult.items.length !== selectedFacilityIds.length
  ) {
    redirect(servicePath(id, 'PROVIDER_LIST_FAILED'));
  }
  const items = [
    ...selectedOrganizationIds.map((organizationId) => ({
      organizationId,
      active: true,
      validFrom,
      validUntil,
    })),
    ...facilitiesResult.items.map((facility) => ({
      organizationId: facility.organizationId,
      facilityId: facility.id,
      active: true,
      validFrom,
      validUntil,
    })),
  ];
  const { error } = await api.PUT('/api/v1/services/{id}/availability', {
    params: { path: { id }, header },
    body: { items },
  });
  if (error) redirect(servicePath(id, apiErrorCode(error) ?? 'UNKNOWN_ERROR'));
  refreshService(id);
  redirect(servicePath(id, ''));
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function apiErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
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

function readEuroCents(value: string): number | undefined {
  const match = /^(0|[1-9]\d*)(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2_000_000_000 ? cents : undefined;
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

function servicePricePath(
  id: string | undefined,
  organizationId: string | undefined,
  facilityId: string | undefined,
  validAt: string,
  error: string | null,
): string {
  if (!id) return '/services?error=INVALID_REQUEST';
  const query = new URLSearchParams();
  if (organizationId) query.set('priceOrganizationId', organizationId);
  if (facilityId) query.set('priceFacilityId', facilityId);
  if (datePattern.test(validAt)) query.set('priceDate', validAt);
  if (error) query.set('error', error);
  else query.set('updated', 'price');
  const suffix = query.toString();
  return `/services/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ''}`;
}

function refreshService(id: string): void {
  revalidatePath('/services');
  revalidatePath(`/services/${id}`);
}
