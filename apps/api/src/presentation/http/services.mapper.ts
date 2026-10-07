import type {
  ServiceAvailabilitySnapshot,
  ServiceCategorySnapshot,
  ServiceDefinitionSnapshot,
  ServiceSearchItem,
} from '@care/services';
import type {
  ServiceAvailabilityResponseDto,
  ServiceCategoryResponseDto,
  ServiceListItemResponseDto,
  ServiceResponseDto,
} from './services.dto';

export function serviceCategoryResponse(
  category: ServiceCategorySnapshot,
): ServiceCategoryResponseDto {
  return {
    id: category.id,
    name: category.name,
    code: category.code ?? null,
    description: category.description ?? null,
    status: category.status,
    sortOrder: category.sortOrder ?? null,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function serviceResponse(service: ServiceDefinitionSnapshot): ServiceResponseDto {
  return {
    id: service.id,
    tenantId: service.tenantId,
    code: service.code,
    name: service.name,
    description: service.description ?? null,
    categoryId: service.categoryId,
    unit: service.unit,
    defaultDurationMinutes: service.defaultDurationMinutes ?? null,
    status: service.status,
    validFrom: service.validFrom,
    validUntil: service.validUntil ?? null,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

export function serviceListItemResponse(item: ServiceSearchItem): ServiceListItemResponseDto {
  return {
    ...serviceResponse(item.service),
    categoryName: item.categoryName,
    availabilityCount: item.availabilityCount,
  };
}

export function serviceAvailabilityResponse(
  item: ServiceAvailabilitySnapshot,
): ServiceAvailabilityResponseDto {
  return {
    id: item.id,
    serviceId: item.serviceId,
    organizationId: item.organizationId,
    facilityId: item.facilityId ?? null,
    active: item.active,
    validFrom: item.validFrom ?? null,
    validUntil: item.validUntil ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
